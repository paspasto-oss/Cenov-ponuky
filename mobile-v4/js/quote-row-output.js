/* Read-only output of saved quote rows. This module never rebuilds recipes,
 * reads live catalog prices, or changes the saved quote during PDF/export. */
(function(root){
  'use strict';
  const manualRoles=new Set(['quote_manual','quote_manual_service','quote_text']);
  const separatelyShownRoles=new Set(['device','installation','installation_service','multisplit_indoor_units','heating_system_flush_cleaner_inhibitor']);
  const metadata=i=>i?.stored_metadata?.quote_material||{};
  const rowsMode=q=>q?.material_edits?.rows_mode===true;
  const configured=q=>!!q?.material_edits?.assemblies;
  const mode=x=>['summary','contents','detail'].includes(x)?x:'summary';
  function outputSettings(q={}){
    const settings=q?.material_edits?.assemblies?.output;
    if(!settings)return {material:detailedLegacy(q)?'detail':'summary',labor:detailedLegacy(q)?'detail':'summary',appendix:false};
    return {material:mode(settings.material),labor:mode(settings.labor),appendix:settings.appendix===true};
  }
  const detailedLegacy=q=>q?.material_edits?.pdf_detail===true;
  const detailed=q=>configured(q)?Object.values(outputSettings(q)).some(x=>x==='contents'||x==='detail'):detailedLegacy(q);
  const isManual=i=>manualRoles.has(i?.role)||metadata(i).origin==='manual';
  const isText=i=>i?.role==='quote_text'||metadata(i).kind==='text'||i?.stored_metadata?.quote_assembly?.kind==='text';
  function number(value){
    if(value==null||typeof value==='boolean'||String(value).trim()==='')return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }
  function amounts(i,q={}){
    if(isText(i)||i?._quote_output?.billable===false)return {unit:null,amount:null,gross:null};
    const unit=number(i?.price),qty=number(i?.qty),vat=number(q.vat_pct??23);
    const amount=unit!=null&&qty!=null?unit*qty:null;
    return {unit,amount,gross:amount!=null&&vat!=null?amount*(1+vat/100):null};
  }
  function itemName(q,i,clean=x=>String(x??'')){
    return configured(q)||rowsMode(q)||detailed(q)||isManual(i)?String(i?.name??''):clean(i?.name);
  }
  function legacyCustomerRows(q={},bundleName='Montážny materiál'){
    const items=Array.isArray(q.items)?q.items:[];
    if(detailed(q))return items.slice();
    const device=items.find(i=>i.role==='device');
    const installation=items.find(i=>i.role==='installation_service'||i.role==='installation');
    const separate=i=>!!i.visible||isManual(i)||separatelyShownRoles.has(i.role);
    const material=items.filter(i=>i!==device&&i!==installation&&!separate(i));
    const rows=[];
    if(device)rows.push(device);
    if(material.length){
      const amounts=material.map(i=>number(i.price)==null||number(i.qty)==null?null:Number(i.price)*Number(i.qty));
      rows.push({role:'customer_material_bundle',name:bundleName,qty:1,unit:'súb.',
        price:amounts.some(x=>x==null)?null:amounts.reduce((sum,x)=>sum+x,0)});
    }
    if(installation)rows.push(installation);
    rows.push(...items.filter(i=>i!==device&&i!==installation&&separate(i)));
    return rows;
  }

  function engine(options={}){
    if(options.assemblies)return options.assemblies;
    if(root.SpektraQuoteAssemblies)return root.SpektraQuoteAssemblies;
    if(typeof module==='object'&&module.exports)return require('./quote-assemblies.js');
    throw new Error('Modul zostáv ponuky sa nenačítal. Obnovte aplikáciu.');
  }
  function canonicalTotals(q={}){
    let scaled=0n,complete=Array.isArray(q.items)&&q.items.length>0;
    for(const item of Array.isArray(q.items)?q.items:[]){
      if(isText(item))continue;
      const qty=number(item.qty),price=number(item.price);
      if(qty==null||price==null||qty<0||price<0){complete=false;continue;}
      // Same precision and rounding order as the atomic save and app totals:
      // quantities 3 decimals, unit prices 4, summed net rounded once to cents.
      scaled+=BigInt(Math.round(price*10000))*BigInt(Math.round(qty*1000));
    }
    const rate=number(q.vat_pct??23);
    complete=complete&&rate!=null&&rate>=0;
    if(!complete)return {net:null,vat:null,total:null,vat_pct:rate,complete:false};
    const netCents=(scaled+50000n)/100000n;
    const totalCents=(netCents*BigInt(Math.round((100+rate)*100))+5000n)/10000n;
    return {net:Number(netCents)/100,vat:Number(totalCents-netCents)/100,total:Number(totalCents)/100,vat_pct:rate,complete:true};
  }
  // This is deliberately an allow-list. Catalog costs, notes, stored metadata,
  // margins and source snapshots must never reach a customer document model.
  function publicRow(item,index,patch={}){
    const row={role:item.role||'',name:String(item.name??''),qty:number(item.qty),unit:String(item.unit??''),price:number(item.price),
      public_description:String(item.public_description??item.customer_description??''),
      _quote_output:{type:isText(item)?'text':'line',billable:!isText(item),source_index:index,...patch}};
    if(isText(item)){row.qty=null;row.unit='';row.price=null;}
    return row;
  }
  function synthetic(name,type,group,amount=null,billable=false){
    return {role:type==='text'?'quote_text':group.kind==='material'?'customer_material_bundle':'customer_'+String(group.kind||'group')+'_bundle',
      name:String(name??''),qty:billable?1:null,unit:billable?'súb.':'',price:billable?number(amount):null,
      public_description:type==='summary'?String(group.public_description??''):'',
      _quote_output:{type,billable,group_id:String(group.id??''),group_kind:group.kind,
        ...(amount!==undefined&&type==='subtotal'?{display_amount:number(amount)}:{})}};
  }
  function displayAmounts(row,q={}){
    const out=row?._quote_output;
    if(out?.hide_prices)return {unit:null,amount:null,gross:null};
    if(out&&Object.prototype.hasOwnProperty.call(out,'display_amount')){
      const amount=number(out.display_amount),vat=number(q.vat_pct??23);
      return {unit:out.display_unit==null?null:number(out.display_unit),amount,gross:amount!=null&&vat!=null?amount*(1+vat/100):null};
    }
    return amounts(row,q);
  }
  function scopeRows(group){
    const contents=Array.isArray(group.contents)?group.contents:[];
    const fromRows=(group.rows||[]).flatMap(row=>Array.isArray(row.work_scope)?row.work_scope:[]);
    const input=contents.length?contents:fromRows;
    return input.map(value=>{
      const item=typeof value==='string'?{name:value}:value||{};
      const row=synthetic(item.name,'contents',group,undefined);
      row.qty=number(item.qty);row.unit=String(item.unit??'');
      row._quote_output.hide_prices=true;row._quote_output.depth=1;
      return row;
    }).filter(row=>row.name.trim());
  }
  function groupRows(group,detail,bundleName){
    const all=Array.isArray(group.rows)?group.rows:[];
    const indices=Array.isArray(group.row_indices)?group.row_indices:[];
    const billRows=all.map((row,index)=>publicRow(row,indices[index],{group_id:String(group.id??''),group_kind:group.kind}));
    if(!['material','labor'].includes(group.kind))return billRows;
    const notes=billRows.filter(isText),priced=billRows.filter(row=>!isText(row));
    if(!priced.length)return notes;
    const name=group.pricing==='fixed'&&priced.length===1?priced[0].name:String(group.name||(group.kind==='material'?bundleName:'Montáž'));
    const net=number(group.net);
    if(detail==='summary')return [synthetic(name,'summary',group,net,true),...notes];
    if(group.pricing==='fixed'){
      // The parent is the only selling price. Operations are descriptions,
      // including when a user asks for a full priced breakdown.
      return [...priced,...scopeRows(group),...notes];
    }
    const header=synthetic(name,'heading',group,undefined);
    if(detail==='contents'){
      const children=billRows.map(row=>({...row,price:null,_quote_output:{...row._quote_output,type:isText(row)?'text':'contents',billable:false,hide_prices:true,depth:1}}));
      const subtotal=synthetic(name+' – spolu','subtotal',group,net,true);
      subtotal._quote_output.hide_unit_price=true;
      return [header,...children,subtotal];
    }
    const children=billRows.map(row=>({...row,_quote_output:{...row._quote_output,depth:1}}));
    return [header,...children,synthetic(name+' – spolu','subtotal',group,net,false)];
  }
  function appendixOnly(row,q){
    const values=displayAmounts(row,q);
    return {...row,price:null,_quote_output:{...row._quote_output,billable:false,appendix:true,
      ...(row._quote_output?.hide_prices?{}:{display_amount:values.amount,display_unit:values.unit})}};
  }
  function customerModel(q={},options={}){
    const bundleName=options.bundleName||'Montážny materiál',settings=outputSettings(q);
    if(!configured(q)){
      return {configured:false,settings,rows:legacyCustomerRows(q,bundleName).map((row,index)=>publicRow(row,index)),appendixRows:[],totals:canonicalTotals(q)};
    }
    const groups=engine(options).groups(q),rows=[],appendixRows=[];
    for(const group of groups){
      const selected=['material','labor'].includes(group.kind)?settings[group.kind]:'detail';
      rows.push(...groupRows(group,settings.appendix?'summary':selected,bundleName));
      if(settings.appendix&&['material','labor'].includes(group.kind)&&selected!=='summary'){
        const heading=synthetic(String(group.name||bundleName),'heading',group,undefined);
        const detail=groupRows(group,selected,bundleName);
        if(detail[0]?._quote_output?.type!=='heading')detail.unshift(heading);
        appendixRows.push(...detail.map(row=>appendixOnly(row,q)));
      }
    }
    return {configured:true,settings,rows,appendixRows,totals:canonicalTotals(q)};
  }
  function customerRows(q={},bundleName='Montážny materiál',options={}){
    return configured(q)?customerModel(q,{...options,bundleName}).rows:legacyCustomerRows(q,bundleName);
  }
  const api={rowsMode,detailed,configured,outputSettings,isManual,isText,amounts,displayAmounts,itemName,customerRows,customerModel,canonicalTotals};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SpektraQuoteRowOutput=api;
})(typeof window==='object'?window:globalThis);
