const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../js/quote-assemblies.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const stock=(extra={})=>({id:'stock-cu',fingerprint:'fp-cu',plu:'CU1',code:'CU28',storage_ref:'main',pohoda_stock_id:42,
  name:'Potrubie Cu 28',unit:'m',active:true,sell_price_ex_vat:12,purchase_price_ex_vat:7,...extra});
const quote=(extra={})=>({id:'quote-a',quote_no:'CP-2026-001',status:'draft',customer:{name:'Zákazník'},inspection_id:'inspection-1',
  items:[{role:'device',name:'Zariadenie',qty:1,unit:'ks',price:1000,cost:700},
    {role:'pipe',name:'Potrubie pre zákazníka',qty:5,unit:'m',price:12,cost:7,pohoda:stock()},
    {role:'installation_service',name:'Montáž',qty:1,unit:'súb.',price:600,cost:300,work_scope:['Zameranie','Osadenie','Montáž','Skúška']}],
  warranty_consent:{accepted:true,signature_data_url:'data:image/png;base64,QQ=='},...extra});
const total=q=>q.items.reduce((sum,row)=>sum+(Number(row.price)||0)*Number(row.qty),0);
const group=(q,kind)=>A.groups(q).find(g=>g.kind===kind);
const row=(q,kind)=>group(q,kind).rows[0];

