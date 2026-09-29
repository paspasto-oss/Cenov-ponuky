/* Spektra Install – mobile field inspections
 * Loaded after app.html. Additive UI only; existing quote wizard is untouched.
 */
(function(){
  'use strict';

  const CACHE_KEY='spektra_inspections_v1';
  const TYPE_OPTIONS=[
    ['heat_pump','♨','Tepelné čerpadlo'],
    ['air_conditioning','❄','Klimatizácia'],
    ['gas_boiler','🔥','Plynový kotol'],
    ['biomass','●','Biomasa'],
    ['recovery','💨','Rekuperácia'],
    ['zti','🚿','ZTI'],
    ['floor_heating','▤','Podlahovka'],
    ['water_heater','♨','Bojler / TÚV'],
    ['other','🔧','Iné']
  ];
  const PHOTO_CATEGORIES=[
    ['building','Objekt'],
    ['plant_room','Kotolňa / technická miestnosť'],
    ['existing_device','Existujúci zdroj'],
    ['outdoor_unit','Miesto nového zariadenia'],
    ['electrical_panel','Rozvádzač'],
    ['pipe_route','Trasa potrubia'],
    ['nameplate','Výrobný štítok']
  ];
  const EXTRA_WORK=[
    ['demolition','Demontáž starého zariadenia'],
    ['disposal','Odvoz starého zariadenia'],
    ['carry','Znos / vynos'],
    ['stairs','Schody'],
    ['heavy','Ťažká manipulácia'],
    ['core_drilling','Jadrové vŕtanie'],
    ['welding','Zváranie'],
    ['flush','Preplach vykurovania'],
    ['inhibitor','Inhibitor'],
    ['building_work','Stavebné práce'],
    ['platform','Plošina'],
    ['earthworks','Zemné práce']
  ];

  let rows=loadCache();
  let active=null;
  let step=1;
  let busy=false;
  let stockSearchResults=[];
  let stockSearchTimer=null;

  const esc=v=>String(v==null?'':v).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const nowIso=()=>new Date().toISOString();
  const uuid=()=>crypto?.randomUUID?crypto.randomUUID():'insp_'+Date.now()+'_'+Math.random().toString(36).slice(2,10);
  const fold=v=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const priceText=v=>v==null||v===''?'—':new Intl.NumberFormat('sk-SK',{style:'currency',currency:'EUR'}).format(Number(v)||0);
  function stockPool(){
    try{return Array.isArray(stocks)?stocks:[]}catch(_){return []}
  }

  function loadCache(){
    try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'[]')}catch(_){return []}
  }
  function storeCache(){
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(rows))}catch(e){console.warn('Inspection cache write failed',e)}
  }
  function saveLocal(i){
    i.updated_local=Date.now();
    const idx=rows.findIndex(x=>x.local_id===i.local_id);
    if(idx>=0)rows[idx]=JSON.parse(JSON.stringify(i));else rows.unshift(JSON.parse(JSON.stringify(i)));
    storeCache();
  }
  function newInspection(){
    return {
      local_id:uuid(),
      remote_id:null,
      customer_id:null,
      sync_version:1,
      status:'draft',
      _dirty:true,
      inspection_types:['heat_pump'],
      customer:{name:'',phone:'',email:'',address:'',notes:''},
      building:{type:'family_house',condition:'renovation',heated_area_m2:150,floors:1,insulated:true,insulation_mm:150,windows:'triple'},
      existing_system:{source:'gas',annual_consumption:'',heating:'underfloor',water_temp_c:35,persons:3},
      heat_loss:{known:false,known_kw:null,specific_loss_w_m2:60,reserve_pct:10,base_kw:null,design_kw:null,recommended_kw:null},
      proposed_device:{name:'',power_kw:null},
      outdoor_unit:{placement:'ground',route_m:5,vertical_m:0,drilling:true,wall_cm:40},
      plant_room:{dhw_l:200,space:'ok'},
      electrical:{phases:3,main_breaker_a:25,panel_space:true,cable_m:12},
      routes:{heating_m:5,refrigerant_m:5,condensate_m:5,trunking_m:5},
      extra_work:[],
      installation:{
        tier:'standard',
        labor_hour_rate_ex_vat:35,
        labor_workers:1,
        labor_hours:8,
        floor_labor_rate_m2:8,
        floor_spacing_cm:15,
        water_heater_mode:'same_place',
        water_heater_labor_ex_vat:150
      },
      checklist:{},
      notes:'',
      materials:[],
      photos:[],
      inspected_at:null
    };
  }

  function normalizeRemote(r){
    const c=r.customers||{};
    return {
      local_id:r.local_id||('remote_'+r.id),
      remote_id:r.id,
      customer_id:r.customer_id||null,
      sync_version:r.sync_version||1,
      status:r.status||'draft',
      _dirty:false,
      inspection_types:Array.isArray(r.inspection_types)?r.inspection_types:[],
      customer:{name:c.name||r.site_contact_name||'',phone:c.phone||r.site_phone||'',email:c.email||r.site_email||'',address:c.address||r.site_address||'',notes:c.notes||''},
      building:r.building||{},
      existing_system:r.existing_system||{},
      heat_loss:r.heat_loss||{},
      proposed_device:r.proposed_device||{},
      proposed_device_stock_id:r.proposed_device_stock_id||null,
      outdoor_unit:r.outdoor_unit||{},
      plant_room:r.plant_room||{},
      electrical:r.electrical||{},
      routes:r.routes||{},
      extra_work:Array.isArray(r.extra_work)?r.extra_work:[],
      installation:r.installation||{},
      checklist:r.checklist||{},
      notes:r.notes||'',
      materials:(r.inspection_materials||[]).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(m=>({
        id:m.id,pohoda_stock_id:m.pohoda_stock_id||null,role:m.role||null,code:m.code||null,name:m.name,
        qty:Number(m.qty||0),unit:m.unit||'ks',source:m.source||'manual',original_qty:m.original_qty,metadata:m.metadata||{}
      })),
      photos:(r.inspection_photos||[]).map(p=>({...p})),
      quotes:r.inspection_quotes||[],
      inspected_at:r.inspected_at||null,
      updated_at:r.updated_at||null,
      updated_local:Date.parse(r.updated_at)||Date.now()
    };
  }

  function initUI(){
    if(document.getElementById('inspectionHome'))return;
    injectStyles();
    injectEntryPoints();
    injectScreens();
  }

  function injectStyles(){
    const style=document.createElement('style');
    style.textContent=
      '.inspectionProgress{display:flex;gap:5px;margin:0 0 11px}.inspectionProgress i{height:5px;flex:1;background:#8eb6cb;border-radius:999px}.inspectionProgress i.on{background:#00539B}'+
      '.inspTypeGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.inspType{border:1px solid #8fb8cf;background:#f7fbfd;border-radius:12px;padding:11px;text-align:center;color:#173247}.inspType.on{background:#00539B;color:#fff;border-color:#00539B}.inspType span{display:block;font-size:21px}.inspType b{font-size:12px}'+
      '.inspPhotoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.inspThumb{height:110px;background:#f0f6f9;border:1px solid #a9cadb;border-radius:10px;overflow:hidden;position:relative}.inspThumb img{width:100%;height:100%;object-fit:cover}.inspThumb button{position:absolute;right:5px;top:5px;width:27px;height:27px;border:0;border-radius:50%;background:#173247;color:#fff;font-weight:900}'+
      '.inspMaterial{display:grid;grid-template-columns:minmax(0,1fr) 72px 62px 34px;gap:6px;align-items:center;margin-bottom:7px}.inspMaterial input,.inspMaterial select{padding:8px;font-size:14px}.inspMaterial button{border:0;border-radius:8px;background:#dfeaf0;color:#173247;height:38px}.inspMaterialMain{min-width:0}.inspMaterialMeta{font-size:10px;color:#607787;margin:3px 2px 0;white-space:normal}.inspMaterialMeta.linked{color:#28775c;font-weight:700}'+
      '.inspStockSearch{margin:0 0 10px}.inspStockResults{display:flex;flex-direction:column;gap:6px;margin-top:7px}.inspStockResult{width:100%;border:1px solid #a9cadb;background:#f7fbfd;color:#173247;border-radius:11px;padding:10px;text-align:left}.inspStockResult b{display:block;font-size:13px}.inspStockResult small{display:block;color:#607787;margin-top:3px}.inspStockResult .price{font-weight:900;color:#00539B}.inspStockHint{font-size:11px;color:#607787;margin-top:6px}'+
      '.inspStatus{font-size:11px;padding:5px 8px;border-radius:999px;background:#d7e1e7;color:#425766}.inspStatus.completed,.inspStatus.converted{background:#d9efe5;color:#24684f}.inspStatus.in_progress{background:#fff0ca;color:#755c18}'+
      '@media(max-width:720px){.inspMaterial{grid-template-columns:minmax(0,1fr) 62px 58px 32px}.inspPhotoGrid{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(style);
  }

  function injectEntryPoints(){
    const actions=document.querySelector('#home .hero .actions');
    if(actions&&!document.getElementById('newInspectionHomeBtn')){
      const b=document.createElement('button');
      b.id='newInspectionHomeBtn';
      b.className='big';
      b.innerHTML='<span>📋</span><b>Nová obhliadka</b><small>Terén → technika → fotky → ponuka</small>';
      b.onclick=()=>startNew();
      actions.appendChild(b);

      const l=document.createElement('button');
      l.id='inspectionListHomeBtn';
      l.className='big';
      l.innerHTML='<span>☑</span><b>Obhliadky</b><small>Rozpracované a dokončené obhliadky</small>';
      l.onclick=()=>openHome();
      actions.appendChild(l);
    }

    const nav=document.querySelector('nav.nav');
    if(nav&&!document.getElementById('inspectionNavBtn')){
      nav.style.gridTemplateColumns='repeat(5,1fr)';
      const btn=document.createElement('button');
      btn.id='inspectionNavBtn';
      btn.innerHTML='<span>📋</span>Obhliadky';
      btn.onclick=()=>openHome();
      const stockBtn=[...nav.children].find(x=>String(x.textContent||'').includes('Zásoby'));
      nav.insertBefore(btn,stockBtn||nav.children[2]||null);
    }
  }

  function injectScreens(){
    const wrap=document.querySelector('.wrap');
    if(!wrap)return;
    wrap.insertAdjacentHTML('beforeend',
      '<section id="inspectionHome" class="screen">'+
        '<div class="topline"><button class="btn ghost small" onclick="go(\'home\')">← Späť</button><h1>Obhliadky</h1></div>'+
        '<div class="card hero"><h1>Obhliadky v teréne</h1><p>Technický zápis, materiál a fotodokumentácia synchronizované cez Supabase.</p>'+
          '<div class="actions"><button class="big primary" onclick="SpektraInspections.startNew()"><span>＋</span><b>Nová obhliadka</b><small>Začať zápis u zákazníka</small></button>'+
          '<button class="big" onclick="SpektraInspections.refresh()"><span>⟳</span><b>Synchronizovať</b><small>Mobil ↔ PC práca ↔ PC doma</small></button></div>'+
        '</div>'+
        '<div class="stats"><div class="stat"><small>Spolu</small><strong id="inspAll">0</strong></div><div class="stat"><small>Rozpracované</small><strong id="inspDraft">0</strong></div><div class="stat"><small>Dokončené</small><strong id="inspDone">0</strong></div><div class="stat"><small>Ponuka</small><strong id="inspConverted">0</strong></div></div>'+
        '<div class="card" style="margin-top:10px"><h2>Posledné obhliadky</h2><div id="inspectionList" class="list"></div></div>'+
      '</section>'+
      '<section id="inspectionWizard" class="screen">'+
        '<div class="topline"><button class="btn ghost small" onclick="SpektraInspections.back()">← Späť</button><h1 id="inspWizardTitle">Obhliadka</h1></div>'+
        '<div id="inspProgress" class="inspectionProgress"></div>'+
        '<div id="inspWizardBody"></div>'+
      '</section>'
    );
  }

  async function ensureAuth(){
    if(!window.SpektraDB)return false;
    if(!SpektraDB.isAuthenticated()){
      try{await SpektraDB.init()}catch(_){}
    }
    return SpektraDB.isAuthenticated();
  }

  async function openHome(){
    initUI();
    go('inspectionHome');
    renderList();
    await refresh(true);
  }

  async function refresh(silent=false){
    if(busy)return;
    busy=true;
    try{
      const authed=await ensureAuth();
      if(authed){
        const dirty=rows.filter(x=>x._dirty&&x.customer?.name&&x.customer?.address);
        for(const d of dirty){
          try{await saveRemote(d,null,true)}catch(e){console.warn('Inspection pending sync failed',e)}
        }
        const remote=await SpektraDB.listInspections(100);
        const remoteRows=remote.map(normalizeRemote);
        const map=new Map(remoteRows.map(x=>[x.local_id,x]));
        rows.filter(x=>x._dirty).forEach(x=>map.set(x.local_id,x));
        rows=[...map.values()].sort((a,b)=>(b.updated_local||0)-(a.updated_local||0));
        storeCache();
      }
      renderList();
    }catch(e){
      console.error('Inspection refresh failed',e);
      if(!silent)alert('Synchronizácia obhliadok zlyhala: '+(e.message||String(e)));
    }finally{busy=false}
  }

  function renderList(){
    const all=document.getElementById('inspAll');if(!all)return;
    all.textContent=rows.length;
    document.getElementById('inspDraft').textContent=rows.filter(x=>['draft','in_progress'].includes(x.status)).length;
    document.getElementById('inspDone').textContent=rows.filter(x=>['completed','approved'].includes(x.status)).length;
    document.getElementById('inspConverted').textContent=rows.filter(x=>x.status==='converted').length;
    const box=document.getElementById('inspectionList');
    if(!rows.length){box.innerHTML='<div class="sub" style="padding:18px;text-align:center">Zatiaľ bez obhliadok.</div>';return}
    box.innerHTML=rows.slice(0,30).map(x=>{
      const type=(x.inspection_types||[]).map(typeLabel).join(', ')||'Obhliadka';
      const sync=x._dirty?' · čaká na sync':'';
      return '<div class="row" style="cursor:pointer" onclick="SpektraInspections.edit(\''+esc(x.local_id)+'\')">'+
        '<div style="flex:1;min-width:0"><b>'+esc(x.customer?.name||'Bez mena')+'</b><small>'+esc(x.customer?.address||'')+' · '+esc(type)+sync+'</small></div>'+
        '<span class="inspStatus '+esc(x.status)+'">'+esc(statusLabel(x.status))+'</span>'+
      '</div>';
    }).join('');
  }

  function typeLabel(v){
    const x=TYPE_OPTIONS.find(a=>a[0]===v);
    return x?x[2]:v;
  }
  function statusLabel(v){
    return v==='in_progress'?'Rozpracovaná':v==='completed'?'Dokončená':v==='approved'?'Schválená':v==='converted'?'Ponuka':v==='archived'?'Archív':'Návrh';
  }

  function startNew(){
    active=newInspection();
    step=1;
    saveLocal(active);
    renderWizard();
    go('inspectionWizard');
  }
  function edit(localId){
    const src=rows.find(x=>x.local_id===localId);
    if(!src)return;
    active=JSON.parse(JSON.stringify(src));
    step=1;
    renderWizard();
    go('inspectionWizard');
  }
  function back(){
    if(step>1){step--;renderWizard();window.scrollTo(0,0)}
    else openHome();
  }
  function next(){
    if(!active)return;
    if(step===1){
      if(!active.customer.name||!active.customer.phone||!active.customer.address){alert('Vyplň meno, telefón a adresu realizácie.');return}
      if(!(active.inspection_types||[]).length){alert('Vyber typ obhliadky.');return}
    }
    if(step===2&&num(active.building.heated_area_m2)<=0){alert('Zadaj vykurovanú plochu objektu.');return}
    if(step===3)calculateHeatLoss();
    if(step===4)ensureBaseMaterials();
    if(step<6){step++;active.status=active.status==='draft'?'in_progress':active.status;active._dirty=true;saveLocal(active);renderWizard();window.scrollTo(0,0)}
  }

  function renderProgress(){
    const p=document.getElementById('inspProgress');
    if(p)p.innerHTML=[1,2,3,4,5,6].map(n=>'<i class="'+(n<=step?'on':'')+'"></i>').join('');
  }
  function renderWizard(){
    if(!active)return;
    renderProgress();
    const titles=['','1. Zákazník','2. Objekt','3. Vykurovanie a výkon','4. Montáž a materiál','5. Fotodokumentácia','6. Súhrn'];
    document.getElementById('inspWizardTitle').textContent=titles[step]||'Obhliadka';
    const body=document.getElementById('inspWizardBody');
    body.innerHTML=step===1?stepCustomer():step===2?stepBuilding():step===3?stepTechnical():step===4?stepInstallation():step===5?stepPhotos():stepSummary();
  }

  function field(label,id,value,type='text',extra=''){
    return '<div class="field"><label>'+esc(label)+'</label><input id="'+id+'" type="'+type+'" value="'+esc(value??'')+'" '+extra+'></div>';
  }
  function selectField(label,id,value,options,extra=''){
    return '<div class="field"><label>'+esc(label)+'</label><select id="'+id+'" '+extra+'>'+options.map(o=>'<option value="'+esc(o[0])+'" '+(String(value)===String(o[0])?'selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select></div>';
  }
  function setPath(path,value,rerender=false){
    if(!active)return;
    const parts=path.split('.');
    let obj=active;
    for(let i=0;i<parts.length-1;i++){if(!obj[parts[i]]||typeof obj[parts[i]]!=='object')obj[parts[i]]={};obj=obj[parts[i]]}
    obj[parts[parts.length-1]]=value;
    active._dirty=true;
    saveLocal(active);
    if(rerender)renderWizard();
  }
  function setFromInput(path,el,kind='text',rerender=false){
    let v=el.value;
    if(kind==='number')v=el.value===''?null:Number(el.value);
    if(kind==='bool')v=el.checked;
    setPath(path,v,rerender);
  }

  function stepCustomer(){
    const c=active.customer||{};
    return '<div class="card">'+
      field('Meno alebo firma *','icName',c.name,'text','onchange="SpektraInspections.input(\'customer.name\',this)"')+
      '<div class="grid2">'+field('Telefón *','icPhone',c.phone,'tel','onchange="SpektraInspections.input(\'customer.phone\',this)"')+field('E-mail','icEmail',c.email,'email','onchange="SpektraInspections.input(\'customer.email\',this)"')+'</div>'+
      field('Adresa realizácie *','icAddress',c.address,'text','onchange="SpektraInspections.input(\'customer.address\',this)"')+
      '<div class="field"><label>Poznámka k zákazníkovi</label><textarea onchange="SpektraInspections.input(\'customer.notes\',this)">'+esc(c.notes||'')+'</textarea></div>'+
      '</div><div class="card"><h2>Čo ideme riešiť?</h2><div class="inspTypeGrid">'+TYPE_OPTIONS.map(t=>
        '<button type="button" class="inspType '+((active.inspection_types||[]).includes(t[0])?'on':'')+'" onclick="SpektraInspections.toggleType(\''+t[0]+'\')"><span>'+t[1]+'</span><b>'+esc(t[2])+'</b></button>'
      ).join('')+'</div></div>'+
      '<button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať →</button>';
  }

  function stepBuilding(){
    const b=active.building||{};
    return '<div class="card">'+
      selectField('Typ objektu','ibType',b.type||'family_house',[['family_house','Rodinný dom'],['apartment','Byt'],['commercial','Prevádzka'],['other','Iné']],'onchange="SpektraInspections.input(\'building.type\',this)"')+
      selectField('Stav objektu','ibCondition',b.condition||'renovation',[['new','Novostavba'],['renovation','Rekonštrukcia'],['existing','Existujúci objekt']],'onchange="SpektraInspections.input(\'building.condition\',this)"')+
      '<div class="grid2">'+
        field('Vykurovaná plocha [m²]','ibArea',b.heated_area_m2,'number','min="10" step="1" onchange="SpektraInspections.input(\'building.heated_area_m2\',this,\'number\')"')+
        field('Počet podlaží','ibFloors',b.floors,'number','min="1" max="10" onchange="SpektraInspections.input(\'building.floors\',this,\'number\')"')+
      '</div>'+
      '<label class="row" style="cursor:pointer"><span><b>Zateplenie</b><small>Objekt má obvodové zateplenie</small></span><input type="checkbox" '+(b.insulated?'checked':'')+' style="width:23px;height:23px" onchange="SpektraInspections.check(\'building.insulated\',this,true)"></label>'+
      (b.insulated?field('Hrúbka izolácie [mm]','ibIns',b.insulation_mm,'number','min="0" step="10" onchange="SpektraInspections.input(\'building.insulation_mm\',this,\'number\')"'):'')+
      selectField('Okná','ibWindows',b.windows||'triple',[['old','Staršie'],['double','2-sklo'],['triple','3-sklo']],'onchange="SpektraInspections.input(\'building.windows\',this)"')+
      '</div><button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať →</button>';
  }

  function selectedTypes(){return active?.inspection_types||[]}
  function equipmentInspection(){return selectedTypes().some(x=>['heat_pump','air_conditioning','gas_boiler','biomass'].includes(x))}
  function tradePrimaryType(){return ['floor_heating','water_heater','zti','recovery','other'].find(x=>selectedTypes().includes(x))||null}
  function isTradeInspection(){return !equipmentInspection() && !!tradePrimaryType()}
  function ensureTradeDefaults(){
    active.installation=active.installation||{};
    const i=active.installation;
    if(i.labor_hour_rate_ex_vat==null)i.labor_hour_rate_ex_vat=35;
    if(i.labor_workers==null)i.labor_workers=1;
    if(i.labor_hours==null)i.labor_hours=8;
    if(i.floor_labor_rate_m2==null)i.floor_labor_rate_m2=8;
    if(i.floor_spacing_cm==null)i.floor_spacing_cm=15;
    if(i.water_heater_mode==null)i.water_heater_mode='same_place';
    if(i.water_heater_labor_ex_vat==null)i.water_heater_labor_ex_vat=i.water_heater_mode==='new_place'?225:150;
    return i;
  }
  function tradeLabel(type=tradePrimaryType()){
    return type==='floor_heating'?'Podlahové kúrenie':type==='water_heater'?'Výmena bojlera / ohrievača TÚV':type==='zti'?'ZTI / vodoinštalačné práce':type==='recovery'?'Rekuperácia / vzduchotechnické práce':'Montážne práce';
  }
  function stockByExactCode(code){
    const q=String(code||'').toLowerCase();
    return stockPool().find(x=>String(x.code||'').toLowerCase()===q)||null;
  }
  function materialFromStockCode(code,qty,unit,role,nameFallback){
    const st=stockByExactCode(code);
    return {
      pohoda_stock_id:st?.id||null, role:role||null, code:st?.code||code||null, name:st?.name||nameFallback||code,
      qty:Number(qty||0), unit:unit||st?.unit||'ks', source:'calculated', original_qty:Number(qty||0),
      metadata:{plu:st?.plu||null,manufacturer:st?.manufacturer||null,sell_price_ex_vat:st?.sell_price_ex_vat==null?null:Number(st.sell_price_ex_vat),purchase_price_ex_vat:st?.purchase_price_ex_vat==null?null:Number(st.purchase_price_ex_vat),quantity_available:st?.quantity_available==null?null:Number(st.quantity_available)}
    };
  }
  function floorDesign(){
    const i=ensureTradeDefaults();
    const area=Math.max(0,num(active.building?.heated_area_m2,0));
    const spacing=Math.max(5,num(i.floor_spacing_cm,15));
    const pipeM=Math.ceil(area*(100/spacing)*1.05);
    const circuits=Math.max(1,Math.ceil(pipeM/95));
    return {area,spacing,pipeM,circuits};
  }
  function tradeLaborPrice(){
    const i=ensureTradeDefaults(),type=tradePrimaryType();
    if(type==='floor_heating')return Math.round(floorDesign().area*num(i.floor_labor_rate_m2,8)*100)/100;
    if(type==='water_heater')return Math.max(0,num(i.water_heater_labor_ex_vat,i.water_heater_mode==='new_place'?225:150));
    return Math.round(num(i.labor_workers,1)*num(i.labor_hours,8)*num(i.labor_hour_rate_ex_vat,35)*100)/100;
  }
  function currentMaterialEstimate(){
    let total=0,missing=0;
    for(const m of (active.materials||[])){
      let st=m.pohoda_stock_id?stockPool().find(x=>x.id===m.pohoda_stock_id):null;
      if(!st&&m.code)st=stockByExactCode(m.code);
      const p=st?.sell_price_ex_vat??m.metadata?.sell_price_ex_vat;
      if(p==null){missing++;continue}
      total+=Number(p||0)*Number(m.qty||0);
    }
    return {total:Math.round(total*100)/100,missing};
  }
  function calculateHeatLoss(){
    const h=active.heat_loss||(active.heat_loss={});
    const b=active.building||{};
    const e=active.existing_system||{};
    const base=h.known&&num(h.known_kw)>0?num(h.known_kw):num(b.heated_area_m2)*num(h.specific_loss_w_m2,60)/1000;
    let reserve=e.heating==='underfloor'?10:e.heating==='radiators'?15:20;
    h.reserve_pct=reserve;
    h.base_kw=Math.round(base*100)/100;
    h.design_kw=Math.round(base*(1+reserve/100)*100)/100;
    const sizes=[5,7,9,12,16];
    h.recommended_kw=sizes.find(x=>x>=h.design_kw)||16;
    return h;
  }

  function editTradeSetup(){
    if(!active)return;
    const i=ensureTradeDefaults(),type=tradePrimaryType();
    if(type==='floor_heating'){
      const area=prompt('Plocha podlahového kúrenia [m²]:',String(active.building?.heated_area_m2||0));
      if(area!==null&&num(area)>0)active.building.heated_area_m2=num(area);
      const spacing=prompt('Rozstup rúry [cm] – napr. 10, 15 alebo 20:',String(i.floor_spacing_cm||15));
      if(spacing!==null&&num(spacing)>0)i.floor_spacing_cm=num(spacing);
      const rate=prompt('Cena práce bez DPH [€/m²]:',String(i.floor_labor_rate_m2||8));
      if(rate!==null&&num(rate)>=0)i.floor_labor_rate_m2=num(rate);
      active.materials=[];ensureBaseMaterials();
    }else if(type==='water_heater'){
      const mode=prompt('1 = jednoduchá výmena na rovnakom mieste, 2 = nové miesto / úprava rozvodov',i.water_heater_mode==='new_place'?'2':'1');
      if(mode==='2'){i.water_heater_mode='new_place';if(i.water_heater_labor_ex_vat===150)i.water_heater_labor_ex_vat=225}else if(mode==='1'){i.water_heater_mode='same_place';}
      const price=prompt('Odhad práce bez DPH [€]:',String(i.water_heater_labor_ex_vat||150));
      if(price!==null&&num(price)>=0)i.water_heater_labor_ex_vat=num(price);
    }else{
      const workers=prompt('Počet montérov:',String(i.labor_workers||1));
      if(workers!==null&&num(workers)>0)i.labor_workers=num(workers);
      const hours=prompt('Hodiny na jedného montéra:',String(i.labor_hours||8));
      if(hours!==null&&num(hours)>=0)i.labor_hours=num(hours);
      const rate=prompt('Sadzba práce bez DPH [€/h]:',String(i.labor_hour_rate_ex_vat||35));
      if(rate!==null&&num(rate)>=0)i.labor_hour_rate_ex_vat=num(rate);
    }
    active._dirty=true;saveLocal(active);renderWizard();
  }
  function stepTradeTechnical(){
    const i=ensureTradeDefaults(),type=tradePrimaryType();
    let detail='';
    if(type==='floor_heating'){
      const d=floorDesign();
      detail='<div class="srow"><span>Plocha</span><b>'+d.area+' m²</b></div><div class="srow"><span>Rozstup</span><b>'+d.spacing+' cm</b></div><div class="srow"><span>Orientačná rúrka</span><b>'+d.pipeM+' m</b></div><div class="srow"><span>Odhad okruhov</span><b>'+d.circuits+'</b></div><div class="srow"><span>Práca</span><b>'+priceText(i.floor_labor_rate_m2)+' / m²</b></div>';
    }else if(type==='water_heater'){
      detail='<div class="srow"><span>Rozsah</span><b>'+(i.water_heater_mode==='new_place'?'nové miesto / úpravy':'rovnaké miesto')+'</b></div><div class="srow"><span>Odhad práce</span><b>'+priceText(tradeLaborPrice())+'</b></div>';
    }else{
      detail='<div class="srow"><span>Montéri</span><b>'+num(i.labor_workers,1)+'</b></div><div class="srow"><span>Hodiny / montér</span><b>'+num(i.labor_hours,8)+' h</b></div><div class="srow"><span>Sadzba</span><b>'+priceText(i.labor_hour_rate_ex_vat)+' / h</b></div><div class="srow"><span>Odhad práce</span><b>'+priceText(tradeLaborPrice())+'</b></div>';
    }
    return '<div class="card"><h2>'+esc(tradeLabel(type))+'</h2><div class="summary">'+detail+'<div class="srow total"><span>Práca bez DPH</span><span>'+priceText(tradeLaborPrice())+'</span></div></div><button class="btn ghost full" style="margin-top:10px" onclick="SpektraInspections.editTradeSetup()">Upraviť odhad práce</button></div><div class="notice" style="margin-bottom:10px">Materiál sa doplní v ďalšom kroku z POHODY. Cena je orientačný návrh a pred odoslaním zákazníkovi ju môže kancelária upraviť.</div><button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať →</button>';
  }
  function stepTechnical(){
    if(isTradeInspection())return stepTradeTechnical();
    calculateHeatLoss();
    const e=active.existing_system||{},h=active.heat_loss||{};
    return '<div class="card"><h2>Existujúci systém</h2>'+
      selectField('Aktuálny zdroj','ieSource',e.source||'gas',[['gas','Plyn'],['electric','Elektrina'],['wood','Drevo'],['pellets','Pelety'],['heat_pump','Tepelné čerpadlo'],['other','Iné']],'onchange="SpektraInspections.input(\'existing_system.source\',this)"')+
      field('Ročná spotreba / poznámka','ieConsumption',e.annual_consumption||'','text','placeholder="napr. 1 800 m³/rok" onchange="SpektraInspections.input(\'existing_system.annual_consumption\',this)"')+
      selectField('Odovzdávanie tepla','ieHeating',e.heating||'underfloor',[['underfloor','Podlahové vykurovanie'],['radiators','Radiátory'],['high_temp','Vysokoteplotné radiátory']],'onchange="SpektraInspections.input(\'existing_system.heating\',this,null,true)"')+
      '<div class="grid2">'+field('Bežná teplota vody [°C]','ieTemp',e.water_temp_c||35,'number','min="20" max="80" onchange="SpektraInspections.input(\'existing_system.water_temp_c\',this,\'number\')"')+field('Počet osôb','iePersons',e.persons||3,'number','min="1" onchange="SpektraInspections.input(\'existing_system.persons\',this,\'number\')"')+'</div>'+
      '</div>'+
      '<div class="card"><h2>Tepelná strata</h2>'+
        '<label class="row" style="cursor:pointer;margin-bottom:10px"><span><b>Poznám presnú tepelnú stratu</b><small>Inak vypočítame orientačne z plochy</small></span><input type="checkbox" '+(h.known?'checked':'')+' style="width:23px;height:23px" onchange="SpektraInspections.check(\'heat_loss.known\',this,true)"></label>'+
        (h.known
          ?field('Tepelná strata [kW]','ihKnown',h.known_kw||'','number','min="1" step="0.1" onchange="SpektraInspections.input(\'heat_loss.known_kw\',this,\'number\',true)"')
          :selectField('Orientačná strata objektu','ihWm2',h.specific_loss_w_m2||60,[['45','45 W/m² – novostavba'],['60','60 W/m² – zateplený dom'],['95','95 W/m² – starší dom'],['125','125 W/m² – nezateplený']],'onchange="SpektraInspections.input(\'heat_loss.specific_loss_w_m2\',this,\'number\',true)"'))+
        '<div class="summary"><div class="srow"><span>Základ</span><b>'+num(h.base_kw).toFixed(2)+' kW</b></div><div class="srow"><span>Rezerva</span><b>+'+num(h.reserve_pct)+' %</b></div><div class="srow total"><span>Návrhový výkon</span><span>'+num(h.design_kw).toFixed(2)+' kW</span></div></div>'+
        '<div class="notice ok" style="margin-top:9px">Odporúčaná výkonová trieda: <b>'+num(h.recommended_kw)+' kW</b>. Orientačný návrh treba pred finálnou ponukou technicky preveriť.</div>'+
      '</div><button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať →</button>';
  }

  function ensureBaseMaterials(){
    if((active.materials||[]).length)return;
    const types=active.inspection_types||[];
    const r=active.routes||(active.routes={});
    const o=active.outdoor_unit||{};
    const e=active.electrical||{};
    const pipe=num(r.heating_m||o.route_m,5),cable=num(e.cable_m,12);
    if(types.includes('floor_heating')&&!equipmentInspection()){
      const d=floorDesign();
      const manifoldCircuits=Math.min(12,Math.max(2,d.circuits));
      active.materials=[
        materialFromStockCode('12051591001',Math.ceil(d.area*1.05*10)/10,'m2','floor_system_board','REHAU VARIONOVA systémová doska'),
        materialFromStockCode('11361401500',d.pipeM,'m','floor_pipe','REHAU RAUTHERM S 17x2'),
        materialFromStockCode('HR1103-'+manifoldCircuits,1,'ks','floor_manifold','Nerezový rozdeľovač '+manifoldCircuits+' cestný pre podlahové')
      ];
    }else if(types.includes('heat_pump')){
      active.materials=[
        {role:'copper_pipe_d28',name:'Cu potrubie 28 mm',qty:2*pipe,original_qty:2*pipe,unit:'m',source:'calculated'},
        {role:'pipe_insulation_13x28',name:'Izolácia potrubia 28 mm',qty:2*pipe,original_qty:2*pipe,unit:'m',source:'calculated'},
        {role:'power_cable_cyky_5x2_5',name:'CYKY 5×2,5',qty:cable,original_qty:cable,unit:'m',source:'calculated'}
      ];
    }else if(types.includes('air_conditioning')){
      const ac=num(r.refrigerant_m||o.route_m,5);
      active.materials=[
        {role:'refrigerant_pipe_pair',name:'Chladivové potrubie – pár',qty:ac,original_qty:ac,unit:'m',source:'calculated'},
        {role:'condensate_drain',name:'Odvod kondenzátu',qty:num(r.condensate_m,ac),original_qty:num(r.condensate_m,ac),unit:'m',source:'calculated'},
        {role:'pvc_trunking',name:'PVC lišta',qty:num(r.trunking_m,ac),original_qty:num(r.trunking_m,ac),unit:'m',source:'calculated'},
        {role:'power_cable',name:'Napájací / komunikačný kábel',qty:ac,original_qty:ac,unit:'m',source:'calculated'}
      ];
    }else if(isTradeInspection()){
      active.materials=[];
    }else{
      active.materials=[{name:'Montážny materiál podľa obhliadky',qty:1,original_qty:1,unit:'súb.',source:'manual'}];
    }
    active._dirty=true;saveLocal(active);
  }

  function toggleExtra(key){
    const a=active.extra_work||(active.extra_work=[]);
    const i=a.indexOf(key);
    if(i>=0)a.splice(i,1);else a.push(key);
    active._dirty=true;saveLocal(active);renderWizard();
  }

  function stepInstallation(){
    ensureBaseMaterials();
    const o=active.outdoor_unit||{},p=active.plant_room||{},e=active.electrical||{},r=active.routes||{};
    return '<div class="card"><h2>Miesto a trasa</h2>'+
      selectField('Umiestnenie zariadenia','ioPlace',o.placement||'ground',[['ground','Na zemi'],['wall','Na stene'],['roof','Strecha'],['inside','Technická miestnosť'],['other','Iné']],'onchange="SpektraInspections.input(\'outdoor_unit.placement\',this)"')+
      '<div class="grid2">'+field('Trasa potrubia [m]','ioRoute',o.route_m||5,'number','min="0" step="0.5" onchange="SpektraInspections.routeChanged(this)"')+field('Výškový rozdiel [m]','ioVert',o.vertical_m||0,'number','min="0" step="0.5" onchange="SpektraInspections.input(\'outdoor_unit.vertical_m\',this,\'number\')"')+'</div>'+
      '<label class="row" style="cursor:pointer"><span><b>Treba jadrové vŕtanie</b><small>Prestup nie je pripravený</small></span><input type="checkbox" '+(o.drilling?'checked':'')+' style="width:23px;height:23px" onchange="SpektraInspections.check(\'outdoor_unit.drilling\',this,true)"></label>'+
      (o.drilling?field('Hrúbka steny [cm]','ioWall',o.wall_cm||40,'number','min="5" onchange="SpektraInspections.input(\'outdoor_unit.wall_cm\',this,\'number\')"'):'')+
      '</div>'+
      '<div class="card"><h2>Kotolňa / elektro</h2>'+
      '<div class="grid2">'+selectField('Zásobník TÚV','ipDhw',p.dhw_l||200,[['0','Bez nového'],['120','120 l'],['200','200 l'],['300','300 l']],'onchange="SpektraInspections.input(\'plant_room.dhw_l\',this,\'number\')"')+
      selectField('Miesto','ipSpace',p.space||'ok',[['ok','Bez problémov'],['tight','Tesné'],['rebuild','Treba úpravu']],'onchange="SpektraInspections.input(\'plant_room.space\',this)"')+'</div>'+
      '<div class="grid2">'+selectField('Prívod','iePhases',e.phases||3,[['1','1 fáza'],['3','3 fázy']],'onchange="SpektraInspections.input(\'electrical.phases\',this,\'number\')"')+field('Hlavný istič [A]','ieBreaker',e.main_breaker_a||25,'number','min="10" onchange="SpektraInspections.input(\'electrical.main_breaker_a\',this,\'number\')"')+'</div>'+
      '<label class="row" style="cursor:pointer"><span><b>Voľné miesto v rozvádzači</b></span><input type="checkbox" '+(e.panel_space?'checked':'')+' style="width:23px;height:23px" onchange="SpektraInspections.check(\'electrical.panel_space\',this)"></label>'+
      field('Dĺžka nového prívodu [m]','ieCable',e.cable_m||12,'number','min="0" step="0.5" onchange="SpektraInspections.input(\'electrical.cable_m\',this,\'number\')"')+
      '</div>'+
      '<div class="card"><h2>Práce navyše</h2><div class="grid2">'+EXTRA_WORK.map(x=>'<label class="row" style="cursor:pointer"><span>'+esc(x[1])+'</span><input type="checkbox" '+((active.extra_work||[]).includes(x[0])?'checked':'')+' style="width:22px;height:22px" onchange="SpektraInspections.toggleExtra(\''+x[0]+'\')"></label>').join('')+'</div></div>'+
      '<div class="card"><h2>Navrhované zariadenie</h2>'+
        field('Model / poznámka','ipDevice',active.proposed_device?.name||'','text','placeholder="napr. Panasonic Aquarea 12 kW" onchange="SpektraInspections.input(\'proposed_device.name\',this)"')+
        field('Predbežný výkon [kW]','ipPower',active.proposed_device?.power_kw||active.heat_loss?.recommended_kw||'','number','step="0.1" onchange="SpektraInspections.input(\'proposed_device.power_kw\',this,\'number\')"')+
      '</div>'+
      '<div class="card"><h2>Materiál z obhliadky</h2>'+
        '<div class="inspStockSearch"><div class="field" style="margin-bottom:0"><label>Hľadať v POHODE</label><input id="inspStockSearchInput" placeholder="Názov, kód, PLU, výrobca…" autocomplete="off" oninput="SpektraInspections.searchStock(this.value)"></div>'+
        '<div id="inspStockResults" class="inspStockResults"></div><div class="inspStockHint">Výberom zo skladu sa uloží presná karta POHODA a pri cenovej ponuke sa použije jej aktuálna cena.</div></div>'+
        '<div id="inspMaterials">'+materialRows()+'</div>'+
        '<button class="btn ghost small" onclick="SpektraInspections.addMaterial()">+ Pridať ručne</button></div>'+
      '<div class="card"><h2>Poznámka technika</h2><textarea onchange="SpektraInspections.input(\'notes\',this)">'+esc(active.notes||'')+'</textarea></div>'+
      '<button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať →</button>';
  }

  function routeChanged(el){
    const v=num(el.value,5);
    setPath('outdoor_unit.route_m',v,false);
    setPath('routes.heating_m',v,false);
    setPath('routes.refrigerant_m',v,false);
  }
  function materialRows(){
    return (active.materials||[]).map((m,i)=>{
      const meta=m.metadata||{};
      const linked=!!m.pohoda_stock_id;
      const details=linked
        ? 'POHODA'+(m.code?' · '+m.code:'')+(meta.plu?' · PLU '+meta.plu:'')+' · '+priceText(meta.sell_price_ex_vat)+' bez DPH'+(meta.quantity_available!=null?' · sklad '+meta.quantity_available+' '+(m.unit||'ks'):'')
        : (m.source==='manual'?'Ručná položka – ak sa nenájde v POHODE, ponuka môže zostať bez ceny':'Množstvo vypočítané z obhliadky');
      return '<div class="inspMaterial">'+
        '<div class="inspMaterialMain"><input value="'+esc(m.name||'')+'" '+(linked?'readonly':'')+' onchange="SpektraInspections.material('+i+',\'name\',this.value)"><div class="inspMaterialMeta '+(linked?'linked':'')+'">'+esc(details)+'</div></div>'+
        '<input type="number" step="0.5" min="0" value="'+esc(m.qty??0)+'" onchange="SpektraInspections.material('+i+',\'qty\',Number(this.value))">'+
        '<select onchange="SpektraInspections.material('+i+',\'unit\',this.value)">'+[...new Set(['ks','m','súb.','l','bal',m.unit].filter(Boolean))].map(u=>'<option '+(m.unit===u?'selected':'')+'>'+u+'</option>').join('')+'</select>'+
        '<button type="button" onclick="SpektraInspections.removeMaterial('+i+')">×</button></div>';
    }).join('');
  }
  function material(index,key,value){
    if(!active.materials[index])return;
    active.materials[index][key]=value;
    active._dirty=true;saveLocal(active);
  }
  function addMaterial(){active.materials.push({name:'Nová položka',qty:1,unit:'ks',source:'manual',metadata:{}});active._dirty=true;saveLocal(active);renderWizard()}
  function removeMaterial(i){active.materials.splice(i,1);active._dirty=true;saveLocal(active);renderWizard()}

  function renderStockSearchResults(message=''){
    const box=document.getElementById('inspStockResults');
    if(!box)return;
    if(message){box.innerHTML='<div class="notice">'+esc(message)+'</div>';return}
    if(!stockSearchResults.length){box.innerHTML='';return}
    box.innerHTML=stockSearchResults.map((st,i)=>{
      const code=st.code||st.plu||'bez kódu';
      const qty=st.quantity_available==null?'—':Number(st.quantity_available).toLocaleString('sk-SK');
      return '<button type="button" class="inspStockResult" onclick="SpektraInspections.chooseStock('+i+')">'+
        '<b>'+esc(st.name||'Bez názvu')+'</b>'+
        '<small>'+esc(code)+(st.plu&&st.plu!==code?' · PLU '+esc(st.plu):'')+(st.manufacturer?' · '+esc(st.manufacturer):'')+'</small>'+
        '<small>Sklad: '+qty+' '+esc(st.unit||'ks')+' · <span class="price">'+priceText(st.sell_price_ex_vat)+' bez DPH</span></small>'+
      '</button>';
    }).join('');
  }

  async function searchStock(query){
    const q=fold(query);
    clearTimeout(stockSearchTimer);
    if(q.length<2){stockSearchResults=[];renderStockSearchResults();return}
    renderStockSearchResults('Hľadám v POHODE…');
    stockSearchTimer=setTimeout(async()=>{
      try{
        let pool=stockPool();
        if(!pool.length&&window.SpektraDB?.isAuthenticated()){
          pool=await SpektraDB.listStocks();
          try{stocks=pool}catch(_){}
        }
        const tokens=q.split(/\s+/).filter(Boolean);
        stockSearchResults=pool.filter(st=>{
          if(st.active===false)return false;
          const hay=fold([st.name,st.code,st.plu,st.ean,st.manufacturer,st.stock_group].filter(Boolean).join(' '));
          return tokens.every(t=>hay.includes(t));
        }).sort((a,b)=>{
          const qa=fold(a.name).startsWith(q)?1:0,qb=fold(b.name).startsWith(q)?1:0;
          if(qa!==qb)return qb-qa;
          const sa=Number(a.quantity_available||0)>0?1:0,sb=Number(b.quantity_available||0)>0?1:0;
          if(sa!==sb)return sb-sa;
          return String(a.name||'').localeCompare(String(b.name||''),'sk');
        }).slice(0,20);
        renderStockSearchResults(stockSearchResults.length?'':'Nenašla sa žiadna položka.');
      }catch(e){
        console.error('Inspection POHODA search failed',e);
        stockSearchResults=[];
        renderStockSearchResults('Vyhľadávanie zlyhalo: '+(e.message||String(e)));
      }
    },180);
  }

  function chooseStock(index){
    const st=stockSearchResults[index];
    if(!st||!active)return;
    active.materials=active.materials||[];
    const existing=active.materials.find(m=>m.pohoda_stock_id===st.id);
    if(existing){
      existing.qty=Number(existing.qty||0)+1;
      existing.metadata={...(existing.metadata||{}),
        plu:st.plu||null,ean:st.ean||null,manufacturer:st.manufacturer||null,
        sell_price_ex_vat:st.sell_price_ex_vat==null?null:Number(st.sell_price_ex_vat),
        purchase_price_ex_vat:st.purchase_price_ex_vat==null?null:Number(st.purchase_price_ex_vat),
        quantity_available:st.quantity_available==null?null:Number(st.quantity_available)
      };
    }else{
      active.materials.push({
        pohoda_stock_id:st.id,
        role:null,
        code:st.code||null,
        name:st.name||'POHODA položka',
        qty:1,
        unit:st.unit||'ks',
        source:'pohoda',
        original_qty:null,
        metadata:{
          plu:st.plu||null,ean:st.ean||null,manufacturer:st.manufacturer||null,
          sell_price_ex_vat:st.sell_price_ex_vat==null?null:Number(st.sell_price_ex_vat),
          purchase_price_ex_vat:st.purchase_price_ex_vat==null?null:Number(st.purchase_price_ex_vat),
          quantity_available:st.quantity_available==null?null:Number(st.quantity_available)
        }
      });
    }
    active._dirty=true;
    saveLocal(active);
    stockSearchResults=[];
    renderWizard();
    setTimeout(()=>document.getElementById('inspStockSearchInput')?.focus(),0);
  }

  function requiredPhotoKeys(){return PHOTO_CATEGORIES.map(x=>x[0])}
  function stepPhotos(){
    const photos=active.photos||[];
    const cards=PHOTO_CATEGORIES.map(([key,label])=>{
      const cat=photos.filter(p=>p.category===key);
      return '<div class="card"><div class="row" style="margin-bottom:8px"><div><b>'+esc(label)+'</b><small>'+(cat.length?'✓ '+cat.length+' foto':'Povinné foto')+'</small></div>'+
        '<label class="btn ghost small" style="cursor:pointer">📷 Foto<input type="file" accept="image/*" capture="environment" style="display:none" onchange="SpektraInspections.photo(\''+key+'\',this.files[0]);this.value=\'\'"></label></div>'+
        (cat.length?'<div class="inspPhotoGrid">'+cat.map(p=>'<div class="inspThumb">'+(p.signed_url?'<img src="'+esc(p.signed_url)+'" alt="">':'<div style="padding:15px;font-size:12px">'+esc(p.file_name||'Foto')+'</div>')+'<button onclick="SpektraInspections.deletePhoto(\''+esc(p.id||'')+'\')">×</button></div>').join('')+'</div>':'')+
      '</div>';
    }).join('');
    const missing=requiredPhotoKeys().filter(k=>!photos.some(p=>p.category===k));
    return '<div class="notice '+(missing.length?'warn':'ok')+'" style="margin-bottom:10px">'+(missing.length?'Chýba '+missing.length+' povinných fotografií: '+missing.map(photoLabel).join(', '):'Fotodokumentácia je kompletná ✓')+'</div>'+
      cards+'<button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať na súhrn →</button>';
  }
  function photoLabel(key){return PHOTO_CATEGORIES.find(x=>x[0]===key)?.[1]||key}

  async function saveRemote(i,eventType=null,silent=false){
    const authed=await ensureAuth();
    if(!authed){
      i._dirty=true;saveLocal(i);
      if(!silent)alert('Obhliadka je uložená lokálne. Po prihlásení do online databázy sa zosynchronizuje.');
      return i;
    }
    const ids=await SpektraDB.saveInspection(i,eventType);
    i.remote_id=ids.remote_id;
    i.customer_id=ids.customer_id;
    i.sync_version=ids.sync_version;
    i.updated_at=ids.updated_at;
    i._dirty=false;
    saveLocal(i);
    return i;
  }

  async function save(status=null){
    if(!active)return;
    if(status)active.status=status;
    if(status==='completed'&&!active.inspected_at)active.inspected_at=nowIso();
    active._dirty=true;saveLocal(active);
    try{
      await saveRemote(active,status==='completed'?'inspection_completed':'inspection_saved',false);
      renderWizard();
    }catch(e){
      active._dirty=true;saveLocal(active);
      console.error('Inspection save failed',e);
      alert('Online uloženie obhliadky zlyhalo: '+(e.message||String(e))+'. Lokálna kópia zostala zachovaná.');
    }
  }

  async function photo(category,file){
    if(!file||!active)return;
    const authed=await ensureAuth();
    if(!authed){alert('Fotografie sa ukladajú do privátneho online úložiska. Najprv sa prihlás do databázy.');return}
    try{
      if(!active.remote_id)await saveRemote(active,'inspection_saved',true);
      const p=await SpektraDB.uploadInspectionPhoto(active.remote_id,file,category,true);
      active.photos=active.photos||[];
      active.photos.push(p);
      active.checklist=active.checklist||{};
      active.checklist[category]=true;
      active._dirty=true;
      await saveRemote(active,'photo_added',true);
      renderWizard();
    }catch(e){console.error(e);alert('Fotografiu sa nepodarilo uložiť: '+(e.message||String(e)))}
  }
  async function deletePhoto(id){
    if(!active||!id)return;
    const p=(active.photos||[]).find(x=>x.id===id);
    if(!p)return;
    try{
      await SpektraDB.deleteInspectionPhoto(p);
      active.photos=active.photos.filter(x=>x.id!==id);
      active.checklist[p.category]=active.photos.some(x=>x.category===p.category);
      active._dirty=true;await saveRemote(active,'photo_deleted',true);renderWizard();
    }catch(e){alert('Fotografiu sa nepodarilo odstrániť: '+(e.message||String(e)))}
  }

  function summaryRow(label,value){
    return '<div class="srow"><span>'+esc(label)+'</span><b>'+esc(value==null?'—':value)+'</b></div>';
  }
  function stepSummary(){
    calculateHeatLoss();
    const missing=requiredPhotoKeys().filter(k=>!(active.photos||[]).some(p=>p.category===k));
    const types=(active.inspection_types||[]).map(typeLabel).join(', ');
    const work=(active.extra_work||[]).map(k=>EXTRA_WORK.find(x=>x[0]===k)?.[1]||k).join(', ')||'bez doplnkov';
    return '<div class="card"><h2>'+esc(active.customer?.name||'Bez mena')+'</h2><div class="sub">'+esc(active.customer?.address||'')+'</div>'+
      '<div class="summary" style="margin-top:12px">'+
      summaryRow('Typ',types)+summaryRow('Plocha',(active.building?.heated_area_m2||'—')+' m²')+
      summaryRow('Vykurovanie',active.existing_system?.heating==='underfloor'?'Podlahovka':active.existing_system?.heating==='radiators'?'Radiátory':'Vysokoteplotné')+
      summaryRow('Návrhový výkon',num(active.heat_loss?.design_kw).toFixed(2)+' kW')+
      summaryRow('Odporúčaná trieda',num(active.heat_loss?.recommended_kw)+' kW')+
      summaryRow('Trasa',num(active.outdoor_unit?.route_m)+' m')+
      summaryRow('Materiál',(active.materials||[]).length+' položiek')+
      summaryRow('Práce navyše',work)+
      '</div></div>'+
      '<div class="card"><h2>Fotodokumentácia</h2><div class="notice '+(missing.length?'warn':'ok')+'">'+((active.photos||[]).length)+' fotografií · '+(missing.length?'chýba: '+missing.map(photoLabel).join(', '):'kompletná ✓')+'</div></div>'+
      '<div class="card"><h2>Poznámka technika</h2><div>'+esc(active.notes||'Bez poznámky')+'</div></div>'+
      '<div class="sendgrid">'+
        '<button class="btn ghost" onclick="SpektraInspections.save()">Uložiť rozpracovanú</button>'+
        '<button class="btn green" onclick="SpektraInspections.complete()">✓ Dokončiť obhliadku</button>'+
        '<button class="btn primary" onclick="SpektraInspections.createQuote()">Vytvoriť cenovú ponuku →</button>'+
        '<button class="btn ghost" onclick="SpektraInspections.openHome()">Späť na obhliadky</button>'+
      '</div>';
  }

  async function complete(){
    const missing=requiredPhotoKeys().filter(k=>!(active.photos||[]).some(p=>p.category===k));
    if(missing.length){alert('Obhliadku nemožno dokončiť. Chýbajú povinné fotografie: '+missing.map(photoLabel).join(', ')+'. Môžeš ju zatiaľ uložiť ako rozpracovanú.');return}
    await save('completed');
    alert('Obhliadka je dokončená a synchronizovaná.');
  }

  async function createQuote(){
    if(!active)return;
    const missing=requiredPhotoKeys().filter(k=>!(active.photos||[]).some(p=>p.category===k));
    if(missing.length){alert('Pred vytvorením ponuky doplň povinné fotografie: '+missing.map(photoLabel).join(', ')+'.');return}
    const authed=await ensureAuth();
    if(!authed){alert('Na vytvorenie prepojenej cenovej ponuky musí byť aplikácia prihlásená online.');return}

    calculateHeatLoss();
    active.status='completed';
    if(!active.inspected_at)active.inspected_at=nowIso();
    await saveRemote(active,'inspection_completed',true);

    const supported=(active.inspection_types||[]).find(x=>['heat_pump','air_conditioning','gas_boiler','biomass'].includes(x));
    if(!supported){alert('Automatické vytvorenie ponuky je zatiaľ dostupné pre tepelné čerpadlo, klimatizáciu a kotol. Obhliadka zostala uložená.');return}

    startWizard();
    current.inspection_id=active.remote_id;
    current.remote_customer_id=active.customer_id;
    current.customer={
      name:active.customer.name||'',
      phone:active.customer.phone||'',
      email:active.customer.email||'',
      address:active.customer.address||'',
      note:active.customer.notes||active.notes||''
    };
    const h=active.heat_loss||{},b=active.building||{},e=active.existing_system||{};
    current.building={
      known_loss:!!h.known,
      heat_loss_kw:h.known?num(h.known_kw):null,
      area_m2:h.known?null:num(b.heated_area_m2),
      w_per_m2:num(h.specific_loss_w_m2,60),
      heating:e.heating||'underfloor',
      with_external_dhw_tank:num(active.plant_room?.dhw_l)>0
    };
    category=supported==='heat_pump'?'heat_pump':supported==='air_conditioning'?'air_conditioning':'boiler';
    current.category=category;
    if(category==='boiler'){
      boilerType=supported==='biomass'?'pellet':'gas';
      current.boiler_type=boilerType;
    }
    brand='';current.brand='';
    current.required_kw=num(h.design_kw);
    current.target_kw=num(h.recommended_kw);
    // Preserve the technical source of the quote. buildBOM() applies these
    // values after the user selects the final brand/device.
    current.inspection_materials=(active.materials||[]).map(m=>({...m}));
    current.inspection_routes={...(active.routes||{}),route_m:num(active.outdoor_unit?.route_m||0)};
    current.inspection_extra_work=[...(active.extra_work||[])];
    current.inspection_notes=active.notes||null;

    const vals={
      cName:current.customer.name,cPhone:current.customer.phone,cEmail:current.customer.email,cAddress:current.customer.address,cNote:current.customer.note,
      hasLoss:current.building.known_loss?'yes':'no',heatLoss:current.building.heat_loss_kw||'',area:current.building.area_m2||'',
      buildingClass:String(current.building.w_per_m2||60),heating:current.building.heating||'underfloor',dhwMode:current.building.with_external_dhw_tank?'external':'none'
    };
    Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.value=v});
    toggleLoss();
    renderChoices();

    await upsertCurrent();
    if(current.remote_id){
      await SpektraDB.linkInspectionQuote(active.remote_id,current.remote_id,'generated');
      active.status='converted';active._dirty=false;saveLocal(active);
    }
    go('step3');
    alert('Z obhliadky bol vytvorený draft cenovej ponuky. Vyber značku a zariadenie; ostatný editor ponuky funguje ďalej po starom.');
  }

  function toggleType(key){
    const a=active.inspection_types||(active.inspection_types=[]);
    const i=a.indexOf(key);
    if(i>=0){
      if(a.length>1)a.splice(i,1);
    }else a.push(key);
    active._dirty=true;saveLocal(active);renderWizard();
  }

  window.SpektraInspections={
    openHome,startNew,edit,refresh,next,back,save,complete,createQuote,
    input:(path,el,kind,rerender)=>setFromInput(path,el,kind||'text',!!rerender),
    check:(path,el,rerender)=>setFromInput(path,el,'bool',!!rerender),
    toggleType,toggleExtra,routeChanged,material,addMaterial,removeMaterial,searchStock,chooseStock,photo,deletePhoto
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initUI);
  else initUI();
})();
