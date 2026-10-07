/* Read-only financial summary of the SAVED offer. Never reads live stock prices,
 * rebuilds a BOM, applies subsidies, or writes a quote while rendering its list. */
(function(root){
  'use strict';
  const equipmentRoles=new Set(['device','multisplit_indoor_units']);
  const serviceRoles=new Set(['installation','installation_service','heating_system_flush_cleaner_inhibitor','wall_penetration_80mm_50cm','annual_service','quote_manual_service']);
  const euro=new Intl.NumberFormat('sk-SK',{style:'currency',currency:'EUR'});
  function number(value){
    if(value==null||typeof value==='boolean'||(typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }
  function itemGroup(item){
    const kind=item?.stored_metadata?.quote_assembly?.kind;
    if(kind==='equipment')return 'equipment';
    if(['labor','transport','revision','pressure','service'].includes(kind))return 'installation';
    if(kind==='material')return 'material';
    if(equipmentRoles.has(item?.role))return 'equipment';
    if(serviceRoles.has(item?.role))return 'installation';
    return 'material';
  }
  function calculate(q={}){
    const items=Array.isArray(q.items)?q.items:[];
    const groups={equipment:{net:0,missing:0},installation:{net:0,missing:0},material:{net:0,missing:0}};
    const missingCost=[],missingPrice=[];
    let sales=0,knownCost=0;
    for(const i of items){
      const group=groups[itemGroup(i)],qty=number(i?.qty),price=number(i?.price),cost=number(i?.cost);
      if(qty===0)continue; // Removed/disabled quantity contributes neither revenue nor costs.
      if(qty==null||qty<0){group.missing++;missingPrice.push(i);continue;}
      const amount=price==null?null:price*qty;
      if(amount==null||!Number.isFinite(amount)){group.missing++;missingPrice.push(i);}
      else{group.net+=amount;sales+=amount;}
      // Zero purchase prices are known only if entered explicitly. Free goods
      // still have a cost; only explicitly bundled services may omit that cost.
      const explicit=i?.cost_override===true||i?.stored_metadata?.cost_override===true;
      if(cost!=null&&cost>=0&&(cost>0||explicit)&&Number.isFinite(cost*qty))knownCost+=cost*qty;
      else if(!(i?.mapping_status==='included_in_installation'&&price===0))missingCost.push(i);
    }
    const savedNet=number(q.net),savedTotal=number(q.total);
    const vat=q.vat_pct==null?23:number(q.vat_pct);
    const vatValid=vat!=null&&vat>=0&&vat<=100;
    const multiplier=vatValid?1+vat/100:null;
    const inconsistent=items.length>0&&missingPrice.length===0&&savedNet!=null&&Math.abs(savedNet-sales)>0.011;
    const pricesComplete=items.length>0&&missingPrice.length===0&&q.price_complete!==false&&Number.isFinite(sales);
    const complete=pricesComplete&&missingCost.length===0&&Number.isFinite(knownCost)&&!inconsistent;
    const net=pricesComplete?(savedNet??sales):null;
    const gross=complete?(net-knownCost):null;
    const total=q.price_complete===false||missingPrice.length?null:(savedTotal??(pricesComplete&&vatValid?net*multiplier:null));
    const part=key=>items.length&&vatValid&&!groups[key].missing?groups[key].net*multiplier:null;
    return {sales,knownCost,gross,margin:complete&&net>0?gross/net*100:null,
      markup:complete&&knownCost>0?gross/knownCost*100:null,missingCost,missingPrice,complete,
      inconsistent,hasItems:items.length>0,total,installation:part('installation'),material:part('material')};
  }
  function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function metric(key,label,value,vat,title,empty='Neúplná',extra=''){
    const valid=value!=null&&Number.isFinite(value);
    const text=valid?euro.format(Object.is(value,-0)?0:value):empty;
    return '<span class="quoteListMetric '+key+(!valid?' incomplete':'')+(extra?' '+extra:'')+'" title="'+escape(title)+'">'+
      '<span class="quoteListMetricLabel">'+label+' <span class="quoteListVat">'+vat+'</span></span><strong>'+escape(text)+'</strong></span>';
  }
  function html(q){
    const s=calculate(q),empty=s.hasItems?'Neúplná':'—';
    let reason='Hrubý zisk ponuky bez DPH: predaj mínus uložené nákupné náklady vrátane práce, ak je vyplnená. Nie čistý zisk po réžii firmy.';
    let missing='Neúplný';
    if(!s.hasItems){reason='Ponuka zatiaľ nemá položky.';missing='—';}
    else if(s.inconsistent){reason='Súčet uložených položiek nesedí s hlavičkou. Otvorte a skontrolujte ponuku.';missing='Skontrolovať';}
    else if(s.missingCost.length){reason='Chýbajú nákupné náklady pri '+s.missingCost.length+' položkách. Zisk nemožno spoľahlivo vypočítať.';missing='Neúplný ('+s.missingCost.length+')';}
    else if(!s.complete)reason='Ponuka nemá kompletné predajné ceny alebo platné množstvá.';
    return '<span class="quoteListFinancials" aria-label="Finančný prehľad ponuky">'+
      metric('quoteListTotal','Celkom',s.total,'s DPH','Celá uložená ponuka vrátane zariadenia, materiálu a prác; pred odpočítaním dotácie.',empty)+
      metric('','Materiál',s.material,'s DPH','Predajná cena materiálu a príslušenstva vrátane doplnených zásobníkov, bez hlavného zariadenia a vnútorných klimatizačných jednotiek.',empty)+
      metric('','Montáž',s.installation,'s DPH','Súčet montáže a služieb účtovaných v tejto ponuke. Budúci ročný servis mimo položiek sa nepripočítava.',empty)+
      metric('quoteListProfit','Zisk',s.gross,'bez DPH',reason,missing,s.gross!=null&&s.gross<0?'negative':'')+
      '</span>';
  }
  const api={calculate,html,itemGroup};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.SpektraQuoteSummary=api;
})(typeof window!=='undefined'?window:globalThis);
