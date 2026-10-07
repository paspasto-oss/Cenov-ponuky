/* Reusable assemblies inside the existing flat quote storage contract.
 * Only q.items are billed. Group headers, optional items not selected and
 * variant snapshots never enter that array. Read helpers never edit a quote.
 * Network access, persistence, quote numbering and totals belong to the app.
 */
(function(root){
  'use strict';
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const kinds=new Set(['equipment','material','labor','transport','revision','pressure','service','text','other']);
  const labels={equipment:'Zariadenia',material:'Montážny materiál',labor:'Montáž',transport:'Doprava',revision:'Revízia',pressure:'Tlaková skúška',service:'Ďalšie služby',text:'Poznámky',other:'Ďalšie položky'};
  const modes=new Set(['summary','contents','detail']);
  const metadata=row=>object(row?.stored_metadata?.quote_assembly)?row.stored_metadata.quote_assembly:{};
  const materialMetadata=row=>row?.stored_metadata?.quote_material||{};
  const rowId=row=>metadata(row).id||null;
  const unlocked=q=>!!q&&q.status!=='approved'&&q._server_status!=='approved';
  const isText=row=>row?.role==='quote_text'||metadata(row).kind==='text'||materialMetadata(row).kind==='text';
  const rounded=(value,digits=2)=>Math.round((value+Number.EPSILON)*10**digits)/10**digits;

  function text(value,label='názov'){
    const out=String(value??'').trim();
    if(!out||out.includes('\u0000'))throw new Error('Vyplňte platný '+label+'.');
    return out;
  }
  function decimal(value,precision,limit,nullable,label){
    if(nullable&&(value==null||String(value).trim()===''))return null;
    if(typeof value==='boolean'||(typeof value!=='number'&&typeof value!=='string'))throw new Error('Neplatná '+label+'.');
    const raw=String(value??'').trim().replace(',','.');
    const pattern=new RegExp('^(?:\\d+(?:\\.\\d{1,'+precision+'})?|\\.\\d{1,'+precision+'})$');
    const n=Number(raw);
    if(!pattern.test(raw)||!Number.isFinite(n)||n<0||n>=limit)throw new Error('Zadajte nezápornú hodnotu: '+label+' (najviac '+precision+' desatinné miesta).');
    return n;
  }
  const quantity=value=>decimal(value,3,100000000000,false,'množstvo');
  const money=value=>decimal(value,4,100000000,true,'cena');
  function number(value){
    if(value==null||typeof value==='boolean'||String(value).trim()==='')return null;
    const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
  }
  function kind(row){
    const saved=metadata(row).kind;if(kinds.has(saved))return saved;
    if(isText(row))return 'text';
    const role=String(row?.role||'').toLowerCase();
    if(['device','multisplit_indoor_units','equipment'].includes(role))return 'equipment';
    if(/^(transport|delivery|travel|doprava)(_|$)/.test(role))return 'transport';
    if(/(^|_)(revision|revisia|revizia)(_|$)/.test(role))return 'revision';
    if(/(^|_)(pressure_test|pressure_protocol|tlakova_skuska)(_|$)/.test(role))return 'pressure';
    if(['installation','installation_service','quote_manual_service','wall_penetration_80mm_50cm','zti_base_work'].includes(role))return 'labor';
    if(['heating_system_flush_cleaner_inhibitor','annual_service'].includes(role)||role.endsWith('_service'))return 'service';
    return 'material';
  }
  function reference(stock={}){
    const ref={source:stock.source||'pohoda'};
    for(const key of ['id','fingerprint','plu','code','storage_ref','pohoda_stock_id'])ref[key]=stock[key]??null;
    return ref;
  }
  function catalogReference(row){
    if(object(metadata(row).catalog_ref))return reference(metadata(row).catalog_ref);
    if(object(materialMetadata(row).catalog_ref))return reference(materialMetadata(row).catalog_ref);
    if(object(row?.catalog_ref))return reference(row.catalog_ref);
    // Persisted stock ID wins over a convenience catalog object hydrated by code.
    if(row?.pohoda_stock_id!=null)return reference({pohoda_stock_id:row.pohoda_stock_id,code:row.pohoda_code||row.pohoda?.code});
    if(object(row?.pohoda))return reference(row.pohoda);
    if(row?.pohoda_code)return reference({code:row.pohoda_code});
    return null;
  }
  function findStock(ref,stocks=[]){
    if(!ref)return null;
    const rows=stocks.filter(s=>s&&s.active!==false&&(!ref.storage_ref||String(s.storage_ref??'')===String(ref.storage_ref)));
    const match=field=>rows.filter(s=>s[field]!=null&&String(s[field])===String(ref[field]));
    if(ref.fingerprint||ref.id){
      for(const field of ['fingerprint','id']){
        if(!ref[field])continue;const found=match(field);if(found.length===1)return found[0];
      }
      return null; // A missing exact card must not fall back to a similar code.
    }
    if(ref.pohoda_stock_id!=null){
      const found=match('pohoda_stock_id').filter(s=>!ref.code||String(s.code)===String(ref.code));
      return found.length===1?found[0]:null;
    }
    if(ref.plu){const found=match('plu');return found.length===1?found[0]:null;}
    if(ref.code){const found=match('code');return found.length===1?found[0]:null;}
    return null;
  }
  function manualFlags(row){
    const m=metadata(row),flags={...(object(m.manual)?m.manual:{})};
    if(row?.price_override===true)flags.price=true;
    if(row?.cost_override===true)flags.cost=true;
    if(m.manual_quantity===true)flags.qty=true;
    if(m.baseline_quantity!=null&&number(row?.qty)!==number(m.baseline_quantity))flags.qty=true;
    return flags;
  }
  function amounts(row){
    if(isText(row))return {unit:null,amount:null,cost:null};
    const qty=number(row?.qty),price=number(row?.price),cost=number(row?.cost);
    const knownCost=cost!=null&&(cost>0||row?.cost_override===true||row?.stored_metadata?.cost_override===true||metadata(row).cost_known===true);
    return {unit:price,amount:qty!=null&&price!=null?qty*price:null,
      cost:qty===0?0:qty!=null&&knownCost?qty*cost:row?.mapping_status==='included_in_installation'&&price===0?0:null};
  }
  function assertEditable(q){if(!unlocked(q))throw new Error('Schválená ponuka má uzamknuté položky. Vytvorte novú revíziu.');}
  function identity(state,prefix,used){
    state.next_id=Number.isInteger(state.next_id)&&state.next_id>0?state.next_id:1;
    let id;do{id=prefix+'-'+state.next_id++;}while(used.has(id));used.add(id);return id;
  }
  function cleanContents(contents){
    if(!Array.isArray(contents))throw new Error('Rozsah zostavy musí byť zoznam položiek.');
    return contents.map(entry=>{
      if(typeof entry==='string')return {name:text(entry,'popis úkonu')};
      if(!object(entry))throw new Error('Neplatný riadok rozsahu zostavy.');
      const row={name:text(entry.name,'popis úkonu')};
      if(entry.qty!=null)row.qty=quantity(entry.qty);
      if(entry.unit!=null&&String(entry.unit).trim())row.unit=text(entry.unit,'mernú jednotku');
      if(entry.kind!=null){if(!kinds.has(entry.kind))throw new Error('Neplatný typ rozsahu.');row.kind=entry.kind;}
      if(entry.catalog_ref)row.catalog_ref=reference(entry.catalog_ref);
      if(entry.included_duplicate===true)row.included_duplicate=true;
      return row; // Never invent or preserve individual selling prices here.
    });
  }
  function contentsBasis(value){
    const basis=quantity(value);if(basis<=0)throw new Error('Základ množstiev obsahu zostavy musí byť väčší ako nula.');return basis;
  }
  function hasQuantifiedContents(group){return Array.isArray(group.contents)&&group.contents.some(item=>number(item?.qty)!=null);}
  function ensureContentsBasis(group,rows){
    if(group.pricing==='fixed'&&rows.length===1&&hasQuantifiedContents(group)&&group.contents_basis_quantity==null){
      group.contents_basis_quantity=number(rows[0].qty)>0?number(rows[0].qty):1;
    }
  }
  function contentsView(group,rows){
    if(group.pricing!=='fixed'||rows.length!==1||!hasQuantifiedContents(group))return {};
    const billed=number(rows[0].qty),basis=number(group.contents_basis_quantity);
    if(billed==null||basis==null||basis<=0)return {};
    // Store a basis, not duplicated live quantities. Every read derives the
    // content from the actual billed quantity, including manual edits/recalc.
    const contents=group.contents.map(item=>number(item?.qty)==null?clone(item):{...clone(item),qty:rounded(Number(item.qty)*billed/basis,3)});
    // A returned group is a complete snapshot: copying it must not scale the
    // already expanded contents twice (optional items and group dialogs use it).
    return {contents,contents_basis_quantity:billed>0?billed:1};
  }
  function normalize(q){
    q.items=Array.isArray(q.items)?q.items:[];
    q.material_edits=object(q.material_edits)?q.material_edits:{};
    q.material_edits.version=1;
    const j=q.material_edits;
    if(!object(j.scopes))j.scopes={};
    const state=object(j.assemblies)?j.assemblies:{};j.assemblies=state;state.version=1;
    if(!Array.isArray(state.groups))state.groups=[];
    for(const key of ['optional','variants','scenarios'])if(!Array.isArray(state[key]))state[key]=[];
    if(!object(state.parameters))state.parameters={};
    if(!object(state.output))state.output={};
    for(const key of ['material','labor'])if(!modes.has(state.output[key]))state.output[key]=j.pdf_detail?'detail':'summary';
    state.output.appendix=state.output.appendix===true;
    const groupIds=new Set(),rowIds=new Set();
    const reservedGroups=new Set(state.groups.map(group=>group.id).filter(Boolean));
    const reservedRows=new Set(q.items.map(row=>metadata(row).id).filter(Boolean));
    for(const group of state.groups){
      if(!group.id||groupIds.has(group.id))group.id=identity(state,'group',reservedGroups);
      groupIds.add(group.id);
      if(!kinds.has(group.kind))group.kind='material';
      group.name=String(group.name||labels[group.kind]);
      group.pricing=group.pricing==='fixed'?'fixed':'computed';
    }
    for(const row of q.items){
      row.stored_metadata=object(row.stored_metadata)?row.stored_metadata:{};
      const m=object(row.stored_metadata.quote_assembly)?row.stored_metadata.quote_assembly:{};
      row.stored_metadata.quote_assembly=m;
      if(!m.id||rowIds.has(m.id))m.id=identity(state,'row',reservedRows);
      rowIds.add(m.id);
      if(!kinds.has(m.kind))m.kind=kind(row);
      if(!object(m.manual))m.manual={};
      if(m.baseline_quantity==null&&number(row.qty)!=null)m.baseline_quantity=number(row.qty);
      if(!m.catalog_ref){const ref=catalogReference(row);if(ref)m.catalog_ref=ref;}
      if(!m.group_id||!groupIds.has(m.group_id)){
        const id=m.group_id||'legacy-'+m.kind;
        if(!groupIds.has(id)){
          state.groups.push({id,name:labels[m.kind],kind:m.kind,pricing:'computed',legacy:true});groupIds.add(id);
        }
        m.group_id=id;
      }
    }
    for(const group of state.groups){
      const rows=q.items.filter(row=>metadata(row).group_id===group.id);
      if(group.legacy&&group.kind==='labor'&&rows.length===1&&['installation','installation_service'].includes(rows[0].role)){
        group.pricing='fixed';group.fixed_row_id=rowId(rows[0]);
      }
      if(group.pricing==='fixed'&&rows.length===1){
        group.fixed_row_id=rowId(rows[0]);
        if(!Array.isArray(group.contents)&&Array.isArray(rows[0].work_scope))group.contents=rows[0].work_scope.filter(x=>String(x??'').trim()).map(x=>({name:String(x)}));
        ensureContentsBasis(group,rows);
      }
    }
    return q;
  }
  function prepared(q={}){return normalize({...q,items:clone(q.items||[]),material_edits:clone(q.material_edits||{})});}
  function inspect(q){return clone(prepared(q).material_edits.assemblies);}
  function init(q){assertEditable(q);normalize(q);q.material_edits.rows_mode=true;return q;}
  function mutation(q,fn){
    assertEditable(q);const draft=prepared(q);const result=fn(draft,draft.material_edits.assemblies);
    if(draft.items.length>2000)throw new Error('Ponuka môže obsahovať najviac 2 000 položiek.');
    draft.material_edits.rows_mode=true;
    q.items=draft.items;q.material_edits=draft.material_edits;delete q.warranty_consent;
    return result;
  }
  function getGroup(q,id){const group=q.material_edits.assemblies.groups.find(g=>g.id===id);if(!group)throw new Error('Zostava sa už v ponuke nenachádza.');return group;}
  function getRow(q,id){
    const row=Number.isInteger(id)?q.items[id]:q.items.find(i=>rowId(i)===id);
    if(!row)throw new Error('Položka sa už v ponuke nenachádza.');return row;
  }
  function groupRows(q,id){return q.items.filter(row=>metadata(row).group_id===id);}
  function groups(q){
    const draft=prepared(q),state=draft.material_edits.assemblies;
    return state.groups.map(group=>{
      const indices=[],rows=[];draft.items.forEach((row,index)=>{if(metadata(row).group_id===group.id){indices.push(index);rows.push(row);}});
      const billed=rows.filter(row=>!isText(row)),values=billed.map(amounts);
      const priceComplete=values.every(v=>v.amount!=null),costComplete=values.every(v=>v.cost!=null);
      return {...clone(group),...contentsView(group,rows),rows:clone(rows),row_indices:indices,
        net:priceComplete?values.reduce((sum,v)=>sum+v.amount,0):null,
        cost:costComplete?values.reduce((sum,v)=>sum+v.cost,0):null,
        price_complete:priceComplete,cost_complete:costComplete};
    });
  }
  function outputSettings(q){return clone(prepared(q).material_edits.assemblies.output);}
  function setOutput(q,patch){
    if(!object(patch))throw new Error('Neplatné nastavenie tlače.');
    for(const key of Object.keys(patch)){
      if(!['material','labor','appendix'].includes(key))throw new Error('Neplatné nastavenie tlače.');
      if(key==='appendix'?typeof patch[key]!=='boolean':!modes.has(patch[key]))throw new Error('Neplatná podrobnosť tlače.');
    }
    return mutation(q,(draft,state)=>Object.assign(state.output,clone(patch)));
  }
  function createGroupIn(q,values={}){
    const state=q.material_edits.assemblies,used=new Set(state.groups.map(g=>g.id));
    const groupKind=values.kind||'material';if(!kinds.has(groupKind))throw new Error('Neplatný typ zostavy.');
    const pricing=values.pricing||'computed';if(!['computed','fixed'].includes(pricing))throw new Error('Neplatný spôsob ocenenia.');
    const id=values.id?text(values.id,'identifikátor zostavy'):identity(state,'group',used);
    if(state.groups.some(g=>g.id===id))throw new Error('Zostava s týmto identifikátorom už existuje.');
    const group={id,name:text(values.name||labels[groupKind],'názov zostavy'),kind:groupKind,pricing};
    for(const key of ['template_id','template_version','scenario_id','scenario_instance_id','public_description','procurement_incomplete','included_material_route_m'])if(values[key]!=null)group[key]=clone(values[key]);
    if(values.contents!=null)group.contents=cleanContents(values.contents);
    if(values.contents_basis_quantity!=null)group.contents_basis_quantity=contentsBasis(values.contents_basis_quantity);
    state.groups.push(group);return group;
  }
  function createGroup(q,values){return mutation(q,draft=>createGroupIn(draft,values));}
  function updateGroup(q,id,patch={}){
    return mutation(q,draft=>{
      const group=getGroup(draft,id);
      if(own(patch,'name'))group.name=text(patch.name,'názov zostavy');
      if(own(patch,'kind')){
        if(!kinds.has(patch.kind))throw new Error('Neplatný typ zostavy.');
        group.kind=patch.kind;groupRows(draft,id).forEach(row=>{metadata(row).kind=patch.kind;});
      }
      if(own(patch,'public_description'))group.public_description=String(patch.public_description??'');
      if(own(patch,'pricing')){
        if(!['computed','fixed'].includes(patch.pricing))throw new Error('Neplatný spôsob ocenenia.');
        const rows=groupRows(draft,id);
        if(patch.pricing==='fixed'&&rows.length>1)throw new Error('Pevná zostava musí mať jeden účtovaný riadok. Rozpis viacerých ocenených položiek zostáva súčtom položiek.');
        group.pricing=patch.pricing;delete group.legacy;
        if(group.pricing==='fixed'&&rows.length)group.fixed_row_id=rowId(rows[0]);else delete group.fixed_row_id;
      }
      if(own(patch,'contents')){
        group.contents=cleanContents(patch.contents);
        const rows=groupRows(draft,id);
        if(group.pricing==='fixed'&&rows.length===1){
          rows[0].work_scope=group.contents.map(row=>row.name);
          if(hasQuantifiedContents(group))group.contents_basis_quantity=patch.contents_basis_quantity!=null?contentsBasis(patch.contents_basis_quantity):(number(rows[0].qty)>0?number(rows[0].qty):1);
          else delete group.contents_basis_quantity;
        }
      }
      else if(own(patch,'contents_basis_quantity'))group.contents_basis_quantity=contentsBasis(patch.contents_basis_quantity);
      ensureContentsBasis(group,groupRows(draft,id));
      return group;
    });
  }
  function setGroupDetails(q,id,contents){return updateGroup(q,id,{contents});}
  function validateRow(input){
    if(!object(input))throw new Error('Neplatná položka zostavy.');
    const textOnly=isText(input),name=text(input.name,'názov položky');
    // Validate before JSON cloning, which would otherwise turn Infinity into null.
    const qty=textOnly?1:quantity(input.qty??1),unit=textOnly?'ks':text(input.unit||'ks','mernú jednotku');
    const price=textOnly?0:money(input.price),cost=textOnly?0:money(input.cost);
    const row=clone(input);Object.assign(row,{name,qty,unit,price,cost});
    if(isText(row)){row.role='quote_text';row.cost_override=true;}
    row.stored_metadata=object(row.stored_metadata)?row.stored_metadata:{};
    if(!object(row.stored_metadata.quote_assembly))row.stored_metadata.quote_assembly={};
    return row;
  }
  function addRowsIn(q,groupId,inputs,options={}){
    if(!Array.isArray(inputs))throw new Error('Položky zostavy musia tvoriť zoznam.');
    const group=getGroup(q,groupId),state=q.material_edits.assemblies,items=[],skipped=[];
    const used=new Set(q.items.map(rowId));
    for(const input of inputs){
      const row=validateRow(input),m=metadata(row);
      const covered=m.singleton_key&&state.scenarios.some(s=>(s.covered_services||[]).includes(m.singleton_key)&&q.items.some(i=>metadata(i).scenario_instance_id===s.id&&['labor','service'].includes(kind(i))&&number(i.qty)>0));
      if(m.singleton_key&&(covered||q.items.some(i=>metadata(i).singleton_key===m.singleton_key))){
        skipped.push({name:row.name,reason:'already_included',singleton_key:m.singleton_key});continue;
      }
      if(group.pricing==='fixed'&&groupRows(q,groupId).length)throw new Error('Pevná zostava má jeden účtovaný riadok. Ďalšie úkony doplňte do rozsahu montáže.');
      if(!m.id||used.has(m.id))m.id=identity(state,'row',used);else used.add(m.id);
      m.group_id=groupId;m.kind=isText(row)?'text':group.kind;
      m.manual=object(m.manual)?m.manual:{};m.baseline_quantity=row.qty;
      for(const key of ['origin','template_id','template_version','scenario_id','scenario_instance_id'])if(options[key]!=null)m[key]=options[key];
      if(!m.catalog_ref){const ref=catalogReference(row);if(ref)m.catalog_ref=ref;}
      if(m.quantity_rule)m.quantity_rule=validateRule(m.quantity_rule);
      if(m.price_rule)m.price_rule=validatePriceRule(m.price_rule);
      row.customer_group=group.name;q.items.push(row);items.push(row);
      if(group.pricing==='fixed'){
        group.fixed_row_id=m.id;
        if(!group.contents&&Array.isArray(row.work_scope))group.contents=cleanContents(row.work_scope);
        ensureContentsBasis(group,[row]);
      }
    }
    return {items,skipped};
  }
  function addRows(q,groupId,rows,options){return mutation(q,draft=>addRowsIn(draft,groupId,rows,options));}
  function moveRow(q,id,targetGroupId,options={}){
    return mutation(q,draft=>{
      const row=getRow(draft,id),target=getGroup(draft,targetGroupId),old=getGroup(draft,metadata(row).group_id);
      if(target.pricing==='fixed'&&groupRows(draft,targetGroupId).some(i=>i!==row))throw new Error('Do pevnej zostavy nemožno pridať druhý účtovaný riadok.');
      const index=draft.items.indexOf(row);draft.items.splice(index,1);
      metadata(row).group_id=targetGroupId;metadata(row).kind=isText(row)?'text':target.kind;row.customer_group=target.name;
      const before=options.beforeRowId?draft.items.findIndex(i=>rowId(i)===options.beforeRowId):-1;
      if(before>=0){if(metadata(draft.items[before]).group_id!==targetGroupId)throw new Error('Cieľový riadok patrí do inej zostavy.');draft.items.splice(before,0,row);}
      else{const last=draft.items.map(i=>metadata(i).group_id).lastIndexOf(targetGroupId);draft.items.splice(last>=0?last+1:draft.items.length,0,row);}
      if(old.fixed_row_id===rowId(row))delete old.fixed_row_id;
      if(target.pricing==='fixed')target.fixed_row_id=rowId(row);
      return row;
    });
  }
  function copyRow(q,id,targetGroupId){
    return mutation(q,draft=>{
      const source=getRow(draft,id),copy=clone(source);delete metadata(copy).id;delete metadata(copy).optional_id;
      // A duplicate explicitly requested by the user is a distinct scope.
      delete metadata(copy).singleton_key;metadata(copy).origin='copy';
      return addRowsIn(draft,targetGroupId||metadata(source).group_id,[copy]).items[0];
    });
  }
  function copyGroup(q,id,options={}){
    return mutation(q,draft=>{
      const source=getGroup(draft,id),group=createGroupIn(draft,{...clone(source),id:null,name:options.name||source.name+' – kópia'});
      delete group.fixed_row_id;
      const rows=groupRows(draft,id).map(row=>{
        const copy=clone(row);for(const key of ['id','optional_id','singleton_key'])delete metadata(copy)[key];metadata(copy).origin='copy';return copy;
      });
      addRowsIn(draft,group.id,rows);return group;
    });
  }
  function removeRow(q,id){return mutation(q,draft=>{const row=getRow(draft,id);draft.items.splice(draft.items.indexOf(row),1);const group=getGroup(draft,metadata(row).group_id);if(group.fixed_row_id===rowId(row))delete group.fixed_row_id;return row;});}
  function removeGroup(q,id){
    return mutation(q,(draft,state)=>{const group=getGroup(draft,id),items=groupRows(draft,id);draft.items=draft.items.filter(row=>metadata(row).group_id!==id);state.groups=state.groups.filter(g=>g.id!==id);return {group,items};});
  }
  function setField(q,id,field,value){
    if(!['name','unit','qty','price','cost','note'].includes(field))throw new Error('Toto pole položky nemožno upraviť.');
    return mutation(q,draft=>{
      const row=getRow(draft,id);if(isText(row)&&!['name','note'].includes(field))throw new Error('Textový riadok nemá množstvo ani cenu.');
      row[field]=field==='qty'?quantity(value):['price','cost'].includes(field)?money(value):field==='note'?String(value??''):text(value,field==='name'?'názov položky':'mernú jednotku');
      metadata(row).manual[field]=true;
      if(field==='price'||field==='cost')row[field+'_override']=true;
      if(field==='name'&&object(row.stored_metadata.quote_material))row.stored_metadata.quote_material.name_override=true;
      return row;
    });
  }
  function markManual(q,id,field,value=true){
    if(!['name','unit','qty','price','cost'].includes(field)||typeof value!=='boolean')throw new Error('Neplatné označenie ručnej úpravy.');
    return mutation(q,draft=>{const row=getRow(draft,id);metadata(row).manual[field]=value;if(field==='qty'&&!value){metadata(row).baseline_quantity=row.qty;metadata(row).manual_quantity=false;}if(field==='price'||field==='cost')row[field+'_override']=value;return row;});
  }
  function setFixedPrice(q,id,value){
    const price=money(value);
    return mutation(q,draft=>{
      const group=getGroup(draft,id),rows=groupRows(draft,id);
      if(rows.length!==1||isText(rows[0]))throw new Error('Pevnú cenu možno nastaviť pre zostavu s jedným účtovaným riadkom.');
      const row=rows[0];group.pricing='fixed';delete group.legacy;group.fixed_row_id=rowId(row);
      row.price=price;row.price_override=true;metadata(row).manual.price=true;
      if(!group.contents&&row.work_scope)group.contents=cleanContents(row.work_scope);
      ensureContentsBasis(group,rows);
      return group;
    });
  }

  function parameterName(value){
    const name=String(value??'');
    if(!/^[A-Za-z0-9_:-]{1,200}$/.test(name)||['__proto__','constructor','prototype'].includes(name))throw new Error('Neplatný parameter množstva.');
    return name;
  }
  function coefficient(value,fallback,negative=false){
    if(value==null)return fallback;
    if(typeof value==='boolean'||String(value).trim()==='')throw new Error('Neplatný koeficient množstva.');
    const n=Number(String(value).replace(',','.'));
    if(!Number.isFinite(n)||(!negative&&n<0)||Math.abs(n)>=100000000000)throw new Error('Neplatný koeficient množstva.');
    return n;
  }
  function validateRule(rule){
    if(!object(rule)||!['fixed','parameter','sum'].includes(rule.type))throw new Error('Neplatné pravidlo množstva.');
    if(rule.type==='fixed')return {type:'fixed',qty:quantity(rule.qty)};
    const out={type:rule.type,factor:coefficient(rule.factor,1),offset:coefficient(rule.offset,0,true),min:quantity(rule.min??0),ceil:rule.ceil===true};
    if(rule.type==='parameter')out.parameter=parameterName(rule.parameter);
    else{
      if(!Array.isArray(rule.parameters)||!rule.parameters.length)throw new Error('Pravidlu súčtu chýbajú parametre.');
      out.parameters=rule.parameters.map(parameterName);
      if(rule.weights!=null){
        if(!Array.isArray(rule.weights)||rule.weights.length!==out.parameters.length)throw new Error('Koeficienty musia zodpovedať parametrom pravidla.');
        out.weights=rule.weights.map(value=>coefficient(value,1));
      }
    }
    if(rule.ceil_step!=null){out.ceil_step=quantity(rule.ceil_step);if(!out.ceil_step)throw new Error('Krok zaokrúhlenia musí byť kladný.');}
    if(rule.zero_when_empty===true)out.zero_when_empty=true;
    if(rule.max!=null){out.max=quantity(rule.max);if(out.max<out.min)throw new Error('Maximum množstva nesmie byť menšie ako minimum.');}
    return out;
  }
  function evaluateRule(rule,parameters){
    const parsed=validateRule(rule);if(parsed.type==='fixed')return parsed.qty;
    const names=parsed.type==='parameter'?[parsed.parameter]:parsed.parameters;
    let total=0,any=false;for(let index=0;index<names.length;index++){
      const name=names[index];if(!own(parameters,name))throw new Error('Chýba parameter '+name+'.');
      const qty=quantity(parameters[name]);if(qty>0)any=true;total+=qty*(parsed.weights?.[index]??1);
    }
    if(parsed.zero_when_empty&&!any)return 0;
    let result=Math.max(parsed.min,total*parsed.factor+parsed.offset);
    if(parsed.max!=null)result=Math.min(parsed.max,result);
    if(parsed.ceil_step)result=Math.ceil((result-Number.EPSILON)/parsed.ceil_step)*parsed.ceil_step;
    if(parsed.ceil)result=Math.ceil(result);
    if(parsed.max!=null)result=Math.min(parsed.max,result);
    return quantity(String(rounded(result,3)));
  }
  function setQuantityRule(q,id,rule){
    const parsed=rule==null?null:validateRule(rule);
    return mutation(q,draft=>{const row=getRow(draft,id);if(isText(row))throw new Error('Text nemá pravidlo množstva.');metadata(row).quantity_rule=parsed;metadata(row).baseline_quantity=row.qty;return row;});
  }
  function previewQuantities(q,parameters={}){
    if(!object(parameters))throw new Error('Neplatné parametre zostavy.');
    const draft=prepared(q),merged={...draft.material_edits.assemblies.parameters},changes=[],missing=[];
    for(const [key,value] of Object.entries(parameters))merged[parameterName(key)]=quantity(value);
    for(const row of draft.items){
      const m=metadata(row);if(!m.quantity_rule||isText(row))continue;
      try{
        const after=evaluateRule(m.quantity_rule,merged),manual=manualFlags(row).qty===true;
        if(after!==number(row.qty))changes.push({row_id:m.id,group_id:m.group_id,name:row.name,field:'qty',before:row.qty,after,manual,apply:!manual,rule:clone(m.quantity_rule)});
      }catch(error){missing.push({row_id:m.id,name:row.name,error:error.message});}
    }
    return {type:'quantities',quote_id:q?.id||null,parameters:merged,changes,missing};
  }
  function verifyPreview(q,preview,type){
    if(!object(preview)||preview.type!==type||preview.quote_id!==(q?.id||null)||!Array.isArray(preview.changes))throw new Error('Náhľad prepočtu patrí inej ponuke alebo už nie je platný.');
  }
  function selectedChange(change,options){return !Array.isArray(options.rowIds)||options.rowIds.includes(change.row_id);}
  function applyQuantities(q,preview,options={}){
    verifyPreview(q,preview,'quantities');
    return mutation(q,(draft,state)=>{
      let updated=0,skipped=0;
      for(const change of preview.changes){
        if(!selectedChange(change,options)){skipped++;continue;}
        const row=getRow(draft,change.row_id),m=metadata(row);
        if(number(row.qty)!==number(change.before)||JSON.stringify(m.quantity_rule)!==JSON.stringify(change.rule))throw new Error('Množstvá sa od náhľadu zmenili. Zopakujte prepočet.');
        if(manualFlags(row).qty===true&&options.overrideManual!==true){skipped++;continue;}
        const after=evaluateRule(m.quantity_rule,preview.parameters);
        if(after!==change.after)throw new Error('Neplatný výsledok prepočtu množstva.');
        row.qty=after;m.baseline_quantity=after;m.manual.qty=false;m.manual_quantity=false;updated++;
      }
      state.parameters=clone(preview.parameters);return {updated,skipped,missing:clone(preview.missing||[])};
    });
  }
  function validatePriceRule(rule){
    if(!object(rule)||!['catalog','markup','margin','fixed'].includes(rule.mode))throw new Error('Neplatné pravidlo predajnej ceny.');
    if(rule.mode==='catalog')return {mode:'catalog'};
    const value=money(rule.value);if(value==null)throw new Error('Doplňte hodnotu cenového pravidla.');
    if(rule.mode==='margin'&&value>=100)throw new Error('Marža musí byť menšia ako 100 %.');
    return {mode:rule.mode,value};
  }
  function priceFromCost(rule,cost,catalogPrice=null){
    const parsed=validatePriceRule(rule);
    if(parsed.mode==='catalog')return money(catalogPrice);
    if(parsed.mode==='fixed')return parsed.value;
    const known=number(cost);if(known==null)return null;
    return money(String(rounded(parsed.mode==='markup'?known*(1+parsed.value/100):known/(1-parsed.value/100),4)));
  }
  function setPriceRule(q,id,rule){
    const parsed=validatePriceRule(rule);
    return mutation(q,draft=>{
      const row=getRow(draft,id);if(isText(row))throw new Error('Text nemá cenové pravidlo.');
      metadata(row).price_rule=parsed;
      const rawCost=number(row.cost);
      const known=rawCost!=null&&(rawCost>0||row.cost_override===true||row.stored_metadata?.cost_override===true||metadata(row).cost_known===true)?rawCost:null;
      row.price=priceFromCost(parsed,known,row.pohoda?.sell_price_ex_vat??row.price);
      const group=getGroup(draft,metadata(row).group_id);
      if(group.pricing==='fixed'&&parsed.mode!=='fixed'){
        group.pricing='computed';delete group.fixed_row_id;delete group.legacy;
      }
      row.price_override=false;metadata(row).manual.price=false;return row;
    });
  }
  function previewPrices(q,stocks=[]){
    const draft=prepared(q),changes=[],missing=[],matches=[];
    for(const row of draft.items){
      if(isText(row)||row.mapping_status==='included_in_installation'||metadata(row).included_duplicate===true)continue;
      const ref=catalogReference(row);if(!ref)continue;
      const st=findStock(ref,stocks),m=metadata(row),manual=manualFlags(row);
      const group=draft.material_edits.assemblies.groups.find(g=>g.id===m.group_id);
      if(group?.pricing==='fixed')manual.price=true;
      if(!st){missing.push({row_id:m.id,name:row.name,reason:'catalog_item_missing'});continue;}
      let cost,price;
      try{
        cost=money(st.purchase_price_ex_vat);price=money(st.sell_price_ex_vat);
        if(m.price_rule){
          const actualCost=manual.cost?row.cost:cost;
          const known=actualCost!=null&&(Number(actualCost)>0||manual.cost||m.cost_known===true)?actualCost:null;
          price=priceFromCost(m.price_rule,known,price);
        }
      }catch(error){missing.push({row_id:m.id,name:row.name,reason:'invalid_catalog_price',error:error.message});continue;}
      matches.push({row_id:m.id,reference:clone(ref),stock:clone(st)});
      for(const [field,after] of [['price',price],['cost',cost]])if(number(row[field])!==after){
        changes.push({row_id:m.id,group_id:m.group_id,name:row.name,field,before:row[field]??null,after,manual:manual[field]===true,apply:manual[field]!==true});
      }
    }
    return {type:'prices',quote_id:q?.id||null,changes,missing,matches};
  }
  function applyPrices(q,preview,options={}){
    verifyPreview(q,preview,'prices');
    return mutation(q,draft=>{
      let updated=0,skipped=0;const touched=new Set();
      for(const change of preview.changes){
        if(!['price','cost'].includes(change.field))throw new Error('Neplatné pole prepočtu ceny.');
        if(!selectedChange(change,options)){skipped++;continue;}
        const row=getRow(draft,change.row_id);
        if(number(row[change.field])!==number(change.before))throw new Error('Ceny sa od náhľadu zmenili. Zopakujte aktualizáciu.');
        const group=draft.material_edits.assemblies.groups.find(g=>g.id===metadata(row).group_id);
        if((manualFlags(row)[change.field]===true||(change.field==='price'&&group?.pricing==='fixed'))&&options.overrideManual!==true){skipped++;continue;}
        row[change.field]=money(change.after);row[change.field+'_override']=false;metadata(row).manual[change.field]=false;touched.add(change.row_id);updated++;
      }
      for(const match of preview.matches||[]){
        if(Array.isArray(options.rowIds)&&!options.rowIds.includes(match.row_id))continue;
        const row=getRow(draft,match.row_id);
        if(JSON.stringify(catalogReference(row))!==JSON.stringify(match.reference))throw new Error('Skladová väzba sa od náhľadu zmenila. Zopakujte aktualizáciu.');
        row.pohoda=clone(match.stock);metadata(row).catalog_ref=reference(match.stock);
        metadata(row).price_source={source:'pohoda',updated_at:match.stock.updated_at||match.stock.imported_at||null};
        row.pohoda_code=match.stock.code??row.pohoda_code??null;
        row.pohoda_stock_id=match.stock.pohoda_stock_id??row.pohoda_stock_id??null;
        row.mapping_status='mapped'; // Keep the editable customer name and unit.
      }
      return {updated,rows_updated:touched.size,skipped,missing:clone(preview.missing||[])};
    });
  }

  function namespaceRule(rule,names){
    if(!rule)return rule;const out=validateRule(rule);
    if(out.type==='parameter')out.parameter=names[out.parameter]||out.parameter;
    if(out.type==='sum')out.parameters=out.parameters.map(key=>names[key]||key);
    return out;
  }
  function addOptionalIn(q,values){
    const state=q.material_edits.assemblies,used=new Set(state.optional.map(x=>x.id));
    const id=values.id&&!used.has(values.id)?values.id:identity(state,'optional',used);
    const option={id,name:text(values.name,'názov doplnku'),kind:kinds.has(values.kind)?values.kind:'service',selected:false,
      include_in_initial_total:values.include_in_initial_total!==false,items:(values.items||[]).map(validateRow),groups:clone(values.groups||[])};
    for(const key of ['template_id','scenario_instance_id','period','public_description'])if(values[key]!=null)option[key]=clone(values[key]);
    for(const row of option.items)metadata(row).optional_id=id;
    state.optional.push(option);return option;
  }
  function addOptional(q,values){return mutation(q,draft=>addOptionalIn(draft,values));}
  function selectOptional(q,id,selected){
    if(typeof selected!=='boolean')throw new Error('Neplatný výber doplnku.');
    return mutation(q,(draft,state)=>{
      const option=state.optional.find(x=>x.id===id);if(!option)throw new Error('Doplnok sa už v ponuke nenachádza.');
      const active=draft.items.filter(row=>metadata(row).optional_id===id);
      if(!selected){
        if(active.length)option.items=clone(active);
        draft.items=draft.items.filter(row=>metadata(row).optional_id!==id);option.selected=false;return option;
      }
      if(option.selected&&active.length||option.include_in_initial_total===false){option.selected=true;return option;}
      option.selected=true;option.skipped=[];
      for(const row of option.items){
        let group=state.groups.find(g=>g.id===metadata(row).group_id);
        if(!group){
          const definition=option.groups.find(g=>g.id===metadata(row).group_id);
          group=createGroupIn(draft,definition||{name:option.name,kind:option.kind});
        }
        const input=clone(row);metadata(input).optional_id=id;
        const result=addRowsIn(draft,group.id,[input]);option.skipped.push(...result.skipped);
      }
      return option;
    });
  }
  function addScenario(q,result,options={}){
    if(!object(result))throw new Error('Neplatný výsledok scenára.');
    return mutation(q,(draft,state)=>{
      if(options.replace===true){draft.items=[];state.groups=[];state.optional=[];state.scenarios=[];state.parameters={};}
      const used=new Set(state.scenarios.map(s=>s.id)),instanceId=identity(state,'scenario',used),names={};
      const sourceGroups=Array.isArray(result.groups)?result.groups:(result.assemblies||[]);
      const rawRows=Array.isArray(result.items)?result.items:Array.isArray(result.rows)?result.rows:sourceGroups.flatMap(g=>g.rows||[]);
      const referenced=new Set();
      for(const input of rawRows.concat((result.optional||[]).flatMap(option=>option.items||[]))){
        const rule=metadata(input).quantity_rule;if(rule?.type==='parameter')referenced.add(rule.parameter);
        if(rule?.type==='sum')for(const name of rule.parameters||[])referenced.add(name);
      }
      for(const [key,value] of Object.entries(result.parameters||{})){
        if(!referenced.has(key))continue;
        if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:[.,]\d+)?$/.test(value.trim())))continue;
        const full=parameterName(instanceId+':'+parameterName(key));names[key]=full;state.parameters[full]=quantity(value);
      }
      const groupMap=new Map();
      const mapRow=input=>{
        const row=clone(input);row.stored_metadata=object(row.stored_metadata)?row.stored_metadata:{};
        row.stored_metadata.quote_assembly={...metadata(row)};const m=metadata(row);
        m.quantity_rule=namespaceRule(m.quantity_rule,names);m.scenario_instance_id=instanceId;
        if(m.group_id&&groupMap.has(m.group_id))m.group_id=groupMap.get(m.group_id);
        return row;
      };
      for(const source of sourceGroups){
        const group=createGroupIn(draft,{...source,id:null,kind:source.kind||source.type||'material',pricing:source.pricing||source.pricingMode||'computed',scenario_instance_id:instanceId});
        groupMap.set(source.id,group.id);
      }
      const allRows=Array.isArray(result.items)?result.items:Array.isArray(result.rows)?result.rows:sourceGroups.flatMap(g=>(g.rows||[]).map(row=>({...row,stored_metadata:{...(row.stored_metadata||{}),quote_assembly:{...metadata(row),group_id:g.id}}})));
      const added=[],skipped=[];
      for(const input of allRows){
        const row=mapRow(input);let groupId=metadata(row).group_id;
        if(!state.groups.some(g=>g.id===groupId)){
          const groupKind=kind(row);let group=state.groups.find(g=>g.scenario_instance_id===instanceId&&g.kind===groupKind);
          if(!group)group=createGroupIn(draft,{name:labels[groupKind],kind:groupKind,scenario_instance_id:instanceId});groupId=group.id;
        }
        const inserted=addRowsIn(draft,groupId,[row],{scenario_instance_id:instanceId});added.push(...inserted.items);skipped.push(...inserted.skipped);
      }
      const optional=[];
      for(const option of result.optional||[]){
        optional.push(addOptionalIn(draft,{...option,id:null,scenario_instance_id:instanceId,items:(option.items||[]).map(mapRow),groups:(option.groups||[]).map(g=>({...g,id:groupMap.get(g.id)||g.id,scenario_instance_id:instanceId}))}));
      }
      const scenario=object(result.scenario)?result.scenario:{id:result.scenarioId||result.id,name:result.name};
      const record={id:instanceId,scenario_id:scenario.id||null,name:scenario.name||'Zostava',parameters:names,configuration:clone(result.parameters||{}),covered_services:clone(result.covered_services||[]),version:scenario.version||result.version||1};state.scenarios.push(record);
      return {scenario:record,items:added,groups:state.groups.filter(g=>g.scenario_instance_id===instanceId),optional,skipped,warnings:clone(result.warnings||[])};
    });
  }
  function variantSnapshot(q){
    const state=q.material_edits.assemblies;
    const out={items:clone(q.items),groups:clone(state.groups),parameters:clone(state.parameters),optional:clone(state.optional),scenarios:clone(state.scenarios)};
    for(const key of ['device','category','system_type','boiler_type','ac_mode','multisplit_count'])if(q[key]!==undefined)out[key]=clone(q[key]);
    return out;
  }
  function saveVariant(q,values={}){
    return mutation(q,(draft,state)=>{
      const name=text(values.name,'názov variantu'),used=new Set(state.variants.map(v=>v.id));
      const id=values.id||identity(state,'variant',used),existing=state.variants.find(v=>v.id===id);
      const variant={id,name,snapshot:variantSnapshot(draft)};
      if(existing)state.variants[state.variants.indexOf(existing)]=variant;else state.variants.push(variant);
      state.active_variant_id=id;return variant;
    });
  }
  function selectVariant(q,id){
    let header;
    const result=mutation(q,(draft,state)=>{
      const selected=state.variants.find(v=>v.id===id);if(!selected)throw new Error('Variant sa už v ponuke nenachádza.');
      if(id===state.active_variant_id)return selected;
      const active=state.variants.find(v=>v.id===state.active_variant_id);if(active)active.snapshot=variantSnapshot(draft);
      const next=clone(selected.snapshot);draft.items=next.items;
      for(const key of ['groups','parameters','optional','scenarios'])state[key]=next[key]||(['parameters'].includes(key)?{}:[]);
      header={};for(const key of ['device','category','system_type','boiler_type','ac_mode','multisplit_count'])header[key]=next[key];
      state.active_variant_id=id;return selected;
    });
    if(header)for(const [key,value] of Object.entries(header)){if(value===undefined)delete q[key];else q[key]=value;}
    return result;
  }
  function removeVariant(q,id){return mutation(q,(draft,state)=>{const index=state.variants.findIndex(v=>v.id===id);if(index<0)throw new Error('Variant sa už v ponuke nenachádza.');const removed=state.variants.splice(index,1)[0];if(state.active_variant_id===id)delete state.active_variant_id;return removed;});}
  function createRevision(source,allQuotes=[],options={}){
    if(!source||!options.id)throw new Error('Nová revízia potrebuje nový identifikátor ponuky.');
    if(options.id===source.id||allQuotes.some(q=>q.id===options.id))throw new Error('Identifikátor novej revízie sa už používa.');
    const copy=clone(source),previous=source.material_edits?.assemblies?.revision||{};
    const rootId=previous.root_id||source.id,rootNo=previous.root_quote_no||source.quote_no||'';
    let last=Number(previous.number)||1;
    for(const q of allQuotes){const revision=q.material_edits?.assemblies?.revision;if(q.id===rootId||revision?.root_id===rootId)last=Math.max(last,Number(revision?.number)||1);}
    for(const key of Object.keys(copy))if(key.startsWith('_'))delete copy[key];
    for(const key of ['remote_id','remote_customer_id','sync_version','issued_on','valid_until','warranty_consent','signature','signature_data_url','customer_signature','pohoda_offer_exported_at','pohoda_offer_export_file'])delete copy[key];
    const now=options.now??Date.now();copy.id=options.id;copy.quote_no=options.quote_no||'NÁVRH-R'+(last+1);copy.status='draft';copy.created=now;copy.updated=now;copy._dirty=true;copy._server_quote_no=false;
    normalize(copy);copy.material_edits.rows_mode=true;
    copy.material_edits.assemblies.revision={root_id:rootId,root_quote_no:rootNo,number:last+1,parent_id:source.id,parent_quote_no:source.quote_no||'',created_at:now};
    return copy;
  }
  function procurement(q){
    const draft=prepared(q),map=new Map(),unmapped=[];
    const purchase=[];
    for(const group of groups(draft)){
      const rows=group.rows;
      if(group.pricing==='fixed'&&['material','equipment','other'].includes(group.kind)&&group.contents?.length){
        for(let index=0;index<group.contents.length;index++){
          const content=group.contents[index];
          purchase.push({...content,stored_metadata:{quote_assembly:{id:group.id+':content:'+index,group_id:group.id,kind:content.kind||group.kind,catalog_ref:content.catalog_ref,included_duplicate:content.included_duplicate}}});
        }
      }else purchase.push(...rows);
    }
    for(const row of purchase){
      const m=metadata(row);if(isText(row)||!['equipment','material','other'].includes(kind(row))||m.included_duplicate===true)continue;
      const qty=number(row.qty);if(qty==null||qty<=0)continue;const ref=catalogReference(row);
      if(!ref||![ref.fingerprint,ref.id,ref.pohoda_stock_id,ref.plu,ref.code].some(x=>x!=null&&x!=='')){unmapped.push({row_id:m.id,name:row.name,qty,unit:row.unit||'ks'});continue;}
      const source=ref.source||'pohoda',identityKey=ref.fingerprint?'fp:'+ref.fingerprint:ref.id?'id:'+ref.id:ref.pohoda_stock_id!=null?'stock:'+ref.pohoda_stock_id:ref.plu?'plu:'+ref.plu:'code:'+ref.code;
      const key=JSON.stringify([source,identityKey,ref.storage_ref||'',row.unit||'ks']);
      let entry=map.get(key);if(!entry){entry={catalog_ref:clone(ref),code:ref.code||row.pohoda_code||'',name:row.name,qty:0,unit:row.unit||'ks',sources:[]};map.set(key,entry);}
      entry.qty=rounded(entry.qty+qty,3);entry.sources.push({row_id:m.id,group_id:m.group_id,qty});
    }
    const warnings=draft.material_edits.assemblies.groups.filter(g=>g.procurement_incomplete&&groupRows(draft,g.id).some(row=>number(row.qty)>0)).map(g=>({group_id:g.id,name:g.name,message:'Zostava nemá úplný položkový súpis zahrnutého materiálu. Doplňte materiál pred objednaním.'}));
    return {items:[...map.values()],unmapped,warnings,complete:unmapped.length===0&&warnings.length===0};
  }
  function installer(q){
    return groups(q).filter(group=>group.rows.length).map(group=>({id:group.id,name:group.name,kind:group.kind,
      items:group.rows.map(row=>({id:rowId(row),name:row.name,qty:isText(row)?null:row.qty,unit:isText(row)?null:row.unit,
        note:String(row.note||''),work_scope:Array.isArray(row.work_scope)?clone(row.work_scope):[],catalog_ref:catalogReference(row)})),
      contents:clone(group.contents||[])}));
  }
  const api={init,ensure:init,inspect,groups,metadata,rowId,kind,isText,unlocked,quantity,money,amounts,reference,catalogReference,findStock,manualFlags,
    outputSettings,setOutput,createGroup,updateGroup,setGroupDetails,addRows,moveRow,copyRow,copyGroup,removeRow,removeGroup,setField,markManual,setFixedPrice,
    validateRule,evaluateRule,setQuantityRule,previewQuantities,applyQuantities,validatePriceRule,priceFromCost,setPriceRule,previewPrices,applyPrices,
    addScenario,addOptional,selectOptional,saveVariant,selectVariant,removeVariant,createRevision,procurement,installer};
  root.SpektraQuoteAssemblies=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
