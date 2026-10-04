// Run: node --test mobile-v4/tests/mdv-evo-stock.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
const declarations=[...html.matchAll(/^(?:async )?function (\w+)\(/gm)];
const names=['stockChoiceScore','mergePreferredStock','putPreferred','rebuildStockIndexes',
 'stockHeatPumpCandidate','catalogCategory','acBrandAliases','extractPowerKw',
 'acCatalogCandidates','mergeAcCandidates','cleanAcModelName','acStockCandidates','findStockForDevice'];
const functions=names.map(name=>{
 const index=declarations.findIndex(m=>m[1]===name);assert.ok(index>=0,name);
 return html.slice(declarations[index].index,declarations[index+1].index);
}).join('\n');
// Values from the POHODA export dated 2026-10-04. Prices are test fixtures,
// never a fallback price list in the application.
const fixtures=[
 ['CMDV000122','400001','MDV EVO 2,6 kW',277,470.73],
 ['CMDV000125','400002','MDV EVO 3,5 kW',287,478.86],
 ['CMDV000128','400003','MDV EVO 5,3 kW',456,608.94],
 ['CMDV000131','400004','MDV EVO 7,1 kW',596,771.54]
].map(([code,plu,name,purchase_price_ex_vat,sell_price_ex_vat])=>({code,plu,name,purchase_price_ex_vat,sell_price_ex_vat,active:true}));
function environment(rows=fixtures){
 const c=vm.createContext({stocks:structuredClone(rows),stockByCodeMap:new Map(),stockByPluMap:new Map(),stockByNameMap:new Map(),acStockPool:[],deviceCatalog:[],
  norm:x=>String(x??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()});
 vm.runInContext(functions,c);
 c.rebuildStockIndexes();return c;
}
test('all four short EVO names resolve from imported stock with actual prices',()=>{
 const c=environment();assert.equal(c.acStockPool.length,0);
 const devices=c.acStockCandidates('MDV');assert.equal(devices.length,4);
 for(const st of fixtures){
  const d=devices.find(x=>x.pohoda_code===st.code);assert.ok(d,st.code);
  assert.equal(d.sell_price_ex_vat,st.sell_price_ex_vat);
  assert.equal(d.purchase_price_ex_vat,st.purchase_price_ex_vat);
  assert.equal(d.pohoda_plu,st.plu);
  const matched=c.findStockForDevice(d);assert.equal(matched.code,st.code);
  assert.equal(matched.sell_price_ex_vat,st.sell_price_ex_vat);
 }
 assert.equal(devices[0].power_kw,2.6);assert.equal(devices[0].model,'EVO 2,6 kW');
});
test('imported price takes priority over an outdated static candidate',()=>{
 const c=environment();c.deviceCatalog=[{category:'klimatizacia',brand:'MDV',model:'EVO',pohoda_code:'CMDV000122',sell_price_ex_vat:999}];
 const devices=c.acStockCandidates('MDV');assert.equal(devices.length,4);
 assert.equal(devices.find(x=>x.pohoda_code==='CMDV000122').sell_price_ex_vat,470.73);
});
test('weekly stock name and price changes are read without fixed fallback prices',()=>{
 const rows=structuredClone(fixtures);rows[0].name='MDV EVO nový názov 2,6 kW';rows[0].sell_price_ex_vat=500;rows[0].purchase_price_ex_vat=300;
 const c=environment(rows);const d=c.acStockCandidates('MDV').find(x=>x.pohoda_code==='CMDV000122');
 assert.equal(d.sell_price_ex_vat,500);assert.equal(d.purchase_price_ex_vat,300);
 assert.equal(c.findStockForDevice(d).name,rows[0].name);
});
test('MDV multisplit components and inactive or unpriced sets are excluded',()=>{
 const c=environment([
  {...fixtures[0],active:false},{...fixtures[1],sell_price_ex_vat:0},
  {code:'CMDV000132',name:'MDV EVO multisplit vnútorná jednotka 2,6 kW',sell_price_ex_vat:100},
  {code:'OUT',name:'MDV EVO multisplit vonkajšia jednotka 7,1 kW',sell_price_ex_vat:100}
 ]);
 assert.equal(c.acStockCandidates('MDV').length,0);
});
test('Midea single split code filtering still reads short stock names',()=>{
 const c=environment([{code:'CMID002087',plu:'1',name:'Midea Xtreme 2,6 kW',sell_price_ex_vat:400,purchase_price_ex_vat:200}]);
 assert.equal(c.acStockPool.length,0);const d=c.acStockCandidates('Midea');
 assert.equal(d.length,1);assert.equal(d[0].sell_price_ex_vat,400);
});
