/* Quote rows use the existing atomic save and durable outbox. The wizard keeps a
 * small edit journal in workflow.material_edits. Once an issued quote is edited
 * as rows, its saved items are authoritative and recipes cannot rebuild them.
 */
(function(root){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const fold=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const metadata=i=>i?.stored_metadata?.quote_material||{};
  const unlocked=q=>!!q&&q.status!=='approved'&&q._server_status!=='approved';
  const editable=i=>!!i;
  const extra=i=>['catalog','manual'].includes(metadata(i).origin);
  const isText=i=>i?.role==='quote_text'||metadata(i).kind==='text';
  const rowsMode=q=>q?.material_edits?.rows_mode===true;
  function scope(q,system=q.system_type){
    return JSON.stringify([q.category||'',q.category==='boiler'?(q.boiler_type||q.device?.boiler_type||'gas'):'',system||'',q.category==='air_conditioning'?(q.ac_mode||'single'):'']);
  }
  function key(i){
    if(extra(i))return 'extra:'+metadata(i).id;
    if(metadata(i).source_key)return metadata(i).source_key;
    return JSON.stringify([i.role||'',fold(i.pohoda?.code||i.pohoda_code||i.name),fold(i.unit||'ks')]);
  }
  function keepSource(i){
    if(extra(i)||metadata(i).source_key)return;
    const sourceKey=key(i);
    i.stored_metadata={...(i.stored_metadata||{}),quote_material:{...metadata(i),source_key:sourceKey,
      ...(i.pohoda?{catalog_ref:reference(i.pohoda)}:{})}};
  }
  function quantity(value,positive=false){
    const raw=String(value??'').trim().replace(',','.');
    if(!/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(raw))throw new Error('Zadajte platné množstvo, najviac na 3 desatinné miesta.');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<0||n>=100000000000||(positive&&n===0))throw new Error('Množstvo musí byť '+(positive?'väčšie ako nula.':'nezáporné a menšie ako 100 miliárd.'));
    return n;
  }
  function money(value){
    const raw=String(value??'').trim().replace(',','.');
    if(raw==='')return null;
    if(!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(raw))throw new Error('Zadajte nezápornú cenu, najviac na 4 desatinné miesta.');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<0||n>=100000000)throw new Error('Cena musí byť nezáporná a menšia ako 100 miliónov.');
    return n;
  }
  function text(value,label){
    const out=String(value??'').trim();
    if(!out||out.includes('\u0000'))throw new Error('Vyplňte platný '+label+'.');
    return out;
  }
  function journal(q){
    if(!q.material_edits||q.material_edits.version!==1)q.material_edits={version:1,active_scope:scope(q),scopes:{}};
    return q.material_edits;
  }
  function bucket(q,s=journal(q).active_scope||scope(q)){
    const j=journal(q);
    if(!j.scopes||typeof j.scopes!=='object')j.scopes={};
    if(!j.scopes[s])j.scopes[s]={removed:[],overrides:[],extras:[]};
    for(const field of ['removed','overrides','extras'])if(!Array.isArray(j.scopes[s][field]))j.scopes[s][field]=[];
    return j.scopes[s];
  }
  function enableRows(q){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknuté položky.');
    const j=journal(q);
    j.rows_mode=true;
    if(typeof j.pdf_detail!=='boolean')j.pdf_detail=false;
    delete q.warranty_consent;
    return q;
  }
  function setDetailedPdf(q,value){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknuté položky.');
    if(typeof value!=='boolean')throw new Error('Neplatné nastavenie rozpisu PDF.');
    journal(q).pdf_detail=value;
    delete q.warranty_consent;
    return value;
  }
  function isRoleRemoved(q,roles){
    const j=q?.material_edits;
    const b=j?.scopes?.[j.active_scope||scope(q)];
    const wanted=Array.isArray(roles)?roles:[roles];
    return wanted.some(role=>(b?.removed_roles||[]).includes(role));
  }
  function reference(st){
    return {...(st?.match_by==='code'?{match_by:'code'}:{}),id:st?.id||null,fingerprint:st?.fingerprint||null,plu:st?.plu||null,code:st?.code||null,storage_ref:st?.storage_ref||null};
  }
  function findStock(ref,stocks){
    if(!ref)return null;
    const rows=(stocks||[]).filter(x=>x.active!==false);
    if(ref.match_by==='code'){
      const code=String(ref.code??'').trim();if(!code)return null;
      const found=rows.filter(x=>String(x.code??'').trim()===code);
      if(found.length===1)return found[0];
      const scoped=ref.storage_ref?found.filter(x=>String(x.storage_ref??'')===String(ref.storage_ref)):[];
      return scoped.length===1?scoped[0]:null;
    }
    // Never silently choose a different warehouse/card when an exact ID exists.
    // PLU/code fallback cannot replace a missing exact stored card.
    for(const field of (ref.fingerprint||ref.id)?['fingerprint','id']:['plu']){
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
      if(metadata(i).origin==='manual'||isText(i))continue;
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
    if(!unlocked(q)||rowsMode(q))return;
    // Avoid adding a journal just by opening an untouched quote.
    if(!q.material_edits&&!(q.items||[]).some(i=>i.price_override||i.cost_override||extra(i)))return;
    const b=bucket(q);
    for(const i of q.items||[]){
      if(extra(i)){
        const n=b.extras.findIndex(x=>key(x)===key(i));
        if(n>=0)b.extras[n]=snapshot(i);else b.extras.push(snapshot(i));
      }else if(i.price_override||i.cost_override||b.overrides.some(x=>x.key===key(i))){
        keepSource(i);
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
    if(!unlocked(q)||rowsMode(q))return q.items;
    const j=q.material_edits;
    if(!j)return generated;
    j.active_scope=newScope;
    const b=bucket(q,newScope);
    const removed=new Set(b.removed);
    const changes=new Map(b.overrides.map(x=>[x.key,x]));
    const out=generated.filter(i=>!removed.has(key(i))).map(i=>{
      const sourceKey=key(i),o=changes.get(sourceKey);if(!o)return i;
      const copy={...i};
      keepSource(copy);
      for(const field of ['name','unit','qty'])if(o[field]!==undefined)copy[field]=o[field];
      if(o.price_override){copy.price=o.price;copy.price_override=true}
      if(o.cost_override){copy.cost=o.cost;copy.cost_override=true}
      return copy;
    });
    for(const saved of b.extras){
      const i=clone(saved);
      if(metadata(i).origin==='manual'){i.pohoda=null;out.push(i);continue;}
      const st=findStock(metadata(i).catalog_ref,stocks);
      i.pohoda=st;
      if(st){
        if(!metadata(i).name_override)i.name=st.name;
        i.pohoda_code=st.code||null;
        if(!i.price_override)i.price=st.sell_price_ex_vat==null?null:Number(st.sell_price_ex_vat);
        if(!i.cost_override)i.cost=st.purchase_price_ex_vat==null?null:Number(st.purchase_price_ex_vat);
        i.mapping_status='mapped';
      }else i.mapping_status='catalog_item_missing';
      out.push(i);
    }
    return out;
  }
  function setField(q,index,field,value){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknuté položky.');
    const i=q.items?.[index];if(!editable(i))throw new Error('Položka sa už v ponuke nenachádza.');
    if(!['name','unit','qty','price','cost'].includes(field))throw new Error('Toto pole položky nemožno upraviť.');
    if(isText(i)&&field!=='name')throw new Error('Textový riadok nemá množstvo ani cenu.');
    const parsed=field==='qty'?quantity(value):['price','cost'].includes(field)?money(value):text(value,field==='name'?'názov položky':'mernú jednotku');
    // Validate first: an invalid field must not change metadata, saved consent or rows.
    keepSource(i);
    i[field]=parsed;
    const patch={[field]:parsed};
    if(field==='price'||field==='cost'){i[field+'_override']=true;patch[field+'_override']=true;}
    if(field==='name'&&extra(i))i.stored_metadata.quote_material.name_override=true;
    if(!rowsMode(q)){
      if(extra(i))capture(q);else rememberOverride(bucket(q),key(i),patch);
    }
    delete q.warranty_consent;
    return i;
  }
  function setQuantity(q,index,value){return setField(q,index,'qty',value)}
  function remove(q,index){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknuté položky.');
    const i=q.items?.[index];if(!editable(i))throw new Error('Položka sa už v ponuke nenachádza.');
    if(!rowsMode(q)){
      const b=bucket(q),k=key(i);
      if(extra(i))b.extras=b.extras.filter(x=>key(x)!==k);
      else{
        if(!b.removed.includes(k))b.removed.push(k);
        if(!Array.isArray(b.removed_roles))b.removed_roles=[];
        if(i.role&&!b.removed_roles.includes(i.role))b.removed_roles.push(i.role);
      }
    }
    q.items.splice(index,1);
    delete q.warranty_consent;
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
      if(!editable(i)||isText(i)||metadata(i).origin==='manual'||fold(i.unit)!==fold(st.unit||'ks'))return false;
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
      visible:rowsMode(q),mapping_status:'mapped',customer_group:'Montážny materiál',note:'',
      stored_metadata:{quote_material:{origin:'catalog',id,kind:'item',catalog_ref:ref}}};
    if(!rowsMode(q))bucket(q).extras.push(snapshot(i));
    (q.items||(q.items=[])).push(i);
    delete q.warranty_consent;
    return {item:i,merged:false};
  }
  function addManual(q,values,id){
    if(!unlocked(q))throw new Error('Schválená ponuka má uzamknuté položky.');
    if(!id)throw new Error('Chýba identifikátor pridávanej položky.');
    const name=text(values?.name,'názov položky'),textOnly=values?.textOnly===true;
    const qty=textOnly?1:quantity(values?.qty??1);
    const unit=textOnly?'ks':text(values?.unit??'ks','mernú jednotku');
    const price=textOnly?0:money(values?.price),cost=textOnly?0:money(values?.cost);
    const i={role:textOnly?'quote_text':values?.service===true?'quote_manual_service':'quote_manual',name,qty,unit,pohoda:null,pohoda_code:null,pohoda_stock_id:null,
      price,cost,price_override:true,cost_override:true,visible:true,mapping_status:'manual',customer_group:'Doplnené položky',note:'',
      stored_metadata:{quote_material:{origin:'manual',id,kind:textOnly?'text':'item'}}};
    if(!rowsMode(q))bucket(q).extras.push(snapshot(i));
    (q.items||(q.items=[])).push(i);
    delete q.warranty_consent;
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
  const api={editable,unlocked,scope,key,quantity,money,capture,apply,setField,setQuantity,remove,add,addManual,
    isText,enableRows,rowsMode,setDetailedPdf,isRoleRemoved,search,findStock,snapshot,refreshExisting};
  root.SpektraQuoteMaterials=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
