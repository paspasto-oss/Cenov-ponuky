const {test}=require('node:test');
const assert=require('node:assert/strict');
const Q=require('../js/quote-quick.js');
const A=require('../js/quote-assemblies.js');
const S=require('../js/hvac-scenarios.js');
const O=require('../js/quote-row-output.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const stocks=[{id:'new-pipe',code:'0017',name:'Potrubie z POHODY',unit:'m',sell_price_ex_vat:1.2,purchase_price_ex_vat:.7},
 {code:'BOARD',name:'Varionova',unit:'m²',sell_price_ex_vat:8,purchase_price_ex_vat:5},
 {code:'MAN',name:'Rozdeľovač',unit:'ks',sell_price_ex_vat:200,purchase_price_ex_vat:140}];
const config={format:Q.FORMAT,version:1,name:'Podlahovka',materials:[
 {name:'Potrubie',role:'floor_pipe',unit:'m',ref:{code:'0017'},mode:'area',quantity:7.37},
 {name:'Doska',role:'floor_board',unit:'m²',ref:{code:'BOARD'},mode:'area',quantity:1.05},
 {name:'Rozdeľovač',role:'floor_manifold',unit:'ks',ref:{code:'MAN'},mode:'fixed',quantity:1}],
 labor_price:7,labor_cost:4,transport_price:.8,transport_cost:.4};
const empty=()=>({id:'q1',status:'draft',customer:{name:'TEST',phone:'1'},category:'floor_heating',items:[],vat_pct:23});
function quote(area=100,km=40,c=config,st=stocks){const q=empty();Q.applyNew(q,c,area,km,st);return q;}
function row(q,k){return q.items.find(r=>r.role===k||A.kind(r)===k);}