test('read helpers deterministically inspect a legacy approved quote without changing any saved byte',()=>{
  const q=quote({status:'approved'}),before=JSON.stringify(q);
  const first=A.groups(q),second=A.groups(q);
  assert.deepEqual(first,second);assert.equal(first.length,3);assert.equal(first[2].pricing,'fixed');
  assert.deepEqual(first[2].contents.map(x=>x.name),q.items[2].work_scope);
  assert.equal(JSON.stringify(q),before);assert.equal(A.outputSettings(q).material,'summary');
  assert.throws(()=>A.init(q));assert.equal(JSON.stringify(q),before);
});
test('init persists stable identity alongside existing journals, names and catalog references',()=>{
  const q=quote({material_edits:{version:1,scopes:{old:{removed:['key']}},pdf_detail:true}});
  A.init(q);const ids=q.items.map(A.rowId),ref=A.catalogReference(q.items[1]);
  const reloaded=clone(q);A.init(reloaded);
  assert.deepEqual(reloaded.items.map(A.rowId),ids);assert.deepEqual(ref,A.reference(stock()));
  assert.deepEqual(reloaded.material_edits.scopes.old.removed,['key']);assert.equal(A.outputSettings(q).material,'detail');
  assert.equal(q.material_edits.rows_mode,true);assert.equal(q.items[1].name,'Potrubie pre zákazníka');
});
test('an unidentified inserted row cannot steal an existing persisted row identity',()=>{
  const q=quote();A.init(q);const saved=q.items[0],id=A.rowId(saved);
  q.items.unshift({role:'quote_text',name:'Poznámka',qty:1,unit:'ks',price:0,cost:0,cost_override:true});A.init(q);
  assert.equal(A.rowId(q.items[1]),id);assert.notEqual(A.rowId(q.items[0]),id);
});
test('grouping and all independent output settings leave canonical billed totals unchanged',()=>{
  const q=quote();const before=total(q),prices=q.items.map(i=>i.price);
  for(const material of ['summary','contents','detail'])for(const labor of ['summary','contents','detail'])for(const appendix of [false,true]){
    A.setOutput(q,{material,labor,appendix});assert.equal(total(q),before);assert.deepEqual(q.items.map(i=>i.price),prices);
    assert.deepEqual(A.outputSettings(q),{material,labor,appendix});
  }
  assert.equal(A.groups(q).reduce((sum,g)=>sum+g.net,0),before);
});
test('invalid mutation is atomic and retains consent, journal and every billed row',()=>{
  const q=quote(),before=JSON.stringify(q);
  for(const op of [()=>A.setField(q,1,'price','-1'),()=>A.setField(q,1,'qty','1.1234'),()=>A.setField(q,1,'name',' '),
    ()=>A.setOutput(q,{material:'invalid'}),()=>A.createGroup(q,{name:'X',kind:'invalid'}),
    ()=>A.setQuantityRule(q,1,{type:'eval',script:'boom()'})])assert.throws(op);
  assert.equal(JSON.stringify(q),before);
  A.init(q);const initialized=JSON.stringify(q),g=group(q,'material');
  for(const values of [{price:Infinity},{qty:NaN},{cost:-1}])assert.throws(()=>A.addRows(q,g.id,[{name:'Neplatná položka',qty:1,unit:'ks',price:1,cost:1,...values}]));
  assert.equal(JSON.stringify(q),initialized);
});
test('approved status including a stale locally editable copy blocks every mutation',()=>{
  for(const flags of [{status:'approved'},{status:'sent',_server_status:'approved'}]){
    const q=quote(flags),before=JSON.stringify(q);
    for(const op of [()=>A.createGroup(q,{name:'Nová'}),()=>A.setField(q,0,'qty',2),()=>A.removeRow(q,0),()=>A.saveVariant(q,{name:'A'}),()=>A.setOutput(q,{appendix:true})])assert.throws(op);
    assert.equal(JSON.stringify(q),before);
  }
});
test('group copy, move and removal preserve independent row identity and actual costs',()=>{
  const q=quote();A.init(q);const material=group(q,'material'),copy=A.copyGroup(q,material.id,{name:'Druhá vetva'});
  assert.equal(total(q),1720);assert.notEqual(material.id,copy.id);
  const copied=group(q,'material');assert.equal(copied.rows.length,1);
  const newRow=A.groups(q).find(g=>g.id===copy.id).rows[0];assert.notEqual(A.rowId(newRow),A.rowId(material.rows[0]));
  A.setField(q,A.rowId(newRow),'qty','2,5');assert.equal(q.items[1].qty,5);assert.equal(total(q),1690);
  const target=A.createGroup(q,{name:'Ďalší materiál',kind:'material'});A.moveRow(q,A.rowId(newRow),target.id);
  assert.equal(A.groups(q).find(g=>g.id===target.id).rows[0].cost,7);
  A.removeGroup(q,target.id);assert.equal(total(q),1660);
});
test('fixed labor retains one billed row and truthful unpriced scope; multirow conversion fails without data loss',()=>{
  const q=quote();A.init(q);const labor=group(q,'labor');
  A.setFixedPrice(q,labor.id,'850');A.setGroupDetails(q,labor.id,[{name:'Zameranie',price:80},{name:'Montáž',price:770}]);
  assert.equal(q.items.length,3);assert.equal(q.items[2].price,850);assert.deepEqual(q.items[2].work_scope,['Zameranie','Montáž']);
  assert.deepEqual(group(q,'labor').contents,[{name:'Zameranie'},{name:'Montáž'}]);
  const material=group(q,'material');A.copyRow(q,A.rowId(material.rows[0]));const before=JSON.stringify(q);
  assert.throws(()=>A.setFixedPrice(q,material.id,100));assert.throws(()=>A.updateGroup(q,material.id,{pricing:'fixed'}));assert.equal(JSON.stringify(q),before);
});
test('manual quantity overrides survive parameter recalculation and subsequent JSON reloads',()=>{
  const q=quote();A.init(q);A.setQuantityRule(q,1,{type:'parameter',parameter:'route_m',factor:2});
  A.applyQuantities(q,A.previewQuantities(q,{route_m:6}));assert.equal(q.items[1].qty,12);
  A.setField(q,1,'qty','13,5');const reloaded=clone(q),preview=A.previewQuantities(reloaded,{route_m:8});
  assert.equal(preview.changes[0].manual,true);assert.equal(preview.changes[0].after,16);
  assert.equal(A.applyQuantities(reloaded,preview).skipped,1);assert.equal(reloaded.items[1].qty,13.5);
  A.markManual(reloaded,1,'qty',false);A.applyQuantities(reloaded,A.previewQuantities(reloaded,{}));assert.equal(reloaded.items[1].qty,16);
});
test('quantity previews detect edits by the legacy editor and reject stale applications atomically',()=>{
  const q=quote();A.init(q);A.setQuantityRule(q,1,{type:'parameter',parameter:'route_m'});
  const preview=A.previewQuantities(q,{route_m:7});q.items[1].qty=6;const before=JSON.stringify(q);
  assert.throws(()=>A.applyQuantities(q,preview));assert.equal(JSON.stringify(q),before);
  const next=A.previewQuantities(q,{route_m:8});assert.equal(next.changes[0].manual,true);
  A.applyQuantities(q,next);assert.equal(q.items[1].qty,6);
});
test('weighted labor rules preserve minimum time and quarter hour upward rounding and zero scope',()=>{
  const rule={type:'sum',parameters:['water','waste'],weights:[.45,.35],offset:1.5,min:2,ceil_step:.25,zero_when_empty:true};
  assert.equal(A.evaluateRule(rule,{water:0,waste:0}),0);
  assert.equal(A.evaluateRule(rule,{water:1,waste:0}),2);
  assert.equal(A.evaluateRule(rule,{water:2,waste:1}),2.75);
  assert.throws(()=>A.validateRule({...rule,weights:[1]}));assert.throws(()=>A.validateRule({...rule,ceil_step:0}));
  assert.throws(()=>A.evaluateRule(rule,{water:2}));
});
test('catalog refresh uses stable identity, preserves customer name and independent manual price/cost',()=>{
  const q=quote();A.init(q);A.setField(q,1,'name','Rozvod vody v kuchyni');A.setField(q,1,'price','15');
  const updated=stock({name:'Nový katalógový názov',sell_price_ex_vat:20,purchase_price_ex_vat:9,updated_at:'2026-10-07'});
  const preview=A.previewPrices(q,[updated]);assert.equal(preview.changes.length,2);assert.equal(preview.changes.find(c=>c.field==='price').manual,true);
  A.applyPrices(q,preview);assert.equal(q.items[1].price,15);assert.equal(q.items[1].cost,9);assert.equal(q.items[1].name,'Rozvod vody v kuchyni');
  assert.equal(A.catalogReference(q.items[1]).id,'stock-cu');assert.equal(q.items[1].pohoda.name,'Nový katalógový názov');
});
test('missing and ambiguous stock references never silently choose another warehouse/card',()=>{
  const q=quote();A.init(q);
  const impostor=stock({id:'other',fingerprint:'other',plu:'other',sell_price_ex_vat:999});
  const preview=A.previewPrices(q,[impostor]);assert.equal(preview.changes.length,0);assert.equal(preview.missing.length,1);
  assert.equal(A.findStock({code:'SAME'},[{code:'SAME',id:'1'},{code:'SAME',id:'2'}]),null);
  assert.equal(A.findStock({id:'id',storage_ref:'A'},[{id:'id',storage_ref:'B'}]),null);
});
test('stale price preview cannot overwrite a subsequent manual change or new stock binding',()=>{
  const q=quote();A.init(q);const preview=A.previewPrices(q,[stock({sell_price_ex_vat:20,purchase_price_ex_vat:9})]);
  A.setField(q,1,'price',18);const before=JSON.stringify(q);assert.throws(()=>A.applyPrices(q,preview));assert.equal(JSON.stringify(q),before);
});
test('fixed group catalog update preserves package price and included operations are not charged twice',()=>{
  const q=quote();A.init(q);q.items[2].pohoda=stock({id:'labor',fingerprint:'labor',code:'LAB'});
  const laborRef=A.reference(q.items[2].pohoda);q.items[2].stored_metadata.quote_assembly.catalog_ref=laborRef;
  const preview=A.previewPrices(q,[stock(),stock({id:'labor',fingerprint:'labor',code:'LAB',sell_price_ex_vat:999,purchase_price_ex_vat:400})]);
  A.applyPrices(q,preview);assert.equal(q.items[2].price,600);assert.equal(q.items[2].cost,400);
  q.items[1].mapping_status='included_in_installation';q.items[1].price=0;
  assert.ok(!A.previewPrices(q,[stock({sell_price_ex_vat:99})]).changes.some(c=>c.row_id===A.rowId(q.items[1])));
});
test('company markup and margin use actual known costs and unknown costs remain unknown',()=>{
  assert.equal(A.priceFromCost({mode:'markup',value:20},100),120);
  assert.equal(A.priceFromCost({mode:'margin',value:20},100),125);
  assert.equal(A.priceFromCost({mode:'margin',value:20},null),null);
  assert.throws(()=>A.validatePriceRule({mode:'margin',value:100}));
  const q=quote();A.setPriceRule(q,1,{mode:'markup',value:50});assert.equal(q.items[1].price,10.5);
  A.applyPrices(q,A.previewPrices(q,[stock({purchase_price_ex_vat:8,sell_price_ex_vat:999})]));assert.equal(q.items[1].price,12);
  A.setField(q,1,'cost','');A.setPriceRule(q,1,{mode:'margin',value:20});assert.equal(q.items[1].price,null);
  q.items[1].cost=0;q.items[1].qty=0;q.items[1].cost_override=false;A.metadata(q.items[1]).manual.cost=false;
  A.setPriceRule(q,1,{mode:'markup',value:30});assert.equal(q.items[1].price,null);
});
test('unknown zero costs do not fabricate profit and null sale at quantity zero matches server completeness',()=>{
  const q=quote();q.items[1].cost=0;
  assert.equal(group(q,'material').cost_complete,false);q.items[1].cost_override=true;assert.equal(group(q,'material').cost_complete,true);
  q.items[1].qty=0;q.items[1].price=null;assert.equal(group(q,'material').price_complete,false);
});
test('optional items bill only when selected, deselect preserves edits and recurring fees stay separate',()=>{
  const q=quote();A.init(q);const before=total(q);
  const option=A.addOptional(q,{name:'Tlaková skúška',kind:'pressure',items:[{name:'Tlaková skúška',role:'pressure_test',qty:1,unit:'ks',price:90,cost:40}]});
  assert.equal(total(q),before);A.selectOptional(q,option.id,true);assert.equal(total(q),before+90);
  A.selectOptional(q,option.id,true);assert.equal(total(q),before+90);
  const selected=q.items.find(i=>A.metadata(i).optional_id===option.id);A.setField(q,A.rowId(selected),'price',100);
  A.selectOptional(q,option.id,false);assert.equal(total(q),before);A.selectOptional(q,option.id,true);assert.equal(total(q),before+100);
  const annual=A.addOptional(q,{name:'Ročný servis',include_in_initial_total:false,period:'rok',items:[{name:'Ročný servis',qty:1,unit:'rok',price:150,cost:70}]});
  A.selectOptional(q,annual.id,true);assert.equal(total(q),before+100);assert.equal(A.inspect(q).optional.find(o=>o.id===annual.id).selected,true);
});
test('scenario instances namespace independent quantities, retain configuration and deduplicate shared work',()=>{
  const make=(route)=>({scenario:{id:'test',name:'Test'},parameters:{route_m:route,device_type:'split',branches:[route]},
    groups:[{id:'material',name:'Materiál',kind:'material',pricing:'computed'},{id:'transport',name:'Doprava',kind:'transport',pricing:'computed'}],
    items:[{role:'pipe',name:'Potrubie',qty:route,unit:'m',price:12,cost:7,stored_metadata:{quote_assembly:{group_id:'material',quantity_rule:{type:'parameter',parameter:'route_m'}}}},
      {role:'transport',name:'Doprava',qty:1,unit:'ks',price:60,cost:20,stored_metadata:{quote_assembly:{group_id:'transport',singleton_key:'transport'}}}]});
  const q=quote({items:[]});const first=A.addScenario(q,make(3)),second=A.addScenario(q,make(7));
  assert.equal(q.items.length,3);assert.equal(second.skipped.length,1);assert.equal(total(q),180);
  assert.equal(A.inspect(q).scenarios[0].configuration.device_type,'split');
  const key=first.scenario.parameters.route_m;A.applyQuantities(q,A.previewQuantities(q,{[key]:5}));
  assert.equal(q.items.filter(i=>i.role==='pipe')[0].qty,5);assert.equal(q.items.filter(i=>i.role==='pipe')[1].qty,7);
});
test('variant snapshots stay outside billed rows, preserve manual changes when switching and never alter contact',()=>{
  const q=quote({device:{id:'A',name:'Prvý'}});const originalTotal=total(q);const a=A.saveVariant(q,{name:'Variant A'});
  A.setField(q,0,'price',2000);q.device={id:'B',name:'Druhý'};const b=A.saveVariant(q,{name:'Variant B'});
  A.selectVariant(q,a.id);assert.equal(total(q),originalTotal);assert.equal(q.device.id,'A');assert.equal(q.items.length,3);
  A.setField(q,0,'price',1100);A.selectVariant(q,b.id);assert.equal(total(q),originalTotal+1000);assert.equal(q.device.id,'B');
  A.selectVariant(q,a.id);assert.equal(q.items[0].price,1100);assert.equal(q.customer.name,'Zákazník');
});
test('new revisions preserve issued originals and increment through all existing family members',()=>{
  const original=quote({status:'approved',remote_id:'remote',remote_customer_id:'customer',sync_version:5,_server_status:'approved',_outbox:{request:'old'},issued_on:'2026-10-01',valid_until:'2026-10-15',pohoda_offer_exported_at:'2026-10-01'});
  const before=JSON.stringify(original);const second=A.createRevision(original,[original],{id:'revision-2',now:100});
  assert.equal(second.status,'draft');assert.equal(second.material_edits.assemblies.revision.number,2);assert.equal(second.inspection_id,'inspection-1');
  for(const key of ['remote_id','remote_customer_id','sync_version','warranty_consent','_server_status','_outbox','issued_on','pohoda_offer_exported_at'])assert.equal(second[key],undefined);
  const third=A.createRevision(original,[original,second],{id:'revision-3',now:200});
  assert.equal(third.material_edits.assemblies.revision.number,3);assert.equal(third.material_edits.assemblies.revision.root_quote_no,original.quote_no);
  assert.equal(JSON.stringify(original),before);second.items[0].price=0;assert.equal(original.items[0].price,1000);
  assert.throws(()=>A.createRevision(original,[second],{id:'revision-2'}));
});
test('procurement aggregates exact stock and units across groups, omits work/text and keeps provenance',()=>{
  const q=quote();A.init(q);A.copyGroup(q,group(q,'material').id);A.createGroup(q,{name:'Poznámky',kind:'text'});
  const list=A.procurement(q);assert.equal(list.items.length,1);assert.equal(list.items[0].qty,10);assert.equal(list.items[0].sources.length,2);
  assert.equal(list.unmapped.length,1);assert.equal(list.unmapped[0].name,'Zariadenie');
  assert.ok(!list.items.some(i=>i.name==='Montáž'));
  const work=A.installer(q);assert.ok(work.find(g=>g.kind==='labor').items[0].work_scope.includes('Skúška'));
  assert.ok(!ownPrices(work));
});
function ownPrices(value){if(!value||typeof value!=='object')return false;return Object.entries(value).some(([key,x])=>['price','cost'].includes(key)||ownPrices(x));}
test('fixed material procurement uses its explicit unpriced contents once',()=>{
  const q=quote({items:[]});const g=A.createGroup(q,{name:'Montážny materiál',kind:'material',pricing:'fixed',contents:[
    {name:'Potrubie',qty:5,unit:'m',catalog_ref:A.reference(stock())},
    {name:'Práca',qty:1,unit:'hod',kind:'labor'},
    {name:'Duplicitný popis',qty:5,unit:'m',catalog_ref:A.reference(stock()),included_duplicate:true}]});
  A.addRows(q,g.id,[{name:'Montážny materiál',qty:1,unit:'súb.',price:100,cost:35}]);
  const purchase=A.procurement(q);assert.equal(purchase.items.length,1);assert.equal(purchase.items[0].qty,5);assert.equal(purchase.unmapped.length,0);
  assert.equal(total(q),100);
});
