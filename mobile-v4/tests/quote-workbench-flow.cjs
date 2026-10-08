/* Real workbench/editor handlers and durable storage, with a small DOM adapter.
 * These tests verify saving/revision semantics; visual layout is checked apart.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../js/quote-assemblies.js'),M=require('../js/quote-materials.js'),S=require('../js/hvac-scenarios.js');
const O=require('../js/quote-workbench-output.js'),Summary=require('../js/quote-list-summary.js'),Storage=require('../js/quote-storage.js');
const RowOutput=require('../js/quote-row-output.js');
const RealizationDate=require('../js/realization-date.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const stock=(extra={})=>({id:'cu-card',fingerprint:'cu-fingerprint',plu:'CU1',code:'CU28',name:'Potrubie Cu28',unit:'m',active:true,sell_price_ex_vat:12,purchase_price_ex_vat:7,...extra});
const quote=(id='original',status='sent')=>({id,quote_no:'CP-'+id,status,category:'heat_pump',system_type:'monoblock',
  customer:{name:'Zákazník '+id,phone:'0900000000',address:'Rajec'},building:{},device:{id:'hp',name:'Zariadenie'},optional_services:{},
  installation_tier:'standard',items:[{role:'device',name:'Zariadenie',qty:1,unit:'ks',price:1000,cost:700,visible:true},
    {role:'pipe',name:'Rozvod v kuchyni',qty:5,unit:'m',price:12,cost:7,pohoda:stock(),pohoda_code:'CU28'},
    {role:'installation_service',name:'Montáž',qty:1,unit:'súb.',price:600,cost:300,work_scope:['Zameranie','Montáž','Skúška'],visible:true}],
  net:1660,vat_pct:23,vat:381.8,total:2041.8,price_complete:true,warranty_consent:{accepted:true,signature_data_url:'data:image/png;base64,QQ=='}});
function functions(names){
  const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8'),all=[...html.matchAll(/^(?:async )?function (\w+)\(/gm)];
  return names.map(name=>{const n=all.findIndex(m=>m[1]===name);assert.ok(n>=0,'Missing '+name);return html.slice(all[n].index,all[n+1]?.index??html.length);}).join('\n');
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function environment(original=quote(),options={}){
  const nodes=new Map(),local=new Map(),calls={sends:[],alerts:[],errors:[],warnings:[],screen:null,quotePersists:0,final:0,stockReads:0,pdfSnapshots:[],pdfUrls:[],pdfClosed:0};
  let anon=0;
  function makeNode(id){
    const classes=new Set(),attrs=new Map(),listeners={};
    const n={id,value:'',checked:false,disabled:false,textContent:'',innerHTML:'',dataset:{},style:{},listeners,children:[],parentElement:null,
      classList:{add(...values){values.forEach(x=>classes.add(x));if(values.includes('on'))calls.screen=n.id;},remove(...values){values.forEach(x=>classes.delete(x));},toggle(name,value){const add=value===undefined?!classes.has(name):value;if(add)classes.add(name);else classes.delete(name);return add;},contains:name=>classes.has(name)},
      appendChild(child){child.parentElement=n;n.children.push(child);if(child.id)nodes.set(child.id,child);return child;},prepend(child){return n.appendChild(child);},
      replaceChildren(...children){n.children=children;},remove(){if(n.id)nodes.delete(n.id);},contains(child){return n===child||n.children.includes(child);},
      addEventListener(name,handler){listeners[name]=handler;},setAttribute(key,value){attrs.set(key,String(value));if(options.pdf&&key==='data-pdf-render'){n.firstElementChild=makeNode('pdf-root');n.children=[n.firstElementChild];}},removeAttribute(key){attrs.delete(key);},getAttribute:key=>attrs.get(key)??null,
      querySelector(){return null;},querySelectorAll(){return [];},closest(){return null;},focus(){},click(){}};
    return n;
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,makeNode(id));return nodes.get(id);};
  const doc={getElementById:node,createElement:()=>makeNode('anonymous-'+(++anon)),activeElement:null,
    querySelector(selector){
      if(selector.includes('[aria-invalid="true"]'))return [...nodes.values()].find(n=>n.getAttribute('aria-invalid')==='true')||null;
      const match=selector.match(/^\[data-row-total="(\d+)"\]$/);return match?node('row-total-'+match[1]):null;
    },querySelectorAll(selector){
      if(selector==='.screen')return [];
      const found=selector.match(/^\[data-([a-z-]+)\]$/);if(!found)return [];
      const key=found[1].replace(/-([a-z])/g,(_,x)=>x.toUpperCase());return [...nodes.values()].filter(n=>Object.hasOwn(n.dataset,key));
    }};doc.body=node('body');
  const c=vm.createContext({console:{log:console.log,error:(...args)=>calls.errors.push(args),warn:(...args)=>calls.warnings.push(args)},setTimeout,clearTimeout,document:doc,current:clone(original),quotes:[clone(original),quote('other','draft')],stocks:[stock()],
    SpektraQuoteAssemblies:A,SpektraQuoteMaterials:M,SpektraHvacScenarios:S,SpektraQuoteWorkbenchOutput:O,SpektraQuoteSummary:Summary,SpektraQuoteStorage:Storage,SpektraRealizationDate:RealizationDate,
    localStorage:{getItem:key=>local.get(key)??null,setItem:(key,val)=>local.set(key,String(val))},alert:message=>calls.alerts.push(message),confirm:()=>true,
    esc:x=>String(x??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),eur:x=>x==null?'—':Number(x).toFixed(2)+' €',
    isTradeQuote:()=>false,renderFinal:()=>calls.final++,renderRecommendation(){},renderInternalProfit(){},updateActiveContext(){},scrollTo(){},
    ensurePdfImagesState(){},ensureSubsidyState(){},hydrateQuoteForm(){},renderChoices(){},rebuildStockIndexes(){},printPDF:async()=>{},
    category:original.category,brand:'',boilerType:'gas',acMode:'single',multiCount:2,recommendation:null,
    bundleRecipes:require('../data/bundle-recipes.json'),deviceCatalog:[],
    SpektraDB:{isAuthenticated:()=>true,getUser:()=>({id:'tester'}),listQuoteLibrary:async()=>[],listStocks:async()=>{calls.stockReads++;return options.listStocks?options.listStocks():[stock({sell_price_ex_vat:20,purchase_price_ex_vat:8})];}}
  });c.window=c;
  const storage=Storage.create({getRows:()=>c.quotes,setRows:rows=>{c.quotes=rows;},getCurrent:()=>c.current,authenticated:()=>true,
    persist:()=>calls.quotePersists++,send:async saved=>{
      calls.sends.push(clone(saved));if(options.send)await options.send(saved);
      return {remote_id:saved.remote_id||'remote-'+saved.id,remote_customer_id:'customer',quote_no:saved.remote_id?saved.quote_no:'CP-NEW-'+saved.id,
        sync_version:(saved.sync_version||0)+1,status:saved.status,net:saved.net,vat_pct:saved.vat_pct,total:saved.total,price_complete:saved.price_complete,updated_at:'2026-10-07T20:00:00Z'};
    }});
  c.quoteStorage=()=>storage;
  vm.runInContext(functions(['isQuotePriceLocked','go','recalcQuoteTotalsFromItems','upsertCurrent','openQuote','refreshQuoteFromCatalog']),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/quote-material-editor.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/quote-workbench.js'),'utf8'),c);
  if(options.pdf){
    // Exercise the real printPDF/createPdfFile lifecycle. Only rasterization,
    // assets and document markup are replaced; they are covered by PDF tests.
    c.SpektraQuoteRowOutput=RowOutput;
    c.html2canvas=async()=>({});c.jspdf={jsPDF:function(){}};
    c.inlineImagesForPdf=async()=>{};
    c.offerHtml=()=>{calls.pdfSnapshots.push(clone(c.current));return '<div>PDF test page</div>';};
    c.SpektraPdfPagination={waitForAssets:async()=>{},prepare:()=>({pages:[makeNode('pdf-page')],dispose(){}}),
      render:async()=>({internal:{getNumberOfPages:()=>1},output:()=>new Blob(['PDF test'])})};
    c.File=require('node:buffer').File;
    c.URL={createObjectURL:()=>{const url='blob:test-'+(calls.pdfUrls.length+1);calls.pdfUrls.push(url);return url;},revokeObjectURL(){}};
    c.open=()=>({document:{title:'',body:{style:{},textContent:''}},location:{replace(){}},close(){calls.pdfClosed++;}});
    c.setTimeout=(fn,ms)=>ms>=1000?0:setTimeout(fn,ms);
    vm.runInContext(functions(['createPdfFile','printPDF']),c);
  }
  const active=()=>vm.runInContext('quoteRowsEditorActive',c);
  const fill=values=>{const ids={name:'quoteManualName',kind:'quoteManualKind',qty:'quoteManualQty',unit:'quoteManualUnit',price:'quoteManualPrice',cost:'quoteManualCost'};for(const [key,val]of Object.entries(values))node(ids[key]||key).value=String(val);};
  const open=async id=>{c.openQuote(id||original.id);await new Promise(setImmediate);};
  const confirm=async()=>c.SpektraQuoteWorkbench.action('confirm-dialog',makeNode('confirm'));
  const change=async target=>node('quoteWorkbench').listeners.change({target});
  return {c,calls,node,nodes,open,active,fill,confirm,change,api:c.SpektraQuoteWorkbench};
}

test('opening sent quote renders workbench without initializing, recalculating or saving original snapshot',async()=>{
  const original=quote(),{c,calls,open,active}=environment(original);await open();
  assert.equal(active(),true);assert.equal(calls.screen,'quoteRows');assert.equal(calls.sends.length,0);
  assert.equal(c.current.material_edits,undefined);assert.deepEqual(clone(c.current.items),original.items);assert.equal(c.current.total,original.total);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
});
test('first valid row edit makes a new revision and next edits save the same draft without touching issued original',async()=>{
  const original=quote(),{c,calls,open}=environment(original);await open();
  const result=await c.setQuoteItemField(1,'qty','7,5');assert.equal(result.ok,true);
  const id=c.current.id;assert.notEqual(id,original.id);assert.equal(c.current.status,'draft');assert.equal(c.current.material_edits.assemblies.revision.number,2);
  assert.equal(c.current.material_edits.assemblies.revision.root_quote_no,original.quote_no);assert.equal(c.current.warranty_consent,undefined);
  assert.equal(c.current.items[1].qty,7.5);assert.equal(c.current.net,1690);assert.equal(c.current.total,2078.7);
  await c.setQuoteItemField(1,'name','Upravený rozvod');assert.equal(c.current.id,id);assert.equal(calls.sends.length,2);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);assert.equal(c.quotes.filter(q=>q.material_edits?.assemblies?.revision).length,1);
});
test('invalid first edit creates no revision, removes no consent and queues no save',async()=>{
  const original=quote(),{c,calls,open,node}=environment(original);await open();const before=clone(c.current);
  const input=node('invalid-price');const result=await c.setQuoteItemField(1,'price','-1',input);
  assert.equal(result.ok,false);assert.equal(input.getAttribute('aria-invalid'),'true');assert.deepEqual(clone(c.current),before);
  assert.equal(calls.sends.length,0);assert.equal(c.quotes.length,2);
});
test('realization date edit persists in a new revision while issued quotes and every billed value stay intact',async()=>{
  const billed=q=>(q.items||[]).map(i=>[i.name,i.qty,i.unit,i.price,i.cost]);
  for(const status of ['sent','approved']){
    const original={...quote('date-'+status,status),estimated_realization_date:'2026-10-20'};
    const {c,calls,open,api,node}=environment(original);await open();
    const result=await api.setRealizationDate('2026-11-03',node('quoteEstimatedRealizationDate'));
    assert.equal(result.ok,true);assert.notEqual(c.current.id,original.id);assert.equal(c.current.status,'draft');
    assert.equal(c.current.material_edits.assemblies.revision.number,2);assert.equal(c.current.estimated_realization_date,'2026-11-03');
    assert.deepEqual(billed(c.current),billed(original));assert.equal(c.current.net,original.net);assert.equal(c.current.total,original.total);
    assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);assert.equal(calls.sends.length,1);
    assert.equal(calls.sends[0].estimated_realization_date,'2026-11-03');
    const revisionId=c.current.id;await open('other');await open(revisionId);
    assert.equal(c.current.estimated_realization_date,'2026-11-03');assert.equal(node('quoteEstimatedRealizationDate').value,'2026-11-03');
  }
});
test('invalid or unchanged realization date creates no revision and does not clear consent or save',async()=>{
  const original={...quote(),estimated_realization_date:'2026-10-20'}, {c,calls,open,api,node}=environment(original);await open();
  const input=node('quoteEstimatedRealizationDate'),before=clone(c.current);
  assert.equal((await api.setRealizationDate('2026-02-30',input)).ok,false);assert.equal(input.getAttribute('aria-invalid'),'true');
  input.validity={badInput:true};assert.equal((await api.setRealizationDate('',input)).ok,false);delete input.validity;
  assert.equal((await api.setRealizationDate('2026-10-20',input)).unchanged,true);assert.equal(input.getAttribute('aria-invalid'),null);
  assert.deepEqual(clone(c.current),before);assert.equal(calls.sends.length,0);assert.equal(c.quotes.length,2);
  const empty=environment(quote('empty-date','draft'));await empty.open();
  assert.equal((await empty.api.setRealizationDate('')).unchanged,true);assert.equal(empty.calls.sends.length,0);
});
test('clearing and undoing realization date retains the draft and survives reopening',async()=>{
  const original={...quote('date-draft','draft'),estimated_realization_date:'2026-10-20'}, {c,calls,open,api,node}=environment(original);await open();
  const result=await api.setRealizationDate('',node('quoteEstimatedRealizationDate'));assert.equal(result.ok,true);
  assert.equal(c.current.id,original.id);assert.equal(c.current.estimated_realization_date,'');assert.equal(calls.sends.at(-1).estimated_realization_date,'');
  await api.action('undo');assert.equal(c.current.estimated_realization_date,'2026-10-20');assert.equal(c.current.id,original.id);
  await api.setRealizationDate('');await open('other');await open(original.id);
  assert.equal(c.current.estimated_realization_date,'');assert.equal(node('quoteEstimatedRealizationDate').value,'');
});
test('quick quote start saves realization date as quote data separate from the contact',async()=>{
  const original=quote('quick-date','draft'),{c,calls,fill,api,node}=environment(original);
  fill({cName:'Nový zákazník',cPhone:'0900000000',cAddress:'Rajec'});
  const before=clone(c.current),dateInput=node('cEstimatedRealizationDate');dateInput.validity={badInput:true};
  await api.quickStart();assert.deepEqual(clone(c.current),before);assert.equal(calls.sends.length,0);
  delete dateInput.validity;dateInput.value='2026-12-02';
  await api.quickStart();assert.equal(c.current.estimated_realization_date,'2026-12-02');
  assert.equal(node('quoteEstimatedRealizationDate').value,'2026-12-02');assert.equal(calls.sends.at(-1).estimated_realization_date,'2026-12-02');
  assert.equal(Object.hasOwn(c.current.customer,'estimated_realization_date'),false);
});
test('approved offer opens original final view and explicit edit creates an independent revision',async()=>{
  const original=quote('approved','approved'),{c,calls,open}=environment(original);await open();
  assert.equal(calls.screen,'step5');assert.equal(calls.sends.length,0);
  await c.copyQuoteForEditing();assert.equal(c.current.status,'draft');assert.equal(calls.screen,'quoteRows');
  assert.equal(c.current.material_edits.assemblies.revision.number,2);assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
});
test('manual and catalog editor entry points create revisions, retain catalog IDs and preserve blank costs',async()=>{
  const original=quote(),{c,open,fill}=environment(original);await open();
  fill({kind:'material',name:'Dodatočný materiál',qty:'2,5',unit:'m',price:'10',cost:''});const manual=await c.addManualQuoteItem();assert.equal(manual.ok,true);
  const id=c.current.id;assert.equal(c.current.items.at(-1).cost,null);assert.equal(c.current.items.at(-1).qty,2.5);
  fill({kind:'text',name:'Termín podľa dohody',qty:'',unit:'',price:'',cost:''});await c.addManualQuoteItem();assert.equal(M.isText(c.current.items.at(-1)),true);
  const st=stock({id:'valve',fingerprint:'fp-valve',code:'V1',name:'Ventil',unit:'ks'});c.stocks.push(st);
  const added=await c.SpektraQuoteWorkbench.addCatalog(st,'3');assert.equal(added.ok,true);assert.equal(c.current.id,id);
  assert.equal(A.catalogReference(c.current.items.at(-1)).id,'valve');assert.equal(c.current.items.at(-1).qty,3);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
});
test('output controls independently change presentation with a revision while preserving all billed totals',async()=>{
  const original=quote(),{c,open,change}=environment(original);await open();
  await change({dataset:{wbOutput:'material'},value:'detail',type:'select-one'});const id=c.current.id;
  await change({dataset:{wbOutput:'labor'},value:'contents',type:'select-one'});
  await change({dataset:{wbOutput:'appendix'},checked:true,type:'checkbox'});
  assert.equal(c.current.id,id);assert.deepEqual(A.outputSettings(c.current),{material:'detail',labor:'contents',appendix:true});
  assert.equal(c.current.net,original.net);assert.equal(c.current.total,original.total);assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
});
test('price preview is read-only until confirmation and then refreshes the new revision preserving names',async()=>{
  const original=quote(),{c,calls,open,api,confirm,node}=environment(original);await open();
  await api.priceDialog();assert.equal(c.current.id,original.id);assert.equal(calls.sends.length,0);
  node('wbOverrideManual').checked=false;await confirm();assert.notEqual(c.current.id,original.id);assert.equal(c.current.items[1].price,20);
  assert.equal(c.current.items[1].cost,8);assert.equal(c.current.items[1].name,'Rozvod v kuchyni');assert.equal(calls.stockReads,1);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
});
test('legacy catalog-add handler forwards to workbench and validates its exact selected card before revision',async()=>{
  const original=quote(),{c,calls,open,node}=environment(original);await open();
  const selected=stock({id:'valve',fingerprint:'fp-valve',code:'V1',name:'Ventil',unit:'ks'});c.selectedTestStock=selected;c.stocks.push(selected);
  vm.runInContext('quoteMaterialSearchOwner=current.id;quoteMaterialSearchRows=[selectedTestStock]',c);node('quoteMaterialAddQty').value='2,5';
  const result=await c.addQuoteMaterialFromStock(0);assert.equal(result.ok,true);assert.notEqual(c.current.id,original.id);
  assert.equal(c.current.items.at(-1).qty,2.5);assert.equal(A.catalogReference(c.current.items.at(-1)).id,'valve');assert.equal(calls.sends.length,1);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
  const invalid=environment(original);await invalid.open();invalid.c.selectedTestStock=selected;
  vm.runInContext('quoteMaterialSearchOwner=current.id;quoteMaterialSearchRows=[selectedTestStock]',invalid.c);invalid.node('quoteMaterialAddQty').value='1';
  const rejected=await invalid.c.addQuoteMaterialFromStock(0);assert.equal(rejected.ok,false);assert.equal(invalid.c.current.id,original.id);assert.equal(invalid.calls.sends.length,0);
});
test('old price refresh button enters preview for sent and approved offers and creates revision only on confirmation',async()=>{
  for(const status of ['sent','approved']){
    const original=quote('legacy-'+status,status),{c,calls,open,confirm}=environment(original);await open();
    await c.refreshQuoteFromCatalog();assert.equal(c.current.id,original.id);assert.equal(calls.sends.length,0);assert.equal(calls.stockReads,1);
    assert.equal(c.current.items[1].price,12);await confirm();assert.notEqual(c.current.id,original.id);assert.equal(c.current.items[1].price,20);
    assert.equal(c.current.material_edits.assemblies.revision.number,2);assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
  }
});
test('price preview applies missing catalog prices as unknown in new draft without changing issued figures',async()=>{
  const original=quote(),{c,open,api,confirm}=environment(original,{listStocks:async()=>[stock({sell_price_ex_vat:null,purchase_price_ex_vat:null})]});await open();
  await api.priceDialog();await confirm();assert.equal(c.current.items[1].price,null);assert.equal(c.current.items[1].cost,null);
  assert.equal(c.current.price_complete,false);assert.equal(c.quotes.find(q=>q.id===c.current.id).price_complete,false);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),original);
});
test('undo restores the preceding row snapshot in the same draft and saves through the existing outbox',async()=>{
  const {c,calls,open,api}=environment();await open();await c.setQuoteItemField(1,'qty',9);const id=c.current.id;
  await c.removeQuoteMaterial(1);assert.equal(c.current.items.length,2);
  await api.action('undo');assert.equal(c.current.id,id);assert.equal(c.current.items.length,3);assert.equal(c.current.items[1].qty,9);
  await api.action('undo');assert.equal(c.current.items[1].qty,5);assert.equal(c.current.status,'draft');assert.equal(calls.sends.length,4);
});
test('late row save cannot alter another open quote or its status/inputs',async()=>{
  const gate=deferred(),{c,calls,open,node}=environment(quote(),{send:()=>gate.promise});await open();
  const input=node('old-qty');input.value='8';const pending=c.setQuoteItemField(1,'qty',8,input);await new Promise(setImmediate);
  await open('other');const before=clone(c.current),status=node('wbStatus').textContent,html=node('quoteWorkbench').innerHTML;
  gate.resolve();const result=await pending;
  assert.equal(result.stale,true);assert.deepEqual(clone(c.current),before);assert.equal(node('wbStatus').textContent,status);
  assert.equal(node('quoteWorkbench').innerHTML,html);assert.equal(input.value,'8');assert.equal(calls.sends.length,1);
});
test('catalog lookup completing after quote switch does not open a stale price dialog',async()=>{
  const gate=deferred(),{c,calls,open,api,node}=environment(quote(),{listStocks:()=>gate.promise});await open();
  const pending=api.priceDialog();await open('other');const before=clone(c.current),bodyCount=node('body').children.length;
  gate.resolve([stock({sell_price_ex_vat:99})]);await pending;
  assert.deepEqual(clone(c.current),before);assert.equal(node('body').children.length,bodyCount);assert.equal(calls.sends.length,0);
});
test('callback header edits survive model mutation and are included in the same saved draft',async()=>{
  const {c,open,api}=environment();await open();
  await api.mutate('Kontakt a druh',q=>{A.setField(q,1,'qty',7);q.customer.name='Nové meno';q.category='other';q.building.note='Obhliadka';});
  const saved=c.quotes.find(q=>q.id===c.current.id);assert.equal(saved.customer.name,'Nové meno');assert.equal(saved.category,'other');assert.equal(saved.building.note,'Obhliadka');
  assert.equal(c.current.items[1].qty,7);
});
test('finalizing complete workbench draft persists ready and subsequent row edit preserves issued original as R2',async()=>{
  const original=quote('draft-final','draft'),{c,calls,open}=environment(original);await open();
  const result=await c.quoteRowsToFinal();assert.equal(result.ok,true);assert.equal(c.current.status,'ready');assert.equal(calls.screen,'step5');
  assert.equal(calls.sends.at(-1).status,'ready');const issued=clone(c.quotes.find(q=>q.id===original.id));
  await c.setQuoteItemField(1,'qty',9);assert.notEqual(c.current.id,original.id);assert.equal(c.current.status,'draft');
  assert.equal(c.current.material_edits.assemblies.revision.number,2);assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),issued);
});
test('direct PDF output saves ready before rendering and repeated output of issued version is read-only',async()=>{
  const original=quote('draft-pdf','draft');A.init(original);
  const {c,calls,open,api}=environment(original,{pdf:true});await open();
  await api.action('pdf');assert.equal(c.current.status,'ready');assert.equal(calls.pdfUrls.length,1);assert.equal(calls.pdfSnapshots[0].status,'ready');
  assert.equal(calls.sends.length,1);const issued=clone(c.quotes.find(q=>q.id===original.id));
  await api.action('pdf');assert.equal(calls.pdfUrls.length,2);assert.equal(calls.sends.length,1);assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),issued);
  await c.setQuoteItemField(1,'price',15);assert.notEqual(c.current.id,original.id);assert.equal(c.current.material_edits.assemblies.revision.number,2);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),issued);
});
test('incomplete draft cannot be issued or exported as PDF and remains an editable draft',async()=>{
  const original=quote('draft-missing-price','draft');original.items[1].price=null;original.price_complete=false;A.init(original);
  const {c,calls,open,api}=environment(original,{pdf:true});await open();
  const result=await c.quoteRowsToFinal();assert.equal(result.ok,false);assert.equal(c.current.status,'draft');assert.equal(calls.screen,'quoteRows');
  await api.action('pdf');assert.equal(calls.pdfUrls.length,0);assert.equal(calls.pdfSnapshots.length,0);assert.equal(calls.sends.length,0);
  assert.equal(c.current.status,'draft');assert.ok(calls.alerts.some(message=>message.includes('predajné ceny')));
});
test('changing quote during pre-export save stops PDF rather than rendering another customer',async()=>{
  const original=quote('draft-pending-pdf','draft');A.init(original);const gate=deferred();
  const {c,calls,open,api}=environment(original,{pdf:true,send:()=>gate.promise});await open();
  const pending=api.action('pdf');await new Promise(setImmediate);assert.equal(c.current.status,'ready');
  await open('other');const before=clone(c.current);gate.resolve();await pending;
  assert.deepEqual(clone(c.current),before);assert.equal(calls.pdfUrls.length,0);assert.equal(calls.pdfSnapshots.length,0);assert.equal(calls.pdfClosed,1);
});
test('failed issue save stops export and a retry completes the staged ready snapshot before PDF',async()=>{
  const original=quote('draft-failed-pdf','draft');A.init(original);let fail=true;
  const {c,calls,open,api}=environment(original,{pdf:true,send:async()=>{if(fail)throw new Error('Uloženie sa nepotvrdilo');}});await open();
  await api.action('pdf');assert.equal(calls.pdfUrls.length,0);assert.equal(calls.pdfSnapshots.length,0);assert.equal(c.current.status,'ready');
  const pending=c.quotes.find(q=>q.id===original.id);assert.equal(pending._outbox.snapshot.status,'ready');assert.equal(pending._dirty,true);
  fail=false;await api.action('pdf');assert.equal(calls.pdfUrls.length,1);assert.equal(calls.pdfSnapshots[0].status,'ready');assert.equal(c.current._dirty,false);
  assert.equal(c.current._server_status,'ready');assert.equal(c.current.id,original.id);
});
test('undo after issuing creates R2 instead of overwriting the issued version',async()=>{
  const original=quote('draft-undo','draft'),{c,open,api}=environment(original);await open();
  await c.setQuoteItemField(1,'qty',9);assert.equal(c.current.id,original.id);
  const result=await c.prepareQuoteRowsForIssue();assert.equal(result.ok,true);const issued=clone(c.quotes.find(q=>q.id===original.id));assert.equal(issued.status,'ready');
  await api.action('undo');assert.notEqual(c.current.id,original.id);assert.equal(c.current.status,'draft');assert.equal(c.current.items[1].qty,5);
  assert.equal(c.current.material_edits.assemblies.revision.number,2);assert.equal(c.current.material_edits.assemblies.revision.root_quote_no,issued.quote_no);
  assert.deepEqual(clone(c.quotes.find(q=>q.id===original.id)),issued);
});