test('simple form builds a detailed BOM with exactly three customer summary rows',()=>{
 const q=quote(),model=O.customerModel(q);assert.equal(model.rows.length,3);assert.equal(q.items.length,5);
 assert.equal(row(q,'floor_pipe').qty,737);assert.equal(row(q,'floor_board').qty,105);assert.equal(row(q,'floor_manifold').qty,1);
 assert.equal(row(q,'labor').qty,100);assert.equal(row(q,'transport').qty,40);
 assert.equal(model.totals.net,2656.4);assert.equal(model.totals.total,3267.37);
 assert.deepEqual(Q.summary(q).map(r=>r.unit),['m²','m²','km']);
 assert.ok(!JSON.stringify(model.rows).includes('purchase_price'));assert.ok(!JSON.stringify(model.rows).includes('catalog_ref'));
});
test('one square metre baseline scales by area; fixed hardware is not multiplied by square metres',()=>{
 const q=quote(1,0);assert.equal(row(q,'floor_pipe').qty,7.37);Q.resize(q,100,40,.8);
 assert.equal(row(q,'floor_pipe').qty,737);assert.equal(row(q,'floor_manifold').qty,1);assert.equal(row(q,'transport').qty,40);
 Q.resize(q,200,80,.8);assert.equal(row(q,'floor_pipe').qty,1474);assert.equal(row(q,'floor_manifold').qty,1);
 assert.equal(row(q,'labor').qty,200);assert.equal(row(q,'transport').qty,80);assert.equal(q.items.length,5);
});
test('resize keeps saved stock names prices costs and manual prices, and never reads inventory',()=>{
 const q=quote(),original=copy(q);row(q,'floor_pipe').price=9;row(q,'floor_pipe').name='Ručný názov';
 Q.resize(q,200,20,100);assert.equal(row(q,'floor_pipe').price,9);assert.equal(row(q,'floor_pipe').cost,.7);
 assert.equal(row(q,'floor_pipe').name,'Ručný názov');assert.equal(row(q,'transport').price,.8);
 assert.deepEqual(q.customer,original.customer);assert.equal(q.id,original.id);
});
test('a new quote uses current exact-code prices while a saved quote stays frozen',()=>{
 const old=quote(),before=copy(old),updated=copy(stocks);updated[0].id='different-id';updated[0].name='Nový názov';updated[0].sell_price_ex_vat=2;
 const next=quote(100,40,config,updated);assert.equal(row(next,'floor_pipe').price,2);assert.equal(row(next,'floor_pipe').name,'Nový názov');assert.deepEqual(old,before);
});
test('unmapped ambiguous wrong-code and wrong-unit stock remains unpriced',()=>{
 for(const st of [[],stocks.map(s=>s.code==='0017'?{...s,code:'17'}:s),[...stocks,{...stocks[0],id:'duplicate'}],stocks.map(s=>s.code==='0017'?{...s,unit:'bal'}:s)]){
 const q=quote(100,40,config,st);assert.equal(row(q,'floor_pipe').price,null);assert.equal(O.canonicalTotals(q).complete,false);
 assert.equal(Q.summary(q)[0].net,null);assert.equal(row(q,'floor_pipe').pohoda_code,'0017');
 }
});
test('explicit warehouse resolves duplicate stock codes; leading zeros are retained',()=>{
 const c=copy(config);c.materials[0].ref.storage_ref='S2';
 const q=quote(100,0,c,[...stocks.map(s=>({...s,storage_ref:'S1'})),{...stocks[0],storage_ref:'S2',sell_price_ex_vat:3}]);
 assert.equal(row(q,'floor_pipe').price,3);assert.equal(row(q,'floor_pipe').pohoda_code,'0017');
});
test('missing transport tariff is not silently treated as free after zero kilometres becomes nonzero',()=>{
 const c={...config,transport_price:null},q=quote(100,0,c);assert.equal(O.canonicalTotals(q).complete,true);
 Q.resize(q,100,40,null);assert.equal(row(q,'transport').price,null);assert.equal(O.canonicalTotals(q).complete,false);
 const q2=quote(100,0,c);Q.resize(q2,100,20,.75);assert.equal(row(q2,'transport').price,.75);
});
test('missing installation tariff prevents a complete quote',()=>{
 const q=quote(100,40,{...config,labor_price:null});assert.equal(Q.summary(q)[1].net,null);assert.equal(O.canonicalTotals(q).complete,false);
});
test('existing regular REHAU scenario exposes its area and can be resized without inserting a duplicate assembly',()=>{
 const q=empty();A.addScenario(q,S.instantiate({scenarioId:'floor_heating_rehau',parameters:{area_m2:161,installation_rate:7},stocks:[]}));
 assert.equal(Q.sourceArea(q),161);assert.equal(Q.supported(q),true);const count=q.items.length;
 Q.resize(q,200,40,.8);assert.equal(q.items.length,count+1);assert.equal(Q.sourceArea(q),200);
 Q.resize(q,100,20,.8);assert.equal(q.items.length,count+1);assert.equal(row(q,'labor').qty,100);assert.equal(row(q,'transport').qty,20);
});
test('new insertion never overwrites existing quote rows',()=>{
 const q=quote(),before=copy(q);assert.throws(()=>Q.applyNew(q,config,1,0,stocks));assert.deepEqual(q,before);
});
test('locked approved quote is rejected without changes; revision workflow belongs to workbench',()=>{
 for(const lock of [{status:'approved'},{_server_status:'approved'}]){const q={...quote(),...lock},before=copy(q);assert.throws(()=>Q.resize(q,200,80,.8));assert.deepEqual(q,before);}
});
test('mixed equipment services variants and multiple scenarios require advanced mode instead of hiding them',()=>{
 for(const kind of ['equipment','service','pressure','text']){const q=quote();q.items.push({name:'Extra',role:kind,qty:1,price:20,stored_metadata:{quote_assembly:{kind}}});assert.equal(Q.supported(q),false);}
 const q=quote();q.material_edits.assemblies.variants=[{id:'v'}];assert.equal(Q.supported(q),false);
 const q2=quote();q2.material_edits.assemblies.scenarios.push({id:'other'});assert.equal(Q.supported(q2),false);
});
test('trip charge is never mistaken for a kilometre tariff and multiple transports cannot be collapsed',()=>{
 const q=quote();row(q,'transport').unit='výjazd';const before=copy(q);assert.throws(()=>Q.resize(q,120,40,.8));assert.deepEqual(q,before);assert.equal(Q.travel(q),null);
});
test('configuration stores only reusable material codes norms rates without customer or quote data',()=>{
 const q=quote();q.customer={name:'PRIVATE PERSON',address:'SECRET ADDRESS'};
 const c=Q.configuration(q,{area_m2:100,labor_price:7,transport_price:.8});const serialized=JSON.stringify(c);
 assert.ok(!serialized.includes('PRIVATE'));assert.ok(!serialized.includes('SECRET'));assert.ok(!serialized.includes('customer'));
 assert.equal(c.materials[0].quantity,7.37);assert.equal(c.materials[0].ref.code,'0017');assert.equal(c.materials[2].mode,'fixed');assert.equal(c.materials[2].quantity,1);
 assert.equal(quote(200,40,c).items[0].qty,1474);
});
test('invalid area distance rates units and numeric codes are rejected',()=>{
 for(const bad of [-1,'',null,true,'NaN','Infinity','1e3','1/2'])assert.throws(()=>Q.build(config,bad,0,stocks));
 for(const bad of [-1,'',true])assert.throws(()=>Q.build(config,100,bad,stocks));
 assert.throws(()=>Q.validate({...config,labor_price:-1}));
 const c=copy(config);c.materials[0].ref.code=17;assert.throws(()=>Q.validate(c));
 assert.equal(Q.build(config,'10,5','2,5',stocks).parameters.area_m2,10.5);
});
test('reading and previewing summary do not modify stored offers',()=>{
 const q=quote(),before=copy(q);Q.summary(q);Q.sourceArea(q);Q.supported(q);Q.configuration(q,{area_m2:100});assert.deepEqual(q,before);
});
