// Run: node --test mobile-v4/tests/approved-price-lock.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
const declarations=[...html.matchAll(/^(?:async )?function (\w+)\(/gm)];
const names=['isQuotePriceLocked','go','openQuote','buildBOM','ensureHeatPumpInstallationItem',
 'recalcQuoteTotalsFromItems','setQuoteItemPrice','setQuoteItemCost','renderRecommendation',
 'refreshQuoteFromCatalog','pickAlternative','saveDraft','finishQuote','markSent','remoteQuoteToLocal'];
const functions=names.map(name=>{
 const index=declarations.findIndex(m=>m[1]===name);
 assert.ok(index>=0,name);
 return html.slice(declarations[index].index,declarations[index+1].index);
}).join('\n');
function quote(status='approved'){
 return {id:'q1',quote_no:'CP-1',status,category:'heat_pump',customer:{name:'Test',address:'Rajec'},
 building:{},device:{brand:'Midea',model:'Pôvodný názov'},optional_services:{annual_service:false},
 items:[{role:'device',name:'Schválený názov',price:100,cost:60,qty:1,unit:'ks'}],
 net:100,vat_pct:20,vat:20,total:120,price_complete:true};
}
function environment(q=quote()){
 const nodes=new Map();const calls={renders:0,saves:0,fetches:0,alerts:[],screen:null};
 const getNode=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{add(){calls.screen=id},remove(){},toggle(){}},innerHTML:''});return nodes.get(id)};
 const c=vm.createContext({current:structuredClone(q),quotes:[structuredClone(q)],console,SpektraRealizationDate:require('../js/realization-date.js'),
  document:{getElementById:getNode,querySelectorAll:()=>[]},window:{scrollTo(){},SpektraDB:{isAuthenticated:()=>true}},
  SpektraDB:{async listStocks(){calls.fetches++;return [{sell_price_ex_vat:999,name:'Nový názov'}]}},
  alert:m=>calls.alerts.push(m),renderFinal:()=>calls.renders++,upsertCurrent:async()=>calls.saves++,
  ensurePdfImagesState(){},ensureSubsidyState(){},updateActiveContext(){},
  stockByCodeMap:new Map([['x',{code:'X',name:'Nový názov',sell_price_ex_vat:999,purchase_price_ex_vat:888}]]),
  norm:x=>String(x).toLowerCase(),isTradeQuote:()=>false,
  hydrateQuoteForm(){throw Error('Approved quote reached editor')},
  renderChoices(){throw Error('Approved quote reached catalog choices')},
  setTimeout(){throw Error('Unexpected fallback')}
 });
 vm.runInContext(functions,c);
 return {c,calls,nodes};
}
test('weekly stock prices do not replace saved remote offer values',()=>{
 const {c}=environment();
 const saved=c.remoteQuoteToLocal({id:'remote',status:'approved',subtotal_ex_vat:100,vat_pct:20,total_inc_vat:120,
  device:{brand:'Midea',model:'Schválený model'},quote_items:[{pohoda_code:'X',name:'Schválený názov',qty:1,
   sell_price_ex_vat:100,purchase_price_ex_vat:60}]});
 assert.equal(saved.items[0].name,'Schválený názov');
 assert.equal(saved.items[0].price,100);assert.equal(saved.items[0].cost,60);assert.equal(saved.total,120);
 assert.equal(saved.items[0].pohoda.sell_price_ex_vat,999);
});
test('approved legacy quote opens without adding installation or changing totals',()=>{
 const {c,calls}=environment();const before=JSON.stringify(c.current.items);
 c.openQuote('q1');
 assert.equal(JSON.stringify(c.current.items),before);
 assert.equal(c.current.total,120);assert.equal(c.current.vat_pct,20);
 assert.equal(calls.screen,'step5');assert.equal(calls.renders,1);
});
test('approved offer rejects stock refresh, manual prices, alternatives and status downgrades',async()=>{
 const {c,calls}=environment();const before=JSON.stringify(c.current);
 await c.refreshQuoteFromCatalog();await c.setQuoteItemPrice(0,'999');await c.setQuoteItemCost(0,'888');
 c.pickAlternative('new');c.buildBOM();await c.saveDraft();await c.finishQuote();c.markSent();
 assert.equal(JSON.stringify(c.current),before);
 assert.equal(calls.fetches,0);assert.equal(calls.saves,0);assert.equal(calls.alerts.length,1);
});
test('PDF preparation preserves approved legacy item list, totals and VAT',()=>{
 const {c}=environment();const before=JSON.stringify(c.current);
 assert.equal(c.ensureHeatPumpInstallationItem(),false);c.recalcQuoteTotalsFromItems();
 assert.equal(JSON.stringify(c.current),before);
 c.current.items=[];c.current.total=120;c.recalcQuoteTotalsFromItems();
 assert.equal(c.current.total,120);assert.equal(c.current.items.length,0);
});
test('approved quote cannot reach editing steps or recommendation recalculation',()=>{
 const {c,calls}=environment();const before=JSON.stringify(c.current);
 for(const step of ['step1','step2','step3','step4']){c.go(step);assert.equal(calls.screen,'step5')}
 c.renderRecommendation();assert.equal(JSON.stringify(c.current),before);
});
test('draft still recalculates, allows manual prices and saves normally',async()=>{
 const {c,calls}=environment(quote('draft'));
 c.renderInternalProfit=()=>{};c.renderRecommendation=()=>{};
 c.recalcQuoteTotalsFromItems();assert.equal(c.current.total,120);
 await c.setQuoteItemPrice(0,'200');assert.equal(c.current.items[0].price,200);assert.equal(c.current.total,240);
 await c.setQuoteItemCost(0,'80');assert.equal(c.current.items[0].cost,80);assert.equal(calls.saves,2);
 assert.equal(c.isQuotePriceLocked(),false);
});
test('all inline scripts compile',()=>{
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});
