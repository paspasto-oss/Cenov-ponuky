/* Scenario -> saved quote rows -> customer/internal documents.
 * All quote writes use the existing durable outbox. Library writes use CAS.
 */
(function(root){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const A=()=>root.SpektraQuoteAssemblies;
  const S=()=>root.SpektraHvacScenarios;
  const O=()=>root.SpektraQuoteWorkbenchOutput;
  const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=x=>x==null||String(x).trim()===''?null:Number(String(x).replace(',','.'));
  const money=x=>typeof eur==='function'?eur(x):x==null?'—':Number(x).toFixed(2)+' €';
  const value=id=>document.getElementById(id)?.value??'';
  const state={owner:null,tab:'items',scenarioId:'heat_pump',picked:{},search:{},parameters:{},library:[],libraryOwner:null,libraryLoading:false,undo:[],preview:null,status:'',error:false};
  const labels={equipment:'Zariadenie',material:'Montážny materiál',labor:'Montáž',transport:'Doprava',revision:'Revízia',pressure:'Tlaková skúška',service:'Služba',text:'Text',other:'Ostatné'};
  const formFields=['items','material_edits','category','brand','system_type','device','building','ac_mode','boiler_type','multisplit_count','optional_services','installation_tier','customer','estimated_realization_date'];
  function field(label,id,val='',extra=''){return '<label class="wbField"><span>'+E(label)+'</span><input id="'+E(id)+'" value="'+E(val)+'" '+extra+'></label>';}
  function btn(action,label,data='',cls='ghost'){return '<button type="button" class="btn '+cls+'" data-wb-action="'+E(action)+'" '+data+'>'+E(label)+'</button>';}
  function select(label,id,options,selected,attrs=''){return '<label class="wbField"><span>'+E(label)+'</span><select id="'+E(id)+'" '+attrs+'>'+options.map(([v,t])=>'<option value="'+E(v)+'"'+(String(v)===String(selected)?' selected':'')+'>'+E(t)+'</option>').join('')+'</select></label>';}
  function status(message,error=false){state.status=message;state.error=error;const n=document.getElementById('wbStatus');if(n){n.textContent=message;n.classList.toggle('error',error);}}
  function revisionLabel(q=current){const r=q?.material_edits?.assemblies?.revision;return r?(r.root_quote_no||r.parent_quote_no||'Ponuka')+' · revízia R'+r.number:'';}
  function issued(q){return ['ready','sent','approved'].includes(q?.status)||['ready','sent','approved'].includes(q?._server_status);}
  function snapshot(q){const out={};for(const k of formFields)if(q[k]!==undefined)out[k]=clone(q[k]);return out;}
  function remember(){state.undo.push(snapshot(current));if(state.undo.length>20)state.undo.shift();}
  function prepareEdit(){
    if(!current)throw new Error('Nie je otvorená ponuka.');
    if(issued(current)){
      const original=current;
      current=A().createRevision(original,quotes,{id:root.SpektraQuoteStorage.uuid(),now:Date.now()});
      state.owner=current.id;state.undo=[];
      quoteRowsEditorActive=true;
      status('Úpravy sa ukladajú ako nová revízia. Pôvodná ponuka '+(original.quote_no||'')+' zostáva zachovaná.');
    }
    A().init(current);
    return current;
  }
  async function mutate(message,change,{renderRows=true}={}){
    try{
      if(!current)throw new Error('Nie je otvorená ponuka.');
      // Validate on a draft copy before creating a new revision or touching rows.
      const trial=clone(current);trial.status='draft';delete trial._server_status;A().init(trial);change(trial);
      prepareEdit();remember();change(current);delete current.warranty_consent;
      const owner=current,pending=saveQuoteMaterialChange(message,renderRows),token=owner._edit_token;
      const saved=await pending;
      if(current?.id!==owner.id||current?._edit_token!==token)return {...saved,stale:true};
      status(saved?.ok?message+(saved.synced?' Uložené.':' Uložené v zariadení; čaká na synchronizáciu.'):'Uloženie nepotvrdené: '+(saved?.error||'Skontrolujte pripojenie.'),!saved?.ok);
      render();return saved;
    }catch(e){status(e.message||String(e),true);setQuoteMaterialStatus?.(e.message||String(e),true);return {ok:false,error:e.message};}
  }
  async function changeRow(index,fieldName,newValue,input){
    const pending=mutate('Položka bola zmenená.',q=>A().setField(q,index,fieldName,newValue),{renderRows:false});
    const owner=current,token=owner?._edit_token,result=await pending;
    if(result.stale||current?.id!==owner?.id||current?._edit_token!==token)return result;
    if(input){if(result.ok){input.removeAttribute('aria-invalid');input.value=current.items[index]?.[fieldName]??'';}else input.setAttribute('aria-invalid','true');}
    const total=document.querySelector('[data-row-total="'+index+'"]');
    if(total){const i=current.items[index];total.textContent=money(i?.price==null?null:Number(i.qty)*Number(i.price));}
    return result;
  }
  function validRealizationDate(raw,input){
    const dates=root.SpektraRealizationDate;
    if(!dates)throw new Error('Kalendár sa nenačítal. Obnovte aplikáciu.');
    const value=String(raw??'').trim(),date=dates.normalize(value);
    if(input?.validity?.badInput||(value&&!date))throw new Error('Zadajte platný dátum realizácie alebo nechajte pole prázdne.');
    return date;
  }
  async function setRealizationDate(newValue,input){
    let date;
    try{
      if(!current)throw new Error('Nie je otvorená ponuka.');
      date=validRealizationDate(newValue,input);
    }catch(e){input?.setAttribute('aria-invalid','true');status(e.message,true);setQuoteMaterialStatus?.(e.message,true);return {ok:false,error:e.message};}
    if(root.SpektraRealizationDate.get(current)===date){
      if(input){input.removeAttribute('aria-invalid');input.value=date;}
      status('CCA termín realizácie sa nezmenil.');
      return {ok:true,unchanged:true};
    }
    const pending=mutate(date?'CCA termín realizácie bol uložený.':'CCA termín realizácie bol vymazaný.',q=>{q.estimated_realization_date=date;},{renderRows:false});
    const owner=current,token=owner?._edit_token,result=await pending;
    if(result.stale||current?.id!==owner?.id||current?._edit_token!==token)return result;
    if(input){if(result.ok){input.removeAttribute('aria-invalid');input.value=root.SpektraRealizationDate.get(current);}else input.setAttribute('aria-invalid','true');}
    return result;
  }
  async function beginRevision(){
    try{prepareEdit();openQuoteRows();state.tab='items';render();return await saveQuoteMaterialChange('Vytvorená nová revízia ponuky.',true);}catch(e){status(e.message,true);}
  }
  async function quickStart(){
    if(!current)startWizard();
    const name=String(value('cName')).trim(),phone=String(value('cPhone')).trim(),address=String(value('cAddress')).trim();
    if(!name||!phone||!address){alert('Vyplňte meno, telefón a adresu realizácie.');return;}
    let date;const dateInput=document.getElementById('cEstimatedRealizationDate');
    try{date=validRealizationDate(dateInput?.value,dateInput);dateInput?.removeAttribute('aria-invalid');}
    catch(e){dateInput?.setAttribute('aria-invalid','true');dateInput?.reportValidity?.();alert(e.message);return;}
    current.customer={name,phone,address,email:String(value('cEmail')).trim(),note:String(value('cNote')).trim()};
    current.estimated_realization_date=date;
    A().init(current);quoteRowsEditorActive=true;state.owner=current.id;state.tab='assemblies';state.undo=[];
    openQuoteRows();render();await saveQuoteMaterialChange('Zákazník bol uložený. Vyberte scenár a zariadenie.');
  }
  function onOpen(){
    if(!current||!A()||!S())return;
    if(state.owner!==current.id){closeDialog();state.owner=current.id;state.tab=current.items?.length?'items':'assemblies';state.undo=[];state.picked={};state.search={};state.parameters={};state.preview=null;state.status='';state.error=false;}
    render();loadLibrary().catch(e=>status('Knižnicu sa nepodarilo načítať: '+e.message,true));
  }
  function tab(name){state.tab=name;render();if(name==='items')renderQuoteMaterialEditor();}
  function bind(container){if(!container||container.dataset.wbBound)return;container.dataset.wbBound='1';container.addEventListener('click',e=>{const b=e.target.closest('[data-wb-action]');if(b&&container.contains(b)){e.preventDefault();action(b.dataset.wbAction,b);}});container.addEventListener('input',e=>{if(e.target.dataset.wbSearch)searchStock(e.target.dataset.wbSearch,e.target.value);});container.addEventListener('change',e=>changeControl(e.target));}
  function render(){
    const box=document.getElementById('quoteWorkbench');if(!box||!current||!A()||!S())return;
    const groups=A().groups(current),r=revisionLabel(),isIssued=issued(current);
    let body='<div class="wbCustomerLine"><span>'+E(r||'')+'</span>'+btn('customer','Upraviť kontakt')+'</div>';
    body+='<div class="wbTabs" role="tablist" aria-label="Cenová ponuka">'+[['assemblies','Zostavy'],['items','Položky'],['preview','Náhľad']].map(([id,label])=>'<button type="button" role="tab" aria-selected="'+(state.tab===id)+'" data-wb-action="tab" data-id="'+id+'">'+label+'</button>').join('')+'</div>';
    if(isIssued)body+='<div class="wbReadOnly">Prvá úprava vytvorí novú revíziu. Vydaná verzia zostane uložená.</div>';
    body+='<div id="wbStatus" class="wbStatus'+(state.error?' error':'')+'" role="status" aria-live="polite">'+E(state.status)+'</div>';
    body+='<div class="wbPanel" role="tabpanel">'+(state.tab==='assemblies'?assembliesPanel(groups):state.tab==='preview'?previewPanel():itemsPanel(groups))+'</div>';
    box.innerHTML=body;bind(box);
    document.getElementById('rowMaterialEditorSlot')?.classList.toggle('hidden',state.tab!=='items');
    const old=document.getElementById('quoteRowsDetailedPdf');if(old)old.closest('label')?.classList.add('hidden');
    const rev=document.getElementById('quoteRowsRevision');if(rev)rev.textContent=r;
    if(state.tab==='preview'){const n=document.getElementById('wbCustomerPreview');if(n)n.innerHTML=O().renderCustomer(current,{formatMoney:money});}
  }
  function itemsPanel(groups){
    return '<div class="wbTools">'+btn('tab','＋ Pridať zostavu','data-id="assemblies"')+btn('catalog','＋ Katalóg')+btn('text','＋ Text')+btn('undo','↶ Vrátiť úpravu','',state.undo.length?'ghost':'ghost')+btn('recalculate','Prepočítať množstvá')+btn('prices','Aktualizovať ceny')+'</div>'+
      '<div class="wbTools">'+btn('new-group','Nová skupina')+(groups.length?btn('save-full-template','Uložiť celú zostavu'):'')+btn('pricing','Cenový štandard')+btn('variant','Uložiť variant')+btn('variants','Porovnať varianty')+'</div>'+
      '<div class="sub">'+groups.length+' skupín · Montážny materiál a prácu môžete rozbaliť samostatne v náhľade.</div>'+
      groups.map(g=>groupPanel(g)).join('');
  }
  function groupPanel(g){
    const data='data-id="'+E(g.id)+'"';
    return '<details class="wbGroup"><summary><span>'+E(g.name)+'<small class="wbMeta">'+E(labels[g.kind]||g.kind)+' · '+g.rows.length+' riadkov · '+(g.pricing==='fixed'?'Pevná cena':'Súčet položiek')+'</small></span><span class="wbGroupPrice">'+money(g.price_complete===false?null:g.net)+'</span></summary><div class="wbGroupBody">'+
      '<div class="wbTools">'+btn('edit-group','Upraviť skupinu',data)+btn('copy-group','Kopírovať',data)+btn('save-template','Uložiť ako zostavu',data)+btn('optional-group','Voliteľný doplnok',data)+btn('remove-group','Odstrániť',data)+'</div>'+
      (g.public_description?'<p class="sub">'+E(g.public_description)+'</p>':'')+
      (g.pricing==='fixed'?'<div class="sub">Rozpis obsahu patrí k jednej cene. Samostatné ceny úkonov sa dopĺňajú pri ocenení položiek.</div>':'')+'</div></details>';
  }
  function devicePicker(role,label){
    const chosen=state.picked[role];
    return '<div class="wbField"><span>'+E(label)+'</span><input type="search" autocomplete="off" data-wb-search="'+E(role)+'" value="'+E(state.search[role]||'')+'" placeholder="Hľadať názov, kód alebo PLU…">'+
      (chosen?'<div class="wbSelected"><b>'+E(chosen.name||chosen.model)+'</b>'+E(chosen.code||'')+' · '+money(chosen.sell_price_ex_vat)+'</div>':'<small>Vyberte konkrétnu skladovú kartu.</small>')+'<div id="wbStockResults_'+E(role)+'" class="wbStockList"></div></div>';
  }
  function collectParameters(){
    const out={...state.parameters};
    document.querySelectorAll('[data-wb-param]').forEach(n=>{out[n.dataset.wbParam]=n.type==='checkbox'?n.checked:n.value;});
    if(out.indoor_count){const count=Number(out.indoor_count);out.branch_lengths=Array.from({length:count},(_,i)=>num(out['branch_'+(i+1)+'_m'])??5);}
    state.parameters=out;return out;
  }
  function savedTemplates(){return state.library.filter(x=>x.kind==='template'&&x.payload?.active!==false);}
  function assembliesPanel(groups){
    const sid=state.scenarioId,p=state.parameters;
    const param=(key,label,def,unit='')=>field(label+(unit?' ['+unit+']':''),'wbParam_'+key,p[key]??def,'data-wb-param="'+key+'" inputmode="decimal"');
    let form='';
    if(S().describe(sid).device_required)form+=devicePicker('device',sid==='ac_multi'?'Vonkajšia jednotka':'Zariadenie');
    if(sid==='heat_pump'){
      form+='<div class="wbGrid">'+select('Zapojenie','wbSystem',[['monoblock','Monoblok'],['split','Split']],p.system_type||'monoblock','data-wb-param="system_type"')+select('Príprava TÚV','wbDhw',[['none','Bez TÚV'],['integrated','AiO – integrovaný zásobník'],['external','Externý zásobník']],p.dhw_solution||'none','data-wb-param="dhw_solution" data-wb-rerender="1"')+'</div>';
      if(p.dhw_solution==='external')form+=devicePicker('tank','Externý zásobník TÚV');
    }
    if(['heat_pump','ac_single'].includes(sid))form+='<div class="wbGrid">'+param('route_m','Dĺžka trasy',5,'m')+(sid==='ac_single'?param('power_kw','Výkon klimatizácie',state.picked.device?.power_kw??'','kW'):'')+'</div>';
    if(sid==='ac_multi'){
      const count=Math.max(2,Math.min(5,Number(p.indoor_count)||2));
      form+=select('Počet vnútorných jednotiek','wbIndoorCount',[[2,'2'],[3,'3'],[4,'4'],[5,'5']],count,'data-wb-param="indoor_count" data-wb-rerender="1"');
      for(let i=0;i<count;i++)form+='<div class="wbBranch"><h3>Vnútorná jednotka '+(i+1)+'</h3>'+devicePicker('indoor_'+i,'Jednotka '+(i+1))+'<div class="wbGrid">'+param('branch_'+(i+1)+'_m','Dĺžka vetvy '+(i+1),5,'m')+param('branch_'+(i+1)+'_kw','Výkon jednotky',state.picked['indoor_'+i]?.power_kw??'','kW')+'</div></div>';
    }
    if(sid==='zti')form+='<div class="wbGrid">'+param('water_outlets','Vývody vody',1,'ks')+param('waste_outlets','Vývody odpadu',0,'ks')+param('pipe16_m','Potrubie 16 + izolácia',0,'m')+param('pipe20_m','Potrubie 20 + izolácia',0,'m')+param('pipe25_m','Potrubie 25 + izolácia',0,'m')+'</div>';
    const rendered=new Set(['system_type','dhw_solution','route_m','indoor_count','branch_lengths','water_outlets','waste_outlets','pipe16_m','pipe20_m','pipe25_m']);
    const remaining=S().describe(sid).parameters.filter(x=>!rendered.has(x.key));
    if(remaining.length)form+='<div class="wbGrid">'+remaining.map(d=>d.type==='select'?select(d.label,'wbParam_'+d.key,d.options,p[d.key]??d.default,'data-wb-param="'+d.key+'" data-wb-rerender="1"'):param(d.key,d.label,d.default,d.unit)).join('')+'</div>';
    const templates=savedTemplates();
    const optional=A().inspect(current).optional||[];
    return '<h2>Rýchla ponuka podľa scenára</h2><div class="wbChoices">'+S().list().map(s=>'<button type="button" class="wbChoice" aria-pressed="'+(sid===s.id)+'" data-wb-action="scenario" data-id="'+E(s.id)+'">'+E(s.name||s.label)+'<small>'+E(s.description||'Zariadenie, materiál a montáž')+'</small></button>').join('')+
      '<button type="button" class="wbChoice wbChoiceNew" data-wb-action="new-custom">＋ Nová vlastná zostava<small>Vybrať položky a uložiť ako šablónu</small></button>'+
      templates.map(t=>'<button type="button" class="wbChoice wbChoiceSaved" data-wb-action="use-template" data-id="'+E(t.key)+'">'+E(t.payload.name)+'<small>Moja zostava · vložiť do ponuky</small></button>').join('')+'</div>'+
      '<div class="wbCard">'+form+'<div class="wbTools">'+btn('preview-scenario','Pripraviť zostavu','','primary')+'</div><div class="sub">Pred vložením zobrazíme konkrétne položky, množstvá a prípadné chýbajúce ceny.</div></div>'+
      '<div class="wbCard"><h2>Spoločné služby</h2><div class="wbTools">'+btn('service','Doprava','data-id="transport"')+btn('service','Revízia','data-id="revision"')+btn('service','Tlaková skúška a protokol','data-id="pressure"')+btn('service','Vlastná služba','data-id="service"')+'</div></div>'+
      (optional.length?'<div class="wbCard"><h2>Voliteľné doplnky</h2>'+optional.map((o,n)=>'<label class="wbCheck"><input type="checkbox" data-wb-optional="'+E(o.id||n)+'"'+(o.selected?' checked':'')+'><span>'+E(o.name||o.group?.name||'Doplnok')+'<small>'+(o.include_in_initial_total===false?'Budúci servis – mimo ceny realizácie':o.selected?'Zahrnuté v cene':'Nezahrnuté v cene')+'</small></span></label>').join('')+'</div>':'')+
      '<div class="wbCard"><h2>Moje zostavy</h2><div class="wbTools">'+btn('reload-library','↻ Obnoviť')+btn('import-library','Importovať zostavy')+btn('export-library','Exportovať zostavy')+btn('pricing','Cenový štandard')+'</div>'+
      state.library.filter(x=>x.pending&&x.error).map(x=>'<div class="notice warn">'+E(x.payload?.name||(x.kind==='pricing'?'Cenový štandard':'Náklady realizácie'))+': '+E(x.error)+' '+btn('library-conflict','Skontrolovať uloženie','data-id="'+E(x.key)+'"')+'</div>').join('')+
      (templates.length?'<div class="wbLibraryList">'+templates.map(t=>'<div class="wbLibraryItem"><h3>'+E(t.payload.name)+'</h3><div class="sub">'+E(t.payload.status==='verified'?'Overená':'Rozpracovaná')+' · verzia '+E(t.payload.version||1)+(t.pending?' · čaká na synchronizáciu':'')+'</div><div class="wbTools">'+btn('use-template','Pridať','data-id="'+E(t.key)+'"')+btn('edit-template','Upraviť','data-id="'+E(t.key)+'"')+'</div></div>').join('')+'</div>':'<div class="wbEmpty">Zostavu uložíte zo skupiny položiek tlačidlom „Uložiť ako zostavu“.</div>')+'</div>'+
      (groups.length?'<h2>Zostavy v ponuke</h2>'+btn('save-full-template','Uložiť materiál + montáž + dopravu')+groups.map(groupPanel).join(''):'');
  }
  function previewPanel(){
    const settings=A().outputSettings(current),modes=[['summary','Jedna položka'],['contents','Obsah bez cien riadkov'],['detail','Úplný rozpis s cenami']];
    return '<div class="wbCard"><div class="wbGrid">'+select('Montážny materiál','wbMaterialView',modes,settings.material,'data-wb-output="material"')+select('Montáž','wbLaborView',modes,settings.labor,'data-wb-output="labor"')+'</div>'+
      '<label class="wbCheck"><input type="checkbox" data-wb-output="appendix"'+(settings.appendix?' checked':'')+'><span>Rozpis uviesť v prílohe<small>Hlavná ponuka bude súhrnná. Zvolený rozpis materiálu alebo montáže sa presunie do prílohy.</small></span></label>'+
      '<div class="wbTools">'+btn('pdf','PDF / Tlač','','primary')+btn('final','PDF a odoslanie')+'</div></div><div id="wbCustomerPreview" class="wbPreview"></div>'+
      '<div class="wbCard wbDocumentActions"><h2>Podklady pre realizáciu</h2><div class="wbTools">'+btn('purchase','Nákupný zoznam')+btn('installer','Podklad pre montáž')+btn('feedback','Skutočné náklady')+'</div></div>';
  }
  function searchStock(role,query){
    state.search[role]=query;const box=document.getElementById('wbStockResults_'+role);if(!box)return;
    const found=root.SpektraQuoteMaterials.search(stocks,query,15);
    if(role==='row_link'){
      state.linkResults=found.rows.map(clone);
      box.innerHTML=String(query).trim().length<2?'':found.rows.length?found.rows.map((st,n)=>'<div class="wbStock"><div><b>'+E(st.name)+'</b><small>Kód: '+E(st.code||'chýba')+' · '+E(st.storage_name||st.storage_ref||'')+' · '+money(st.sell_price_ex_vat)+' / '+E(st.unit||'')+'</small></div>'+btn('link-pick-stock','Vybrať','data-id="'+n+'"')+'</div>').join(''):'<div class="wbEmpty">Karta sa nenašla. Doplňte ju v POHODE, importujte XML a obnovte zásoby. Riadok zatiaľ zostane bez ceny.</div>';
      return;
    }
    if(String(query).trim().length<2){box.innerHTML='';return;}
    box.innerHTML=found.rows.length?found.rows.map(st=>'<div class="wbStock"><div><b>'+E(st.name)+'</b><small>'+E(st.code||'')+' · '+money(st.sell_price_ex_vat)+' / '+E(st.unit||'ks')+'</small></div>'+btn('pick-stock','Vybrať','data-role="'+E(role)+'" data-stock="'+E(st.id||st.fingerprint||st.code)+'"')+'</div>').join(''):'<div class="wbEmpty">Nenašla sa skladová karta. Skontrolujte katalóg cez ↻.</div>';
  }
  function stockLinkDialog(index,selected=null){
    const row=current?.items?.[index];if(!row||A().isText(row))throw new Error('Vyberte materiálový riadok.');
    const before=JSON.stringify(row),owner=current.id;
    state.linkIndex=index;state.search.row_link='';state.linkResults=[];
    const differentUnit=selected&&String(selected.unit||'').trim().toLowerCase().replace('²','2').replace('³','3')!==String(row.unit||'').trim().toLowerCase().replace('²','2').replace('³','3');
    let body='<p><strong>'+E(row.name)+'</strong><br><span class="sub">Párovanie podľa presného kódu POHODA. Názov slúži iba na ručné vyhľadávanie.</span></p>';
    if(selected){
      body+='<div class="wbSelected"><b>'+E(selected.name)+'</b>Kód: '+E(selected.code)+' · '+E(selected.unit)+'<br>Predaj: '+money(selected.sell_price_ex_vat)+' · nákup: '+money(selected.purchase_price_ex_vat)+' bez DPH</div>'+field('Množstvo ['+selected.unit+']','wbLinkQty',row.qty,'inputmode="decimal"');
      if(differentUnit)body+='<label class="wbCheck"><input id="wbLinkUnitConfirmed" type="checkbox"><span>Pôvodná MJ: '+E(row.unit)+'. Množstvo som prepočítal na '+E(selected.unit)+'.<small>Pôvodný automatický vzorec sa nahradí potvrdeným množstvom.</small></span></label>';
    }else body+='<label class="wbField"><span>Kód alebo názov skladovej karty</span><input type="search" autocomplete="off" data-wb-search="row_link" placeholder="'+E(row.name)+'"></label><div id="wbStockResults_row_link" class="wbStockList"></div><div class="wbTools"><a class="btn ghost" href="admin/stock-sync.html" target="_blank" rel="noopener">Import XML z POHODY</a>'+btn('link-refresh','↻ Obnoviť zásoby')+'</div><p class="sub">Import nevkladá riadky do ponuky a nemení jej ceny. Kartu priraďte až po kontrole množstva a mernej jednotky.</p>';
    showDialog('Vybrať položku zo zásob',body,'Priradiť do tohto riadku',selected?async()=>{
      if(current?.id!==owner||JSON.stringify(current.items[index])!==before)throw new Error('Riadok sa zmenil. Zopakujte výber zo zásob.');
      const st=A().findStock(A().codeReference(selected),stocks);
      if(!st)throw new Error('Kód nie je jednoznačný alebo karta už nie je v zásobách. Obnovte zásoby.');
      if(['name','unit','sell_price_ex_vat','purchase_price_ex_vat'].some(k=>String(st[k]??'')!==String(selected[k]??'')))throw new Error('Skladová karta sa od výberu zmenila. Vyberte ju znova.');
      const qty=value('wbLinkQty'),confirmUnit=document.getElementById('wbLinkUnitConfirmed')?.checked===true;
      const saved=await mutate('Skladová karta bola priradená podľa kódu.',q=>A().assignStock(q,index,st,{qty,confirmUnit}));
      if(saved.ok&&!saved.stale)closeDialog();
    }:null);
  }
  async function refreshLinkStocks(){
    const owner=current?.id,index=state.linkIndex,user=root.SpektraDB?.getUser?.()?.id;
    if(!root.SpektraDB?.isAuthenticated())throw new Error('Prihláste sa a importujte XML cez ↻.');
    const fresh=await root.SpektraDB.listStocks({force:true});
    if(owner!==current?.id||user!==root.SpektraDB?.getUser?.()?.id)return;
    if(!fresh.length)throw new Error('Katalóg je prázdny. Najprv dokončite import XML.');
    stocks=fresh;if(typeof rebuildStockIndexes==='function')rebuildStockIndexes();
    stockLinkDialog(index);status('Zásoby boli obnovené. Vyberte kartu podľa kódu.');
  }
  function stockById(id){return stocks.find(s=>String(s.id||s.fingerprint||s.code)===String(id));}
  function pickedDevice(role){
    const st=state.picked[role];if(!st)return null;
    const d=(typeof deviceCatalog!=='undefined'?deviceCatalog:[]).find(d=>(st.code&&(d.pohoda_code===st.code||d.code===st.code))||(st.id&&(d.stock_id===st.id||d.id===st.id))||(st.plu&&d.pohoda_plu===st.plu))||{};
    return {...d,...st,power_kw:num(state.parameters.power_kw)??d.power_kw??st.power_kw,brand:d.brand||st.manufacturer||'',model:d.model||st.name};
  }
  function showDialog(title,html,confirmLabel,onConfirm){
    document.getElementById('wbOverlay')?.remove();
    const el=document.createElement('div');el.className='wbOverlay';el.id='wbOverlay';
    el.innerHTML='<section class="wbDialog" role="dialog" aria-modal="true" aria-label="'+E(title)+'"><h2>'+E(title)+'</h2>'+html+'<div id="wbDialogError" class="wbStatus error" role="alert"></div><div class="wbDialogActions">'+btn('close-dialog','Zavrieť')+(onConfirm?btn('confirm-dialog',confirmLabel||'Použiť','','primary'):'')+'</div></section>';
    state.dialogConfirm=onConfirm;state.dialogOwner=current?.id;document.body.appendChild(el);bind(el);el.querySelector('input,select,button')?.focus();
  }
  function closeDialog(){document.getElementById('wbOverlay')?.remove();state.dialogConfirm=null;state.preview=null;state.libraryConflict=null;}
  function previewRows(items){return '<div class="wbScroll"><table class="wbTable"><thead><tr><th>Položka</th><th>Množstvo</th><th>MJ</th><th>Predaj / MJ</th></tr></thead><tbody>'+items.map(i=>'<tr><td>'+E(i.name)+'<small>'+E(i.pohoda_code||i.pohoda?.code||'')+'</small></td><td>'+E(i.qty)+'</td><td>'+E(i.unit)+'</td><td class="wbNumber">'+money(i.price)+'</td></tr>').join('')+'</tbody></table></div>';}
  function previewScenario(){
    const parameters=collectParameters(),device=pickedDevice('device');
    if(S().describe(state.scenarioId).device_required&&!device)throw new Error('Vyberte zariadenie z katalógu.');
    if(state.scenarioId==='heat_pump'&&parameters.dhw_solution==='external'&&!pickedDevice('tank'))throw new Error('Vyberte externý zásobník TÚV z katalógu.');
    const indoorDevices=[];
    if(state.scenarioId==='ac_multi')for(let n=0;n<Number(parameters.indoor_count||2);n++){
      const d=pickedDevice('indoor_'+n);if(!d)throw new Error('Vyberte vnútornú jednotku '+(n+1)+'.');
      d.power_kw=num(parameters['branch_'+(n+1)+'_kw'])??d.power_kw;indoorDevices.push(d);
    }
    const result=S().instantiate({scenarioId:state.scenarioId,device,indoorDevices,tank:pickedDevice('tank'),parameters,stocks,recipes:bundleRecipes});
    state.preview=result;
    const warnings=(result.warnings||[]).map(w=>typeof w==='string'?w:w.message||w.name||JSON.stringify(w));
    showDialog('Kontrola pripravenej zostavy',(warnings.length?'<div class="notice warn">'+warnings.map(E).join('<br>')+'</div>':'')+previewRows(result.items||[]),'Vložiť do ponuky',async()=>{
      const scenarioId=state.scenarioId;
      const saved=await mutate('Zostava bola pridaná.',q=>{
        const primary=!q.items.some(i=>A().kind(i)==='equipment')&&!q.material_edits.assemblies.scenarios.length;
        const added=A().addScenario(q,clone(result));
        if(primary){
          q.category=scenarioId==='zti'?'zti':result.scenario?.category||'other';
          q.device=device?clone(device):{};q.brand=device?.brand||'';
          if(scenarioId==='heat_pump')q.system_type=parameters.system_type||'monoblock';
          if(scenarioId==='gas_boiler')q.boiler_type='gas';if(scenarioId==='biomass')q.boiler_type='pellet';
          if(scenarioId.startsWith('ac_')){q.ac_mode=scenarioId==='ac_multi'?'multi':'single';q.multisplit_count=scenarioId==='ac_multi'?Number(parameters.indoor_count||2):null;}
          q.building={...(q.building||{}),dhw_solution:parameters.dhw_solution||'none'};
        }
        const company=state.library.find(x=>x.key==='pricing:company')?.payload;
        if(company)companyPrices(q,company,new Set(added.items.map(A().rowId)));
      });
      if(saved.ok&&!saved.stale){closeDialog();state.tab='items';render();}
    });
  }
  function groupDialog(id,afterCreate=false){
    const g=id?A().groups(current).find(g=>g.id===id):{name:afterCreate?'Nová vlastná zostava':'Nová skupina',kind:'material',pricing:'computed',rows:[],contents:[]};
    if(!g)throw new Error('Skupina sa nenašla.');
    const html=afterCreate?field('Názov zostavy','wbGroupName',g.name)+'<p class="sub">Po vytvorení pridajte položky z POHODY, montáž a dopravu. Celú zostavu potom uložte do knižnice.</p>':field('Názov skupiny','wbGroupName',g.name)+select('Druh','wbGroupKind',Object.entries(labels),g.kind)+
      select('Výpočet ceny','wbGroupPricing',[['computed','Súčet položiek'],['fixed','Pevná cena – jeden účtovaný riadok']],g.pricing)+
      field('Pevná cena / MJ bez DPH','wbGroupPrice',g.pricing==='fixed'?g.rows[0]?.price??'':'','inputmode="decimal"')+
      '<label class="wbField"><span>Rozsah / úkony – každý na samostatnom riadku</span><textarea id="wbGroupContents">'+E((g.contents||[]).map(x=>typeof x==='string'?x:x.name).join('\n'))+'</textarea><small>Opisný rozpis pevnej ceny. Ceny jednotlivých úkonov sa tu nevytvárajú.</small></label>';
    showDialog(afterCreate?'Nová vlastná zostava':id?'Upraviť skupinu':'Nová skupina',html,'Uložiť',async()=>{
      const name=value('wbGroupName'),kind=afterCreate?'material':value('wbGroupKind'),pricing=afterCreate?'computed':value('wbGroupPricing'),price=afterCreate?'':value('wbGroupPrice');
      const contents=(afterCreate?'':value('wbGroupContents')).split('\n').map(x=>x.trim()).filter(Boolean).map(name=>{const original=(g.contents||[]).find(x=>typeof x==='object'&&x.name===name);return original?clone(original):{name};});
      const saved=await mutate('Skupina bola uložená.',q=>{
        const group=id?A().updateGroup(q,id,{name,kind,pricing,contents}):A().createGroup(q,{name,kind,pricing,contents});
        if(pricing==='fixed'&&price!=='')A().setFixedPrice(q,group.id,price);
      });if(saved.ok&&!saved.stale){closeDialog();if(afterCreate){state.tab='items';render();status('Nová zostava je pripravená. Pridajte položky cez Katalóg, montáž a dopravu a použite „Uložiť celú zostavu“.');}}
    });
  }
  function serviceDialog(kind){
    const names={transport:'Doprava',revision:'Revízia',pressure:'Tlaková skúška a protokol',service:'Ďalšia služba'};
    const pricebook=state.library.find(x=>x.key==='pricing:company')?.payload||{};
    showDialog(names[kind]||'Služba',field('Názov','wbServiceName',names[kind]||'Služba')+'<div class="wbGrid">'+field('Množstvo','wbServiceQty',1,'inputmode="decimal"')+field('MJ','wbServiceUnit',kind==='transport'?'výjazd':'súb.')+field('Predaj / MJ bez DPH','wbServicePrice',kind==='transport'?pricebook.transport_price??'':'','inputmode="decimal"')+field('Náklad / MJ bez DPH','wbServiceCost',kind==='transport'?pricebook.transport_cost??'':'','inputmode="decimal"')+'</div>'+
      '<label class="wbCheck"><input id="wbServiceSingleton" type="checkbox" checked><span>Spoločná služba na zákazku – započítať iba raz</span></label><label class="wbCheck"><input id="wbServiceOptional" type="checkbox"><span>Ponúknuť ako voliteľný doplnok</span></label>','Pridať',async()=>{
      const name=value('wbServiceName'),qty=value('wbServiceQty'),unit=value('wbServiceUnit'),price=value('wbServicePrice'),cost=value('wbServiceCost');
      const singleton=document.getElementById('wbServiceSingleton').checked,optional=document.getElementById('wbServiceOptional').checked;
      const saved=await mutate('Služba bola pridaná.',q=>{
        const row={role:'quote_manual_service',name,qty:A().quantity(qty),unit,price:A().money(price),cost:A().money(cost),cost_override:cost!=='',price_override:true,visible:true,mapping_status:'manual_service',stored_metadata:{quote_material:{origin:'manual',kind:'service'},quote_assembly:{kind,origin:'manual',manual:{price:true,cost:cost!==''},...(singleton?{singleton_key:kind}:{}),quantity_rule:{type:'fixed',qty:A().quantity(qty)}}}};
        if(optional)A().addOptional(q,{name,kind,items:[row]});
        else{const group=A().createGroup(q,{name,kind,pricing:'computed'});const result=A().addRows(q,group.id,[row]);if(!result.items.length&&result.skipped.length)throw new Error('Táto spoločná služba už je v ponuke. Upravte jej množstvo alebo vypnite započítanie iba raz.');}
      });if(saved.ok&&!saved.stale){closeDialog();render();}
    });
  }
  function quantityDialog(){
    const config=A().inspect(current),used=new Set();
    for(const row of current.items||[]){const r=A().metadata(row).quantity_rule;if(r?.parameter)used.add(r.parameter);for(const k of r?.parameters||[])used.add(k);}
    const entries=Object.entries(config.parameters||{}).filter(([key])=>used.has(key));
    const labelsByParameter=new Map();
    for(const s of config.scenarios||[])for(const [key,full] of Object.entries(s.parameters||{}))labelsByParameter.set(full,(s.name||'Zostava')+' · '+key.replace(/_/g,' '));
    if(!entries.length){showDialog('Prepočet množstiev','<p>Táto ponuka ešte nemá pravidlá množstiev. Pridajte scenár alebo nastavte pravidlo v detaile riadka.</p>');return;}
    showDialog('Parametre množstiev','<div class="wbGrid">'+entries.map(([key,v],n)=>field(labelsByParameter.get(key)||key,'wbRecalc_'+n,v,'data-wb-recalc="'+E(key)+'" inputmode="decimal"')).join('')+'</div>','Zobraziť zmeny',()=>{
      const values={};document.querySelectorAll('[data-wb-recalc]').forEach(n=>values[n.dataset.wbRecalc]=n.value);
      const preview=A().previewQuantities(current,values);changePreview(preview,'Množstvá');
    });
  }
  async function priceDialog(){
    const owner=current;status('Načítavam aktuálny katalóg…');
    if(root.SpektraDB?.isAuthenticated()){
      const fresh=await root.SpektraDB.listStocks({force:true});if(!fresh.length)throw new Error('Online katalóg je prázdny.');
      stocks=fresh;rebuildStockIndexes();
    }
    if(current!==owner)return;
    const preview=A().previewPrices(current,stocks);status('Náhľad zmien cien je pripravený.');changePreview(preview,'Ceny z katalógu');
  }
  function changePreview(preview,title){
    const changes=preview.changes||[],missing=preview.missing||[];
    const html=(missing.length?'<div class="notice warn">'+missing.map(x=>E(typeof x==='string'?x:x.name||x.reason||x.error)).join('<br>')+'</div>':'')+
      (changes.length?'<div class="wbScroll"><table class="wbTable"><thead><tr><th>Položka</th><th>Pole</th><th>Teraz</th><th>Po zmene</th><th>Ručná úprava</th></tr></thead><tbody>'+changes.map(c=>'<tr><td>'+E(c.name)+'</td><td>'+E(c.field==='cost'?'Náklad':c.field==='price'?'Predaj':'Množstvo')+'</td><td>'+E(c.before??'—')+'</td><td>'+E(c.after??'—')+'</td><td>'+E(c.manual?'Zachovať':'—')+'</td></tr>').join('')+'</tbody></table></div>':'<p>Ceny alebo množstvá sa nemenia.</p>')+
      (changes.some(c=>c.manual)?'<label class="wbCheck"><input id="wbOverrideManual" type="checkbox"><span>Použiť prepočet aj na označené ručné úpravy</span></label>':'');
    showDialog(title,html,'Použiť zmeny',async()=>{
      const overrideManual=document.getElementById('wbOverrideManual')?.checked===true;
      const saved=await mutate('Prepočet bol použitý.',q=>{const next={...clone(preview),quote_id:q.id};if(preview.type==='prices')A().applyPrices(q,next,{overrideManual});else A().applyQuantities(q,next,{overrideManual});});
      if(saved.ok&&!saved.stale)closeDialog();
    });
  }
  function rowDialog(index){
    const view=clone(current);view.status='draft';delete view._server_status;A().init(view);const row=view.items[index];if(!row)return;
    const meta=A().metadata(row),rule=meta.quantity_rule||{},priceRule=meta.price_rule||{mode:'catalog'};
    const params=Object.entries(A().inspect(view).parameters||{}),groupList=A().groups(view);
    showDialog('Detail položky', '<h3>'+E(row.name)+'</h3><div class="sub">Katalógový kód: '+E(row.pohoda_code||row.pohoda?.code||'—')+'</div>'+
      select('Skupina','wbRowGroup',groupList.map(g=>[g.id,g.name]),meta.group_id)+
      '<h3>Pravidlo množstva</h3><div class="wbGrid">'+select('Množstvo','wbQtyRuleType',[['keep','Ponechať existujúce pravidlo'],['manual','Ručné'],['fixed','Pevné'],['parameter','Podľa parametra']],rule.type==='sum'?'keep':rule.type||'manual')+
      select('Parameter','wbQtyRuleParam',params.map(([k])=>[k,k]),rule.parameter||params[0]?.[0]||'')+field('Koeficient na jednotku parametra','wbQtyFactor',rule.factor??1,'inputmode="decimal"')+field('Pevné množstvo','wbQtyFixed',rule.qty??row.qty,'inputmode="decimal"')+'</div>'+
      '<h3>Cenové pravidlo</h3><div class="wbGrid">'+select('Cena','wbPriceRule',[['keep','Ponechať cenu'],['catalog','Katalóg'],['markup','Náklad + prirážka %'],['margin','Požadovaná marža %'],['fixed','Pevná cena / MJ']],meta.price_rule?priceRule.mode:'keep')+field('Hodnota % alebo pevná cena','wbPriceRuleValue',priceRule.value??'','inputmode="decimal"')+'</div>'+
      '<div class="sub">Ručné úpravy: '+E(Object.keys(A().manualFlags(row)).filter(k=>A().manualFlags(row)[k]).join(', ')||'žiadne')+'</div>','Uložiť pravidlá',async()=>{
      const group=value('wbRowGroup'),type=value('wbQtyRuleType'),parameter=value('wbQtyRuleParam'),factor=value('wbQtyFactor'),fixed=value('wbQtyFixed'),mode=value('wbPriceRule'),v=value('wbPriceRuleValue');
      const saved=await mutate('Pravidlá položky boli uložené.',q=>{
        A().moveRow(q,index,group);const rowId=A().rowId(q.items.find(i=>A().rowId(i)===meta.id)||q.items[index]);
        if(type==='manual')A().setQuantityRule(q,rowId,null);
        else if(type!=='keep'){A().setQuantityRule(q,rowId,type==='fixed'?{type:'fixed',qty:fixed}:{type:'parameter',parameter,factor});A().markManual(q,rowId,'qty',false);}
        if(mode!=='keep')A().setPriceRule(q,rowId,{mode,...(mode==='catalog'?{}:{value:v})});
      });if(saved.ok&&!saved.stale)closeDialog();
    });
  }
  function libraryUser(){return root.SpektraDB?.getUser?.()?.id||'offline';}
  function libraryCacheKey(owner=libraryUser()){return 'spektra.quoteLibrary.v1.'+owner;}
  function readLibraryCache(owner){const rows=JSON.parse(localStorage.getItem(libraryCacheKey(owner))||'[]');return Array.isArray(rows)?rows:[];}
  function persistLibrary(rows=state.library,owner=state.libraryOwner||libraryUser()){try{localStorage.setItem(libraryCacheKey(owner),JSON.stringify(rows));}catch(e){throw new Error('Knižnicu sa nepodarilo uložiť do zariadenia: '+e.message);}}
  async function loadLibrary(force=false){
    const owner=libraryUser();
    if(state.libraryLoading?.owner===owner)return state.libraryLoading.promise;
    if(!force&&state.libraryOwner===owner)return;
    if(state.libraryOwner!==owner){state.library=readLibraryCache(owner);state.libraryOwner=owner;}
    const request={owner};state.libraryLoading=request;
    request.promise=(async()=>{try{
      if(root.SpektraDB?.isAuthenticated()&&root.SpektraDB.listQuoteLibrary){
        const remote=await root.SpektraDB.listQuoteLibrary();if(owner!==libraryUser()||state.libraryLoading!==request)return;
        const map=new Map(remote.map(x=>[x.key,x]));
        for(const row of state.library.filter(x=>x.pending)){
          if(owner!==libraryUser()||state.libraryLoading!==request)return;
          const server=map.get(row.key);
          if(server&&JSON.stringify(server.payload)===JSON.stringify(row.payload))continue;
          try{map.set(row.key,await root.SpektraDB.saveQuoteLibrary(row.key,row.kind,row.payload,row.revision??null));}
          catch(e){map.set(row.key,{...row,error:e.message});}
        }
        if(owner!==libraryUser()||state.libraryLoading!==request)return;
        state.library=[...map.values()];persistLibrary(state.library,owner);
      }
    }finally{if(state.libraryLoading===request){state.libraryLoading=false;if(owner===libraryUser())render();}}})();
    return request.promise;
  }
  async function saveLibrary(key,kind,payload){
    const owner=libraryUser(),quoteOwner=current?.id;
    if(state.libraryOwner!==owner||state.libraryLoading)await loadLibrary();
    if(owner!==libraryUser()||quoteOwner!==current?.id)throw new Error('Účet alebo otvorená ponuka sa zmenili. Zopakujte uloženie.');
    const existing=state.library.find(x=>x.key===key),revision=existing?.revision??null;
    const pending={key,kind,payload:clone(payload),revision,pending:true};
    const old=state.library.slice();state.library=state.library.filter(x=>x.key!==key).concat(pending);
    try{persistLibrary(state.library,owner);}catch(e){state.library=old;throw e;}
    const active=()=>state.libraryOwner===owner&&libraryUser()===owner;
    if(root.SpektraDB?.isAuthenticated()){
      try{
        const result=await root.SpektraDB.saveQuoteLibrary(key,kind,payload,revision);
        const records=active()?state.library:readLibraryCache(owner);
        const newer=records.find(x=>x.key===key);
        // A later local edit must survive an older server response.
        const replacement=newer?.pending&&JSON.stringify(newer.payload)!==JSON.stringify(pending.payload)?{...newer,revision:result.revision}:result;
        const saved=records.filter(x=>x.key!==key).concat(replacement);persistLibrary(saved,owner);
        if(active()){state.library=saved;if(quoteOwner===current?.id)status('Uložené v spoločnej knižnici.');}
      }catch(e){
        if(active()){pending.error=e.message;persistLibrary(state.library,owner);if(quoteOwner===current?.id)status('Zmena zostala v zariadení: '+e.message,true);}
        throw e;
      }
    }else status('Uložené v tomto zariadení. Pre spoločnú knižnicu sa prihláste a zostavu uložte znova.');
    const stale=!active()||quoteOwner!==current?.id;if(!stale)render();return {...pending,stale};
  }
  function libraryComparison(row){
    if(row.kind==='template')return '<b>'+E(row.payload.name)+'</b><div class="sub">Verzia '+E(row.payload.version)+'</div>'+previewRows(row.payload.rows||[]);
    const names=row.kind==='pricing'?{material_mode:'Ocenenie materiálu',material_value:'Prirážka / marža [%]',labor_sell_rate:'Predaj práce [€/čh]',labor_cost_rate:'Náklad práce [€/čh]',transport_price:'Predaj dopravy',transport_cost:'Náklad dopravy',min_margin_pct:'Limit marže [%]'}:{material_cost:'Skutočný materiál',labor_hours:'Hodiny práce',labor_cost:'Náklad práce',transport_cost:'Náklad dopravy',note:'Poznámka'};
    const modes={catalog:'Cena z POHODY',markup:'Náklad + prirážka',margin:'Požadovaná marža'};
    return '<dl>'+Object.entries(names).map(([key,label])=>'<dt>'+E(label)+'</dt><dd>'+E(key==='material_mode'?modes[row.payload[key]]:row.payload[key]??'—')+'</dd>').join('')+'</dl>';
  }
  async function libraryConflictDialog(key){
    const owner=libraryUser(),quoteOwner=current?.id,entry=state.library.find(x=>x.key===key);
    if(!entry?.pending)throw new Error('Zmena už nie je v čakajúcom stave. Obnovte knižnicu.');
    const local=clone(entry);
    if(!root.SpektraDB?.isAuthenticated())throw new Error('Na kontrolu spoločnej verzie sa prihláste.');
    const remote=(await root.SpektraDB.listQuoteLibrary()).find(x=>x.key===key);
    if(owner!==libraryUser()||quoteOwner!==current?.id)return;
    showDialog('Skontrolovať uloženie','<p>Vaša úprava zostáva uložená v zariadení. Porovnajte ju s aktuálnou spoločnou verziou.</p><div class="wbGrid"><div><h3>Moja úprava</h3>'+libraryComparison(local)+'</div><div><h3>Spoločná verzia</h3>'+(remote?libraryComparison(remote):'<p>Zatiaľ nebola uložená.</p>')+'</div></div>'+(remote?'<div class="wbTools">'+btn('use-library-server','Použiť spoločnú verziu a zahodiť moju úpravu','data-id="'+E(key)+'"')+'</div>':''),'Uložiť moju úpravu ako ďalšiu verziu',async()=>{
      if(owner!==libraryUser())throw new Error('Prihlásený účet sa zmenil. Zopakujte kontrolu.');
      const payload=clone(local.payload);if(local.kind==='template')payload.version=Math.max(payload.version||1,(remote?.payload?.version||0)+1);
      state.library=state.library.filter(x=>x.key!==key).concat({...local,revision:remote?.revision??null});
      const saved=await saveLibrary(key,local.kind,payload);if(!saved.stale)closeDialog();
    });
    state.libraryConflict={owner,quoteOwner,key,remote};
  }
  function saveTemplateDialog(groupId){
    const draft=clone(current);draft.status='draft';delete draft._server_status;A().init(draft);const g=A().groups(draft).find(x=>x.id===groupId);
    showDialog('Uložiť opakovateľnú zostavu',field('Názov zostavy','wbTemplateName',g?.name||'Moja zostava')+'<p class="sub">Uloží sa materiál a práca bez zákazníckych údajov. Zostavu možno ďalej upravovať a označiť ako overenú.</p>','Uložiť zostavu',async()=>{
      const template=S().templateFromGroup(draft,groupId,{name:value('wbTemplateName')});const saved=await saveLibrary('template:'+template.id,'template',template);if(!saved.stale)closeDialog();
    });
  }
  function saveWholeTemplateDialog(){
    const draft=clone(current);draft.status='draft';delete draft._server_status;A().init(draft);
    const name=A().groups(draft)[0]?.name||'Moja zostava';
    showDialog('Uložiť celú zostavu',field('Názov zostavy','wbTemplateName',name)+
      '<p class="sub">Do spoločnej knižnice sa uložia všetky položky ponuky – materiál, montáž, doprava a ďalšie služby. Údaje zákazníka sa neukladajú.</p>',
      'Uložiť zostavu',async()=>{
        const template=S().templateFromQuote(draft,{name:value('wbTemplateName')});
        const saved=await saveLibrary('template:'+template.id,'template',template);
        if(!saved.stale)closeDialog();
      });
  }
  function editTemplateDialog(key){
    const entry=state.library.find(x=>x.key===key);if(!entry)throw new Error('Zostava sa nenašla.');const t=entry.payload;
    showDialog('Správa zostavy',field('Názov','wbTemplateName',t.name)+select('Stav','wbTemplateStatus',[['draft','Rozpracovaná'],['verified','Overená na zákazke']],t.status||'draft')+
      '<div class="wbScroll"><table class="wbTable"><thead><tr><th>Položka</th><th>Množstvo</th><th>MJ</th><th>Predaj / MJ</th><th>Náklad / MJ</th></tr></thead><tbody>'+(t.rows||[]).map((r,n)=>'<tr><td><input data-wb-template-row="'+n+'" data-field="name" value="'+E(r.name)+'"></td><td><input data-wb-template-row="'+n+'" data-field="qty" value="'+E(r.qty)+'" inputmode="decimal"></td><td><input data-wb-template-row="'+n+'" data-field="unit" value="'+E(r.unit)+'"></td><td><input data-wb-template-row="'+n+'" data-field="price" value="'+E(r.price??'')+'" inputmode="decimal"></td><td><input data-wb-template-row="'+n+'" data-field="cost" value="'+E(r.cost??'')+'" inputmode="decimal"></td></tr>').join('')+'</tbody></table></div><div class="wbTools">'+btn('copy-template','Uložiť kópiu','data-id="'+E(key)+'"')+'</div><div class="sub">Zmena vytvorí novú verziu zostavy. Už vytvorené ponuky sa neprepočítajú.</div>','Uložiť novú verziu',async()=>{
      const rows=clone(t.rows);document.querySelectorAll('[data-wb-template-row]').forEach(n=>{const r=rows[Number(n.dataset.wbTemplateRow)],f=n.dataset.field;r[f]=['qty','price','cost'].includes(f)?(f==='qty'?A().quantity(n.value):A().money(n.value)):n.value;if(f==='qty')r.quantity_rule={type:'fixed',qty:r.qty};});
      const updated=S().updateTemplate(t,{name:value('wbTemplateName'),status:value('wbTemplateStatus'),rows});const saved=await saveLibrary(key,'template',updated);if(!saved.stale)closeDialog();
    });
  }
  async function useTemplate(key){
    const t=state.library.find(x=>x.key===key)?.payload;if(!t)throw new Error('Zostava sa nenašla.');
    showDialog('Pridať: '+t.name,field('Počet zostáv','wbTemplateCount',1,'inputmode="decimal"')+previewRows(t.rows),'Vložiť do ponuky',async()=>{
      const count=A().quantity(value('wbTemplateCount'));if(count<=0)throw new Error('Počet zostáv musí byť väčší ako nula.');
      const copy=clone(t);copy.parameters={...(copy.parameters||{}),assembly_count:count};
      for(const row of copy.rows)if(!row.quantity_rule||row.quantity_rule.type==='fixed')row.quantity_rule={type:'parameter',parameter:'assembly_count',factor:Number(row.qty)};
      const result=S().instantiateTemplate(copy,{stocks,parameters:copy.parameters});
      const saved=await mutate('Uložená zostava bola pridaná.',q=>{
        const primary=!q.items.some(i=>A().kind(i)==='equipment')&&!q.material_edits.assemblies.scenarios.length;const added=A().addScenario(q,clone(result));
        if(primary){q.category=result.scenario?.category||'other';for(const key of ['system_type','boiler_type','ac_mode'])if(result.scenario?.[key])q[key]=result.scenario[key];}
        const company=state.library.find(x=>x.key==='pricing:company')?.payload;if(company)companyPrices(q,company,new Set(added.items.map(A().rowId)));
      });if(saved.ok&&!saved.stale){closeDialog();state.tab='items';render();}
    });
  }
  function pricingDialog(){
    const p=state.library.find(x=>x.key==='pricing:company')?.payload||{};
    showDialog('Firemný cenový štandard','<div class="wbGrid">'+select('Ocenenie materiálu','wbPricingMode',[['catalog','Predajná cena z POHODY'],['markup','Náklad + prirážka %'],['margin','Požadovaná marža %']],p.material_mode||'catalog')+field('Prirážka / marža materiálu [%]','wbPricingValue',p.material_value??'','inputmode="decimal"')+field('Predaj práce [€/čh]','wbLaborSell',p.labor_sell_rate??'','inputmode="decimal"')+field('Náklad práce [€/čh]','wbLaborCost',p.labor_cost_rate??'','inputmode="decimal"')+field('Doprava – predaj za výjazd','wbTransportSell',p.transport_price??'','inputmode="decimal"')+field('Doprava – náklad za výjazd','wbTransportCost',p.transport_cost??'','inputmode="decimal"')+field('Upozorniť pri marži pod [%]','wbMinMargin',p.min_margin_pct??'','inputmode="decimal"')+'</div>'+
      '<div class="notice">Prázdny náklad ostáva neoverený. Zmena sadzobníka neprepisuje existujúce ponuky.</div><label class="wbCheck"><input id="wbPricingApply" type="checkbox"><span>Po uložení pripraviť náhľad použitia na túto ponuku</span></label>','Uložiť pravidlá',async()=>{
      const p={material_mode:value('wbPricingMode'),material_value:A().money(value('wbPricingValue')),labor_sell_rate:A().money(value('wbLaborSell')),labor_cost_rate:A().money(value('wbLaborCost')),transport_price:A().money(value('wbTransportSell')),transport_cost:A().money(value('wbTransportCost')),min_margin_pct:A().money(value('wbMinMargin')),updated_at:new Date().toISOString()};
      if(p.material_mode!=='catalog'&&p.material_value==null)throw new Error('Zadajte prirážku alebo maržu.');
      if(p.material_mode==='margin'&&p.material_value>=100||p.min_margin_pct!=null&&p.min_margin_pct>=100)throw new Error('Marža musí byť menšia ako 100 %.');
      const apply=document.getElementById('wbPricingApply').checked;const saved=await saveLibrary('pricing:company','pricing',p);if(!saved.stale){closeDialog();if(apply)previewCompanyPricing(p);}
    });
  }
  function companyPrices(q,p,rowIds=null){
    for(let index=0;index<q.items.length;index++){
      const row=q.items[index],kind=A().kind(row),manual=A().manualFlags(row),meta=A().metadata(row);
      if(rowIds&&!rowIds.has(A().rowId(row)))continue;
      if(kind==='material'&&!manual.price&&p.material_mode!=='catalog'&&(!meta.price_rule||meta.price_policy==='company')){A().setPriceRule(q,index,{mode:p.material_mode,value:p.material_value});A().metadata(q.items[index]).price_policy='company';}
      if(kind==='labor'&&['čh','hod','hod.','h'].includes(row.unit)){
        if(!manual.price&&p.labor_sell_rate!=null)A().setField(q,index,'price',p.labor_sell_rate);
        if(!manual.cost&&p.labor_cost_rate!=null)A().setField(q,index,'cost',p.labor_cost_rate);
      }
    }
    q.material_edits.assemblies.pricing_standard={...clone(p),library_revision:state.library.find(x=>x.key==='pricing:company')?.revision??null};
  }
  function previewCompanyPricing(p){
    const draft=clone(current);draft.status='draft';delete draft._server_status;A().init(draft);companyPrices(draft,p);
    showDialog('Použitie cenového štandardu',previewRows(draft.items)+'<p class="sub">Ručné ceny sa zachovajú. Pravidlo materiálu sa vypočíta z overeného nákladu.</p>','Použiť ceny',async()=>{const saved=await mutate('Cenový štandard bol použitý.',q=>companyPrices(q,p));if(saved.ok&&!saved.stale)closeDialog();});
  }
  function variantsDialog(){
    const config=A().inspect(current),variants=config.variants||[];
    const sum=rows=>rows.some(i=>i.price==null)?null:rows.reduce((n,i)=>n+Number(i.qty)*Number(i.price),0);
    const baseline=sum(current.items||[]);
    showDialog('Varianty ponuky',variants.length?'<div class="wbScroll"><table class="wbTable"><thead><tr><th>Variant</th><th>Cena bez DPH</th><th>Rozdiel</th><th></th></tr></thead><tbody>'+variants.map(v=>{const selected=v.id===config.active_variant_id,net=selected?baseline:sum(v.snapshot.items||[]);return '<tr><td>'+E(v.name)+(selected?' <small>Aktívny</small>':'')+'</td><td>'+money(net)+'</td><td>'+money(net==null||baseline==null?null:net-baseline)+'</td><td>'+btn('select-variant','Použiť','data-id="'+E(v.id)+'"')+'</td></tr>';}).join('')+'</tbody></table></div><p class="sub">V cene ponuky je iba aktívny variant. Pred výmenou zariadenia možno uložiť nový variant cez „Uložiť variant“.</p>':'<p>Najprv uložte aktuálnu ponuku ako variant. Potom upravte zariadenie alebo položky a uložte ďalší variant.</p>');
  }
  function variantDialog(){showDialog('Uložiť variant',field('Názov variantu','wbVariantName','Variant '+((A().inspect(current).variants||[]).length+1)),'Uložiť',async()=>{const name=value('wbVariantName');const saved=await mutate('Variant bol uložený.',q=>A().saveVariant(q,{name}));if(saved.ok&&!saved.stale)closeDialog();});}
  function customerDialog(){
    const c=current.customer||{};
    showDialog('Kontakt a miesto realizácie',field('Meno / firma','wbCustomerName',c.name)+field('Telefón','wbCustomerPhone',c.phone)+field('E-mail','wbCustomerEmail',c.email,'type="email"')+field('Adresa realizácie','wbCustomerAddress',c.address),'Uložiť',async()=>{
      const customer={...current.customer,name:value('wbCustomerName').trim(),phone:value('wbCustomerPhone').trim(),email:value('wbCustomerEmail').trim(),address:value('wbCustomerAddress').trim()};
      if(!customer.name||!customer.phone||!customer.address)throw new Error('Vyplňte meno, telefón a adresu.');
      const saved=await mutate('Kontakt bol upravený.',q=>{q.customer=clone(customer);});if(saved.ok&&!saved.stale)closeDialog();
    });
  }
  function feedbackDialog(){
    const key='feedback:'+current.id,entry=state.library.find(x=>x.key===key)?.payload||{},summary=root.SpektraQuoteSummary.calculate(current);
    showDialog('Skutočné náklady zákazky','<p class="sub">Podklad k ponuke '+E(current.quote_no)+'. Údaje realizácie nemenia zákaznícku cenu ani vydanú verziu.</p><div class="wbGrid">'+field('Skutočný materiál bez DPH','wbActualMaterial',entry.material_cost??'','inputmode="decimal"')+field('Skutočné hodiny práce','wbActualHours',entry.labor_hours??'','inputmode="decimal"')+field('Skutočný náklad práce','wbActualLabor',entry.labor_cost??'','inputmode="decimal"')+field('Skutočný náklad dopravy','wbActualTravel',entry.transport_cost??'','inputmode="decimal"')+'</div><label class="wbField"><span>Poznámka pre úpravu budúcich zostáv</span><textarea id="wbActualNote">'+E(entry.note||'')+'</textarea></label><div class="sub">Plánovaný overený náklad: '+money(summary.complete?summary.knownCost:null)+'</div>','Uložiť realizáciu',async()=>{
      const payload={quote_id:current.id,quote_no:current.quote_no,material_cost:A().money(value('wbActualMaterial')),labor_hours:A().money(value('wbActualHours')),labor_cost:A().money(value('wbActualLabor')),transport_cost:A().money(value('wbActualTravel')),note:value('wbActualNote'),updated_at:new Date().toISOString()};
      const saved=await saveLibrary(key,'feedback',payload);if(!saved.stale)closeDialog();
    });
  }
  function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function internalDocument(kind){const html=kind==='purchase'?O().renderPurchase(current):O().renderInstaller(current);showDialog(kind==='purchase'?'Nákupný zoznam':'Podklad pre montáž','<div class="wbPreview">'+html+'</div><div class="wbTools">'+btn('download-document','Stiahnuť podklad','data-id="'+kind+'"')+'</div>');}
  function exportLibrary(){download('Spektra_zostavy.json',S().exportTemplates(state.library.filter(x=>x.kind==='template').map(x=>x.payload)),'application/json');}
  function importLibrary(){
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>2*1024*1024)throw new Error('Súbor je väčší ako 2 MB.');const templates=S().importTemplates(await file.text());
      showDialog('Import zostáv','<p>Počet zostáv: '+templates.length+'</p><ul>'+templates.map(t=>'<li>'+E(t.name)+' · v'+t.version+'</li>').join('')+'</ul>','Pridať do knižnice',async()=>{for(const source of templates){const existing=state.library.find(x=>x.key==='template:'+source.id);const t=existing?S().copyTemplate(source):source;const saved=await saveLibrary('template:'+t.id,'template',t);if(saved.stale)return;}closeDialog();});
    }catch(e){status(e.message,true);}};input.click();
  }
  async function changeControl(node){
    try{
      if(node.dataset.wbParam){collectParameters();if(node.dataset.wbParam==='job_type')state.parameters.labor_rate=node.value==='renovation'?40:35;if(node.dataset.wbRerender)render();}
      if(node.dataset.wbOutput){const patch={[node.dataset.wbOutput]:node.type==='checkbox'?node.checked:node.value};await mutate('Rozpis ponuky bol nastavený.',q=>A().setOutput(q,patch),{renderRows:false});}
      if(node.dataset.wbOptional){await mutate('Výber doplnku bol upravený.',q=>A().selectOptional(q,node.dataset.wbOptional,node.checked));}
      if(node.dataset.wbMoveRow!==undefined){const index=Number(node.dataset.wbMoveRow),target=node.value;await mutate('Položka bola presunutá.',q=>A().moveRow(q,index,target));}
    }catch(e){status(e.message,true);}
  }
  async function action(name,node){
    try{
      const id=node?.dataset?.id;
      if(name==='tab'){tab(id);return;}
      if(name==='scenario'){collectParameters();state.scenarioId=id;state.parameters={};state.picked={};state.search={};render();return;}
      if(name==='pick-stock'){
        collectParameters();const st=stockById(node.dataset.stock);if(!st)throw new Error('Skladová karta už nie je dostupná.');
        const role=node.dataset.role;state.picked[role]=clone(st);state.search[role]='';
        const d=(typeof deviceCatalog!=='undefined'?deviceCatalog:[]).find(x=>(st.code&&(x.pohoda_code===st.code||x.code===st.code))||(st.id&&(x.id===st.id||x.stock_id===st.id)))||{};
        if(role==='device'){state.parameters.power_kw=d.power_kw??st.power_kw??'';if(state.scenarioId==='heat_pump'&&['monoblock','split'].includes(d.system_type||st.system_type))state.parameters.system_type=d.system_type||st.system_type;}
        if(role.startsWith('indoor_'))state.parameters['branch_'+(Number(role.slice(7))+1)+'_kw']=d.power_kw??st.power_kw??'';
        render();return;
      }
      if(name==='preview-scenario'){previewScenario();return;}
      if(name==='close-dialog'){closeDialog();return;}
      if(name==='confirm-dialog'){if(state.dialogOwner!==current?.id)throw new Error('Otvorená ponuka sa zmenila. Zavrite toto okno a zopakujte úpravu.');const fn=state.dialogConfirm;if(fn){node.disabled=true;try{await fn();}finally{node.disabled=false;}}return;}
      if(name==='customer'){customerDialog();return;}
      if(name==='catalog'||name==='text'){tab('items');toggleQuoteAddPanel(name==='catalog'?'catalog':'manual');if(name==='text'){document.getElementById('quoteManualKind').value='text';updateQuoteManualKind();}return;}
      if(name==='new-custom'){groupDialog(null,true);return;}
      if(name==='new-group'||name==='edit-group'){groupDialog(id);return;}
      if(name==='service'){serviceDialog(id);return;}
      if(name==='copy-group'){await mutate('Skupina bola skopírovaná.',q=>A().copyGroup(q,id));return;}
      if(name==='remove-group'){await mutate('Skupina bola odstránená. Úpravu možno vrátiť.',q=>A().removeGroup(q,id));return;}
      if(name==='optional-group'){await mutate('Skupina je pripravená ako voliteľný doplnok.',q=>{const g=A().groups(q).find(x=>x.id===id);if(!g)throw new Error('Skupina sa nenašla.');A().addOptional(q,{name:g.name,kind:g.kind,groups:[g],items:g.rows});A().removeGroup(q,id);});return;}
      if(name==='undo'){
        if(!state.undo.length){status('Nie je dostupná predchádzajúca úprava.');return;}
        const previous=state.undo.pop();prepareEdit();const revision=clone(A().inspect(current).revision||null);
        for(const k of formFields){if(previous[k]===undefined)delete current[k];else current[k]=clone(previous[k]);}
        A().init(current);if(revision)current.material_edits.assemblies.revision=revision;delete current.warranty_consent;
        const owner=current,pending=saveQuoteMaterialChange('Posledná úprava bola vrátená.',true),token=owner._edit_token;await pending;
        if(current?.id===owner.id&&current?._edit_token===token)render();return;
      }
      if(name==='recalculate'){quantityDialog();return;}
      if(name==='prices'){await priceDialog();return;}
      if(name==='row-detail'){rowDialog(Number(id));return;}
      if(name==='link-stock'){stockLinkDialog(Number(id));return;}
      if(name==='link-refresh'){await refreshLinkStocks();return;}
      if(name==='link-pick-stock'){
        const selected=state.linkResults?.[Number(id)];if(!selected)throw new Error('Zopakujte vyhľadávanie skladovej karty.');
        const st=A().findStock(A().codeReference(selected),stocks);
        if(!st)throw new Error('Kód nie je jednoznačný. Skontrolujte kód a sklad v POHODE.');
        stockLinkDialog(state.linkIndex,clone(st));return;
      }
      if(name==='copy-row'){await mutate('Položka bola skopírovaná.',q=>A().copyRow(q,Number(id)));return;}
      if(name==='save-full-template'){saveWholeTemplateDialog();return;}
      if(name==='save-template'){saveTemplateDialog(id);return;}
      if(name==='use-template'){await useTemplate(id);return;}
      if(name==='edit-template'){editTemplateDialog(id);return;}
      if(name==='copy-template'){const entry=state.library.find(x=>x.key===id);const rows=clone(entry.payload.rows);document.querySelectorAll('[data-wb-template-row]').forEach(n=>{const r=rows[Number(n.dataset.wbTemplateRow)],f=n.dataset.field;r[f]=['qty','price','cost'].includes(f)?(f==='qty'?A().quantity(n.value):A().money(n.value)):n.value;});const changed=S().updateTemplate(entry.payload,{name:value('wbTemplateName')||entry.payload.name,rows,status:value('wbTemplateStatus')||'draft'});const t=S().copyTemplate(changed);const saved=await saveLibrary('template:'+t.id,'template',t);if(!saved.stale)closeDialog();return;}
      if(name==='reload-library'){await loadLibrary(true);status('Knižnica bola obnovená.');return;}
      if(name==='library-conflict'){await libraryConflictDialog(id);return;}
      if(name==='use-library-server'){
        const c=state.libraryConflict;if(!c||c.key!==id||c.owner!==libraryUser()||c.quoteOwner!==current?.id||!c.remote)throw new Error('Otvorená kontrola už nie je aktuálna.');
        const rows=state.library.filter(x=>x.key!==id).concat(c.remote);persistLibrary(rows,c.owner);state.library=rows;closeDialog();status('Použitá spoločná verzia.');render();return;
      }
      if(name==='export-library'){exportLibrary();return;}
      if(name==='import-library'){importLibrary();return;}
      if(name==='pricing'){pricingDialog();return;}
      if(name==='variant'){variantDialog();return;}
      if(name==='variants'){variantsDialog();return;}
      if(name==='select-variant'){const saved=await mutate('Variant bol zvolený.',q=>A().selectVariant(q,id));if(saved.ok&&!saved.stale)closeDialog();return;}
      if(name==='pdf'){await printPDF();return;}
      if(name==='final'){await quoteRowsToFinal();return;}
      if(name==='purchase'||name==='installer'){internalDocument(name);return;}
      if(name==='feedback'){feedbackDialog();return;}
      if(name==='download-document'){const html=id==='purchase'?O().renderPurchase(current):O().renderInstaller(current);download((current.quote_no||'ponuka')+'_'+id+'.html','<!doctype html><html lang="sk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+E(current.quote_no)+'</title><style>body{font:14px Arial;margin:24px;color:#20364b}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}@media print{body{margin:0}tr{break-inside:avoid}}</style><body>'+html+'</body></html>','text/html');return;}
    }catch(e){const n=document.getElementById('wbDialogError');if(n)n.textContent=e.message||String(e);else status(e.message||String(e),true);}
  }
  function rowControls(index){return '<div class="wbRowButtons">'+(!A().isText(current?.items?.[index])?btn('link-stock','Zásoby','data-id="'+index+'"'):'')+btn('row-detail','⋯','data-id="'+index+'"')+btn('copy-row','⧉','data-id="'+index+'"')+'</div>';}
  function rowGroupControl(index,groups=A().groups(current)){
    const g=groups.find(g=>g.row_indices?.includes(index));
    return '<div class="wbRowGroup"><select aria-label="Skupina položky" data-wb-move-row="'+index+'">'+groups.map(x=>'<option value="'+E(x.id)+'"'+(x.id===g?.id?' selected':'')+'>'+E(x.name)+'</option>').join('')+'</select></div>';
  }
  function bindRows(){
    const n=document.getElementById('bomItems');bind(n);
    const panel=document.getElementById('quoteCatalogPanel');
    if(panel){let holder=document.getElementById('wbCatalogGroupSlot');if(!holder){holder=document.createElement('div');holder.id='wbCatalogGroupSlot';panel.prepend(holder);}
      const old=value('wbCatalogGroup');holder.innerHTML=select('Pridať do skupiny','wbCatalogGroup',A().groups(current).filter(g=>g.pricing!=='fixed').map(g=>[g.id,g.name]),old);
    }
  }
  function marginWarning(){const p=state.library.find(x=>x.key==='pricing:company')?.payload;if(p?.min_margin_pct==null)return '';const s=root.SpektraQuoteSummary.calculate(current);return s.margin!=null&&s.margin<Number(p.min_margin_pct)?'Marža '+s.margin.toFixed(1)+' % je pod firemným limitom '+p.min_margin_pct+' %.':'';}
  function catalogItemKind(st){
    const code=String(st?.code||'').trim().toUpperCase();
    const name=String(st?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const known=/^(PR-MONT|PR-MONT-R|PR-POM|PR-SERV|PR-MAR|DOP-KM|DOP-10|DOP-20|DOP-40|PK-MONT|PK-SERV-K|PK-SERV-A|PK-DIAG|PK-SPUST|PK-KASK|TC-SERV-M|TC-SERV-S|TC-DIAG|TC-SPUST-M|TC-SPUST-S|TC-KRIV|KL-MONT-3|KL-METER|KL-SERV|KL-HLB|KL-DIAG|KL-DEM|KL-VAK|KU-CERP|KU-EXP|KU-TERM|KU-SMART|KU-PREPL|KU-INH|RPK1|PRSK|MPEL|MHPS|MK3)$/;
    // POHODA also stores genuine physical products and sets below Služby.
    if(!code.startsWith('SP-')&&!known.test(code))return 'material';
    if(code.startsWith('DOP-')||code.startsWith('SP-DOP-'))return 'transport';
    if(/^(SP-SERV-|SP-CHEM-|SP-DIAG-|SP-VYPOC|SP-POD-UVED|SP-KL-EXT)/.test(code)
       ||/servis|revizia|diagnost|preplach|kontrola/.test(name))return 'service';
    return 'labor';
  }
  async function addCatalog(selected,qty){
    const st=selected&&root.SpektraQuoteMaterials.findStock(root.SpektraQuoteMaterials.reference?root.SpektraQuoteMaterials.reference(selected):{id:selected.id,fingerprint:selected.fingerprint,code:selected.code,plu:selected.plu,storage_ref:selected.storage_ref},stocks);
    if(!st){status('Skladová karta už nie je dostupná. Obnovte vyhľadávanie.',true);return {ok:false};}
    const selectedGroup=value('wbCatalogGroup');
    return mutate('Položka z katalógu bola pridaná.',q=>{
      const groupKind=catalogItemKind(st);
      let group=A().groups(q).find(g=>g.id===selectedGroup&&g.kind===groupKind&&g.pricing!=='fixed')||
        A().groups(q).find(g=>g.kind===groupKind&&g.pricing!=='fixed');
      if(!group)group=A().createGroup(q,{name:groupKind==='material'?'Montážny materiál':labels[groupKind],kind:groupKind});
      const temp={status:'draft',items:[]};root.SpektraQuoteMaterials.add(temp,st,qty,root.SpektraQuoteStorage.uuid());
      A().addRows(q,group.id,temp.items,{origin:'catalog'});
    });
  }
  async function addManual(){
    const kind=value('quoteManualKind'),name=value('quoteManualName'),qty=value('quoteManualQty'),unit=value('quoteManualUnit'),price=value('quoteManualPrice'),cost=value('quoteManualCost');
    const result=await mutate(kind==='text'?'Text bol pridaný.':'Vlastná položka bola pridaná.',q=>{
      const temp={status:'draft',items:[]};root.SpektraQuoteMaterials.addManual(temp,{name,qty,unit,price,cost,textOnly:kind==='text',service:kind==='service'},root.SpektraQuoteStorage.uuid());
      const groupKind=kind==='text'?'text':kind==='service'?'service':'material';
      let group=A().groups(q).find(g=>g.kind===groupKind&&g.pricing!=='fixed');if(!group)group=A().createGroup(q,{name:labels[groupKind],kind:groupKind});
      A().addRows(q,group.id,temp.items,{origin:'manual'});
    });if(result.ok&&!result.stale)resetManualQuoteForm();return result;
  }
  const api={addCatalog,addManual,onOpen,render,tab,action,savedTemplates,changeRow,setRealizationDate,mutate,prepareEdit,beginRevision,quickStart,revisionLabel,rowControls,rowGroupControl,bindRows,marginWarning,priceDialog,loadLibrary,stockLinkDialog};
  root.SpektraQuoteWorkbench=api;
})(typeof window==='object'?window:globalThis);
