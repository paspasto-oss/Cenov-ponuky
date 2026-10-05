const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const api=require('../js/quote-list-summary.js');
const line=(role,price,cost,qty=1,other={})=>({role,name:role,price,cost,qty,...other});
function quote(items,extra={}){
 const net=items.reduce((a,i)=>a+(Number(i.price)||0)*(Number(i.qty)||0),0);
 return {id:'test',category:'heat_pump',status:'draft',items,net,total:net*1.23,vat_pct:23,price_complete:true,...extra};
}
const fixture=()=>quote([line('device',4000,3000),line('installation_service',600,300),line('pipe',10,6,20),line('dhw_storage_tank',700,500)]);
function near(actual,expected){assert.ok(Math.abs(actual-expected)<0.000001,`${actual} != ${expected}`)}
test('quote list shows saved gross total, labor, materials and net profit',()=>{
 const s=api.calculate(fixture());
 near(s.total,6765);near(s.installation,738);near(s.material,1107);near(s.gross,1580);
 assert.equal(s.complete,true);near(s.margin,1580/5500*100);
});
test('never uses stock prices or stale cached internal_profit',()=>{
 const q=fixture();q.items.forEach(i=>i.pohoda={sell_price_ex_vat:99999,purchase_price_ex_vat:99999});q.internal_profit={gross_profit_ex_vat:99999};
 assert.equal(api.calculate(q).gross,1580);assert.equal(api.calculate(q).material,1107);
});
test('approved quotes remain byte-for-byte unchanged during summary and detail rendering',()=>{
 const q=fixture();q.status='approved';const original=JSON.stringify(q);
 const freeze=x=>{Object.freeze(x);Object.values(x).forEach(v=>v&&typeof v==='object'&&freeze(v))};freeze(q);
 api.calculate(q);api.html(q);assert.equal(JSON.stringify(q),original);
});
test('stored legacy VAT and zero VAT are respected',()=>{
 const q=fixture();q.vat_pct=20;q.total=6600;near(api.calculate(q).installation,720);assert.equal(api.calculate(q).total,6600);
 q.vat_pct=0;q.total=5500;assert.equal(api.calculate(q).installation,600);assert.equal(api.calculate(q).total,5500);
});
test('total is the saved offer total, not a recalculated discounted or subsidized amount',()=>{
 const q=fixture();q.total=6764.99;q.subsidy={estimated_after_subsidy:2764.99};assert.equal(api.calculate(q).total,6764.99);
});
test('decimal quantities, edited price and visible manually added materials are counted',()=>{
 const q=quote([line('device',100,50),line('catalog_material',8,3,12.5,{visible:true,price_override:true})]);
 const s=api.calculate(q);near(s.material,123);near(s.gross,112.5);
});
test('zero quantity does not make profit or material price incomplete',()=>{
 const q=quote([line('device',100,60),line('pipe',null,null,0)]);const s=api.calculate(q);
 assert.equal(s.complete,true);assert.equal(s.gross,40);assert.equal(s.material,0);
});
test('missing purchase cost is never assumed zero',()=>{
 const q=fixture();q.items[1].cost=null;const s=api.calculate(q);
 assert.equal(s.gross,null);assert.equal(s.complete,false);assert.equal(s.missingCost.length,1);assert.match(api.html(q),/Neúplný \(1\)/);
});
test('imported zero cost is unknown; explicit zero cost is allowed',()=>{
 const q=quote([line('installation_service',200,0)]);assert.equal(api.calculate(q).gross,null);
 q.items[0].cost_override=true;assert.equal(api.calculate(q).gross,200);
});
test('free material still requires a known purchase cost',()=>{
 const q=quote([line('device',100,60),line('gift',0,null)]);assert.equal(api.calculate(q).gross,null);
 q.items[1].cost=20;assert.equal(api.calculate(q).gross,20);
});
test('included installation component does not duplicate labor or block known costs',()=>{
 const q=quote([line('installation_service',200,100),line('wall_penetration_80mm_50cm',0,null,1,{mapping_status:'included_in_installation'})]);
 const s=api.calculate(q);assert.equal(s.gross,100);assert.equal(s.material,0);assert.equal(s.installation,246);
});
test('bundled flag with a priced line is not an exemption from unknown costs',()=>{
 const q=quote([line('pipe',50,null,1,{mapping_status:'included_in_installation'})]);assert.equal(api.calculate(q).complete,false);
});
test('missing material sale blocks material, total and profit but not known labor',()=>{
 const q=quote([line('installation_service',200,100),line('pipe',null,10)]);const s=api.calculate(q);
 assert.equal(s.material,null);assert.equal(s.total,null);assert.equal(s.gross,null);assert.equal(s.installation,246);
});
test('empty or invalid quantities/prices do not coerce into zero or inflate profit',()=>{
 for(const value of [null,'',NaN,Infinity,{},true]){
  assert.equal(api.calculate(quote([line('pipe',value,20)])).gross,null);
  assert.equal(api.calculate(quote([line('pipe',100,20,value)])).gross,null);
 }
});
test('empty drafts show dashes rather than fictional zero materials and profit',()=>{
 const q={items:[],price_complete:false};const s=api.calculate(q);
 assert.equal(s.material,null);assert.equal(s.installation,null);assert.equal(s.gross,null);assert.match(api.html(q),/—/);
});
test('legacy header without items preserves saved total without fabricating breakdown',()=>{
 const s=api.calculate({total:1230});assert.equal(s.total,1230);assert.equal(s.material,null);assert.equal(s.gross,null);
});
test('incomplete header flag prevents profit being reported as final',()=>{
 const q=fixture();q.price_complete=false;assert.equal(api.calculate(q).total,null);assert.equal(api.calculate(q).gross,null);
});
test('sales/header mismatch is warned, not silently repaired',()=>{
 const q=fixture();q.net=1;const s=api.calculate(q);assert.equal(s.inconsistent,true);assert.equal(s.gross,null);
 assert.match(api.html(q),/Skontrolovať/);assert.equal(q.net,1);
});
test('multisplit indoor units count as equipment, not installation material',()=>{
 const q=quote([line('device',1000,500),line('multisplit_indoor_units',200,100,3),line('pipe',10,5,15),line('installation',400,200)],{category:'air_conditioning'});
 const s=api.calculate(q);assert.equal(s.material,184.5);assert.equal(s.installation,492);assert.equal(s.gross,1075);
});
test('optional billed services count in labor, future service text is ignored',()=>{
 const q=quote([line('installation',500,200),line('heating_system_flush_cleaner_inhibitor',400,150)],{optional_services:{annual_service:true}});
 assert.equal(api.calculate(q).installation,1107);assert.equal(api.calculate(q).material,0);
});
test('ZTI and other trade offers use actual material and labor rows',()=>{
 for(const category of ['zti','floor_heating','other','recovery','water_heater']){
  const q=quote([line('inspection_material_1',5,2,100),line('installation_service',1000,600)],{category});
  const s=api.calculate(q);assert.equal(s.material,615);assert.equal(s.installation,1230);assert.equal(s.gross,700);
 }
});
test('material names containing montaz are not guessed to be labor',()=>{
 const q=quote([line('installation_material',10,5,2,{name:'Montážne príslušenstvo'})]);assert.equal(api.calculate(q).material,24.6);assert.equal(api.calculate(q).installation,0);
});
test('negative profit is displayed, not clamped to zero',()=>{
 const q=quote([line('device',100,150)]);assert.equal(api.calculate(q).gross,-50);assert.match(api.html(q),/negative/);
});
test('no user strings are injected in financial summary markup',()=>{
 const q=quote([line('material',100,50,1,{name:'<img src=x onerror=alert(1)>'})]);assert.doesNotMatch(api.html(q),/<img|onerror/);
});
test('one pure calculation serves both list and internal detail, not customer PDF code',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
 const readFunction=name=>{const start=html.indexOf('function '+name+'(');return html.slice(start,html.indexOf('\nfunction ',start+1))};
 assert.match(readFunction('renderHome'),/SpektraQuoteSummary.html\(q\)/);
 const context=vm.createContext({SpektraQuoteSummary:api,current:fixture()});vm.runInContext(readFunction('quoteProfitStats'),context);
 assert.equal(context.quoteProfitStats().gross,1580);
 assert.doesNotMatch(html.slice(html.indexOf('function offerHtmlTechnical()')),/SpektraQuoteSummary\.html/);
});
