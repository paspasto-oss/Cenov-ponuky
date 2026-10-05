const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('../js/quote-materials.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const stock=(extra={})=>({id:'stock-1',fingerprint:'fp-1',plu:'PLU1',code:'CU28',name:'Medené potrubie 28 mm',unit:'m',active:true,sell_price_ex_vat:12,purchase_price_ex_vat:7,...extra});
const material=()=>({role:'pipe',name:'Medené potrubie 28 mm',qty:5,unit:'m',pohoda:stock(),pohoda_code:'CU28',price:12,cost:7,visible:false});
const quote=()=>({id:'q',category:'heat_pump',system_type:'monoblock',status:'draft',items:[{role:'device',name:'TČ',qty:1,unit:'ks',price:1000,cost:700},material(),{role:'installation_service',name:'Montáž',qty:1,price:600,cost:300}]});
function rebuild(q,stocks=[stock()],sys='monoblock'){
  M.capture(q);q.items=M.apply(q,quote().items,stocks,M.scope(q,sys));return q.items;
}
test('quantity accepts SK decimals and zero, rejects invalid or excessive precision',()=>{
 assert.equal(M.quantity('2,375'),2.375);assert.equal(M.quantity('0'),0);
 for(const v of ['',null,'NaN','Infinity','-1','1.1234','1e8','2abc','100000000000'])assert.throws(()=>M.quantity(v));
});
test('quantity survives repeated BOM regeneration and JSON reload',()=>{
 let q=quote();M.setQuantity(q,1,'12,5');rebuild(q);assert.equal(q.items[1].qty,12.5);
 q=clone(q);rebuild(q);assert.equal(q.items[1].qty,12.5);M.setQuantity(q,1,'0');rebuild(q);assert.equal(q.items[1].qty,0);
});
test('removed recipe material does not return after prices, recipe rebuild or reload',()=>{
 let q=quote();M.remove(q,1);assert.equal(q.items.length,2);rebuild(q);assert.equal(q.items.length,2);
 q=clone(q);rebuild(q);assert.ok(!q.items.some(i=>i.role==='pipe'));
});
test('custom catalog material preserves quantity and uses fresh prices without rebuilding other cards',()=>{
 let q=quote(),st=stock({id:'stock-2',fingerprint:'fp-2',code:'V1',plu:'PLU2',name:'Ventil',unit:'ks'});
 M.add(q,st,'3','extra-1');q=clone(q);rebuild(q,[stock(),{...st,sell_price_ex_vat:18,purchase_price_ex_vat:9,name:'Ventil nový názov'}]);
 const i=q.items.at(-1);assert.equal(i.qty,3);assert.equal(i.price,18);assert.equal(i.cost,9);assert.equal(i.name,'Ventil nový názov');
 assert.equal(i.visible,false);assert.equal(q.items[1].qty,5);
});
test('custom material removal is persistent',()=>{
 const q=quote(),st=stock({id:'2',fingerprint:'2',code:'V1'});M.add(q,st,'2','x');M.remove(q,3);rebuild(q,[stock(),st]);assert.equal(q.items.length,3);
});
test('repeated catalog choice increases the same card quantity and supports removed card readdition',()=>{
 const q=quote();assert.equal(M.add(q,stock(),'2','x').merged,true);assert.equal(q.items[1].qty,7);assert.equal(q.items.length,3);
 M.remove(q,1);M.add(q,stock(),'3','y');rebuild(q);assert.equal(q.items.filter(M.editable).length,1);assert.equal(q.items.at(-1).qty,3);
});
test('manual sale and cost overrides survive regular rebuild and price refresh',()=>{
 const q=quote();M.setQuantity(q,1,'8');q.items[1].price=10;q.items[1].price_override=true;q.items[1].cost=6;q.items[1].cost_override=true;
 rebuild(q,[stock({sell_price_ex_vat:90,purchase_price_ex_vat:80})]);assert.equal(q.items[1].price,10);assert.equal(q.items[1].cost,6);assert.equal(q.items[1].qty,8);
});
test('clearing manual purchase cost does not resurrect its old override',()=>{
 const q=quote();q.items[1].cost=6;q.items[1].cost_override=true;rebuild(q);
 q.items[1].cost=null;q.items[1].cost_override=false;rebuild(q);assert.equal(q.items[1].cost,7);assert.notEqual(q.items[1].cost,6);
});
test('manual prices on an added card survive latest stock refresh',()=>{
 const q=quote(),st=stock({id:'2',fingerprint:'2',code:'V1'});M.add(q,st,'3','x');
 Object.assign(q.items.at(-1),{price:99,cost:55,price_override:true,cost_override:true});rebuild(q,[stock(),{...st,sell_price_ex_vat:123}]);
 assert.equal(q.items.at(-1).price,99);assert.equal(q.items.at(-1).cost,55);
});
test('a missing exact card is not replaced by another card with same code',()=>{
 const q=quote(),st=stock({id:'2',fingerprint:'2',plu:'2',code:'V1'});M.add(q,st,'3','x');
 rebuild(q,[stock(),{...st,id:'3',fingerprint:'3',plu:'3',sell_price_ex_vat:999}]);
 assert.equal(q.items.at(-1).price,12);assert.equal(q.items.at(-1).pohoda,null);assert.equal(q.items.at(-1).mapping_status,'catalog_item_missing');
});
test('switching system does not transfer incompatible recipe quantities or deletions',()=>{
 const q=quote();M.setQuantity(q,1,'20');M.add(q,stock({id:'2',fingerprint:'2'}),'2','x');
 rebuild(q,[stock()],'split');assert.equal(q.items[1].qty,5);assert.equal(q.items.length,3);
 rebuild(q,[stock()],'monoblock');assert.equal(q.items[1].qty,20);assert.equal(q.items.length,4);
});
test('approval blocks all material mutations and preserves full quote',()=>{
 const q=quote();q.status='approved';const before=JSON.stringify(q);
 for(const f of [()=>M.setQuantity(q,1,'3'),()=>M.remove(q,1),()=>M.add(q,stock(),'3','x')])assert.throws(f);
 M.capture(q);M.apply(q,[],[]);assert.equal(JSON.stringify(q),before);
 q.status='draft';q._server_status='approved';assert.throws(()=>M.remove(q,1));
});
test('main device and montage service are protected from quantity/deletion',()=>{
 const q=quote();for(const i of [0,2]){assert.throws(()=>M.setQuantity(q,i,'2'));assert.throws(()=>M.remove(q,i))}
});
test('search supports names without accents, code, PLU, EAN and filters inactive cards',()=>{
 const rows=[stock({ean:'123456789',manufacturer:'TEST'}),stock({id:'other',plu:'PLU2',code:'V',name:'Ventil',active:false})];
 for(const query of ['medene 28','CU28','PLU1','123456789','TEST'])assert.equal(M.search(rows,query).rows.length,1);
 assert.equal(M.search(rows,'ventil').total,0);assert.equal(M.search(rows,'x').total,0);
});
test('missing purchase or sales price remains unknown instead of being silently zero',()=>{
 const q=quote();M.add(q,stock({id:'2',fingerprint:'2',sell_price_ex_vat:null,purchase_price_ex_vat:null}),'1','x');
 assert.equal(q.items.at(-1).price,null);assert.equal(q.items.at(-1).cost,null);
});
test('atomic RPC payload and remote hydration retain material journal and custom metadata',async()=>{
 const js=fs.readFileSync(path.join(__dirname,'../js/db.js'),'utf8');let payload;
 const client={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'test'}}}})},rpc:async(name,args)=>{payload=args;return {data:{remote_id:'r',sync_version:2}}}};
 const c=vm.createContext({window:{SPEKTRA_SUPABASE:{url:'x',anonKey:'x'},supabase:{createClient:()=>client}},console});
 vm.runInContext(js,c);await c.window.SpektraDB.init();const q=quote();M.remove(q,1);M.add(q,stock(),'2.5','new');
 await c.window.SpektraDB.saveQuote(q,'request');assert.equal(JSON.stringify(payload.p_quote.workflow.material_edits),JSON.stringify(q.material_edits));
 assert.equal(payload.p_items.at(-1).metadata.quote_material.id,'new');assert.equal(payload.p_items.at(-1).qty,2.5);
 const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
 const declarations=[...html.matchAll(/^(?:async )?function (\w+)\(/gm)],n=declarations.findIndex(m=>m[1]==='remoteQuoteToLocal');
 const context=vm.createContext({stockByCodeMap:new Map(),norm:x=>String(x).toLowerCase()});
 vm.runInContext(html.slice(declarations[n].index,declarations[n+1].index),context);
 const saved=context.remoteQuoteToLocal({...clone(payload.p_quote),id:'r',status:'draft',workflow:clone(payload.p_quote.workflow),quote_items:clone(payload.p_items),sync_version:2});
 assert.equal(JSON.stringify(saved.material_edits),JSON.stringify(q.material_edits));assert.equal(saved.items.at(-1).stored_metadata.quote_material.id,'new');
 rebuild(saved);assert.equal(saved.items.some(x=>x.role==='pipe'),false);assert.equal(saved.items.at(-1).qty,2.5);
});
test('new scripts compile and hooks use atomic storage without schema changes',()=>{
 for(const name of ['quote-materials.js','quote-material-editor.js'])new vm.Script(fs.readFileSync(path.join(__dirname,'../js',name),'utf8'));
 const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');assert.match(html,/SpektraQuoteMaterials\.capture\(edited\)/);assert.match(html,/SpektraQuoteMaterials\.apply/);
 assert.match(html,/finalMaterialEditorSlot/);assert.match(html,/quote-material-editor\.js/);
});
