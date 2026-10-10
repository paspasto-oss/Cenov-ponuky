/* Simple floor quote: area + total kilometres; the detailed BOM stays intact.
 * Optional UI adapter for the existing workbench, storage outbox and library.
 * Pure helpers are exported for regression tests. No production writes on open.
 */
(function(root){
  'use strict';
  const A=root.SpektraQuoteAssemblies||(typeof module==='object'?require('./quote-assemblies.js'):null);
  const copy=x=>JSON.parse(JSON.stringify(x));
  const FORMAT='spektra.floor-quick.v1',KEY='pricing:floor-quick-v1';
  const normUnit=x=>String(x??'').trim().toLowerCase().replace(/²/g,'2');
  const round=(n,d=3)=>Math.round((n+Number.EPSILON)*10**d)/10**d;
  function number(x,label,positive=false,nullable=false){
    if(nullable&&(x==null||String(x).trim()===''))return null;
    if(typeof x!=='number'&&typeof x!=='string')throw new Error('Doplňte '+label+'.');
    const raw=String(x).trim().replace(',','.');
    if(!/^\d+(?:\.\d+)?$/.test(raw))throw new Error('Zadajte platné číslo: '+label+'.');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<0||n>1000000||(positive&&n===0))throw new Error('Skontrolujte '+label+'.');
    return n;
  }
  const amount=(x,label)=>{const n=number(x,label,false,true);return n==null?null:round(n,4);};
  const kinds=q=>(q.items||[]).map(A.kind);
  function supported(q){
    if(!q)return false;
    if(!(q.items||[]).length)return true;
    const state=q.material_edits?.assemblies;
    return q.category==='floor_heating'&&kinds(q).every(k=>['material','labor','transport'].includes(k))&&
      !(state?.optional||[]).length&&!(state?.variants||[]).length&&
      A.groups(q).every(g=>g.pricing!=='fixed')&&
      ['material','labor','transport'].every(k=>A.groups(q).filter(g=>g.kind===k&&g.rows.length).length<=1)&&
      q.items.filter(r=>A.kind(r)==='transport').every(r=>normUnit(r.unit)==='km')&&
      q.items.filter(r=>A.kind(r)==='transport').length<=1&&
      (state?.scenarios||[]).length<=1;
  }
  function sourceArea(q){
    const state=q.material_edits?.assemblies;
    const marked=q.material_edits?.quick_floor?.area_m2;
    if(Number(marked)>0)return Number(marked);
    const areas=(state?.scenarios||[]).map(s=>s.configuration?.area_m2).filter(x=>Number(x)>0);
    if(areas.length===1)return Number(areas[0]);
    const labor=(q.items||[]).filter(r=>A.kind(r)==='labor'&&normUnit(r.unit)==='m2');
    return labor.length===1&&Number(labor[0].qty)>0?Number(labor[0].qty):null;
  }
  function travel(q){
    const rows=(q.items||[]).filter(r=>A.kind(r)==='transport');
    if(rows.some(r=>normUnit(r.unit)!=='km'))return null;
    return round(rows.reduce((s,r)=>s+Number(r.qty||0),0));
  }
  function total(rows,key){
    if(rows.some(r=>Number(r.qty)>0&&(r[key]==null||!Number.isFinite(Number(r[key])))))return null;
    return round(rows.reduce((s,r)=>s+Number(r.qty||0)*Number(r[key]||0),0),2);
  }
  function summary(q,area=sourceArea(q)||1,km=travel(q)||0){
    return [['material','Materiál podlahového kúrenia',area,'m²'],['labor','Montáž podlahového kúrenia',area,'m²'],['transport','Doprava',km,'km']].map(([kind,name,qty,unit])=>{
      const rows=(q.items||[]).filter(r=>A.kind(r)===kind);
      const net=rows.length?total(rows,'price'):kind==='transport'&&km===0?0:null;
      return {kind,name,qty,unit,net,unit_price:net==null?null:qty>0?net/qty:0};
    });
  }
  function reference(row){
    const ref=A.catalogReference(row)||{},code=String(ref.code??row.pohoda_code??row.pohoda?.code??'').trim();
    return code?{source:'pohoda',match_by:'code',code,storage_ref:ref.storage_ref??null}:null;
  }
  function configuration(q,options={}){
    if(!supported(q)||!(q.items||[]).some(r=>A.kind(r)==='material'))throw new Error('Najprv pripravte samostatnú zostavu podlahového kúrenia s materiálom.');
    const area=number(options.area_m2??sourceArea(q),'východiskovú plochu',true);
    const materials=q.items.filter(r=>A.kind(r)==='material').map((r,index)=>{
      const mode=options.modes?.[index]||r.stored_metadata?.quote_assembly?.quick_quantity_mode||(['floor_manifold','floor_cabinet'].includes(r.role)?'fixed':'area');
      return {name:String(r.name||'Materiál'),unit:String(r.unit||''),role:r.role||'quote_manual',ref:reference(r),mode,
        quantity:round(number(r.qty,'množstvo')/(mode==='area'?area:1),8)};
    });
    return validate({format:FORMAT,version:options.version||1,name:'Podlahové kúrenie',materials,
      labor_price:amount(options.labor_price,'sadzbu montáže €/m²'),labor_cost:amount(options.labor_cost,'náklad montáže €/m²'),
      transport_price:amount(options.transport_price,'sadzbu dopravy €/km'),transport_cost:amount(options.transport_cost,'náklad dopravy €/km')});
  }
  function validate(input){
    if(!input||input.format!==FORMAT||!Array.isArray(input.materials)||!input.materials.length||input.materials.length>500)throw new Error('Neplatný štandard podlahového kúrenia.');
    const name=String(input.name||'Podlahové kúrenie').trim().slice(0,150);
    const out={format:FORMAT,name,version:number(input.version||1,'verziu',true),materials:[]};
    for(const key of ['labor_price','labor_cost','transport_price','transport_cost'])out[key]=amount(input[key],key);
    for(const r of input.materials){
      if(!r||!['area','fixed'].includes(r.mode)||!String(r.name||'').trim()||!String(r.unit||'').trim())throw new Error('Skontrolujte názov, jednotku a spôsob výpočtu materiálu.');
      const code=r.ref?.code;if(code!=null&&typeof code!=='string')throw new Error('Kód POHODA musí byť text vrátane úvodných núl.');
      out.materials.push({name:String(r.name).slice(0,500),unit:String(r.unit).slice(0,30),role:String(r.role||'quote_manual').slice(0,100),mode:r.mode,
        quantity:number(r.quantity,'normatív materiálu'),ref:code?.trim()?{source:'pohoda',match_by:'code',code:code.trim(),storage_ref:r.ref.storage_ref??null}:null});
    }
    return out;
  }
  function rawRow(name,kind,qty,unit,price,cost,extra={}){
    return {name,role:kind==='material'?'quote_manual':kind==='labor'?'installation_service':'transport_km',qty:round(qty),unit,price,cost,
      visible:kind!=='material',...extra,stored_metadata:{quote_assembly:{group_id:'quick-'+kind,kind,origin:'scenario',manual:{qty:false,price:kind!=='material',cost:kind!=='material'},...extra.stored_metadata?.quote_assembly}}};
  }
  function build(config,areaInput,kmInput,stocks=[]){
    const c=validate(config),area=round(number(areaInput,'plochu',true)),km=round(number(kmInput,'celkové kilometre'));
    if(!area)throw new Error('Plocha musí byť aspoň 0,001 m².');
    const items=c.materials.map(m=>{
      const st=m.ref?A.findStock(m.ref,stocks):null,ok=st&&normUnit(st.unit)===normUnit(m.unit);
      const qty=m.quantity*(m.mode==='area'?area:1);
      return rawRow(ok?String(st.name||m.name):m.name,'material',qty,m.unit,ok?amount(st.sell_price_ex_vat,'predajnú cenu'):null,ok?amount(st.purchase_price_ex_vat,'nákupnú cenu'):null,{
        role:m.role,pohoda:ok?copy(st):null,pohoda_code:m.ref?.code||null,mapping_status:ok?'mapped':'needs_compatibility_check',
        stored_metadata:{quote_assembly:{catalog_ref:m.ref,stock_selection_required:!ok,quick_quantity_mode:m.mode,
          quantity_rule:m.mode==='area'?{type:'parameter',parameter:'area_m2',factor:m.quantity,min:0}:{type:'fixed',qty:round(qty)}}}});
    });
    items.push(rawRow('Montáž podlahového kúrenia vrátane tlakovej skúšky','labor',area,'m²',c.labor_price,c.labor_cost,{price_override:true,cost_override:c.labor_cost!=null,
      work_scope:['Montáž podlahového kúrenia','Tlaková skúška'],stored_metadata:{quote_assembly:{quantity_rule:{type:'parameter',parameter:'area_m2',factor:1,min:0}}}}));
    items.push(rawRow('Doprava','transport',km,'km',km===0?(c.transport_price??0):c.transport_price,c.transport_cost,{price_override:true,cost_override:c.transport_cost!=null,
      stored_metadata:{quote_assembly:{singleton_key:'transport',quick_tariff:c.transport_price,quantity_rule:{type:'parameter',parameter:'travel_km',factor:1,min:0}}}}));
    return {version:1,scenario:{id:'floor_heating_quick',name:c.name,category:'floor_heating'},parameters:{area_m2:area,travel_km:km},
      groups:[{id:'quick-material',name:'Materiál podlahového kúrenia – '+area+' m²',kind:'material',pricing:'computed'},
        {id:'quick-labor',name:'Montáž podlahového kúrenia – '+area+' m²',kind:'labor',pricing:'computed'},
        {id:'quick-transport',name:'Doprava',kind:'transport',pricing:'computed'}],items,optional:[],warnings:[],covered_services:['pressure']};
  }
  function applyNew(q,config,area,km,stocks){
    if((q.items||[]).length)throw new Error('Novú zostavu nemožno vložiť cez existujúce položky.');
    const result=build(config,area,km,stocks);A.addScenario(q,result);
    q.category='floor_heating';q.system_type='service';
    q.material_edits.quick_floor={area_m2:result.parameters.area_m2,travel_km:result.parameters.travel_km,version:1};
    A.setOutput(q,{material:'summary',labor:'summary',appendix:false});return q;
  }
  function resize(q,areaInput,kmInput,transportRate){
    if(!supported(q)||!(q.items||[]).length)throw new Error('Táto ponuka potrebuje rozšírené úpravy.');
    const oldArea=sourceArea(q),area=round(number(areaInput,'plochu',true)),km=round(number(kmInput,'celkové kilometre'));
    if(!oldArea||!area)throw new Error('Nie je známa východisková plocha. Nastavte ju v rozšírených úpravách.');
    const transports=q.items.filter(r=>A.kind(r)==='transport');
    if(transports.length>1||transports.some(r=>normUnit(r.unit)!=='km'))throw new Error('Doprava nie je jedna položka v kilometroch. Upravte ju v rozšírenom editore.');
    A.init(q);
    for(const row of q.items){
      const kind=A.kind(row),meta=A.metadata(row);if(kind==='transport')continue;
      const fixed=meta.quick_quantity_mode==='fixed'||(['floor_manifold','floor_cabinet'].includes(row.role)&&!meta.quick_quantity_mode);
      const previous=Number(row.qty);row.qty=fixed?previous:round(previous*area/oldArea);
      meta.quick_quantity_mode=fixed?'fixed':'area';meta.baseline_quantity=row.qty;
      // The quick form owns its area update; no stale namespaced formula may
      // overwrite it in the advanced generic quantity dialog.
      meta.quantity_rule={type:'fixed',qty:row.qty};meta.manual={...meta.manual,qty:false};
    }
    let t=transports[0];
    if(t){
      const savedRate=A.metadata(t).quick_tariff;
      const rate=Number(t.qty)===0&&savedRate===null?amount(transportRate,'dopravu €/km'):amount(t.price,'dopravu €/km');
      t.qty=km;t.price=km===0?(rate??0):rate;A.metadata(t).quick_tariff=rate;
      A.metadata(t).quantity_rule={type:'fixed',qty:km};A.metadata(t).baseline_quantity=km;
    }else{
      const rate=amount(transportRate,'dopravu €/km'),g=A.createGroup(q,{name:'Doprava',kind:'transport',pricing:'computed'});
      t=rawRow('Doprava','transport',km,'km',km===0?(rate??0):rate,null,{price_override:true,stored_metadata:{quote_assembly:{singleton_key:'transport',quick_tariff:rate,quantity_rule:{type:'fixed',qty:km}}}});
      A.addRows(q,g.id,[t]);
    }
    for(const g of A.groups(q))if(g.kind==='material'||g.kind==='labor')A.updateGroup(q,g.id,{name:(g.kind==='material'?'Materiál podlahového kúrenia':'Montáž podlahového kúrenia')+' – '+area+' m²'});
    q.material_edits.quick_floor={version:1,area_m2:area,travel_km:km};
    A.setOutput(q,{material:'summary',labor:'summary',appendix:false});return q;
  }
  const api={FORMAT,KEY,supported,sourceArea,travel,summary,configuration,validate,build,applyNew,resize};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}
  root.SpektraQuickQuote=api;
  if(!root.document||!A||!root.SpektraQuoteWorkbench)return;
  const doc=root.document,W=root.SpektraQuoteWorkbench;
  const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=x=>x==null?'Nenacenené':new Intl.NumberFormat('sk-SK',{style:'currency',currency:'EUR'}).format(x);
  const s={owner:'',advanced:false,selected:false,area:'1',km:'0',dirty:false,signature:'',busy:false,library:null,loading:null};
  const user=()=>root.SpektraDB?.getUser?.()?.id||'offline';
  const cacheKey=()=> 'spektra.quoteLibrary.v1.'+user();
  const active=()=>typeof current!=='undefined'?current:null;
  const inventory=()=>typeof stocks!=='undefined'?stocks:[];
  function records(){try{const r=JSON.parse(root.localStorage.getItem(cacheKey())||'[]');return Array.isArray(r)?r:[];}catch(_){return [];}}
  function cached(){return records().find(r=>r.key===KEY)||null;}
  function quoteSignature(q){return JSON.stringify([q?.id,q?.status,q?.category,q?.items,q?.material_edits,q?.customer]);}
  function control(action,label,primary=false){return '<button type="button" class="btn '+(primary?'primary':'ghost')+'" data-quick-action="'+action+'">'+label+'</button>';}
  function feedback(message,error=false){const n=doc.getElementById('quickStatus');if(n){n.textContent=message;n.classList.toggle('error',error);}}
  function scope(){
    const q=active();if(!q)return false;
    const owner=user()+'|'+q.id;
    if(owner!==s.owner){s.owner=owner;s.advanced=false;s.selected=q.category==='floor_heating';s.area=String(sourceArea(q)||1);s.km=String(travel(q)||0);s.dirty=false;s.signature='';s.library=cached();}
    const sig=quoteSignature(q);
    if(s.signature!==sig&&!s.dirty){s.area=String(sourceArea(q)||1);s.km=String(travel(q)||0);}
    s.signature=sig;return supported(q);
  }
  function draft(){
    const q=active(),out=copy(q);out.status='draft';delete out._server_status;
    const config=cached()?.payload;
    if((q.items||[]).length)return resize(out,s.area,s.km,config?.transport_price);
    if(!config)throw new Error('Štandard ešte nie je pripravený. Pavol ho raz nastaví v rozšírených úpravách.');
    return applyNew(out,config,s.area,s.km,inventory());
  }
  function table(rows){return '<div class="quickTableWrap"><table class="quickTable"><thead><tr><th>Položka</th><th>Množstvo</th><th>Celkom bez DPH</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+E(r.name)+'</td><td>'+E(r.qty)+' '+E(r.unit)+'</td><td class="'+(r.net==null?'quickMissing':'')+'">'+E(money(r.net))+'</td></tr>').join('')+'</tbody></table></div>';}
  function preview(){
    const n=doc.getElementById('quickSummary');if(!n)return;
    let q=null,error='';try{q=draft();}catch(e){error=e.message;}
    const area=Number(String(s.area).replace(',','.'))||1,km=Number(String(s.km).replace(',','.'))||0;
    const rows=summary(q||{items:[]},area,km);
    const totals=q?root.SpektraQuoteRowOutput.canonicalTotals(q):{complete:false};
    n.innerHTML=table(rows)+(error?'<p class="quickMissing">'+E(error)+'</p>':!totals.complete?'<p class="quickMissing">Zostava ešte nie je úplne nacenená. Chýbajúce položky alebo sadzby doplní Pavol v rozšírených úpravách.</p>':'')+
      '<div class="quickTotal"><span>Spolu s DPH</span><strong>'+E(money(totals.complete?totals.total:null))+'</strong></div>';
    const pdf=doc.querySelector('[data-quick-action="pdf"]');if(pdf)pdf.disabled=!totals.complete||s.busy;
    const save=doc.querySelector('[data-quick-action="save"]');if(save)save.disabled=!q||s.busy;
  }
  function render(){
    const box=doc.getElementById('quoteQuick'),wb=doc.getElementById('quoteWorkbench'),screen=doc.getElementById('quoteRows');
    if(!box||!wb||!screen||!active())return;
    const eligible=scope(),q=active();
    const simple=eligible&&!s.advanced;
    screen.classList.toggle('quickMode',simple);wb.hidden=simple;box.hidden=false;
    if(!simple){
      box.innerHTML='<div class="quickModeBar">'+(eligible?control('simple','← Jednoduché zadanie'):'')+(eligible&&(q.items||[]).length?control('setup','Nastaviť štandard na 1 m²'):'')+'</div>';
      return;
    }
    let html='<div class="quickModeBar"><strong>Jednoduchá ponuka</strong>'+control('advanced','Rozšírené úpravy')+'</div>';
    if(!s.selected&&!(q.items||[]).length){
      const scenarios=root.SpektraHvacScenarios.list(),templates=typeof W.savedTemplates==='function'?W.savedTemplates():[];
      html+='<h2>Čo naceniť?</h2><div class="wbChoices">'+scenarios.map(r=>'<button type="button" class="wbChoice" data-quick-action="choose" data-scenario="'+E(r.id)+'">'+E(r.id==='floor_heating_rehau'?'Podlahové kúrenie':r.name)+'<small>'+(r.id==='floor_heating_rehau'?'Plocha, materiál, montáž a km':'Otvoriť zostavu')+'</small></button>').join('')+
        '<button type="button" class="wbChoice wbChoiceNew" data-quick-action="new-custom">＋ Nová vlastná zostava<small>Pridať materiál a montáž</small></button>'+
        templates.map(t=>'<button type="button" class="wbChoice wbChoiceSaved" data-quick-action="custom-template" data-template-key="'+E(t.key)+'">'+E(t.payload.name)+'<small>Moja zostava · vložiť do ponuky</small></button>').join('')+'</div>';
      box.innerHTML=html;return;
    }
    html+=(['ready','sent','approved'].includes(q.status)?'<p class="sub">Vydaná ponuka: zmena plochy alebo km vytvorí novú revíziu. Pôvodná verzia zostane zachovaná.</p>':'');
    html+='<h2>Podlahové kúrenie</h2><p class="sub">'+E(q.customer?.name||'')+' · pripravený štandard na 1 m²</p>'+
      '<div class="quickInputs"><label class="wbField"><span>Vykurovaná plocha [m²]</span><input id="quickArea" inputmode="decimal" autocomplete="off" value="'+E(s.area)+'"></label>'+
      '<label class="wbField"><span>Doprava – celkom [km]</span><input id="quickKm" inputmode="decimal" autocomplete="off" value="'+E(s.km)+'"><small>Celkový počet km, vrátane cesty späť.</small></label></div>'+
      '<div id="quickSummary" aria-live="polite"></div><div id="quickStatus" class="wbStatus" role="status"></div><div class="quickActions">'+control('save','Uložiť ponuku')+control('pdf','PDF / Odoslanie →',true)+'</div>';
    box.innerHTML=html;preview();
  }
  async function refreshLibrary(){
    const owner=user();if(s.loading===owner)return;
    s.loading=owner;
    try{await W.loadLibrary();if(user()===owner){s.library=cached();if(!s.advanced)preview();}}
    catch(e){feedback('Spoločný štandard sa nepodarilo načítať: '+e.message,true);}
    finally{if(s.loading===owner)s.loading=null;}
  }
  async function save(pdf=false){
    if(s.busy)return;
    const output=active()?.material_edits?.assemblies?.output;
    if(!s.dirty&&active()?.material_edits?.quick_floor&&output?.material==='summary'&&output?.labor==='summary'&&!output?.appendix){
      if(pdf)await quoteRowsToFinal();else feedback('Ponuka je už uložená.');
      return;
    }
    s.busy=true;preview();const owner=active()?.id;
    try{
      const prepared=draft();
      if(pdf&&!root.SpektraQuoteRowOutput.canonicalTotals(prepared).complete)throw new Error('Doplňte chýbajúce ceny pred vytvorením PDF.');
      const area=s.area,km=s.km,config=cached()?.payload,stockSnapshot=copy(inventory());
      const result=await W.mutate('Plocha, montáž a doprava boli uložené.',q=>{
        if((q.items||[]).length)resize(q,area,km,config?.transport_price);
        else applyNew(q,config,area,km,stockSnapshot);
      });
      if(!result?.ok||result.stale)return;
      s.dirty=false;s.signature='';render();feedback(result.synced?'Ponuka je uložená.':'Ponuka je uložená v zariadení; čaká na synchronizáciu.');
      if(pdf&&active()?.id&&(active().id===owner||active().material_edits?.assemblies?.revision))await quoteRowsToFinal();
    }catch(e){feedback(e.message,true);}finally{s.busy=false;preview();}
  }
  function closeSetup(){doc.getElementById('quickSetup')?.remove();}
  function setup(){
    const q=active(),area=sourceArea(q);if(!area)throw new Error('Nie je známa plocha tejto zostavy. Najprv pripravte podlahové kúrenie cez scenár.');
    const rows=q.items.filter(r=>A.kind(r)==='material'),labor=q.items.filter(r=>A.kind(r)==='labor'),tr=q.items.filter(r=>A.kind(r)==='transport'&&normUnit(r.unit)==='km');
    const old=cached(),owner=user(),quoteId=q.id,before=quoteSignature(q);
    const norm=configuration(q,{area_m2:area});
    const rate=total(labor,'price');const laborRate=old?.payload?.labor_price??(rate>0?rate/area:'');
    const transportRate=old?.payload?.transport_price??(tr.length===1?tr[0].price:'');
    const field=(id,label,val)=>'<label class="wbField"><span>'+E(label)+'</span><input id="'+id+'" inputmode="decimal" value="'+E(val??'')+'"></label>';
    const el=doc.createElement('div');el.id='quickSetup';el.className='wbOverlay';
    el.innerHTML='<section class="wbDialog" role="dialog" aria-modal="true" aria-label="Štandard podlahového kúrenia"><h2>Štandard pre jednoduchú ponuku</h2><p>Aktuálna zostava má '+E(area)+' m². Uložia sa iba materiálové kódy, normatívy a sadzby, nie zákazník ani ponuka.</p>'+field('quickBasis','Východisková plocha tejto zostavy [m²]',area)+
      '<div class="quickTableWrap"><table class="quickTable"><thead><tr><th>Materiál / kód</th><th>Výpočet</th></tr></thead><tbody>'+rows.map((r,i)=>'<tr><td>'+E(r.name)+'<small class="wbMeta">'+E(reference(r)?.code||'Nepriradené – najprv vyberte zásobu')+'</small></td><td><select data-quick-rule="'+i+'"><option value="area"'+(norm.materials[i].mode==='area'?' selected':'')+'>Podľa m²</option><option value="fixed"'+(norm.materials[i].mode==='fixed'?' selected':'')+'>Raz na zákazku</option></select></td></tr>').join('')+'</tbody></table></div>'+
      '<p class="sub">Potrubie a dosky sa násobia plochou. Rozdeľovač a skrinka sú predvolene raz na zákazku. Ide o cenový normatív, nie hydraulický projekt.</p><div class="quickInputs">'+field('quickLaborRate','Montáž – predaj bez DPH [€/m²]',laborRate)+field('quickTravelRate','Doprava – predaj bez DPH [€/km]',transportRate)+'</div>'+
      '<details><summary>Interné náklady</summary><div class="quickInputs">'+field('quickLaborCost','Náklad montáže [€/m²]',old?.payload?.labor_cost??'')+field('quickTravelCost','Náklad dopravy [€/km]',old?.payload?.transport_cost??'')+'</div></details><p>Prázdna cena nie je nula. Všetky skladové karty a jednotky musia byť priradené pred uložením štandardu.</p><div id="quickSetupStatus" class="wbStatus error" role="alert"></div><div class="wbDialogActions">'+control('close-setup','Zavrieť')+control('save-setup','Uložiť štandard',true)+'</div></section>';
    closeSetup();doc.body.appendChild(el);el.querySelector('input')?.focus();
    el.addEventListener('click',async event=>{
      const b=event.target.closest('[data-quick-action]');if(!b)return;
      if(b.dataset.quickAction==='close-setup'){closeSetup();return;}
      if(b.dataset.quickAction!=='save-setup'||b.disabled)return;b.disabled=true;
      try{
        if(owner!==user()||quoteId!==active()?.id||quoteSignature(active())!==before)throw new Error('Účet alebo ponuka sa zmenili. Otvorte nastavenie znova.');
        const val=id=>doc.getElementById(id).value,modes=[...el.querySelectorAll('[data-quick-rule]')].map(n=>n.value);
        const config=configuration(q,{area_m2:val('quickBasis'),modes,version:(old?.payload?.version||0)+1,labor_price:val('quickLaborRate'),transport_price:val('quickTravelRate'),labor_cost:val('quickLaborCost'),transport_cost:val('quickTravelCost')});
        if(config.labor_price==null||config.transport_price==null)throw new Error('Doplňte sadzbu montáže €/m² aj sadzbu dopravy €/km.');
        if(build(config,1,1,inventory()).items.some(r=>r.price==null))throw new Error('Niektorý materiál nemá jednoznačný kód, zhodnú jednotku alebo predajnú cenu. Najprv ho doplňte cez Zásoby.');
        if(!root.SpektraDB?.isAuthenticated())throw new Error('Na uloženie spoločného štandardu pre Martinu sa prihláste. Nastavenie zostáva otvorené.');
        const entry=await root.SpektraDB.saveQuoteLibrary(KEY,'pricing',config,old?.revision??null);
        if(owner!==user())return;
        const list=records().filter(r=>r.key!==KEY).concat(entry);root.localStorage.setItem(cacheKey(),JSON.stringify(list));s.library=entry;
        if(root.SpektraDB?.isAuthenticated())await W.loadLibrary(true);
        if(quoteId!==active()?.id)return;
        closeSetup();root.alert(entry.pending?'Štandard je uložený iba v tomto zariadení. Po prihlásení ho synchronizujte, aby ho videla aj Martina.':'Štandard je uložený v spoločnej knižnici. V novej ponuke stačí plocha a kilometre.');render();
      }catch(e){const n=doc.getElementById('quickSetupStatus');if(n)n.textContent=e.message;}finally{b.disabled=false;}
    });
  }
  function mount(){
    const wb=doc.getElementById('quoteWorkbench');if(!wb||doc.getElementById('quoteQuick'))return;
    const style=doc.createElement('style');style.textContent=`
      #quoteRows.quickMode > .quoteRowsHeading .quoteRowsActions,
      #quoteRows.quickMode > .quoteRowsMetrics,#quoteRows.quickMode > .quoteRowsActions,
      #quoteRows.quickMode > #rowMaterialEditorSlot,#quoteRows.quickMode > .field,
      #quoteRows.quickMode > #quoteRowsWarning{display:none!important}
      #quoteWorkbench[hidden]{display:none!important}
      .quickModeBar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 18px;flex-wrap:wrap}
      .quickModeBar .btn{padding:9px 12px;font-size:13px}
      .quickInputs{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}
      .quickInputs input{font-size:21px;min-width:0;width:100%;box-sizing:border-box}
      .quickInputs .wbField{min-width:0}.quickInputs small{font-size:12px;font-weight:400;line-height:1.4}
      .quickTableWrap{overflow-x:auto}.quickTable{width:100%;border-collapse:collapse;font-size:15px}
      .quickTable th,.quickTable td{text-align:left;padding:16px 10px;border-bottom:1px solid var(--line,#b9c5d0)}
      .quickTable th{font-size:12px;color:var(--muted,#687b8a)}.quickTable td:last-child,.quickTable th:last-child{text-align:right}
      .quickTable td:last-child{font-weight:700}.quickTable td:nth-child(2){white-space:nowrap}
      .quickMissing{color:var(--muted,#687b8a);font-style:italic;line-height:1.5}
      .quickTotal{display:flex;justify-content:space-between;gap:15px;padding:22px 10px;font-size:19px}
      .quickActions{display:flex;gap:12px;justify-content:flex-end;margin:16px 0 24px;flex-wrap:wrap}
      #quickSetup .wbDialog{max-width:800px}#quickSetup .quickTable select{min-width:135px}
      @media(max-width:540px){.quickInputs{gap:10px}.quickTable{font-size:13px}.quickTable th,.quickTable td{padding:13px 5px}.quickActions .btn{flex:1;font-size:14px}.quickModeBar{gap:8px}.quickTotal{font-size:18px}}
    `;doc.head.appendChild(style);
    const box=doc.createElement('div');box.id='quoteQuick';wb.before(box);
    box.addEventListener('input',event=>{if(event.target.id==='quickArea')s.area=event.target.value;else if(event.target.id==='quickKm')s.km=event.target.value;else return;s.dirty=true;preview();});
    box.addEventListener('click',async event=>{
      const b=event.target.closest('[data-quick-action]');if(!b)return;
      try{
        const action=b.dataset.quickAction;
        if(action==='new-custom'){s.advanced=true;await W.action('new-custom',{dataset:{}});render();return;}
        if(action==='custom-template'){s.advanced=true;await W.action('use-template',{dataset:{id:b.dataset.templateKey}});render();return;}
        if(action==='choose'){
          if(b.dataset.scenario==='floor_heating_rehau'){s.selected=true;s.area='1';s.km='0';render();return;}
          s.advanced=true;await W.action('scenario',{dataset:{id:b.dataset.scenario}});render();return;
        }
        if(action==='advanced'){
          if(s.dirty&&!root.confirm('Neuložené zmeny plochy a km sa zahodia. Pokračovať do rozšírených úprav?'))return;
          s.dirty=false;s.advanced=true;
          if(s.selected&&!(active()?.items||[]).length)await W.action('scenario',{dataset:{id:'floor_heating_rehau'}});
          render();return;
        }
        if(action==='simple'){s.advanced=false;s.selected=active()?.category==='floor_heating'||s.selected;render();return;}
        if(action==='setup'){setup();return;}
        if(action==='save')await save(false);if(action==='pdf')await save(true);
      }catch(e){feedback(e.message,true);root.alert(e.message);}
    });
    // Observe only the original workbench, never this adapter's inputs. Existing
    // renderer calls are lexical; a small observer avoids patching its internals.
    let queued=false;
    const changed=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;render();});};
    new root.MutationObserver(changed).observe(wb,{childList:true,subtree:false});
    const oldOpen=W.onOpen;W.onOpen=function(){const result=oldOpen.apply(this,arguments);render();refreshLibrary();return result;};
    doc.addEventListener('keydown',e=>{if(e.key==='Escape')closeSetup();});
    render();refreshLibrary();
  }
  api.mount=mount;
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(typeof window==='object'?window:globalThis);
