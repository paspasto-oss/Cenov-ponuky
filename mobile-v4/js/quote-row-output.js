/* Read-only output of saved quote rows. This module never rebuilds recipes,
 * reads live catalog prices, or changes the saved quote during PDF/export. */
(function(root){
  'use strict';
  const manualRoles=new Set(['quote_manual','quote_manual_service','quote_text']);
  const separatelyShownRoles=new Set(['device','installation','installation_service','multisplit_indoor_units','heating_system_flush_cleaner_inhibitor']);
  const metadata=i=>i?.stored_metadata?.quote_material||{};
  const rowsMode=q=>q?.material_edits?.rows_mode===true;
  const detailed=q=>q?.material_edits?.pdf_detail===true;
  const isManual=i=>manualRoles.has(i?.role)||metadata(i).origin==='manual';
  const isText=i=>i?.role==='quote_text'||(metadata(i).origin==='manual'&&metadata(i).kind==='text');
  function number(value){
    if(value==null||typeof value==='boolean'||String(value).trim()==='')return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }
  function amounts(i,q={}){
    if(isText(i))return {unit:null,amount:null,gross:null};
    const unit=number(i?.price),qty=number(i?.qty),vat=number(q.vat_pct??23);
    const amount=unit!=null&&qty!=null?unit*qty:null;
    return {unit,amount,gross:amount!=null&&vat!=null?amount*(1+vat/100):null};
  }
  function itemName(q,i,clean=x=>String(x??'')){
    return rowsMode(q)||detailed(q)||isManual(i)?String(i?.name??''):clean(i?.name);
  }
  function customerRows(q={},bundleName='Montážny materiál'){
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
  const api={rowsMode,detailed,isManual,isText,amounts,itemName,customerRows};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SpektraQuoteRowOutput=api;
})(typeof window==='object'?window:globalThis);
