window.SpektraDB = (() => {
  let client = null;
  let user = null;

  function config() {
    return window.SPEKTRA_SUPABASE || {};
  }

  function configured() {
    const c = config();
    return !!(c.url && c.anonKey);
  }

  async function init() {
    if (!configured() || !window.supabase) return { online:false, reason:'not_configured' };
    client = window.supabase.createClient(config().url, config().anonKey, {
      auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    const { data } = await client.auth.getSession();
    user = data?.session?.user || null;
    return { online:true, authenticated:!!user, user };
  }

  async function signIn(email, password) {
    if (!client) await init();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    user = data.user;
    return user;
  }

  async function signUp(email, password, displayName) {
    if (!client) await init();
    const { data, error } = await client.auth.signUp({
      email, password,
      options:{ data:{ display_name: displayName || email.split('@')[0] } }
    });
    if (error) throw error;
    user = data.user || null;
    return { user:data.user, session:data.session };
  }

  async function getProfile() {
    if (!client || !user) return null;
    const { data, error } = await client.from('app_users')
      .select('user_id,display_name,role,active').eq('user_id',user.id).single();
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    user = null;
  }

  function isAuthenticated() { return !!user; }
  function getUser() { return user; }

  async function listStocks(options={}) {
    if (!client || !user) return [];

    const adminMode = !!options.admin;
    const forceRefresh = !!options.force;
    const fieldList = [
      'id','pohoda_stock_id','fingerprint','plu','code','ean','name','unit',
      'storage_ref','storage_name','stock_group_ref','stock_group',
      'supplier_name','manufacturer',
      'purchase_price_ex_vat','sell_price_ex_vat','sell_price_inc_vat',
      'quantity_available','min_limit','max_limit','quantity_to_order',
      'margin_pct','discount_pct','active','synced_at','image_url'
    ];
    if (adminMode) fieldList.push(
      'image_urls','image_storage_path','image_storage_paths',
      'image_source_ref','image_source_refs'
    );
    const fields = fieldList.join(',');

    const cacheGet = adminMode ? 'getAll' : 'getAllLite';
    const cacheMerge = adminMode ? 'merge' : 'mergeLite';
    const cacheReplace = adminMode ? 'replaceAll' : 'replaceAllLite';
    const versionKey = adminMode ? 'remote_stock_version_admin' : 'remote_stock_version_lite';
    const countKey = adminMode ? 'remote_stock_count_admin' : 'remote_stock_count_lite';

    let local = window.SpektraStockDB && window.SpektraStockDB[cacheGet]
      ? (await window.SpektraStockDB[cacheGet]().catch(()=>[])).filter(x=>x.active!==false)
      : [];
    const localVersion = window.SpektraStockDB
      ? await window.SpektraStockDB.getMeta(versionKey).catch(()=>null)
      : null;
    const localRemoteCount = window.SpektraStockDB
      ? await window.SpektraStockDB.getMeta(countKey).catch(()=>null)
      : null;

    let remoteVersion = null;
    let remoteCount = null;
    try {
      const [{data,error},{count,error:countError}] = await Promise.all([
        client.from('pohoda_stocks')
          .select('synced_at')
          .eq('active',true)
          .order('synced_at',{ascending:false})
          .limit(1)
          .maybeSingle(),
        client.from('pohoda_stocks')
          .select('id',{count:'exact',head:true})
          .eq('active',true)
      ]);
      if (error) throw error;
      if (countError) throw countError;
      remoteVersion = data?.synced_at || null;
      remoteCount = Number(count||0);
    } catch (e) {
      console.warn('Stock version/count check failed', e);
      if (local.length) {
        window.SPEKTRA_STOCKS_FROM_CACHE = true;
        return local;
      }
    }

    // Cache is trusted only when both version and item count match the server.
    if (
      !forceRefresh &&
      local.length &&
      localVersion &&
      remoteVersion &&
      localVersion >= remoteVersion &&
      Number(local.length) === Number(remoteCount)
    ) {
      window.SPEKTRA_STOCKS_FROM_CACHE = true;
      return local;
    }

    // If the local cache has the expected previous server count, an incremental refresh is safe.
    // Otherwise do a full reload. This repairs interrupted/partial mobile IndexedDB caches.
    const canIncrement =
      !forceRefresh &&
      local.length &&
      localVersion &&
      remoteVersion &&
      Number(local.length) === Number(localRemoteCount) &&
      Number(localRemoteCount) > 0;

    const pageSize = 900; // stay below common PostgREST max-row limits

    if (canIncrement) {
      const changed = [];
      for (let from=0;;from+=pageSize) {
        const { data, error } = await client.from('pohoda_stocks')
          .select(fields)
          .gt('synced_at',localVersion)
          .order('synced_at',{ascending:true})
          .order('id',{ascending:true})
          .range(from,from+pageSize-1);
        if (error) throw error;
        changed.push(...(data||[]));
        if (!data || data.length < pageSize) break;
      }

      const merged = new Map(local.map(x=>[x.fingerprint,x]));
      const mergedChanged = changed.map(x=>{
        const old = merged.get(x.fingerprint);
        return old ? {...old,...x} : x;
      });
      mergedChanged.forEach(x=>merged.set(x.fingerprint,x));
      const finalRows=[...merged.values()].filter(x=>x.active!==false);

      // If incremental result count does not match server, fall through to a full repair.
      if (finalRows.length === remoteCount) {
        if (mergedChanged.length && window.SpektraStockDB) await window.SpektraStockDB[cacheMerge](mergedChanged);
        if (window.SpektraStockDB) {
          if (remoteVersion) await window.SpektraStockDB.setMeta(versionKey,remoteVersion);
          await window.SpektraStockDB.setMeta(countKey,remoteCount);
        }
        window.SPEKTRA_STOCKS_FROM_CACHE = true;
        return finalRows;
      }
    }

    // Full refresh / cache repair.
    const out = [];
    for (let from=0;;from+=pageSize) {
      const { data, error } = await client.from('pohoda_stocks')
        .select(fields)
        .eq('active',true)
        .order('id',{ascending:true})
        .range(from,from+pageSize-1);
      if (error) throw error;
      out.push(...(data||[]));
      if (!data || data.length < pageSize) break;
    }

    if (remoteCount != null && out.length !== remoteCount) {
      throw new Error('Neúplné načítanie katalógu: server '+remoteCount+', načítané '+out.length+'.');
    }

    if (window.SpektraStockDB) {
      await window.SpektraStockDB[cacheReplace](out);
      if (remoteVersion) await window.SpektraStockDB.setMeta(versionKey,remoteVersion);
      await window.SpektraStockDB.setMeta(countKey,out.length);
    }
    window.SPEKTRA_STOCKS_FROM_CACHE = true;
    return out;
  }

  async function upsertStocks(rows, onProgress, options={}) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');

    // Postgres UPSERT nesmie dostať v jednom INSERT-e rovnaký conflict key dvakrát.
    // POHODA XML môže obsahovať tú istú kartu viackrát (sklady/dodávatelia/obrázky),
    // preto urobíme poslednú ochrannú deduplikáciu ešte tesne pred uploadom.
    const unique = new Map();
    let duplicateRows = 0;
    for (const raw of (rows||[])) {
      const x={...raw};
      const key=String(x.fingerprint||'').trim();
      if(!key) continue;
      if(!unique.has(key)){
        unique.set(key,x);
      }else{
        duplicateRows++;
        const prev=unique.get(key);
        const union=(a,b)=>[...new Set([...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])].filter(Boolean))];
        unique.set(key,{
          ...prev,...x,
          suppliers:union(prev.suppliers,x.suppliers),
          image_urls:union(prev.image_urls,x.image_urls),
          image_storage_paths:union(prev.image_storage_paths,x.image_storage_paths),
          image_source_refs:union(prev.image_source_refs,x.image_source_refs),
          image_url:x.image_url||prev.image_url||null,
          image_storage_path:x.image_storage_path||prev.image_storage_path||null,
          image_source_ref:x.image_source_ref||prev.image_source_ref||null
        });
      }
    }
    const uploadRows=[...unique.values()];
    const chunkSize = 200;
    let count = 0;
    const total = uploadRows.length;
    const syncToken = 'sync_'+Date.now()+'_'+Math.random().toString(36).slice(2,10);

    const toPayload = chunk => chunk.map(x => ({
      fingerprint:x.fingerprint,
      plu:x.plu||null,
      code:x.code||null,
      ean:x.ean||null,
      name:x.name,
      unit:x.unit||null,
      storage_ref:x.storage_ref||null,
      storage_name:x.storage_name||null,
      stock_group_ref:x.stock_group_ref||null,
      stock_group:x.stock_group||null,
      supplier_name:(x.suppliers||[]).join(', ')||x.supplier_name||null,
      manufacturer:x.manufacturer||null,
      image_url:x.image_url||null,
      image_urls:Array.isArray(x.image_urls)?x.image_urls:[],
      image_storage_path:x.image_storage_path||null,
      image_storage_paths:Array.isArray(x.image_storage_paths)?x.image_storage_paths:[],
      image_source_ref:x.image_source_ref||null,
      image_source_refs:Array.isArray(x.image_source_refs)?x.image_source_refs:[],
      purchase_price_ex_vat:x.purchase_price_ex_vat,
      sell_price_ex_vat:x.sell_price_ex_vat,
      sell_price_inc_vat:x.sell_price_inc_vat,
      quantity_available:x.quantity_available,
      min_limit:x.min_limit,
      max_limit:x.max_limit,
      quantity_to_order:x.quantity_to_order,
      margin_pct:x.margin_pct,
      discount_pct:x.discount_pct,
      active:true,
      sync_token:syncToken,
      raw_payload:{
        source_format:x.source_format||null,
        source_row:x.source_row||null
      },
      synced_at:new Date().toISOString()
    }));

    for (let start=0; start<total; start+=chunkSize) {
      const payload = toPayload(uploadRows.slice(start,start+chunkSize));
      let lastError = null;
      for (let attempt=1; attempt<=3; attempt++) {
        const { error } = await client.from('pohoda_stocks').upsert(payload,{onConflict:'fingerprint'});
        if (!error) { lastError=null; break; }
        lastError=error;
        if (attempt<3) await new Promise(r=>setTimeout(r, 500*attempt));
      }
      if (lastError) {
        throw new Error('Upload zásob zlyhal pri riadkoch '+(start+1)+'–'+(start+payload.length)+': '+lastError.message);
      }
      count += payload.length;
      if (onProgress) onProgress({count,total,percent:total?Math.round(count/total*100):100,duplicates_removed:duplicateRows});
      await new Promise(r=>setTimeout(r,35));
    }
    if (options.fullSync) {
      const deactivatedAt=new Date().toISOString();
      const legacy = await client.from('pohoda_stocks')
        .update({active:false,synced_at:deactivatedAt})
        .eq('active',true)
        .is('sync_token',null);
      if (legacy.error) throw legacy.error;

      const stale = await client.from('pohoda_stocks')
        .update({active:false,synced_at:deactivatedAt})
        .eq('active',true)
        .neq('sync_token',syncToken);
      if (stale.error) throw stale.error;
    }
    return count;
  }

  async function uploadProductImage(file, stockKey, filename) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    if (!file) throw new Error('Chýba obrázok produktu.');
    const type=(file.type||'').toLowerCase();
    const ext=type==='image/png'?'png':type==='image/webp'?'webp':type==='image/gif'?'gif':'jpg';
    const safeKey=String(stockKey||'stock').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100);
    const base=String(filename||file.name||('image.'+ext)).replace(/[^a-zA-Z0-9._-]/g,'_').slice(-140);
    const finalName=/\.[a-z0-9]+$/i.test(base)?base:(base+'.'+ext);
    const path=safeKey+'/'+finalName;
    const { error } = await client.storage.from('product-images').upload(path,file,{
      cacheControl:'86400',
      upsert:true,
      contentType:file.type||'image/jpeg'
    });
    if (error) throw error;
    const { data } = client.storage.from('product-images').getPublicUrl(path);
    return { path, url:data.publicUrl };
  }

  async function uploadQuoteImage(file, quoteKey) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    if (!file) throw new Error('Chýba obrázok.');
    const ext=(file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg');
    const safe=String(quoteKey||'quote').replace(/[^a-zA-Z0-9_-]/g,'_');
    const path=user.id+'/'+safe+'/'+Date.now()+'.'+ext;
    const { error } = await client.storage.from('quote-images').upload(path,file,{
      cacheControl:'3600',
      upsert:false,
      contentType:file.type||'image/jpeg'
    });
    if (error) throw error;
    const { data } = client.storage.from('quote-images').getPublicUrl(path);
    return { path, url:data.publicUrl };
  }

  async function listPdfBanners() {
    if (!client || !user) return [];
    const { data, error } = await client.from('pdf_banners')
      .select('banner_key,label,asset_url,sort_order,updated_at')
      .eq('active',true)
      .order('sort_order',{ascending:true});
    if (error) throw error;
    return data || [];
  }

  async function listQuotes() {
    if (!client || !user) return [];
    const { data, error } = await client.from('quotes')
      .select('*, customers(*), quote_items(*)')
      .order('created_at',{ascending:false})
      .limit(1000);
    if (error) throw error;
    return data || [];
  }

  async function nextQuoteNo() {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    const { data, error } = await client.rpc('next_quote_no');
    if (error) throw error;
    return data;
  }

  function workflowState(q) {
    const safeImages=(q.pdf_images||[]).filter(x=>x?.url && !String(x.url).startsWith('data:')).map(x=>({
      url:x.url,path:x.path||null,name:x.name||'',source:x.source||''
    }));
    return {
      boiler_type:q.boiler_type||null,
      ac_mode:q.ac_mode||null,
      multisplit_count:q.multisplit_count||null,
      required_kw:q.required_kw??null,
      target_kw:q.target_kw??null,
      economy_ready:!!q.economy_ready,
      pdf_images_enabled:!!q.pdf_images_enabled,
      pdf_images_user_disabled:!!q.pdf_images_user_disabled,
      pdf_images:safeImages,
      pdf_template:q.pdf_template||'presentation',
      pdf_banner_mode:q.pdf_banner_mode||'auto',
      pdf_banner_url:q.pdf_banner_url&&!String(q.pdf_banner_url).startsWith('data:')?q.pdf_banner_url:null,
      pdf_banner_path:q.pdf_banner_path||null,
      pohoda_offer_exported_at:q.pohoda_offer_exported_at||null,
      pohoda_offer_export_file:q.pohoda_offer_export_file||null,
      server_quote_no:!!q._server_quote_no,
      inspection_id:q.inspection_id||null,
      inspection_materials:Array.isArray(q.inspection_materials)?q.inspection_materials:[],
      inspection_installation:q.inspection_installation||{},
      inspection_routes:q.inspection_routes||{},
      inspection_extra_work:Array.isArray(q.inspection_extra_work)?q.inspection_extra_work:[],
      inspection_notes:q.inspection_notes||null,
      warranty_consent:q.warranty_consent?.accepted && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(q.warranty_consent.signature_data_url||'')
        ? {accepted:true,signature_data_url:q.warranty_consent.signature_data_url,signed_at:q.warranty_consent.signed_at||null,offer_key:q.warranty_consent.offer_key||null}
        : null
    };
  }

  async function saveQuote(q) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');

    let remoteId=q.remote_id||null;
    let customerId=q.remote_customer_id||null;

    if(!remoteId && q.id){
      const {data:existing,error:existingError}=await client.from('quotes')
        .select('id,customer_id,quote_no')
        .eq('local_id',q.id)
        .maybeSingle();
      if(existingError) throw existingError;
      if(existing){
        remoteId=existing.id;
        customerId=existing.customer_id||customerId;
        q.quote_no=existing.quote_no||q.quote_no;
        q._server_quote_no=true;
      }
    }

    if(!remoteId && !q._server_quote_no){
      q.quote_no=await nextQuoteNo();
      q._server_quote_no=true;
    }

    if (!customerId) {
      const { data, error } = await client.from('customers').insert({
        name:q.customer?.name || 'Bez mena',
        phone:q.customer?.phone || null,
        email:q.customer?.email || null,
        address:q.customer?.address || null,
        notes:q.customer?.note || null,
        created_by:user.id
      }).select('id').single();
      if (error) throw error;
      customerId = data.id;
    } else {
      const { error } = await client.from('customers').update({
        name:q.customer?.name || 'Bez mena',
        phone:q.customer?.phone || null,
        email:q.customer?.email || null,
        address:q.customer?.address || null,
        notes:q.customer?.note || null,
        updated_at:new Date().toISOString()
      }).eq('id',customerId);
      if(error) throw error;
    }

    const quotePayload = {
      local_id:q.id,
      quote_no:q.quote_no,
      customer_id:customerId,
      status:q.status||'draft',
      category:q.category||null,
      brand:q.brand||null,
      system_type:q.system_type||null,
      installation_tier:q.installation_tier||'standard',
      building:q.building||{},
      device:q.device||{},
      optional_services:q.optional_services||{},
      subsidy:q.subsidy||{},
      workflow:workflowState(q),
      subtotal_ex_vat:q.net||0,
      vat_pct:q.vat_pct||23,
      total_inc_vat:q.total||0,
      price_complete:!!q.price_complete,
      updated_by:user.id,
      updated_at:new Date().toISOString()
    };

    if(remoteId){
      const {error}=await client.from('quotes').update(quotePayload).eq('id',remoteId);
      if(error) throw error;
    }else{
      quotePayload.created_by=user.id;
      let ins=await client.from('quotes').insert(quotePayload).select('id,quote_no,updated_at').single();
      if(ins.error && (ins.error.code==='23505'||String(ins.error.message||'').toLowerCase().includes('duplicate'))){
        q.quote_no=await nextQuoteNo();
        quotePayload.quote_no=q.quote_no;
        ins=await client.from('quotes').insert(quotePayload).select('id,quote_no,updated_at').single();
      }
      if(ins.error) throw ins.error;
      remoteId=ins.data.id;
      q.quote_no=ins.data.quote_no||q.quote_no;
      q._server_quote_no=true;
    }

    await client.from('quote_items').delete().eq('quote_id',remoteId);
    if((q.items||[]).length){
      const payload=q.items.map((i,n)=>({
        quote_id:remoteId,sort_order:n,role:i.role||null,pohoda_stock_id:i.pohoda?.pohoda_stock_id||null,
        pohoda_code:i.pohoda?.code||i.pohoda_code||null,name:i.name,qty:i.qty||1,unit:i.unit||'ks',
        purchase_price_ex_vat:i.cost,sell_price_ex_vat:i.price,mapping_status:i.mapping_status||null,
        visible_to_customer:!!i.visible,customer_group:i.customer_group||null,
        metadata:{
          note:i.note||'',
          work_scope:i.work_scope||[],
          price_override:i.price_override===true,
          cost_override:i.cost_override===true
        }
      }));
      const {error}=await client.from('quote_items').insert(payload);
      if(error) throw error;
    }
    return {
      remote_id:remoteId,
      remote_customer_id:customerId,
      quote_no:q.quote_no,
      server_quote_no:true
    };
  }


  // ------------------------------------------------------------
  // Field inspections / site surveys
  // Additive module: existing quote behaviour remains unchanged.
  // ------------------------------------------------------------

  async function listInspections(limit=1000) {
    if (!client || !user) return [];
    const { data, error } = await client.from('inspections')
      .select('*, customers(id,name,phone,email,address,notes), inspection_materials(*), inspection_photos(*), inspection_quotes(quote_id,relation_type,created_at)')
      .order('created_at',{ascending:false})
      .limit(limit);
    if (error) throw error;

    const rows=data||[];
    const paths=[];
    rows.forEach(r=>(r.inspection_photos||[]).forEach(p=>{ if(p.storage_path) paths.push(p.storage_path); }));
    const signedMap=new Map();
    if(paths.length){
      const unique=[...new Set(paths)];
      const {data:signed,error:signedError}=await client.storage.from('inspection-media').createSignedUrls(unique,3600);
      if(!signedError){
        (signed||[]).forEach(x=>{
          const path=x.path||x.fullPath||null;
          if(path&&x.signedUrl)signedMap.set(path,x.signedUrl);
        });
      }
    }
    rows.forEach(r=>{
      r.inspection_photos=(r.inspection_photos||[]).map(p=>({...p,signed_url:signedMap.get(p.storage_path)||null}));
    });
    return rows;
  }

  async function findInspectionByLocalId(localId) {
    if (!client || !user || !localId) return null;
    const {data,error}=await client.from('inspections')
      .select('id,customer_id,status,updated_at,sync_version')
      .eq('local_id',localId)
      .maybeSingle();
    if(error)throw error;
    return data||null;
  }

  async function ensureInspectionCustomer(i) {
    let customerId=i.customer_id||i.remote_customer_id||null;
    const c=i.customer||{};
    if(!customerId && c.phone){
      const {data}=await client.from('customers').select('id').eq('phone',c.phone).limit(1).maybeSingle();
      if(data?.id)customerId=data.id;
    }
    if(!customerId && c.email){
      const {data}=await client.from('customers').select('id').eq('email',c.email).limit(1).maybeSingle();
      if(data?.id)customerId=data.id;
    }
    if(!customerId){
      const {data,error}=await client.from('customers').insert({
        name:c.name||'Bez mena',
        phone:c.phone||null,
        email:c.email||null,
        address:c.address||i.site_address||null,
        notes:c.notes||null,
        created_by:user.id
      }).select('id').single();
      if(error)throw error;
      customerId=data.id;
    }else{
      const {error}=await client.from('customers').update({
        name:c.name||'Bez mena',
        phone:c.phone||null,
        email:c.email||null,
        address:c.address||i.site_address||null,
        notes:c.notes||null,
        updated_at:new Date().toISOString()
      }).eq('id',customerId);
      if(error)throw error;
    }
    return customerId;
  }

  async function saveInspection(i, eventType=null) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    if(!i)throw new Error('Chýba obhliadka.');

    let remoteId=i.remote_id||i.id_remote||null;
    let customerId=i.customer_id||i.remote_customer_id||null;

    if(!remoteId && i.local_id){
      const existing=await findInspectionByLocalId(i.local_id);
      if(existing){
        remoteId=existing.id;
        customerId=existing.customer_id||customerId;
      }
    }

    // Always persist current customer/contact edits as well. When customerId
    // already exists, ensureInspectionCustomer performs an UPDATE instead of
    // silently leaving stale customer data behind.
    i.customer_id=customerId;
    customerId=await ensureInspectionCustomer(i);
    i.customer_id=customerId;

    const now=new Date().toISOString();
    const payload={
      local_id:i.local_id||null,
      sync_version:Math.max(1,Number(i.sync_version||1)),
      customer_id:customerId,
      technician_id:i.technician_id||user.id,
      status:i.status||'draft',
      inspection_types:Array.isArray(i.inspection_types)?i.inspection_types:[],
      site_address:i.site_address||i.customer?.address||null,
      site_contact_name:i.site_contact_name||i.customer?.name||null,
      site_phone:i.site_phone||i.customer?.phone||null,
      site_email:i.site_email||i.customer?.email||null,
      building:i.building||{},
      existing_system:i.existing_system||{},
      heat_loss:i.heat_loss||{},
      proposed_device_stock_id:i.proposed_device_stock_id||null,
      proposed_device:i.proposed_device||{},
      outdoor_unit:i.outdoor_unit||{},
      plant_room:i.plant_room||{},
      electrical:i.electrical||{},
      routes:i.routes||{},
      extra_work:Array.isArray(i.extra_work)?i.extra_work:[],
      installation:i.installation||{},
      checklist:i.checklist||{},
      notes:i.notes||null,
      inspected_at:i.inspected_at||null,
      updated_by:user.id,
      updated_at:now
    };

    let row=null;
    if(remoteId){
      const expectedVersion=Math.max(1,Number(i.sync_version||1));
      payload.sync_version=expectedVersion+1;
      const {data,error}=await client.from('inspections').update(payload)
        .eq('id',remoteId)
        .eq('sync_version',expectedVersion)
        .select('id,customer_id,status,updated_at,sync_version')
        .maybeSingle();
      if(error)throw error;
      if(!data)throw new Error('Obhliadka bola medzitým zmenená na inom zariadení. Synchronizuj ju a skontroluj zmeny pred ďalším uložením.');
      row=data;
    }else{
      const {data,error}=await client.from('inspections').insert(payload)
        .select('id,customer_id,status,updated_at,sync_version').single();
      if(error)throw error;
      row=data;
      remoteId=row.id;
    }

    const {error:delError}=await client.from('inspection_materials').delete().eq('inspection_id',remoteId);
    if(delError)throw delError;
    const materials=Array.isArray(i.materials)?i.materials:[];
    if(materials.length){
      const mp=materials.filter(x=>x?.name).map((m,n)=>({
        inspection_id:remoteId,
        pohoda_stock_id:m.pohoda_stock_id||null,
        sort_order:n,
        role:m.role||null,
        code:m.code||null,
        name:m.name,
        qty:Number(m.qty||0),
        unit:m.unit||'ks',
        source:m.source||'manual',
        original_qty:m.original_qty==null?null:Number(m.original_qty),
        metadata:m.metadata||{}
      }));
      if(mp.length){
        const {error}=await client.from('inspection_materials').insert(mp);
        if(error)throw error;
      }
    }

    if(eventType){
      const {error}=await client.from('inspection_events').insert({
        inspection_id:remoteId,
        event_type:eventType,
        payload:{status:payload.status,local_id:i.local_id||null}
      });
      if(error)console.warn('Inspection event insert failed',error);
    }

    return {
      remote_id:row.id,
      customer_id:row.customer_id,
      status:row.status,
      updated_at:row.updated_at,
      sync_version:row.sync_version
    };
  }

  async function uploadInspectionPhoto(inspectionId,file,category,isRequired=false,meta={}) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    if(!inspectionId||!file)throw new Error('Chýba obhliadka alebo fotografia.');
    const type=(file.type||'image/jpeg').toLowerCase();
    const ext=type.includes('png')?'png':type.includes('webp')?'webp':type.includes('heic')?'heic':type.includes('heif')?'heif':'jpg';
    const safeCat=String(category||'other').replace(/[^a-zA-Z0-9_-]/g,'_');
    const safeName=String(file.name||('photo.'+ext)).replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120);
    const path=user.id+'/'+inspectionId+'/'+safeCat+'/'+Date.now()+'_'+safeName;
    const {error:uploadError}=await client.storage.from('inspection-media').upload(path,file,{
      cacheControl:'3600',upsert:false,contentType:file.type||'image/jpeg'
    });
    if(uploadError)throw uploadError;
    const photoPayload={
      inspection_id:inspectionId,
      category:category||'other',
      storage_path:path,
      file_name:file.name||null,
      local_photo_key:meta.local_photo_key||null,
      original_file_name:meta.original_file_name||file.name||null,
      drive_file_url:meta.drive_file_url||null,
      drive_folder_url:meta.drive_folder_url||null,
      sync_status:meta.sync_status||'preview_uploaded',
      file_size_original:meta.file_size_original==null?null:Number(meta.file_size_original),
      file_size_preview:meta.file_size_preview==null?(file.size||null):Number(meta.file_size_preview),
      is_required:!!isRequired
    };
    let {data:photo,error}=await client.from('inspection_photos').insert(photoPayload).select('*').single();
    if(error&&/schema cache|column .* does not exist|Could not find the .* column/i.test(String(error.message||error.details||''))){
      const fallbackPayload={...photoPayload};
      delete fallbackPayload.drive_file_url;
      delete fallbackPayload.drive_folder_url;
      delete fallbackPayload.file_size_original;
      delete fallbackPayload.file_size_preview;
      delete fallbackPayload.original_file_name;
      delete fallbackPayload.sync_status;
      ({data:photo,error}=await client.from('inspection_photos').insert(fallbackPayload).select('*').single());
    }
    if(error){
      await client.storage.from('inspection-media').remove([path]).catch(()=>{});
      throw error;
    }
    const {data:signed}=await client.storage.from('inspection-media').createSignedUrl(path,3600);
    return {...photo,signed_url:signed?.signedUrl||null};
  }

  async function deleteInspectionPhoto(photo) {
    if (!client || !user || !photo?.id) return;
    if(photo.storage_path){
      const {error}=await client.storage.from('inspection-media').remove([photo.storage_path]);
      if(error)console.warn('Inspection media remove failed',error);
    }
    const {error}=await client.from('inspection_photos').delete().eq('id',photo.id);
    if(error)throw error;
  }

  async function linkInspectionQuote(inspectionId,quoteId,relationType='generated') {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    if(!inspectionId||!quoteId)throw new Error('Chýba obhliadka alebo ponuka.');
    const {error}=await client.from('inspection_quotes').upsert({
      inspection_id:inspectionId,
      quote_id:quoteId,
      relation_type:relationType
    },{onConflict:'inspection_id,quote_id'});
    if(error)throw error;
    const {error:updateError}=await client.from('inspections').update({
      status:'converted',
      updated_by:user.id,
      updated_at:new Date().toISOString()
    }).eq('id',inspectionId);
    if(updateError)throw updateError;
  }

  async function deleteDraftInspection(inspectionId) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    const {error}=await client.from('inspections').delete().eq('id',inspectionId).eq('status','draft');
    if(error)throw error;
  }

  return { configured, init, signIn, signUp, signOut, isAuthenticated, getUser, getProfile, listStocks, upsertStocks, uploadProductImage, uploadQuoteImage, listPdfBanners, listQuotes, nextQuoteNo, saveQuote, listInspections, saveInspection, uploadInspectionPhoto, deleteInspectionPhoto, linkInspectionQuote, deleteDraftInspection };
})();
