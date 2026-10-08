/* Explicit code links survive POHODA reimports without touching saved quotes. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../js/quote-assemblies.js');
const S=require('../js/hvac-scenarios.js');
const M=require('../js/quote-materials.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const card=(extra={})=>({id:'old-id',fingerprint:'old-fp',code:'0017-S',plu:'17',storage_ref:'1',name:'REHAU RAUTHERM S 17×2',unit:'m',active:true,sell_price_ex_vat:1.25,purchase_price_ex_vat:0.8,...extra});
function offer(){const q={id:'draft',status:'draft',items:[]};A.addScenario(q,S.instantiate({scenarioId:'floor_heating_rehau',parameters:{area_m2:100,installation_rate:5}}));return q;}
for(const [name,api] of [['assemblies',A],['scenarios',S],['materials',M]]){
  test(name+': exact code wins over obsolete ID, fingerprint, PLU and renamed classification',()=>{
    const ref=A.codeReference(card());
    const fresh=card({id:'new-id',fingerprint:'new-fp',plu:'99',storage_ref:'2',name:'Nový názov'});
    const wrong=card({code:'DIFFERENT',name:card().name});
    assert.equal(api.findStock(ref,[wrong,fresh]),fresh);
    assert.equal(api.findStock(ref,[wrong]),null);
  });
  test(name+': code preserves leading zeroes and case; duplicate codes require an unambiguous warehouse',()=>{
    const ref=A.codeReference(card()),a=card({id:'a',storage_ref:'1'}),b=card({id:'b',storage_ref:'2'});
    assert.equal(api.findStock({...ref,storage_ref:null},[a,b]),null);
    assert.equal(api.findStock(ref,[a,b]),a);
    assert.equal(api.findStock(ref,[a,{...a,id:'dup',fingerprint:'dup'}]),null);
    for(const wrong of ['17-S','0017-s','0017 S'])assert.equal(api.findStock(ref,[card({code:wrong})]),null);
    assert.equal(api.findStock(ref,[card({active:false})]),null);
  });
}
test('assigning a card replaces the original slot, retaining quantity, group and automatic rule',()=>{
  const q=offer(),original=clone(q.items[0]),beforeCount=q.items.length,stock=card();
  A.assignStock(q,0,stock);
  const row=q.items[0];
  assert.equal(q.items.length,beforeCount);assert.equal(row.qty,original.qty);assert.equal(row.qty,737);
  assert.equal(A.rowId(row),A.rowId(original));assert.equal(A.metadata(row).group_id,A.metadata(original).group_id);
  assert.deepEqual(A.metadata(row).quantity_rule,A.metadata(original).quantity_rule);
  assert.equal(row.pohoda_code,'0017-S');assert.equal(row.price,1.25);assert.equal(row.cost,0.8);
  assert.equal(A.catalogReference(row).match_by,'code');assert.equal(A.metadata(row).stock_selection_required,false);
  stock.name='Changed elsewhere';assert.notEqual(row.pohoda.name,stock.name);
});
test('blank purchase/sale prices remain null and are not invented during assignment',()=>{
  const q=offer();A.assignStock(q,0,card({sell_price_ex_vat:null,purchase_price_ex_vat:null}));
  assert.equal(q.items[0].price,null);assert.equal(q.items[0].cost,null);
  assert.equal(A.groups(q)[0].price_complete,false);
});
test('invalid, uncoded or inactive cards fail atomically; approved quotes cannot be changed',()=>{
  for(const bad of [card({code:''}),card({sell_price_ex_vat:-1}),card({unit:''}),card({active:false})]){
    const q=offer(),before=clone(q);assert.throws(()=>A.assignStock(q,0,bad));assert.deepEqual(q,before);
  }
  const q=offer();q.status='approved';const before=clone(q);assert.throws(()=>A.assignStock(q,0,card()),/Schválená/);assert.deepEqual(q,before);
});
test('a different stock unit requires explicit conversion and replaces the old quantity formula',()=>{
  const q=offer(),before=clone(q),stock=card({unit:'bal.'});
  assert.throws(()=>A.assignStock(q,0,stock),/MJ/);assert.deepEqual(q,before);
  A.assignStock(q,0,stock,{qty:3,confirmUnit:true});
  assert.equal(q.items[0].qty,3);assert.equal(q.items[0].unit,'bal.');
  assert.deepEqual(A.metadata(q.items[0]).quantity_rule,{type:'fixed',qty:3});assert.equal(A.manualFlags(q.items[0]).qty,true);
});
test('code link survives template export/import, resolves current card and never changes old snapshot',()=>{
  const q=offer();A.assignStock(q,0,card());const before=clone(q);
  const template=S.templateFromGroup(q,A.metadata(q.items[0]).group_id);
  const [restored]=S.importTemplates(S.exportTemplates([template]));
  const fresh=card({id:'new',fingerprint:'new',plu:'new',name:'REHAU nový názov',sell_price_ex_vat:2,purchase_price_ex_vat:1});
  const made=S.instantiateTemplate(restored,{stocks:[fresh]});const row=made.items.find(i=>i.pohoda_code==='0017-S');
  assert.equal(row.name,fresh.name);assert.equal(row.price,2);assert.equal(row.cost,1);assert.equal(A.catalogReference(row).match_by,'code');
  assert.deepEqual(q,before);
  const missing=S.instantiateTemplate(restored,{stocks:[]}).items.find(i=>i.pohoda_code==='0017-S');
  assert.equal(missing.price,null);assert.equal(missing.cost,null);assert.equal(missing.mapping_status,'catalog_item_missing');
  assert.equal(A.metadata(missing).stock_selection_required,true);
});
test('price update matches code after reimport only when explicitly applied and retains code policy',()=>{
  const q=offer();A.assignStock(q,0,card());const before=clone(q);
  const fresh=card({id:'new',fingerprint:'new',name:'Katalóg premenovaný',sell_price_ex_vat:3,purchase_price_ex_vat:1.5});
  const preview=A.previewPrices(q,[fresh]);assert.deepEqual(q,before);
  A.applyPrices(q,preview);assert.equal(q.items[0].price,3);assert.equal(q.items[0].cost,1.5);
  assert.equal(q.items[0].name,before.items[0].name);assert.equal(A.catalogReference(q.items[0]).match_by,'code');
  assert.equal(A.findStock(A.catalogReference(q.items[0]),[{...fresh,id:'next',fingerprint:'next'}]).id,'next');
});
test('underfloor scenario needs no device, keeps all unassigned stock slots unpriced and does not assume free labor',()=>{
  const r=S.instantiate({scenarioId:'floor_heating_rehau'});
  assert.equal(r.scenario.device_required,false);assert.equal(r.items.some(i=>A.kind(i)==='equipment'),false);
  const materials=r.items.filter(i=>A.kind(i)==='material');assert.equal(materials.length,7);
  assert.ok(materials.every(i=>i.price===null&&i.cost===null&&A.metadata(i).stock_selection_required));
  assert.equal(r.items.find(i=>i.role==='installation_service').price,null);
});
test('changed unit in POHODA cannot apply pack prices to old metre quantities',()=>{
  const q=offer();A.assignStock(q,0,card());const before=clone(q);
  const changed=card({unit:'bal.',sell_price_ex_vat:100});
  const preview=A.previewPrices(q,[changed]);
  assert.equal(preview.changes.length,0);assert.ok(preview.missing.some(x=>x.reason==='catalog_unit_changed'));assert.deepEqual(q,before);
  const t=S.templateFromGroup(q,A.metadata(q.items[0]).group_id);
  const row=S.instantiateTemplate(t,{stocks:[changed]}).items[0];
  assert.equal(row.price,null);assert.equal(A.metadata(row).stock_selection_required,true);assert.equal(row.mapping_status,'catalog_unit_changed');
});
