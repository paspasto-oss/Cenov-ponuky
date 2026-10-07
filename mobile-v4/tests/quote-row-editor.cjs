// Behavioral coverage of the row UI, saved-offer routing and durable quote outbox.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('../js/quote-materials.js');
const Storage=require('../js/quote-storage.js');
const Summary=require('../js/quote-list-summary.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const stock=(values={})=>({id:'stock-pipe',fingerprint:'fp-pipe',plu:'PLU-pipe',code:'CU28',
 name:'Medené potrubie 28 mm',unit:'m',active:true,sell_price_ex_vat:12,purchase_price_ex_vat:7,...values});
function quote(id='offer-A',status='sent'){
 return {id,quote_no:'CP-'+id,status,category:'heat_pump',system_type:'monoblock',
  customer:{name:'Zákazník '+id,address:'Rajec'},building:{},device:{id:'device-1',brand:'Midea',model:'Pôvodný model'},
  optional_services:{annual_service:false},installation_tier:'standard',
  items:[{role:'device',name:'Uložené zariadenie',qty:1,unit:'ks',price:1200,cost:800,visible:true},
   {role:'pipe',name:'Uložené potrubie',qty:5,unit:'m',price:12,cost:7,pohoda:stock(),pohoda_code:'CU28',visible:false},
   {role:'installation_service',name:'Uložená montáž',qty:1,unit:'súb.',price:600,cost:300,visible:true}],
  net:1860,vat_pct:23,vat:427.8,total:2287.8,price_complete:true,
  warranty_consent:{accepted:true,offer_key:'saved-signature',signature_data_url:'data:image/png;base64,QQ=='}};
}
function appFunctions(names){
 const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
 const declarations=[...html.matchAll(/^(?:async )?function (\w+)\(/gm)];
 return names.map(name=>{
  const index=declarations.findIndex(m=>m[1]===name);assert.ok(index>=0,'Missing function '+name);
  return html.slice(declarations[index].index,declarations[index+1]?.index??html.length);
 }).join('\n');
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function environment(q=quote(),options={}){
 const nodes=new Map();
 const calls={sends:[],alerts:[],statuses:[],renders:0,finalRenders:0,repairs:0,builds:0,hydrations:0,fetches:0,screen:null,persists:0};
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',checked:false,disabled:false,dataset:{},
   classList:{add(...classes){if(classes.includes('on'))calls.screen=id},remove(){},toggle(){}},replaceChildren(){},appendChild(){},setAttribute(){},removeAttribute(){},
   querySelector(){return null},querySelectorAll(){return []},focus(){}});
  return nodes.get(id);
 };
 const c=vm.createContext({current:clone(q),quotes:[clone(q),quote('offer-B')],console,
  document:{getElementById:node,querySelector:()=>null,querySelectorAll:()=>[],activeElement:null},
  SpektraQuoteMaterials:M,SpektraQuoteStorage:Storage,SpektraQuoteSummary:Summary,stocks:[stock()],
  alert:m=>calls.alerts.push(m),confirm:()=>true,setTimeout,clearTimeout,
  esc:x=>String(x??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),
  customerText:x=>String(x??''),eur:x=>x==null?'—':String(x)+' €',
  renderFinal:()=>calls.finalRenders++,renderRecommendation:()=>calls.renders++,renderInternalProfit(){},syncSubsidyUI(){},
  isTradeQuote:()=>false,ensurePdfImagesState(){},ensureSubsidyState(){},updateActiveContext(){},toggleLoss(){},
  hydrateQuoteForm:()=>calls.hydrations++,renderChoices(){},rebuildStockIndexes(){},updateCatalogStateText(){},
  refreshDeviceCatalogFromStocks(){},scrollTo(){},category:q.category,brand:'Midea',boilerType:'gas',acMode:'single',multiCount:2,
  recommendation:clone(q.device),bundleRecipes:[],deviceCatalog:[],staticDeviceCatalog:[],stockByCodeMap:new Map(),norm:x=>String(x).toLowerCase(),
  SpektraDB:{isAuthenticated:()=>true,listStocks:async()=>{calls.fetches++;return options.listStocks?options.listStocks():[stock({sell_price_ex_vat:20,purchase_price_ex_vat:8})]}},
  fetch:async()=>{throw Error('Row refresh must not fetch replacement device recipes')}
 });
 c.window=c;
 const storage=Storage.create({getRows:()=>c.quotes,setRows:rows=>{c.quotes=rows},getCurrent:()=>c.current,
  authenticated:()=>true,persist:()=>calls.persists++,send:async saved=>{
   calls.sends.push(clone(saved));if(options.send)await options.send(saved);
   return {remote_id:'remote-'+saved.id,remote_customer_id:'customer-'+saved.id,quote_no:saved.quote_no,
    sync_version:(saved.sync_version||0)+1,status:saved.status,net:saved.net,vat_pct:saved.vat_pct,total:saved.total,
    price_complete:saved.price_complete,updated_at:'2026-10-07T17:30:00Z'};
  }});
 c.quoteStorage=()=>storage;
 vm.runInContext(appFunctions(['isQuotePriceLocked','go','startWizard','recalcQuoteTotalsFromItems','upsertCurrent','openQuote',
  'buildBOM','ensureHeatPumpInstallationItem','refreshQuoteFromCatalog']),c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/quote-material-editor.js'),'utf8'),c);
 // Layout is checked in the browser. Keep the production handlers, totals and
 // persistence here, and replace only the expensive full-row rendering.
 c.renderQuoteMaterialEditor=()=>calls.renders++;
 const repair=c.ensureHeatPumpInstallationItem,build=c.buildBOM,setStatus=c.setQuoteMaterialStatus;
 c.ensureHeatPumpInstallationItem=(...args)=>{calls.repairs++;return repair(...args)};
 c.buildBOM=(...args)=>{calls.builds++;return build(...args)};
 c.setQuoteMaterialStatus=(message,...args)=>{calls.statuses.push({id:c.current?.id,message});return setStatus(message,...args)};
 const active=value=>value===undefined?vm.runInContext('quoteRowsEditorActive',c):vm.runInContext('quoteRowsEditorActive='+!!value,c);
 const fill=values=>{
  const fields={kind:'quoteManualKind',name:'quoteManualName',qty:'quoteManualQty',unit:'quoteManualUnit',price:'quoteManualPrice',cost:'quoteManualCost'};
  for(const [field,value] of Object.entries(values))node(fields[field]).value=String(value);
 };
 return {c,calls,node,nodes,active,fill};
}

