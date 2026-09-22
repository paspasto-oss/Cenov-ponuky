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

  async function listStocks() {
    if (!client || !user) return [];
    const pageSize = 1000, out = [];
    for (let from=0;;from+=pageSize) {
      const { data, error } = await client.from('pohoda_stocks')
        .select('*').eq('active',true).range(from, from+pageSize-1);
      if (error) throw error;
      out.push(...(data||[]));
      if (!data || data.length < pageSize) break;
    }
    return out;
  }

  async function upsertStocks(rows, onProgress) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    const chunkSize = 200;
    let count = 0;
    const total = rows.length;

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
      raw_payload:x,
      synced_at:new Date().toISOString()
    }));

    for (let start=0; start<total; start+=chunkSize) {
      const payload = toPayload(rows.slice(start,start+chunkSize));
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
      if (onProgress) onProgress({count,total,percent:Math.round(count/total*100)});
      await new Promise(r=>setTimeout(r,35));
    }
    return count;
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

  async function listQuotes() {
    if (!client || !user) return [];
    const { data, error } = await client.from('quotes')
      .select('*, customers(*), quote_items(*)').order('updated_at',{ascending:false});
    if (error) throw error;
    return data || [];
  }

  async function saveQuote(q) {
    if (!client || !user) throw new Error('Online databáza nie je prihlásená.');
    let customerId = q.remote_customer_id || null;
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
      subtotal_ex_vat:q.net||0,
      vat_pct:q.vat_pct||23,
      total_inc_vat:q.total||0,
      price_complete:!!q.price_complete,
      updated_by:user.id,
      updated_at:new Date().toISOString()
    };
    let remoteId=q.remote_id||null;
    if(remoteId){
      const {error}=await client.from('quotes').update(quotePayload).eq('id',remoteId);
      if(error) throw error;
    }else{
      quotePayload.created_by=user.id;
      const {data,error}=await client.from('quotes').insert(quotePayload).select('id').single();
      if(error) throw error;
      remoteId=data.id;
    }
    await client.from('quote_items').delete().eq('quote_id',remoteId);
    if((q.items||[]).length){
      const payload=q.items.map((i,n)=>({
        quote_id:remoteId,sort_order:n,role:i.role||null,pohoda_stock_id:i.pohoda?.pohoda_stock_id||null,
        pohoda_code:i.pohoda?.code||i.pohoda_code||null,name:i.name,qty:i.qty||1,unit:i.unit||'ks',
        purchase_price_ex_vat:i.cost,sell_price_ex_vat:i.price,mapping_status:i.mapping_status||null,
        visible_to_customer:!!i.visible,customer_group:i.customer_group||null,
        metadata:{note:i.note||'',work_scope:i.work_scope||[]}
      }));
      const {error}=await client.from('quote_items').insert(payload);
      if(error) throw error;
    }
    return { remote_id:remoteId, remote_customer_id:customerId };
  }

  return { configured, init, signIn, signUp, signOut, isAuthenticated, getUser, getProfile, listStocks, upsertStocks, uploadQuoteImage, listQuotes, saveQuote };
})();