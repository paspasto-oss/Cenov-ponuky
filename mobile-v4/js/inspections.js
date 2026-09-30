/* Spektra Install – mobile field inspections
 * Loaded after app.html. Additive UI only; existing quote wizard is untouched.
 */
(function(){
  'use strict';

  const CACHE_KEY='spektra_inspections_v1';
  const ZTI_PIPE_CLIPS_PER_M=2;
  const ZTI_LABOR_RULES={
    base_mh:1.5,
    water_outlet_mh:0.45,
    waste_outlet_mh:0.35,
    washing_siphon_mh:0.30,
    wc_duofix_mh:1.75,
    boiler_outlet_mh:0.50,
    frost_valve_mh:0.75,
    main_water_shutoff_mh:2.50,
    pipe16_mh_per_m:0.06,
    pipe20_mh_per_m:0.07,
    pipe25_mh_per_m:0.08,
    min_mh:2
  };
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
    ['bathroom','Kúpeľňa'],
    ['kitchen','Kuchyňa'],
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
  let manualStockSearch={index:-1,results:[]};
  let manualStockSearchTimer=null;

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
        water_heater_labor_ex_vat:150,
        zti_water_outlets:0,
        zti_waste_outlets:0,
        zti_washing_siphons:0,
        zti_wc_duofix:0,
        zti_boiler_room_outlets:0,
        zti_pipe16_m:0,
        zti_pipe20_m:0,
        zti_pipe25_m:0,
        zti_frost_valves:0,
        zti_main_water_shutoffs:0,
        zti_rate_newbuild_ex_vat:35,
        zti_rate_renovation_ex_vat:40,
        zti_labor_mode:'auto',
        zti_crew_size:2,
        zti_manual_man_hours:null
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
      '.inspManualAuto{position:relative}.inspManualSuggestions{position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #86b8d1;border-radius:10px;box-shadow:0 8px 24px rgba(15,61,84,.18);max-height:300px;overflow:auto;margin-top:3px}.inspManualSuggestions:empty{display:none}.inspManualSuggestion{display:block;width:100%;border:0;border-bottom:1px solid #e2edf2;background:#fff;padding:9px 10px;text-align:left;color:#173247}.inspManualSuggestion:last-child{border-bottom:0}.inspManualSuggestion:hover,.inspManualSuggestion:focus{background:#eef7fb}.inspManualSuggestion b{display:block;font-size:12px}.inspManualSuggestion small{display:block;font-size:10px;color:#607787;margin-top:2px}.inspManualSuggestion .price{font-weight:900;color:#00539B}'+
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
    if(i.zti_water_outlets==null)i.zti_water_outlets=0;
    if(i.zti_waste_outlets==null)i.zti_waste_outlets=0;
    if(i.zti_washing_siphons==null)i.zti_washing_siphons=0;
    if(i.zti_wc_duofix==null)i.zti_wc_duofix=0;
    if(i.zti_boiler_room_outlets==null)i.zti_boiler_room_outlets=0;
    if(i.zti_pipe16_m==null)i.zti_pipe16_m=0;
    if(i.zti_pipe20_m==null)i.zti_pipe20_m=0;
    if(i.zti_pipe25_m==null)i.zti_pipe25_m=0;
    if(i.zti_frost_valves==null)i.zti_frost_valves=0;
    if(i.zti_main_water_shutoffs==null)i.zti_main_water_shutoffs=0;
    if(i.zti_rate_newbuild_ex_vat==null)i.zti_rate_newbuild_ex_vat=35;
    if(i.zti_rate_renovation_ex_vat==null)i.zti_rate_renovation_ex_vat=40;
    if(!['auto','manual'].includes(i.zti_labor_mode))i.zti_labor_mode='auto';
    if(i.zti_crew_size==null)i.zti_crew_size=2;
    if(i.zti_manual_man_hours===undefined)i.zti_manual_man_hours=null;
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

  function ztiMaterial(code,qty,unit,role,nameFallback,macro,label){
    if(Number(qty||0)<=0)return null;
    const m=materialFromStockCode(code,qty,unit,role,nameFallback);
    m.metadata={...(m.metadata||{}),zti_macro:macro,zti_macro_label:label||macro,inspection_auto_owner:'zti'};
    return m;
  }
  function ztiInputs(){
    const i=ensureTradeDefaults();
    return {
      water:Math.max(0,num(i.zti_water_outlets,0)),
      waste:Math.max(0,num(i.zti_waste_outlets,0)),
      siphon:Math.max(0,num(i.zti_washing_siphons,0)),
      wc:Math.max(0,num(i.zti_wc_duofix,0)),
      boiler:Math.max(0,num(i.zti_boiler_room_outlets,0)),
      frost:Math.max(0,num(i.zti_frost_valves,0)),
      main:Math.max(0,num(i.zti_main_water_shutoffs,0)),
      p16:Math.max(0,num(i.zti_pipe16_m,0)),
      p20:Math.max(0,num(i.zti_pipe20_m,0)),
      p25:Math.max(0,num(i.zti_pipe25_m,0))
    };
  }
  function rebuildZtiMaterials(save=true){
    if(!active)return;
    const z=ztiInputs();
    const keep=(active.materials||[]).filter(m=>!m.metadata?.zti_macro);
    const auto=[];
    const add=m=>{if(m)auto.push(m)};

    // 1× vývod voda = 1 nástenka 16x1/2.
    // T-kus 20-16-20 má dve 20 mm vetvy + jednu 16 mm vetvu,
    // nástenka má ďalší 16 mm spoj => spolu 2× objímka 16 + 2× objímka 20.
    add(ztiMaterial('14563581001',z.water,'ks','zti_water_wallplate_16','REHAU RAUTITAN nástenka 16x1/2','water_outlet','Vývod voda'));
    add(ztiMaterial('11600611001',z.water,'ks','zti_water_tee_20_16_20','REHAU RAUTITAN T-kus 20-16-20','water_outlet','Vývod voda'));
    add(ztiMaterial('11600011001',z.water*2,'ks','zti_water_sleeve_16','REHAU RAUTITAN objímka 16','water_outlet','Vývod voda'));
    add(ztiMaterial('11600021001',z.water*2,'ks','zti_water_sleeve_20','REHAU RAUTITAN objímka 20','water_outlet','Vývod voda'));

    // Technická miestnosť / kotol: nástenka 25x3/4 + 1 objímka 25.
    add(ztiMaterial('14563611001',z.boiler,'ks','zti_boiler_wallplate_25','REHAU RAUTITAN nástenka 25x3/4','boiler_outlet','Vývod technická miestnosť'));
    add(ztiMaterial('11600031001',z.boiler,'ks','zti_boiler_sleeve_25','REHAU RAUTITAN objímka 25','boiler_outlet','Vývod technická miestnosť'));

    // Nezamŕzavý vonkajší ventil.
    add(ztiMaterial('039970399',z.frost,'ks','zti_frost_valve','SCHELL POLAR II nezámrzný ventil DN15','frost_valve','Nezamŕzavý ventil'));

    // Hlavný uzáver vody – kompletná zostava podľa Spektra štandardu.
    add(ztiMaterial('154079591609750002',z.main*3,'ks','zti_main_ball_valve_1','IVR 954 EVERLAST guľový kohút FF1"','main_water_shutoff','Hlavný uzáver vody'));
    add(ztiMaterial('2520009',z.main,'ks','zti_main_brass_tee_1','T-kus mosadzný 1"','main_water_shutoff','Hlavný uzáver vody'));
    add(ztiMaterial('200001',z.main*8,'ks','zti_main_brass_nipple_1','Vsuvka 1" mosadz','main_water_shutoff','Hlavný uzáver vody'));
    add(ztiMaterial('5061001',z.main*4,'ks','zti_main_union_1','Šróbenie V4300 1" mosadz','main_water_shutoff','Hlavný uzáver vody'));
    add(ztiMaterial('22116032',z.main*2,'ks','zti_main_pe_transition_32_1','PE prechod 32x1" vonkajší závit','main_water_shutoff','Hlavný uzáver vody'));
    add(ztiMaterial('38100',z.main,'ks','zti_main_filter_10','Sada filtra Senior 10" MONO, komplet 1"','main_water_shutoff','Hlavný uzáver vody'));
    add(ztiMaterial('PPS1020',z.main,'ks','zti_main_filter_cartridge_10','Vložka filtra lisovaná 10"x2,5" 20 micron','main_water_shutoff','Hlavný uzáver vody'));
    add(ztiMaterial('150047100009300038',z.main,'ks','zti_main_pressure_reducer','HERZ tlakový ventil DN25 membránový, redukčný','main_water_shutoff','Hlavný uzáver vody'));

    // Odpad DN50: 1× koleno 87° + 1× metrová rúra na každý vývod.
    add(ztiMaterial('112140',z.waste,'ks','zti_waste_elbow_50','HT PLUS koleno DN50 87°','waste_outlet','Vývod odpad'));
    add(ztiMaterial('112040',z.waste,'ks','zti_waste_pipe_50_1m','HT PLUS rúra DN50 1000 mm','waste_outlet','Vývod odpad'));

    add(ztiMaterial('PT100PS3',z.siphon,'ks','zti_washing_siphon','CONCEPT podomietkový práčkový sifón DN40/50','washing_siphon','Práčkový sifón'));
    add(ztiMaterial('111.154.11.2',z.wc,'ks','zti_wc_duofix','Geberit Duofix Delta pre WC','wc_duofix','WC Geberit Duofix'));

    // Potrubné balíky: rúrka + TUBEX + podlahová príchytka.
    add(ztiMaterial('11301211100',z.p16,'m','zti_pipe16','REHAU RAUTITAN STABIL 16','pipe16','Potrubie 16 + izolácia'));
    add(ztiMaterial('511450013',z.p16,'m','zti_tubex18','TUBEX STANDARD 10-18','pipe16','Potrubie 16 + izolácia'));
    add(ztiMaterial('11301311100',z.p20,'m','zti_pipe20','REHAU RAUTITAN STABIL 20','pipe20','Potrubie 20 + izolácia'));
    add(ztiMaterial('511450014',z.p20,'m','zti_tubex22','TUBEX STANDARD 10-22','pipe20','Potrubie 20 + izolácia'));
    add(ztiMaterial('11301411050',z.p25,'m','zti_pipe25','REHAU RAUTITAN STABIL 25','pipe25','Potrubie 25 + izolácia'));
    add(ztiMaterial('511450015',z.p25,'m','zti_tubex28','TUBEX STANDARD 10-28','pipe25','Potrubie 25 + izolácia'));

    const totalPipe=z.p16+z.p20+z.p25;
    add(ztiMaterial('144013000000001257',totalPipe*ZTI_PIPE_CLIPS_PER_M,'ks','zti_floor_clip','Podlahová príchytka potrubia','pipe_clips','Uchytenie potrubia'));

    active.materials=[...auto,...keep];
    active._dirty=true;
    if(save)saveLocal(active);
    return auto;
  }
  function ztiMacroAmount(macro){
    let total=0,missing=0;
    for(const m of (active.materials||[]).filter(x=>x.metadata?.zti_macro===macro)){
      let st=m.pohoda_stock_id?stockPool().find(x=>x.id===m.pohoda_stock_id):null;
      if(!st&&m.code)st=stockByExactCode(m.code);
      const p=st?.sell_price_ex_vat??m.metadata?.sell_price_ex_vat;
      if(p==null){missing++;continue}
      total+=Number(p||0)*Number(m.qty||0);
    }
    return {total:Math.round(total*100)/100,missing};
  }
  function ztiChanged(key,el){
    const i=ensureTradeDefaults();
    i[key]=Math.max(0,num(el.value,0));
    rebuildZtiMaterials(true);
    renderWizard();
  }


  function ztiLaborEstimate(){
    const i=ensureTradeDefaults(),z=ztiInputs();
    const parts=[
      {key:'base',label:'Príprava, rozmeranie a tlaková skúška',qty:1,mh:ZTI_LABOR_RULES.base_mh},
      {key:'water',label:'Vývody vody',qty:z.water,mh:z.water*ZTI_LABOR_RULES.water_outlet_mh},
      {key:'waste',label:'Vývody odpadu DN50',qty:z.waste,mh:z.waste*ZTI_LABOR_RULES.waste_outlet_mh},
      {key:'siphon',label:'Práčkové sifóny',qty:z.siphon,mh:z.siphon*ZTI_LABOR_RULES.washing_siphon_mh},
      {key:'wc',label:'Geberit Duofix',qty:z.wc,mh:z.wc*ZTI_LABOR_RULES.wc_duofix_mh},
      {key:'boiler',label:'Vývody technická miestnosť',qty:z.boiler,mh:z.boiler*ZTI_LABOR_RULES.boiler_outlet_mh},
      {key:'frost',label:'Nezamŕzavé ventily',qty:z.frost,mh:z.frost*ZTI_LABOR_RULES.frost_valve_mh},
      {key:'main',label:'Hlavný uzáver vody',qty:z.main,mh:z.main*ZTI_LABOR_RULES.main_water_shutoff_mh},
      {key:'p16',label:'Potrubie 16',qty:z.p16,mh:z.p16*ZTI_LABOR_RULES.pipe16_mh_per_m},
      {key:'p20',label:'Potrubie 20',qty:z.p20,mh:z.p20*ZTI_LABOR_RULES.pipe20_mh_per_m},
      {key:'p25',label:'Potrubie 25',qty:z.p25,mh:z.p25*ZTI_LABOR_RULES.pipe25_mh_per_m}
    ];
    const hasScope=(z.water+z.waste+z.siphon+z.wc+z.boiler+z.frost+z.main+z.p16+z.p20+z.p25)>0;
    const raw=parts.reduce((s,p)=>s+Number(p.mh||0),0);
    const manHours=hasScope?Math.max(ZTI_LABOR_RULES.min_mh,Math.ceil(raw*4)/4):0;
    const crew=Math.max(1,Math.round(num(i.zti_crew_size,2)));
    const durationHours=crew?Math.ceil((manHours/crew)*4)/4:manHours;
    return {parts:parts.filter(p=>p.mh>0),raw,manHours,crew,durationHours};
  }
  function ztiLaborManHours(){
    const i=ensureTradeDefaults();
    if(i.zti_labor_mode==='manual'){
      if(i.zti_manual_man_hours==null)return ztiLaborEstimate().manHours;
      return Math.max(0,num(i.zti_manual_man_hours,0));
    }
    return ztiLaborEstimate().manHours;
  }
  function ztiLaborChanged(key,el,kind='number'){
    const i=ensureTradeDefaults();
    let v=el.value;
    if(kind==='number')v=el.value===''?null:Number(el.value);
    if(key==='zti_labor_mode'&&v==='manual'&&i.zti_manual_man_hours==null){
      i.zti_manual_man_hours=ztiLaborEstimate().manHours;
    }
    i[key]=v;
    active._dirty=true;saveLocal(active);renderWizard();
  }

  function floorDesign(){
    const i=ensureTradeDefaults();
    const area=Math.max(0,num(active.building?.heated_area_m2,0));
    const spacing=Math.max(5,num(i.floor_spacing_cm,15));
    const pipeM=Math.ceil(area*(100/spacing)*1.05);
    const circuits=Math.max(1,Math.ceil(pipeM/95));
    return {area,spacing,pipeM,circuits};
  }
  function ztiHourlyRate(){
    const i=ensureTradeDefaults();
    return active.building?.condition==='new'
      ? Math.max(0,num(i.zti_rate_newbuild_ex_vat,35))
      : Math.max(0,num(i.zti_rate_renovation_ex_vat,40));
  }
  function tradeLaborPrice(){
    const i=ensureTradeDefaults(),type=tradePrimaryType();
    if(type==='floor_heating')return Math.round(floorDesign().area*num(i.floor_labor_rate_m2,8)*100)/100;
    if(type==='water_heater')return Math.max(0,num(i.water_heater_labor_ex_vat,i.water_heater_mode==='new_place'?225:150));
    if(type==='zti')return Math.round(ztiLaborManHours()*ztiHourlyRate()*100)/100;
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


  function ztiGeneratedPreview(){
    const rows=(active.materials||[]).filter(m=>m.metadata?.zti_macro);
    if(!rows.length)return '<div class="notice">Zatiaľ bez ZTI materiálu. Zadaj počty vývodov alebo metre potrubia.</div>';
    const groups=new Map();
    rows.forEach(m=>{
      const key=m.metadata.zti_macro,label=m.metadata.zti_macro_label||key;
      if(!groups.has(key))groups.set(key,{label,rows:[]});
      groups.get(key).rows.push(m);
    });
    return [...groups.values()].map(g=>{
      const amount=g.rows.reduce((sum,m)=>{
        let st=m.pohoda_stock_id?stockPool().find(x=>x.id===m.pohoda_stock_id):null;
        if(!st&&m.code)st=stockByExactCode(m.code);
        const p=st?.sell_price_ex_vat??m.metadata?.sell_price_ex_vat;
        return sum+(p==null?0:Number(p||0)*Number(m.qty||0));
      },0);
      return '<details style="margin:7px 0;border:1px solid #d4e3eb;border-radius:10px;padding:8px 10px;background:#f9fcfd">'+
        '<summary style="cursor:pointer;font-weight:800">'+esc(g.label)+' · '+priceText(amount)+'</summary>'+
        '<div style="margin-top:7px;font-size:11px;line-height:1.55">'+g.rows.map(m=>esc(m.name)+' — <b>'+Number(m.qty||0).toLocaleString('sk-SK')+' '+esc(m.unit||'ks')+'</b>').join('<br>')+'</div>'+
      '</details>';
    }).join('');
  }

  function ztiLaborHtml(){
    const i=ensureTradeDefaults(),e=ztiLaborEstimate();
    const mode=i.zti_labor_mode||'auto';
    const mh=ztiLaborManHours();
    const price=tradeLaborPrice();
    const detail=mode==='auto'
      ? e.parts.map(p=>'<div class="srow"><span>'+esc(p.label)+'</span><b>'+Number(p.mh).toFixed(2)+' čh</b></div>').join('')
      : '<div class="notice" style="margin-bottom:8px">Použitý je ručný odhad človekohodín. Rozsah ZTI sa ďalej počíta automaticky pre materiál.</div>';
    const usedRate=ztiHourlyRate();
    const conditionLabel=active.building?.condition==='new'?'Novostavba':'Rekonštrukcia / existujúci objekt';
    return '<div class="grid2">'+
      selectField('Výpočet práce','ztiLaborMode',mode,[['auto','Automaticky podľa rozsahu'],['manual','Ručne']],'onchange="SpektraInspections.ztiLaborChanged(\'zti_labor_mode\',this,\'text\')"')+
      '<div class="field"><label>Použitá sadzba</label><div class="notice ok">'+esc(conditionLabel)+' · '+priceText(usedRate)+' / čh</div></div>'+
      '</div>'+
      '<div class="grid2">'+
        field('Sadzba novostavba [€/čh]','ztiRateNew',i.zti_rate_newbuild_ex_vat,'number','min="0" step="1" onchange="SpektraInspections.ztiLaborChanged(\'zti_rate_newbuild_ex_vat\',this,\'number\')"')+
        field('Sadzba rekonštrukcia [€/čh]','ztiRateRen',i.zti_rate_renovation_ex_vat,'number','min="0" step="1" onchange="SpektraInspections.ztiLaborChanged(\'zti_rate_renovation_ex_vat\',this,\'number\')"')+
      '</div>'+
      (mode==='auto'
        ? '<div class="grid2">'+field('Odporúčaná posádka [os.]','ztiCrew',i.zti_crew_size,'number','min="1" max="6" step="1" onchange="SpektraInspections.ztiLaborChanged(\'zti_crew_size\',this,\'number\')"')+
          '<div class="field"><label>Odhad času na stavbe</label><div class="notice ok">'+e.durationHours.toFixed(2)+' h pri '+e.crew+' montéroch</div></div></div>'
        : field('Ručný odhad [človekohodiny]','ztiManualMh',i.zti_manual_man_hours??e.manHours,'number','min="0" step="0.25" onchange="SpektraInspections.ztiLaborChanged(\'zti_manual_man_hours\',this,\'number\')"'))+
      '<div class="summary">'+detail+
        '<div class="srow"><span>Človekohodiny</span><b>'+mh.toFixed(2)+' čh</b></div>'+
        '<div class="srow total"><span>Práca bez DPH</span><span>'+priceText(price)+'</span></div>'+
      '</div>'+
      '<div class="sub" style="margin-top:8px">Automatický model je interný odhad podľa počtu vývodov, zariadení a metrov potrubia. Pred odoslaním ponuky ho môžeš prepnúť na ručný režim.</div>';
  }

  function stepZtiTechnical(){
    rebuildZtiMaterials(false);
    const i=ensureTradeDefaults(),z=ztiInputs(),mat=currentMaterialEstimate();
    return '<div class="card"><h2>ZTI – počty vývodov</h2>'+
      '<div class="notice" style="margin-bottom:10px">1× <b>Vývod voda</b> = 1 nástenka 16×1/2. Umývadlo teplá + studená teda zapíš ako 2 vývody vody.</div>'+
      '<div class="grid2">'+
        field('Vývod voda 16×1/2 [ks]','ztiWater',z.water,'number','min="0" step="1" onchange="SpektraInspections.ztiChanged(\'zti_water_outlets\',this)"')+
        field('Vývod odpad DN50 [ks]','ztiWaste',z.waste,'number','min="0" step="1" onchange="SpektraInspections.ztiChanged(\'zti_waste_outlets\',this)"')+
      '</div>'+
      '<div class="grid2">'+
        field('Práčkový sifón [ks]','ztiSiphon',z.siphon,'number','min="0" step="1" onchange="SpektraInspections.ztiChanged(\'zti_washing_siphons\',this)"')+
        field('WC Geberit Duofix [ks]','ztiGeberit',z.wc,'number','min="0" step="1" onchange="SpektraInspections.ztiChanged(\'zti_wc_duofix\',this)"')+
      '</div>'+
      field('Vývod technická miestnosť 25×3/4 [ks]','ztiBoiler',z.boiler,'number','min="0" step="1" onchange="SpektraInspections.ztiChanged(\'zti_boiler_room_outlets\',this)"')+
      '<div class="grid2">'+
        field('Nezamŕzavý ventil [ks]','ztiFrost',z.frost,'number','min="0" step="1" onchange="SpektraInspections.ztiChanged(\'zti_frost_valves\',this)"')+
        field('Hlavný uzáver vody [súb.]','ztiMainWater',z.main,'number','min="0" step="1" onchange="SpektraInspections.ztiChanged(\'zti_main_water_shutoffs\',this)"')+
      '</div>'+
      '</div>'+
      '<div class="card"><h2>ZTI – potrubie</h2>'+
      '<div class="grid2">'+
        field('RAUTITAN 16 + TUBEX 10×18 [m]','ztiP16',z.p16,'number','min="0" step="0.5" onchange="SpektraInspections.ztiChanged(\'zti_pipe16_m\',this)"')+
        field('RAUTITAN 20 + TUBEX 10×22 [m]','ztiP20',z.p20,'number','min="0" step="0.5" onchange="SpektraInspections.ztiChanged(\'zti_pipe20_m\',this)"')+
      '</div>'+
      field('RAUTITAN 25 + TUBEX 10×28 [m]','ztiP25',z.p25,'number','min="0" step="0.5" onchange="SpektraInspections.ztiChanged(\'zti_pipe25_m\',this)"')+
      '<div class="sub">Každý meter potrubia automaticky obsahuje rovnakú metráž TUBEX izolácie a '+ZTI_PIPE_CLIPS_PER_M+' podlahové príchytky / m.</div>'+
      '</div>'+
      '<div class="card"><h2>Materiál na pozadí</h2>'+ztiGeneratedPreview()+
        '<div class="summary" style="margin-top:10px"><div class="srow total"><span>Materiál spolu bez DPH</span><span>'+priceText(mat.total)+'</span></div></div>'+
        (mat.missing?'<div class="notice warn" style="margin-top:8px">'+mat.missing+' položkám sa nenašla cena v POHODE.</div>':'')+
      '</div>'+
      '<div class="card"><h2>Práca – automatický odhad</h2>'+ztiLaborHtml()+'</div>'+
      '<button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať →</button>';
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
      rebuildFloorHeatingMaterials(false);
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
    if(type==='zti')return stepZtiTechnical();
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


  function isFloorAutoMaterial(m){
    const role=String(m?.role||'');
    return m?.metadata?.inspection_auto_owner==='floor_heating'
      || role==='floor_system_board'
      || role==='floor_pipe'
      || role.startsWith('floor_manifold_');
  }
  function isZtiAutoMaterial(m){
    return !!m?.metadata?.zti_macro || m?.metadata?.inspection_auto_owner==='zti';
  }
  function manualOrSelectedMaterials(){
    return (active.materials||[]).filter(m=>!isFloorAutoMaterial(m)&&!isZtiAutoMaterial(m));
  }
  function floorAutoMaterial(code,qty,unit,role,nameFallback){
    const m=materialFromStockCode(code,qty,unit,role,nameFallback);
    m.metadata={...(m.metadata||{}),inspection_auto_owner:'floor_heating'};
    return m;
  }
  function rebuildFloorHeatingMaterials(save=true){
    if(!active)return;
    const d=floorDesign();
    const manifoldCount=Math.max(1,Math.ceil(d.circuits/12));
    const baseCircuits=Math.floor(d.circuits/manifoldCount),remainder=d.circuits%manifoldCount;
    const manifoldRows=[];
    for(let n=0;n<manifoldCount;n++){
      const circuits=Math.max(2,baseCircuits+(n<remainder?1:0));
      manifoldRows.push(floorAutoMaterial('HR1103-'+circuits,1,'ks','floor_manifold_'+(n+1),'Nerezový rozdeľovač '+circuits+' cestný pre podlahové'));
    }
    active.materials=[
      floorAutoMaterial('12051591001',Math.ceil(d.area*1.05*10)/10,'m2','floor_system_board','REHAU VARIONOVA systémová doska'),
      floorAutoMaterial('11361401500',d.pipeM,'m','floor_pipe','REHAU RAUTHERM S 17x2'),
      ...manifoldRows,
      ...manualOrSelectedMaterials()
    ];
    active._dirty=true;
    if(save)saveLocal(active);
  }

  function ensureBaseMaterials(){
    const types=active.inspection_types||[];
    const primaryTrade=tradePrimaryType();
    if(!equipmentInspection()&&primaryTrade==='zti'){
      if((active.materials||[]).some(isFloorAutoMaterial))active.materials=manualOrSelectedMaterials();
      rebuildZtiMaterials(false);
      return;
    }
    if(!equipmentInspection()&&primaryTrade==='floor_heating'){
      const hasFloor=(active.materials||[]).some(isFloorAutoMaterial);
      const hasWrong=(active.materials||[]).some(isZtiAutoMaterial);
      if(!hasFloor||hasWrong)rebuildFloorHeatingMaterials(false);
      return;
    }
    if((active.materials||[]).length)return;
    const r=active.routes||(active.routes={});
    const o=active.outdoor_unit||{};
    const e=active.electrical||{};
    const pipe=num(r.heating_m||o.route_m,5),cable=num(e.cable_m,12);
    if(types.includes('floor_heating')&&!equipmentInspection()){
      rebuildFloorHeatingMaterials(false);
      return;
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

  function tradeMaterialCardHtml(){
    return '<div class="card"><h2>Materiál z obhliadky</h2>'+
      '<div class="inspStockSearch"><div class="field" style="margin-bottom:0"><label>Hľadať v POHODE</label><input id="inspStockSearchInput" placeholder="Názov, kód, PLU, výrobca…" autocomplete="off" oninput="SpektraInspections.searchStock(this.value)"></div>'+
      '<div id="inspStockResults" class="inspStockResults"></div><div class="inspStockHint">Vybraná karta sa prenesie do ponuky s aktuálnou cenou z POHODY.</div></div>'+
      '<div id="inspMaterials">'+materialRows()+'</div><button class="btn ghost small" onclick="SpektraInspections.addMaterial()">+ Pridať ručne</button></div>';
  }
  function stepTradeInstallation(){
    ensureBaseMaterials();
    const mat=currentMaterialEstimate(),labor=tradeLaborPrice(),net=mat.total+labor,gross=net*1.23;
    return '<div class="card"><h2>Orientačný návrh ceny</h2><div class="summary">'+
      '<div class="srow"><span>Materiál z POHODY</span><b>'+priceText(mat.total)+'</b></div>'+
      '<div class="srow"><span>Práca</span><b>'+priceText(labor)+'</b></div>'+
      '<div class="srow"><span>Spolu bez DPH</span><b>'+priceText(net)+'</b></div>'+
      '<div class="srow total"><span>Spolu s DPH</span><span>'+priceText(gross)+'</span></div></div>'+
      (mat.missing?'<div class="notice warn" style="margin-top:9px">'+mat.missing+' položkám chýba cena. Vyber ich z POHODY alebo doplň pred odoslaním ponuky.</div>':'')+
      (tradePrimaryType()==='zti'
        ? '<button class="btn ghost full" style="margin-top:10px" onclick="SpektraInspections.back()">← Upraviť ZTI rozsah a prácu</button></div>'
        : '<button class="btn ghost full" style="margin-top:10px" onclick="SpektraInspections.editTradeSetup()">Upraviť odhad práce</button></div>')+
      tradeMaterialCardHtml()+
      '<div class="card"><h2>Poznámka technika</h2><textarea onchange="SpektraInspections.input(\'notes\',this)">'+esc(active.notes||'')+'</textarea></div>'+
      '<button class="btn primary full" onclick="SpektraInspections.next()">Pokračovať →</button>';
  }
  function stepInstallation(){
    if(isTradeInspection())return stepTradeInstallation();
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
      const linked=!!m.pohoda_stock_id,macro=!!meta.zti_macro;
      const details=linked
        ? (macro?'ZTI · '+(meta.zti_macro_label||'automaticky')+' · ':'')+'POHODA'+(m.code?' · '+m.code:'')+(meta.plu?' · PLU '+meta.plu:'')+' · '+priceText(meta.sell_price_ex_vat)+' bez DPH'+(meta.quantity_available!=null?' · sklad '+meta.quantity_available+' '+(m.unit||'ks'):'')
        : (m.source==='manual'?'Ručná položka – ak sa nenájde v POHODE, ponuka môže zostať bez ceny':'Množstvo vypočítané z obhliadky');
      const nameInput=(linked||macro)
        ? '<input value="'+esc(m.name||'')+'" readonly>'
        : '<div class="inspManualAuto"><input value="'+esc(m.name||'')+'" autocomplete="off" placeholder="Začni písať názov alebo kód…" oninput="SpektraInspections.materialAutocomplete('+i+',this.value)" onfocus="SpektraInspections.materialAutocomplete('+i+',this.value)"><div id="inspManualSuggestions-'+i+'" class="inspManualSuggestions"></div></div>';
      return '<div class="inspMaterial">'+
        '<div class="inspMaterialMain">'+nameInput+'<div class="inspMaterialMeta '+(linked?'linked':'')+'">'+esc(details)+'</div></div>'+
        '<input type="number" step="0.5" min="0" value="'+esc(m.qty??0)+'" '+(macro?'readonly':'')+' onchange="SpektraInspections.material('+i+',\'qty\',Number(this.value))">'+
        '<select '+(macro?'disabled':'')+' onchange="SpektraInspections.material('+i+',\'unit\',this.value)">'+[...new Set(['ks','m','súb.','l','bal',m.unit].filter(Boolean))].map(u=>'<option '+(m.unit===u?'selected':'')+'>'+u+'</option>').join('')+'</select>'+
        (macro?'<button type="button" disabled title="Mení sa cez ZTI vstupy">↻</button>':'<button type="button" onclick="SpektraInspections.removeMaterial('+i+')">×</button>')+'</div>';
    }).join('');
  }
  function material(index,key,value){
    if(!active.materials[index])return;
    active.materials[index][key]=value;
    active._dirty=true;saveLocal(active);
  }
  function addMaterial(){
    active.materials.push({name:'',qty:1,unit:'ks',source:'manual',metadata:{}});
    const index=active.materials.length-1;
    active._dirty=true;saveLocal(active);renderWizard();
    setTimeout(()=>document.querySelector('#inspManualSuggestions-'+index)?.previousElementSibling?.focus(),0);
  }
  function removeMaterial(i){active.materials.splice(i,1);active._dirty=true;saveLocal(active);renderWizard()}


  const MATERIAL_SEARCH_SYNONYMS={
    vent:['ventil','kohut','kohút'],
    koh:['kohut','kohút','ventil'],
    geber:['geberit','duofix'],
    duof:['duofix','geberit'],
    raut:['rehau','rautitan','rautherm'],
    rehau:['rehau','rautitan','rautherm'],
    sif:['sifon','sifón'],
    objim:['objimka','objímka'],
    tkus:['t-kus','t kus','tee'],
    vsuv:['vsuvka'],
    sroben:['srobenie','šróbenie','skrutkovanie'],
    skrut:['skrutkovanie','srobenie','šróbenie'],
    gul:['gulovy','guľový','kohut','kohút'],
    filter:['filter','filtracna','filtračná'],
    vloz:['vlozka','vložka'],
    tubex:['tubex','izolacia','izolácia'],
    izol:['izolacia','izolácia','tubex'],
    odpad:['odpad','ht','htem','htb'],
    ht:['ht','htem','htb','odpad'],
    pe:['pe','polyetylen','polyetylén'],
    reduk:['redukcia','redukčný','redukcný','tlakovy','tlakový'],
    tlak:['tlakovy','tlakový','redukčný','redukcny'],
    cerp:['cerpadlo','čerpadlo','pumpa'],
    rozdel:['rozdelovac','rozdeľovač'],
    klima:['klimatizacia','klimatizácia','split'],
    kond:['kondenzat','kondenzát'],
    kabel:['kabel','kábel','cyky','jyty'],
    lista:['lista','lišta'],
    poist:['poistny','poistný'],
    expanz:['expanzna','expanzná'],
    zasob:['zasobnik','zásobník'],
    bojler:['bojler','ohrievac','ohrievač','zasobnik','zásobník']
  };
  function synonymAlternatives(token){
    const t=fold(token);
    const out=new Set([t]);
    if(t.length>=3){
      for(const [key,vals] of Object.entries(MATERIAL_SEARCH_SYNONYMS)){
        if(key.startsWith(t)||t.startsWith(key)){
          vals.forEach(v=>out.add(fold(v)));
        }
      }
    }
    return [...out];
  }

  function localStockMatches(query,limit=8){
    const q=fold(query);
    if(q.length<2)return [];
    const tokens=q.split(/\s+/).filter(Boolean);
    const tokenAlternatives=tokens.map(synonymAlternatives);
    return stockPool().filter(st=>{
      if(st.active===false)return false;
      const hay=fold([st.name,st.code,st.plu,st.ean,st.manufacturer,st.stock_group].filter(Boolean).join(' '));
      return tokenAlternatives.every(alts=>alts.some(t=>hay.includes(t)));
    }).sort((a,b)=>{
      const exactA=[a.code,a.plu,a.ean].some(v=>fold(v)===q)?1:0;
      const exactB=[b.code,b.plu,b.ean].some(v=>fold(v)===q)?1:0;
      if(exactA!==exactB)return exactB-exactA;
      const qa=fold(a.name).startsWith(q)?1:0,qb=fold(b.name).startsWith(q)?1:0;
      if(qa!==qb)return qb-qa;
      const sa=Number(a.quantity_available||0)>0?1:0,sb=Number(b.quantity_available||0)>0?1:0;
      if(sa!==sb)return sb-sa;
      return String(a.name||'').localeCompare(String(b.name||''),'sk');
    }).slice(0,limit);
  }
  function renderMaterialAutocomplete(index,message=''){
    const box=document.getElementById('inspManualSuggestions-'+index);
    if(!box)return;
    if(message){box.innerHTML='<div style="padding:9px 10px;font-size:11px;color:#607787">'+esc(message)+'</div>';return}
    if(manualStockSearch.index!==index||!manualStockSearch.results.length){box.innerHTML='';return}
    box.innerHTML=manualStockSearch.results.map((st,n)=>{
      const code=st.code||st.plu||'bez kódu';
      const qty=st.quantity_available==null?'—':Number(st.quantity_available).toLocaleString('sk-SK');
      return '<button type="button" class="inspManualSuggestion" onmousedown="event.preventDefault();SpektraInspections.chooseMaterialAutocomplete('+index+','+n+')">'+
        '<b>'+esc(st.name||'Bez názvu')+'</b>'+
        '<small>'+esc(code)+(st.manufacturer?' · '+esc(st.manufacturer):'')+' · sklad '+qty+' '+esc(st.unit||'ks')+' · <span class="price">'+priceText(st.sell_price_ex_vat)+' bez DPH</span></small>'+
      '</button>';
    }).join('');
  }
  async function materialAutocomplete(index,value){
    if(!active?.materials?.[index])return;
    const m=active.materials[index];
    if(m.pohoda_stock_id||m.metadata?.zti_macro)return;
    m.name=value;
    m.source='manual';
    active._dirty=true;
    saveLocal(active);
    clearTimeout(manualStockSearchTimer);
    const q=fold(value);
    if(q.length<2){
      manualStockSearch={index,results:[]};
      renderMaterialAutocomplete(index);
      return;
    }
    renderMaterialAutocomplete(index,'Hľadám v POHODE…');
    manualStockSearchTimer=setTimeout(async()=>{
      try{
        let pool=stockPool();
        if(!pool.length&&window.SpektraDB?.isAuthenticated()){
          pool=await SpektraDB.listStocks();
          try{stocks=pool}catch(_){}
        }
        manualStockSearch={index,results:localStockMatches(value,8)};
        renderMaterialAutocomplete(index,manualStockSearch.results.length?'':'Bez zhody – položku môžeš nechať ručne.');
      }catch(e){
        console.error('Manual material autocomplete failed',e);
        manualStockSearch={index,results:[]};
        renderMaterialAutocomplete(index,'Vyhľadávanie zlyhalo.');
      }
    },120);
  }
  function chooseMaterialAutocomplete(index,resultIndex){
    if(!active?.materials?.[index]||manualStockSearch.index!==index)return;
    const st=manualStockSearch.results[resultIndex];
    if(!st)return;
    const current=active.materials[index],qty=Number(current.qty||1);
    const duplicateIndex=active.materials.findIndex((m,n)=>n!==index&&m.pohoda_stock_id===st.id);
    if(duplicateIndex>=0){
      active.materials[duplicateIndex].qty=Number(active.materials[duplicateIndex].qty||0)+qty;
      active.materials.splice(index,1);
    }else{
      active.materials[index]={
        pohoda_stock_id:st.id,
        role:current.role||null,
        code:st.code||null,
        name:st.name||current.name||'POHODA položka',
        qty,
        unit:st.unit||current.unit||'ks',
        source:'pohoda',
        original_qty:current.original_qty??null,
        metadata:{
          ...(current.metadata||{}),
          plu:st.plu||null,ean:st.ean||null,manufacturer:st.manufacturer||null,
          sell_price_ex_vat:st.sell_price_ex_vat==null?null:Number(st.sell_price_ex_vat),
          purchase_price_ex_vat:st.purchase_price_ex_vat==null?null:Number(st.purchase_price_ex_vat),
          quantity_available:st.quantity_available==null?null:Number(st.quantity_available)
        }
      };
    }
    manualStockSearch={index:-1,results:[]};
    active._dirty=true;saveLocal(active);renderWizard();
  }

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

  function requiredPhotoKeys(){
    if(equipmentInspection())return ['building','plant_room','existing_device','outdoor_unit','electrical_panel','pipe_route','nameplate'];
    const type=tradePrimaryType();
    if(type==='floor_heating')return ['building','plant_room','pipe_route'];
    if(type==='water_heater')return ['plant_room','existing_device','electrical_panel','nameplate'];
    if(type==='zti')return ['building','plant_room','bathroom','kitchen'];
    if(type==='recovery')return ['building','electrical_panel','pipe_route'];
    return ['building','pipe_route'];
  }
  function stepPhotos(){
    const photos=active.photos||[];
    const required=requiredPhotoKeys();
    const cards=PHOTO_CATEGORIES.map(([key,label])=>{
      const cat=photos.filter(p=>p.category===key),must=required.includes(key);
      return '<div class="card"><div class="row" style="margin-bottom:8px"><div><b>'+esc(label)+'</b><small>'+(cat.length?'✓ '+cat.length+' foto':(must?'Povinné foto':'Voliteľné foto'))+'</small></div>'+
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
      const p=await SpektraDB.uploadInspectionPhoto(active.remote_id,file,category,requiredPhotoKeys().includes(category));
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
    const tradeEstimate=isTradeInspection()?currentMaterialEstimate():null;
    const tradeTotal=tradeEstimate?tradeEstimate.total+tradeLaborPrice():0;
    const tradePriceHtml=tradeEstimate
      ? '<div class="card"><h2>Orientačný návrh ceny</h2><div class="summary">'+summaryRow('Materiál',priceText(tradeEstimate.total)+' bez DPH')+summaryRow('Práca',priceText(tradeLaborPrice())+' bez DPH')+summaryRow('Spolu bez DPH',priceText(tradeTotal))+summaryRow('Spolu s DPH',priceText(tradeTotal*1.23))+'</div>'+(tradeEstimate.missing?'<div class="notice warn" style="margin-top:9px">'+tradeEstimate.missing+' položkám chýba cena.</div>':'')+'</div>'
      : '';
    const technicalRows=isTradeInspection()
      ? summaryRow('Typ zákazky',tradeLabel())+(tradePrimaryType()==='zti'?summaryRow('Rozsah ZTI',ztiScopeSummary().join(' · ')||'bez zadaného rozsahu'):'')+summaryRow('Materiál',(active.materials||[]).length+' položiek')+summaryRow('Odhad práce',priceText(tradeLaborPrice())+' bez DPH')+summaryRow('Práce navyše',work)
      : summaryRow('Plocha',(active.building?.heated_area_m2||'—')+' m²')+summaryRow('Vykurovanie',active.existing_system?.heating==='underfloor'?'Podlahovka':active.existing_system?.heating==='radiators'?'Radiátory':'Vysokoteplotné')+summaryRow('Návrhový výkon',num(active.heat_loss?.design_kw).toFixed(2)+' kW')+summaryRow('Odporúčaná trieda',num(active.heat_loss?.recommended_kw)+' kW')+summaryRow('Trasa',num(active.outdoor_unit?.route_m)+' m')+summaryRow('Materiál',(active.materials||[]).length+' položiek')+summaryRow('Práce navyše',work);
    return '<div class="card"><h2>'+esc(active.customer?.name||'Bez mena')+'</h2><div class="sub">'+esc(active.customer?.address||'')+'</div>'+
      '<div class="summary" style="margin-top:12px">'+summaryRow('Typ',types)+technicalRows+'</div></div>'+tradePriceHtml+
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

  function tradeQuoteMaterialItems(){
    return (active.materials||[]).filter(m=>m?.name).map((m,n)=>{
      let st=m.pohoda_stock_id?stockPool().find(x=>x.id===m.pohoda_stock_id):null;
      if(!st&&m.code)st=stockByExactCode(m.code);
      const price=st?.sell_price_ex_vat??m.metadata?.sell_price_ex_vat??null;
      const cost=st?.purchase_price_ex_vat??m.metadata?.purchase_price_ex_vat??null;
      return {
        role:m.role||('inspection_material_'+n), name:m.name, qty:Number(m.qty||0), unit:m.unit||st?.unit||'ks',
        pohoda:st||null, pohoda_code:st?.code||m.code||null,
        price:price==null?null:Number(price), cost:cost==null?null:Number(cost),
        visible:false, mapping_status:st?'mapped_from_inspection':(price==null?'inspection_missing_price':'inspection_snapshot'),
        customer_group:'Materiál podľa obhliadky', note:'Množstvo podľa obhliadky.'
      };
    });
  }

  function ztiScopeSummary(){
    const z=ztiInputs(),out=[];
    if(z.water)out.push(z.water+'× vývod voda 16×1/2');
    if(z.waste)out.push(z.waste+'× vývod odpad DN50');
    if(z.siphon)out.push(z.siphon+'× práčkový sifón');
    if(z.wc)out.push(z.wc+'× WC Geberit Duofix');
    if(z.boiler)out.push(z.boiler+'× vývod technická miestnosť 25×3/4');
    if(z.frost)out.push(z.frost+'× nezamŕzavý ventil');
    if(z.main)out.push(z.main+'× hlavný uzáver vody');
    if(z.p16)out.push(z.p16+' m RAUTITAN 16 + TUBEX 10×18');
    if(z.p20)out.push(z.p20+' m RAUTITAN 20 + TUBEX 10×22');
    if(z.p25)out.push(z.p25+' m RAUTITAN 25 + TUBEX 10×28');
    return out;
  }

  function tradeWorkScope(type){
    if(type==='floor_heating')return ['rozloženie systémových dosiek','uloženie vykurovacích okruhov','montáž a pripojenie rozdeľovača','tlaková skúška systému'];
    if(type==='water_heater')return ['demontáž existujúceho ohrievača podľa potreby','osadenie nového ohrievača','napojenie vody a poistných prvkov','kontrola tesnosti a funkcie'];
    if(type==='zti')return [...ztiScopeSummary(),'montáž vodovodných a odpadových rozvodov podľa obhliadky','lisovanie a osadenie tvaroviek','napojenie vývodov','kontrola tesnosti'];
    return ['montážne práce podľa rozsahu obhliadky','kontrola funkcie po dokončení'];
  }
  async function createTradeQuote(){
    const type=tradePrimaryType();
    if(!type)throw new Error('Nie je zvolený typ remeselnej zákazky.');
    ensureBaseMaterials();
    const materials=tradeQuoteMaterialItems();
    const labor=tradeLaborPrice();
    const laborItem={role:'installation_service',name:tradeLabel(type)+' – práca',qty:1,unit:'súb.',pohoda:null,pohoda_code:null,price:labor,cost:null,visible:true,mapping_status:'internal_estimate',customer_group:'Montáž a práca',note:'Orientačný odhad podľa obhliadky.',work_scope:tradeWorkScope(type)};
    const items=[...materials,laborItem];
    const missing=items.some(i=>i.price==null);
    const net=items.reduce((s,i)=>s+(i.price==null?0:Number(i.price||0)*Number(i.qty||0)),0);

    startWizard();
    current.inspection_id=active.remote_id;
    current.remote_customer_id=active.customer_id;
    current.customer={name:active.customer.name||'',phone:active.customer.phone||'',email:active.customer.email||'',address:active.customer.address||'',note:active.customer.notes||active.notes||''};
    current.category=type; category=type;
    current.brand='Spektra Install'; brand='Spektra Install';
    current.system_type='service';
    current.installation_tier='custom';
    current.device={brand:'Spektra Install',model:tradeLabel(type),variant:'Návrh podľa obhliadky'};
    current.items=items;
    current.net=Math.round(net*100)/100;current.vat_pct=23;current.vat=Math.round(current.net*.23*100)/100;current.total=Math.round(current.net*1.23*100)/100;
    current.price_complete=!missing;
    current.status='ready';
    current.pdf_template='technical';current.pdf_banner_mode='none';current.pdf_images_enabled=false;current.pdf_images=[];
    current.optional_services={annual_service:false};current.subsidy={program:'none'};
    current.building={...active.building,area_m2:num(active.building?.heated_area_m2,0),heating:active.existing_system?.heating||null};
    current.inspection_materials=(active.materials||[]).map(m=>({...m}));
    current.inspection_installation={...(active.installation||{})};
    current.inspection_routes={...(active.routes||{})};
    current.inspection_extra_work=[...(active.extra_work||[])];
    current.inspection_notes=active.notes||null;

    await upsertCurrent();
    if(current.remote_id){await SpektraDB.linkInspectionQuote(active.remote_id,current.remote_id,'generated');active.status='converted';active._dirty=false;saveLocal(active)}
    renderFinal();go('step5');
    alert(missing?'Ponuka bola vytvorená, ale niektorým materiálovým položkám chýba cena. Doplň ich pred odoslaním.':'Orientačná cenová ponuka bola vytvorená z obhliadky.');
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
    if(!supported){await createTradeQuote();return}

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
    const before=tradePrimaryType();
    const i=a.indexOf(key);
    if(i>=0){
      if(a.length>1)a.splice(i,1);
    }else a.push(key);
    const after=tradePrimaryType();
    if(before!==after){
      if(after==='floor_heating')rebuildFloorHeatingMaterials(false);
      else if(after==='zti'){active.materials=manualOrSelectedMaterials();rebuildZtiMaterials(false)}
      else active.materials=manualOrSelectedMaterials();
    }
    active._dirty=true;saveLocal(active);renderWizard();
  }

  window.SpektraInspections={
    openHome,startNew,edit,refresh,next,back,save,complete,createQuote,
    input:(path,el,kind,rerender)=>setFromInput(path,el,kind||'text',!!rerender),
    check:(path,el,rerender)=>setFromInput(path,el,'bool',!!rerender),
    toggleType,toggleExtra,routeChanged,material,addMaterial,removeMaterial,searchStock,chooseStock,materialAutocomplete,chooseMaterialAutocomplete,editTradeSetup,ztiChanged,ztiLaborChanged,photo,deletePhoto
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initUI);
  else initUI();
})();