test('opening a saved issued offer shows rows without repairing, recalculating or saving its snapshot',()=>{
 const original=quote();original.items.splice(2,1);original.net=1260;original.total=1549.8;original.vat=289.8;
 const {c,calls,active}=environment(original);c.openQuote(original.id);
 assert.equal(calls.screen,'quoteRows');assert.equal(active(),true);assert.equal(calls.repairs,0);assert.equal(calls.builds,0);
 assert.equal(calls.hydrations,0);assert.equal(calls.sends.length,0);assert.equal(calls.persists,0);
 assert.deepEqual(clone(c.current.items),original.items);assert.equal(c.current.total,original.total);assert.equal(c.current.net,original.net);
 assert.equal(M.rowsMode(c.current),false);assert.deepEqual(clone(c.current.warranty_consent),original.warranty_consent);
});
test('saved offers with an intentionally empty item list still open directly in the row editor',()=>{
 const q=quote();q.items=[];q.net=0;q.total=0;q.vat=0;q.price_complete=false;
 const {c,calls}=environment(q);c.openQuote(q.id);
 assert.equal(calls.screen,'quoteRows');assert.equal(c.current.items.length,0);assert.equal(calls.builds,0);assert.equal(calls.sends.length,0);
});
test('starting a new quote after row editing restores the ordinary wizard',()=>{
 const {c,calls,active}=environment();active(true);M.enableRows(c.current);const originalId=c.current.id;
 c.startWizard();assert.equal(active(),false);assert.equal(calls.screen,'step1');assert.notEqual(c.current.id,originalId);
 assert.equal(c.current.status,'draft');assert.equal(M.rowsMode(c.current),false);assert.equal(c.current.items.length,0);
});
test('row field edits accept SK decimals, preserve blank cost and persist without downgrading sent status',async()=>{
 const {c,calls,active}=environment();active(true);
 await c.setQuoteItemField(1,'name','Potrubie pre kuchyňu');await c.setQuoteItemField(1,'unit','bal.');
 await c.setQuoteItemField(1,'qty','2,5');await c.setQuoteItemField(1,'price','9,95');await c.setQuoteItemField(1,'cost','');
 const row=c.current.items[1],saved=c.quotes.find(q=>q.id===c.current.id);
 assert.equal(row.name,'Potrubie pre kuchyňu');assert.equal(row.unit,'bal.');assert.equal(row.qty,2.5);assert.equal(row.price,9.95);
 assert.equal(row.cost,null);assert.equal(row.cost_override,true);assert.equal(M.rowsMode(c.current),true);
 assert.equal(c.current.status,'sent');assert.equal(saved.status,'sent');assert.equal(c.current.warranty_consent,undefined);
 assert.equal(saved.items[1].cost,null);assert.ok(calls.sends.every(q=>q.status==='sent'));
 assert.ok(Math.abs(c.current.net-1824.875)<0.000001);
});
test('invalid row input never enables snapshot mode, removes consent or queues a save',async()=>{
 const {c,calls,active}=environment();active(true);const before=clone(c.current);
 for(const [field,value] of [['qty','-2'],['price','100000000'],['price','1.12345'],['name',' '],['unit','']]){
  await c.setQuoteItemField(1,field,value);assert.deepEqual(clone(c.current),before);
 }
 assert.equal(M.rowsMode(c.current),false);assert.equal(calls.sends.length,0);assert.equal(calls.persists,0);
});
test('approved offers, including stale locally sent copies, reject row mutations',async()=>{
 for(const flags of [{status:'approved'},{status:'sent',_server_status:'approved'}]){
  const q=Object.assign(quote(),flags),{c,calls,active,fill}=environment(q);active(true);const before=clone(c.current);
  await c.setQuoteItemField(0,'name','Nové zariadenie');await c.removeQuoteMaterial(0);
  fill({kind:'text',name:'Nesmie sa pridať',qty:1,unit:'ks',price:0,cost:0});await c.addManualQuoteItem();
  assert.deepEqual(clone(c.current),before);assert.equal(calls.sends.length,0);assert.equal(calls.persists,0);
 }
});
test('copying an approved offer creates an independently saved editable draft and preserves its original',async()=>{
 const original=quote('approved-original','approved');Object.assign(original,{remote_id:'remote-original',remote_customer_id:'customer-original',
  sync_version:8,_server_status:'approved',_server_quote_no:true,_conflict:true,issued_on:'2026-10-01',valid_until:'2026-10-15'});
 const {c,calls,active}=environment(original),before=clone(c.quotes.find(q=>q.id===original.id));
 await c.copyQuoteForEditing();const draft=c.current,request=calls.sends[0];
 assert.notEqual(draft.id,original.id);assert.equal(draft.status,'draft');assert.equal(active(),true);assert.equal(calls.screen,'quoteRows');
 assert.equal(M.rowsMode(draft),true);assert.equal(draft.warranty_consent,undefined);assert.deepEqual(clone(draft.items),original.items);
 assert.equal(request.remote_id,undefined);assert.equal(request.remote_customer_id,undefined);assert.equal(request.sync_version,undefined);
 assert.equal(request._server_status,undefined);assert.equal(request._conflict,undefined);assert.equal(request.issued_on,undefined);assert.equal(request.valid_until,undefined);
 assert.notEqual(request.quote_no,original.quote_no);assert.equal(calls.sends.length,1);assert.equal(request.status,'draft');
 assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),before);
 await c.setQuoteItemField(0,'name','Nové zariadenie v kópii');
 assert.equal(c.quotes.find(q=>q.id===original.id).items[0].name,original.items[0].name);
 assert.equal(c.quotes.find(q=>q.id===draft.id).items[0].name,'Nové zariadenie v kópii');
});
test('manual form creates material, labor and text with the correct independent financial meaning',async()=>{
 const {c,calls,active,fill}=environment();active(true);
 fill({kind:'material',name:'Doplnkový materiál',qty:'2',unit:'ks',price:'',cost:''});await c.addManualQuoteItem();
 fill({kind:'service',name:'Dodatočná práca',qty:'2,5',unit:'hod',price:'25',cost:'10'});await c.addManualQuoteItem();
 fill({kind:'text',name:'Termín dohodneme telefonicky.',qty:'',unit:'',price:'',cost:''});await c.addManualQuoteItem();
 const [material,labor,note]=c.current.items.slice(3);
 assert.equal(material.role,'quote_manual');assert.equal(material.price,null);assert.equal(material.cost,null);
 assert.equal(labor.role,'quote_manual_service');assert.equal(labor.qty,2.5);assert.equal(labor.price,25);
 assert.equal(M.isText(note),true);assert.equal(note.price,0);assert.equal(note.cost,0);assert.equal(note.cost_override,true);
 assert.ok([material,labor,note].every(i=>i.visible===true));assert.equal(c.current.status,'sent');
 assert.equal(new Set([material,labor,note].map(i=>i.stored_metadata.quote_material.id)).size,3);
 assert.equal(calls.sends.length,3);
});
test('the first catalog addition from an issued row editor is visible and keeps its exact stock card',async()=>{
 const {c,active,node}=environment();active(true);
 const selected=stock({id:'valve',fingerprint:'fp-valve',plu:'PLU-valve',code:'V1',name:'Ventil',unit:'ks'});
 c.stocks.push(selected);c.selectedTestStock=selected;
 vm.runInContext('quoteMaterialSearchOwner=current.id;quoteMaterialSearchRows=[selectedTestStock]',c);
 node('quoteMaterialAddQty').value='2,5';await c.addQuoteMaterialFromStock(0);
 const added=c.current.items.at(-1);assert.equal(added.name,'Ventil');assert.equal(added.qty,2.5);assert.equal(added.visible,true);
 assert.equal(added.pohoda.id,'valve');assert.equal(M.rowsMode(c.current),true);assert.equal(c.current.status,'sent');
});
test('deleting installation through rows persists and neither PDF repair nor BOM rebuild restores it',async()=>{
 const {c,active}=environment();active(true);await c.removeQuoteMaterial(2);
 assert.equal(M.rowsMode(c.current),true);assert.equal(c.current.items.length,2);
 assert.equal(c.ensureHeatPumpInstallationItem(),false);c.buildBOM();
 assert.equal(c.current.items.length,2);assert.equal(c.quotes.find(q=>q.id===c.current.id).items.length,2);
});
test('explicit row save and final preview retain issued status',async()=>{
 const {c,calls,active}=environment();active(true);await c.saveQuoteRows();
 assert.equal(c.current.status,'sent');assert.equal(calls.sends.at(-1).status,'sent');
 await c.quoteRowsToFinal();assert.equal(c.current.status,'sent');assert.equal(calls.sends.at(-1).status,'sent');
 assert.equal(calls.screen,'step5');
});
test('row price refresh updates exact existing cards without replacing items or choosing a different device',async()=>{
 const {c,calls,active}=environment();active(true);
 const before=clone(c.current);await c.refreshQuoteFromCatalog();
 assert.deepEqual(clone(c.current.device),before.device);assert.equal(c.current.items.length,before.items.length);
 assert.equal(c.current.items[1].name,before.items[1].name);assert.equal(c.current.items[1].qty,5);assert.equal(c.current.items[1].price,20);
 assert.equal(c.current.items[1].cost,8);assert.equal(c.current.items[0].price,1200);assert.equal(c.current.items[2].price,600);
 assert.equal(calls.builds,0);assert.equal(calls.sends.at(-1).status,'sent');
});
test('completion of an older row save cannot overwrite the newly opened offer or its save message',async()=>{
 const gate=deferred(),{c,calls,active}=environment(quote(),{send:()=>gate.promise});active(true);
 const pending=c.setQuoteItemField(0,'qty','2');await new Promise(setImmediate);
 c.openQuote('offer-B');const before=clone(c.current),messages=calls.statuses.length;gate.resolve();await pending;
 assert.equal(c.current.id,'offer-B');assert.deepEqual(clone(c.current),before);assert.equal(calls.statuses.length,messages);
 const savedA=c.quotes.find(q=>q.id==='offer-A');assert.equal(savedA.items[0].qty,2);assert.equal(savedA.remote_id,'remote-offer-A');
});
test('late final-preview save for offer A cannot navigate offer B away from its editor',async()=>{
 const gate=deferred(),{c,calls,active}=environment(quote(),{send:()=>gate.promise});active(true);
 const pending=c.quoteRowsToFinal();await new Promise(setImmediate);
 c.openQuote('offer-B');const before=clone(c.current);gate.resolve();await pending;
 assert.equal(calls.screen,'quoteRows');assert.equal(c.current.id,'offer-B');assert.deepEqual(clone(c.current),before);
});
test('a catalog response requested for offer A cannot refresh or save offer B after switching offers',async()=>{
 const gate=deferred(),{c,calls,active}=environment(quote(),{listStocks:()=>gate.promise});active(true);
 const pending=c.refreshQuoteFromCatalog();await new Promise(setImmediate);
 c.openQuote('offer-B');const before=clone(c.current);gate.resolve([stock({sell_price_ex_vat:999})]);await pending;
 assert.equal(c.current.id,'offer-B');assert.deepEqual(clone(c.current),before);assert.equal(calls.sends.length,0);
 assert.equal(calls.screen,'quoteRows');
});
