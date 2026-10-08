// Run: node --test mobile-v4/tests/stock-purchase-import.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../admin/stock-sync.html'),'utf8');
const functions=html.slice(html.indexOf('function s(v)'),html.indexOf('function indexImageFiles(files)'))+
 html.slice(html.indexOf('function existingStockFor(row)'),html.indexOf('async function parseXlsx(file)'))+
 html.slice(html.indexOf('function collapseImageOnlyRows(rows)'),html.indexOf('async function prepareProductImages(rows,btn)'));
function element(name,value){
 const children=Array.isArray(value)?value:[];
 return {localName:name.split(':').pop(),children,attributes:[],textContent:children.length?children.map(x=>x.textContent).join(''):String(value??''),
  getElementsByTagName(){return children.flatMap(x=>[x,...x.getElementsByTagName('*')])}};
}
function stock({id='26192',code='CMDV000125',plu='400002',name='MDV EVO 3,5 kW',purchase='287',sale='478.86',storage=true}={}){
 const fields=[element('stk:id',id),element('stk:code',code),element('stk:PLU',plu),element('stk:name',name),element('stk:unit','ks')];
 if(storage)fields.push(element('stk:storage',[element('typ:id','291'),element('typ:ids','Predaj/Vykurovanie a ohrev vody/Klimatizácie/Midea ,MDV')]));
 fields.push(element('stk:weightedPurchasePrice','0'),element('stk:purchasingPrice',purchase),element('stk:sellingPrice',sale),element('stk:count','0'));
 fields.push(element('stk:pictures',[element('stk:picture',[element('stk:filepath',code+'.jpg')])]));
 return element('lStk:stock',[element('stk:stockHeader',fields)]);
}
function environment(baseline=[]){
 const c=vm.createContext({baselineRows:structuredClone(baseline),normalized:[],conflicts:[],autoResolvedDuplicates:0,
  baselineByFingerprint:new Map(),baselineByCode:new Map(),baselineByPlu:new Map(),baselineCommercialByCode:new Map(),baselineCommercialByPlu:new Map(),
  matchedImageFiles:()=>[]});
 vm.runInContext(functions,c);c.rebuildBaselineIndexes();return c;
}
function oldCard(){return {code:'CMDV000125',plu:'400002',name:'Starý názov',fingerprint:'existing-card',purchase_price_ex_vat:0,sell_price_ex_vat:400,
 image_url:'https://example.test/old.jpg',image_urls:['https://example.test/old.jpg']}}
test('POHODA nested storage and current purchasingPrice map correctly',()=>{
 const c=environment();const row=c.normalizeXmlStock(stock(),0);
 assert.equal(row.storage_ref,'291');assert.match(row.storage_name,/Klimatizácie/);
 assert.equal(row.purchase_price_ex_vat,287);assert.equal(row.sell_price_ex_vat,478.86);
});
test('complete import preparation preserves updated name and prices over stale zero-cost baseline',()=>{
 const c=environment([oldCard()]);c.mergeRows([c.normalizeXmlStock(stock(),0)]);
 const rows=c.collapseImageOnlyRows(c.normalized);assert.equal(rows.length,1);
 const row=rows[0];assert.equal(row.fingerprint,'existing-card');assert.equal(row.name,'MDV EVO 3,5 kW');
 assert.equal(row.purchase_price_ex_vat,287);assert.equal(row.sell_price_ex_vat,478.86);
 assert.equal(row.image_url,'https://example.test/old.jpg');
});
test('priced XML card without storage never gets replaced with stale baseline',()=>{
 const c=environment([oldCard()]);c.mergeRows([c.normalizeXmlStock(stock({storage:false}),0)]);
 const rows=c.collapseImageOnlyRows(c.normalized);assert.equal(rows.length,1);
 assert.equal(rows[0].purchase_price_ex_vat,287);assert.equal(rows[0].sell_price_ex_vat,478.86);assert.equal(rows[0].name,'MDV EVO 3,5 kW');
});
test('JYTY cable retains its 0.90 EUR purchase price with zero weighted price',()=>{
 const c=environment();const row=c.normalizeXmlStock(stock({id:'28948',code:'JYTY-O 4x1',plu:'105109',name:'Kábel špeciálny JYTY-O 4x1',purchase:'0.9',sale:'1.17'}),0);
 assert.equal(row.purchase_price_ex_vat,0.9);assert.equal(c.collapseImageOnlyRows([row])[0].purchase_price_ex_vat,0.9);
});
test('image-only import still attaches images to the existing commercial card',()=>{
 const base={...oldCard(),storage_ref:'291',purchase_price_ex_vat:287,sell_price_ex_vat:478.86};
 const c=environment([base]);const images={code:base.code,name:'Obrázok',fingerprint:'image-only',image_source_refs:['new.jpg']};
 const rows=c.collapseImageOnlyRows([images]);assert.equal(rows.length,1);assert.equal(rows[0].purchase_price_ex_vat,287);
 assert.ok(rows[0].image_source_refs.includes('new.jpg'));
});
test('explicit zero prices and quantities are commercial data, not image-only data',()=>{
 const c=environment([oldCard()]);const row={...oldCard(),name:'New',purchase_price_ex_vat:null,sell_price_ex_vat:0,quantity_available:0};
 const rows=c.collapseImageOnlyRows([row]);assert.equal(rows[0].name,'New');assert.equal(rows[0].sell_price_ex_vat,0);
});

