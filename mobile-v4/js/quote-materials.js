/* Quote material edits are layered over generated recipes, never over approved quotes.
 * The small edit journal lives in workflow.material_edits; item snapshots still use
 * the existing atomic save and durable outbox. No new database write path.
 */
(function(root){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const fold=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const protectedRoles=new Set(['device','installation','installation_service','heating_system_flush_cleaner_inhibitor','multisplit_indoor_units']);
  const metadata=i=>i?.stored_metadata?.quote_material||{};
  const unlocked=q=>!!q&&q.status!=='approved'&&q._server_status!=='approved';
  const editable=i=>!!i&&!protectedRoles.has(i.role);
  function scope(q,system=q.system_type){
    return JSON.stringify([q.category||'',q.category==='boiler'?(q.boiler_type||q.device?.boiler_type||'gas'):'',system||'',q.category==='air_conditioning'?(q.ac_mode||'single'):'']);
  }
  function key(i){
    if(metadata(i).origin==='catalog')return 'extra:'+metadata(i).id;
    return JSON.stringify([i.role||'',fold(i.pohoda?.code||i.pohoda_code||i.name),fold(i.unit||'ks')]);
  }
  function quantity(value,positive=false){
    const raw=String(value??'').trim().replace(',','.');
    if(!/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(raw))throw new Error('Zadajte platné množstvo, najviac na 3 desatinné miesta.');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<0||n>=100000000000||(positive&&n===0))throw new Error('Množstvo musí byť '+(positive?'väčšie ako nula.':'nezáporné a menšie ako 100 miliárd.'));
    return n;
  }
  function journal(q){
    if(!q.material_edits||q.material_edits.version!==1)q.material_edits={version:1,active_scope:scope(q),scopes:{}};
    return q.material_edits;
  }
  function bucket(q,s=journal(q).active_scope||scope(q)){
    const j=journal(q);
    if(!j.scopes||typeof j.scopes!=='object')j.scopes={};
    if(!j.scopes[s])j.scopes[s]={removed:[],overrides:[],extras:[]};
    return j.scopes[s];
  }
  function reference(st){
    return {id:st?.id||null,fingerprint:st?.fingerprint||null,plu:st?.plu||null,code:st?.code||null,storage_ref:st?.storage_ref||null};
  }
  function findStock(ref,stocks){
    if(!ref)return null;
    const rows=(stocks||[]).filter(x=>x.active!==false);
    // Never silently choose a different warehouse/card when an exact ID exists.
    for(const field of ['fingerprint','id','plu']){
      if(!ref[field])continue;
      const found=rows.filter(x=>String(x[field]||'')===String(ref[field]));
      if(found.length===1)return found[0];
      if(found.length>1&&ref.storage_ref){
        const exact=found.filter(x=>String(x.storage_ref||'')===String(ref.storage_ref));
        if(exact.length===1)return exact[0];
      }
    }
    if(ref.fingerprint||ref.id||ref.plu)return null;
    const found=rows.filter(x=>ref.code&&fold(x.code)===fold(ref.code)&&(!ref.storage_ref||String(x.storage_ref||'')===String(ref.storage_ref)));
    return found.length===1?found[0]:null;
  }
  function refreshExisting(q,stocks){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknuté ceny.');
    const missing=[];let updated=0;
    for(const i of q.items||[]){
      const saved=metadata(i).catalog_ref;
      const stockId=i.pohoda_stock_id;
      const code=i.pohoda_code||i.pohoda?.code;
      if(!saved&&!stockId&&!code&&!i.pohoda)continue;
      let st;
      if(saved)st=findStock(saved,stocks);
      else if(stockId){
        const found=(stocks||[]).filter(x=>x.active!==false&&String(x.pohoda_stock_id??'')===String(stockId)&&(!code||String(x.code)===String(code)));
        st=found.length===1?found[0]:null;
      }else if(i.pohoda?.id||i.pohoda?.fingerprint)st=findStock(reference(i.pohoda),stocks);
      else{
        const found=(stocks||[]).filter(x=>x.active!==false&&code&&String(x.code)===String(code));
        st=found.length===1?found[0]:null;
      }
      if(!st){missing.push(i.name);continue;}
      i.pohoda=st;
      for(const [field,source,override] of [['price','sell_price_ex_vat','price_override'],['cost','purchase_price_ex_vat','cost_override']]){
        if(i[override])continue;
        const value=st[source];
        i[field]=value==null||!Number.isFinite(Number(value))?null:Number(value);
      }
      updated++;
    }
    capture(q);
    return {updated,missing};
  }
  function snapshot(i){
    const out={};
    for(const k of ['role','name','qty','unit','pohoda_code','pohoda_stock_id','price','cost','visible','mapping_status','customer_group','note','work_scope','price_override','cost_override','stored_metadata']){
      if(i[k]!==undefined)out[k]=clone(i[k]);
    }
    return out;
  }
  function rememberOverride(b,k,patch){
    let o=b.overrides.find(x=>x.key===k);
    if(!o){o={key:k};b.overrides.push(o)}
    Object.assign(o,patch);
  }
  function capture(q){
    if(!unlocked(q))return;
    // Avoid adding a journal just by opening an untouched quote.
    if(!q.material_edits&&!(q.items||[]).some(i=>i.price_override||i.cost_override||metadata(i).origin==='catalog'))return;
    const b=bucket(q);
    for(const i of q.items||[]){
      if(metadata(i).origin==='catalog'){
        const n=b.extras.findIndex(x=>key(x)===key(i));
        if(n>=0)b.extras[n]=snapshot(i);else b.extras.push(snapshot(i));
      }else if(i.price_override||i.cost_override||b.overrides.some(x=>x.key===key(i))){
        const old=b.overrides.find(x=>x.key===key(i));
        if(old&&!i.cost_override){delete old.cost;delete old.cost_override}
        if(old&&!i.price_override){delete old.price;delete old.price_override}
        const p={};
        if(i.price_override){p.price=i.price;p.price_override=true}
        if(i.cost_override){p.cost=i.cost;p.cost_override=true}
        rememberOverride(b,key(i),p);
      }
    }
  }
  function apply(q,generated,stocks,newScope=scope(q)){
    if(!unlocked(q))return q.items;
    const j=q.material_edits;
    if(!j)return generated;
    j.active_scope=newScope;
    const b=bucket(q,newScope);
    const removed=new Set(b.removed);
    const changes=new Map(b.overrides.map(x=>[x.key,x]));
    const out=generated.filter(i=>!editable(i)||!removed.has(key(i))).map(i=>{
      const o=changes.get(key(i));if(!o)return i;
      const copy={...i};
      if(editable(i)&&o.qty!==undefined)copy.qty=o.qty;
      if(o.price_override){copy.price=o.price;copy.price_override=true}
      if(o.cost_override){copy.cost=o.cost;copy.cost_override=true}
      return copy;
    });
    for(const saved of b.extras){
      const i=clone(saved),st=findStock(metadata(i).catalog_ref,stocks);
      i.pohoda=st;
      if(st){
        i.name=st.name;i.pohoda_code=st.code||null;
        if(!i.price_override)i.price=st.sell_price_ex_vat==null?null:Number(st.sell_price_ex_vat);
        if(!i.cost_override)i.cost=st.purchase_price_ex_vat==null?null:Number(st.purchase_price_ex_vat);
        i.mapping_status='mapped';
      }else i.mapping_status='catalog_item_missing';
      out.push(i);
    }
    return out;
  }
  function setQuantity(q,index,value){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknutý materiál.');
    const i=q.items?.[index];if(!editable(i))throw new Error('Množstvo zariadenia alebo montážnej služby sa mení v technickom návrhu.');
    const qty=quantity(value),b=bucket(q);
    i.qty=qty;
    if(metadata(i).origin==='catalog')capture(q);else rememberOverride(b,key(i),{qty});
    return i;
  }
  function remove(q,index){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknutý materiál.');
    const i=q.items?.[index];if(!editable(i))throw new Error('Zariadenie a montážnu službu nemožno vymazať cez materiál.');
    const b=bucket(q),k=key(i);
    if(metadata(i).origin==='catalog')b.extras=b.extras.filter(x=>key(x)!==k);
    else if(!b.removed.includes(k))b.removed.push(k);
    q.items.splice(index,1);
    return i;
  }
  function add(q,st,value,id){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknutý materiál.');
    if(!st||st.active===false||!String(st.name||'').trim())throw new Error('Táto skladová karta už nie je dostupná. Obnovte vyhľadávanie.');
    const qty=quantity(value,true);
    if(!id)throw new Error('Chýba identifikátor pridávaného materiálu.');
    const ref=reference(st);
    // Repeated selection of the same exact card increases quantity instead of duplicating it.
    const index=(q.items||[]).findIndex(i=>{
      if(!editable(i)||fold(i.unit)!==fold(st.unit||'ks'))return false;
      const r=metadata(i).catalog_ref||(i.pohoda?reference(i.pohoda):null);
      if(!r)return false;
      return (ref.fingerprint&&r.fingerprint===ref.fingerprint)||(ref.id&&r.id===ref.id)||
        (!ref.id&&!ref.fingerprint&&ref.plu&&r.plu===ref.plu&&r.storage_ref===ref.storage_ref);
    });
    if(index>=0){setQuantity(q,index,String(Math.round((Number(q.items[index].qty)+qty)*1000)/1000));return {item:q.items[index],merged:true}}
    const i={role:'quote_material',name:st.name,qty,unit:st.unit||'ks',pohoda:st,pohoda_code:st.code||null,
      pohoda_stock_id:st.pohoda_stock_id||null,
      price:st.sell_price_ex_vat==null?null:Number(st.sell_price_ex_vat),
      cost:st.purchase_price_ex_vat==null?null:Number(st.purchase_price_ex_vat),
      visible:false,mapping_status:'mapped',customer_group:'Montážny materiál',note:'',
      stored_metadata:{quote_material:{origin:'catalog',id,catalog_ref:ref}}};
    const b=bucket(q);b.extras.push(snapshot(i));
    (q.items||(q.items=[])).push(i);
    return {item:i,merged:false};
  }
  function search(stocks,query,limit=20){
    const q=fold(query),terms=q.split(/\s+/).filter(Boolean);
    if(q.length<2)return {rows:[],total:0};
    const found=[];
    for(const st of stocks||[]){
      if(st.active===false)continue;
      const code=fold(st.code),plu=fold(st.plu),ean=fold(st.ean),name=fold(st.name);
      const text=[name,code,plu,ean,fold(st.manufacturer),fold(st.supplier_name)].join(' ');
      if(!terms.every(t=>text.includes(t)))continue;
      const rank=[code,plu,ean].includes(q)?0:name.startsWith(q)?1:Number(st.quantity_available)>0?2:3;
      found.push({st,rank});
    }
    found.sort((a,b)=>a.rank-b.rank||String(a.st.name).localeCompare(String(b.st.name),'sk')||String(a.st.id||a.st.plu||'').localeCompare(String(b.st.id||b.st.plu||'')));
    return {rows:found.slice(0,limit).map(x=>x.st),total:found.length};
  }
  const api={editable,unlocked,scope,key,quantity,capture,apply,setQuantity,remove,add,search,findStock,snapshot,refreshExisting};
  root.SpektraQuoteMaterials=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