test('code, not reused PLU or old name, selects the baseline card',()=>{
 const a={...oldCard(),code:'0017',plu:'1',fingerprint:'a'},b={...oldCard(),code:'0018',plu:'2',fingerprint:'b'};
 const c=environment([a,b]);c.mergeRows([c.normalizeXmlStock(stock({code:'0017',plu:'2',name:'Nový názov'}),0)]);
 assert.equal(c.normalized[0].fingerprint,'a');assert.equal(c.normalized[0].code,'0017');assert.equal(c.normalized[0].plu,'2');
 assert.equal(c.normalized[0].name,'Nový názov');assert.equal(c.conflicts.length,0);
});
test('same name/PLU or case-folded/zero-stripped code cannot merge a different product',()=>{
 const c=environment([{...oldCard(),code:'0017-X',fingerprint:'old'}]);
 for(const code of ['17-X','0017-x','OTHER']){
   c.mergeRows([c.normalizeXmlStock(stock({code}),0)]);
   assert.notEqual(c.normalized[0].fingerprint,'old');assert.equal(c.normalized[0].code,code);
 }
});
test('unique code remains the identity when the classification is changed',()=>{
 const c=environment([{...oldCard(),storage_ref:'old-classification',storage_name:'Staré členenie'}]);
 c.mergeRows([c.normalizeXmlStock(stock(),0)]);
 assert.equal(c.normalized[0].fingerprint,'existing-card');assert.equal(c.normalized[0].storage_ref,'291');
});
test('ambiguous duplicate code and missing codes are excluded as conflicts instead of guessed',()=>{
 const c=environment([{...oldCard(),fingerprint:'a',storage_ref:'1'},{...oldCard(),fingerprint:'b',storage_ref:'2'}]);
 c.mergeRows([c.normalizeXmlStock(stock({storage:false}),0)]);assert.equal(c.conflicts.length,1);assert.match(c.conflicts[0].reason,/viac skladových/);
 c.mergeRows([c.normalizeXmlStock(stock({code:''}),0)]);assert.equal(c.conflicts.length,1);assert.match(c.conflicts[0].reason,/Chýba kód/);
});
test('same code and warehouse with conflicting commercial values is not silently deduplicated',()=>{
 const c=environment();c.mergeRows([c.normalizeXmlStock(stock({sale:10}),0),c.normalizeXmlStock(stock({sale:20}),1)]);
 assert.equal(c.conflicts.length,1);assert.match(c.conflicts[0].reason,/rozdielna/);
});
test('new fingerprints depend on exact code and classification, never name or PLU',()=>{
 const c=environment();const a=c.normalizeXmlStock(stock({name:'A',plu:'1'}),0),b=c.normalizeXmlStock(stock({name:'B',plu:'2'}),1);
 assert.equal(a.fingerprint,b.fingerprint);
 assert.notEqual(a.fingerprint,c.normalizeXmlStock(stock({code:'different'}),2).fingerprint);
});
