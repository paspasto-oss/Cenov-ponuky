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
 M.remove(q,1);M.add(q,stock(),'3','y');rebuild(q);assert.equal(q.items.length,3);assert.equal(q.items.filter(i=>i.pohoda?.code==='CU28').length,1);assert.equal(q.items.at(-1).qty,3);
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
 for(const f of [()=>M.setQuantity(q,1,'3'),()=>M.remove(q,1),()=>M.add(q,stock(),'3','x'),
  ()=>M.setField(q,0,'name','Prepísané'),()=>M.addManual(q,{name:'Práca'},'manual'),()=>M.enableRows(q),()=>M.setDetailedPdf(q,true)])assert.throws(f);
 M.capture(q);M.apply(q,[],[]);assert.equal(JSON.stringify(q),before);
 q.status='draft';q._server_status='approved';assert.throws(()=>M.remove(q,1));
});
test('main device and montage service support persistent field edits and deletion',()=>{
 const q=quote();
 for(const index of [0,2]){
  M.setQuantity(q,index,'2');M.setField(q,index,'name','Upravená položka '+index);
  M.setField(q,index,'unit','súb.');M.setField(q,index,'price','123,45');
 }
 rebuild(q);
 for(const index of [0,2]){
  assert.equal(q.items[index].qty,2);assert.equal(q.items[index].name,'Upravená položka '+index);
  assert.equal(q.items[index].unit,'súb.');assert.equal(q.items[index].price,123.45);
 }
 M.remove(q,2);M.remove(q,0);rebuild(q);
 assert.deepEqual(q.items.map(i=>i.role),['pipe']);assert.equal(M.isRoleRemoved(q,['installation','installation_service']),true);
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
test('inspection price refresh preserves quantities, labor and manual overrides',()=>{
 const q={category:'other',status:'draft',items:[
  {name:'Radiátor',qty:3,unit:'ks',pohoda_code:'K1',pohoda_stock_id:123,price:200,cost:100},
  {name:'Ručná cena',qty:2,pohoda_code:'K2',price:50,cost:20,price_override:true,cost_override:true},
  {name:'Práca',qty:8,unit:'hod',price:25,cost:15,mapping_status:'service'}]};
 const labor=clone(q.items[2]);
 assert.deepEqual(M.refreshExisting(q,[stock({code:'K1',pohoda_stock_id:123,sell_price_ex_vat:150,purchase_price_ex_vat:90}),stock({code:'K2',sell_price_ex_vat:70,purchase_price_ex_vat:30})]),{updated:2,missing:[]});
 assert.equal(q.items[0].price,150);assert.equal(q.items[0].cost,90);assert.equal(q.items[0].qty,3);
 assert.equal(q.items[1].price,50);assert.equal(q.items[1].cost,20);assert.deepEqual(q.items[2],labor);
});
test('inspection refresh refuses ambiguous or missing exact cards and exposes missing prices',()=>{
 const q={status:'draft',items:[{name:'Missing',pohoda_stock_id:123,pohoda_code:'K',price:20},{name:'Duplicate',pohoda_code:'D',price:30},{name:'No price',pohoda_code:'N',price:40}]};
 const result=M.refreshExisting(q,[stock({code:'K',pohoda_stock_id:999}),stock({code:'D'}),stock({code:'D',id:'second'}),stock({code:'N',sell_price_ex_vat:null})]);
 assert.deepEqual(result,{updated:1,missing:['Missing','Duplicate']});assert.equal(q.items[0].price,20);assert.equal(q.items[1].price,30);assert.equal(q.items[2].price,null);
});
test('approved inspection cannot refresh prices, including stale local status',()=>{
 for(const flags of [{status:'approved'},{status:'draft',_server_status:'approved'}]){
 const q={...flags,items:[material()]},before=clone(q);assert.throws(()=>M.refreshExisting(q,[stock({sell_price_ex_vat:1})]));assert.deepEqual(q,before);
 }
});
test('renaming an uncoded row and its unit keeps its original identity through reload, rebuild and removal',()=>{
 let q=quote();q.items[1]={role:'custom_recipe',name:'Pôvodný názov',qty:5,unit:'m',price:12,cost:7};
 const generated=clone(q.items),originalKey=M.key(q.items[1]);
 M.setField(q,1,'name','Iný názov');M.setField(q,1,'unit','bal.');M.setField(q,1,'qty','2,5');
 assert.equal(M.key(q.items[1]),originalKey);
 q=clone(q);M.capture(q);q.items=M.apply(q,clone(generated),[]);
 assert.equal(q.items[1].name,'Iný názov');assert.equal(q.items[1].unit,'bal.');assert.equal(q.items[1].qty,2.5);
 assert.equal(M.key(q.items[1]),originalKey);
 M.remove(q,1);q.items=M.apply(q,clone(generated),[]);assert.equal(q.items.length,2);
});
test('catalog row custom name and unit survive a stock update without breaking exact card mapping',()=>{
 const q=quote(),st=stock({id:'extra',fingerprint:'fp-extra',plu:'PLUextra'});
 M.add(q,st,'2','extra');M.setField(q,3,'name','Potrubie pre kuchyňu');M.setField(q,3,'unit','bal.');
 rebuild(q,[stock(),{...st,name:'Nový katalógový názov',sell_price_ex_vat:20}]);
 const i=q.items[3];assert.equal(i.name,'Potrubie pre kuchyňu');assert.equal(i.unit,'bal.');assert.equal(i.price,20);
 assert.equal(i.pohoda.id,'extra');assert.equal(i.stored_metadata.quote_material.catalog_ref.id,'extra');
});
test('row mode keeps the issued item snapshot across recipe and system changes, including an empty offer',()=>{
 let q=quote();q.warranty_consent={accepted:true,signature_data_url:'data:image/png;base64,QQ=='};
 M.enableRows(q);assert.equal(M.rowsMode(q),true);assert.equal(q.material_edits.pdf_detail,false);assert.equal(q.warranty_consent,undefined);
 M.setField(q,0,'name','Dva dodané kotly');M.setField(q,0,'qty','2');M.remove(q,2);
 M.addManual(q,{name:'Doprava',qty:1,unit:'km',price:20,cost:10,service:true},'manual-service');
 q=clone(q);const before=clone(q),snapshot=q.items;
 M.capture(q);assert.equal(M.apply(q,quote().items,[stock({sell_price_ex_vat:900})],M.scope(q,'split')),snapshot);
 assert.deepEqual(q,before);assert.equal(q.items[2].role,'quote_manual_service');
 assert.deepEqual(q.material_edits.scopes,{}); // No second item snapshot is stored in the journal.
 while(q.items.length)M.remove(q,0);
 assert.deepEqual(M.apply(q,quote().items,[]),[]);
});
test('opening untouched quotes does not create row mode; PDF detail is an explicit separate setting',()=>{
 const q=quote(),before=clone(q);M.capture(q);assert.deepEqual(q,before);assert.equal(M.rowsMode(q),false);
 M.setDetailedPdf(q,true);assert.equal(M.rowsMode(q),false);assert.equal(q.material_edits.pdf_detail,true);
 M.enableRows(q);assert.equal(q.material_edits.pdf_detail,true);M.setDetailedPdf(q,false);assert.equal(M.rowsMode(q),true);
 const saved=clone(q);assert.throws(()=>M.setDetailedPdf(q,'false'));assert.deepEqual(q,saved);
});
test('manual billable material and labor preserve unknown prices; text rows contribute explicit zero',()=>{
 const q=quote();
 const material=M.addManual(q,{name:'Ručný materiál'},'manual-material').item;
 const labor=M.addManual(q,{name:'Práca',qty:'2,5',unit:'hod',price:'25',cost:'10',service:true},'manual-labor').item;
 const note=M.addManual(q,{name:'Zákazník pripraví miesto montáže.',textOnly:true},'manual-text').item;
 assert.equal(material.role,'quote_manual');assert.equal(material.qty,1);assert.equal(material.price,null);assert.equal(material.cost,null);
 assert.equal(labor.role,'quote_manual_service');assert.equal(labor.qty,2.5);assert.equal(labor.price,25);assert.equal(labor.cost,10);
 assert.equal(M.isText(note),true);assert.equal(note.role,'quote_text');assert.equal(note.price,0);assert.equal(note.cost,0);
 assert.equal(note.cost_override,true);assert.equal(note.visible,true);assert.equal(note.unit,'ks');assert.equal(note.qty,1);
 for(const field of ['qty','unit','price','cost'])assert.throws(()=>M.setField(q,5,field,'5'));
 M.setField(q,5,'name','Doplnená poznámka');assert.equal(note.name,'Doplnená poznámka');
});
test('manual rows retain independent identities and are not remapped by matching catalog names',()=>{
 let q=quote();M.addManual(q,{name:'Medené potrubie 28 mm',price:9,cost:4},'manual-a');
 M.addManual(q,{name:'Medené potrubie 28 mm',price:10,cost:5},'manual-b');M.addManual(q,{name:'Poznámka',textOnly:true},'text');
 q=clone(q);rebuild(q,[stock({sell_price_ex_vat:99,purchase_price_ex_vat:88})]);
 assert.deepEqual(q.items.slice(3).map(i=>i.price),[9,10,0]);assert.ok(q.items.slice(3).every(i=>i.pohoda===null));
 M.refreshExisting(q,[stock({sell_price_ex_vat:999})]);assert.deepEqual(q.items.slice(3).map(i=>i.price),[9,10,0]);
 M.remove(q,3);rebuild(q);assert.equal(q.items.filter(i=>i.role==='quote_manual').length,1);
 assert.equal(q.items[3].stored_metadata.quote_material.id,'manual-b');
});
test('cleared sale and cost fields remain unknown through refresh and journal regeneration',()=>{
 const q=quote();M.setField(q,1,'price','');M.setField(q,1,'cost','');
 M.refreshExisting(q,[stock({sell_price_ex_vat:70,purchase_price_ex_vat:60})]);rebuild(q);
 assert.equal(q.items[1].price,null);assert.equal(q.items[1].cost,null);
 assert.equal(q.items[1].price_override,true);assert.equal(q.items[1].cost_override,true);
});
test('field validation rejects invalid inputs before mutating the quote or its signature',()=>{
 const q=quote();q.warranty_consent={accepted:true,offer_key:'original'};const before=clone(q);
 for(const [field,value] of [['name',' '],['unit',''],['name','nul\u0000text'],['role','installation'],['qty','-1'],['qty','1.1234'],
  ['price','-1'],['cost','1.00001'],['price','NaN'],['price','Infinity'],['price','1e3'],['price','2eur'],['cost','100000000']]){
  assert.throws(()=>M.setField(q,1,field,value));assert.deepEqual(q,before);
 }
 assert.throws(()=>M.setField(q,99,'name','Platný názov'));assert.deepEqual(q,before);
 for(const values of [{name:' '},{name:'Práca',qty:'-1'},{name:'Práca',unit:''},{name:'Práca',price:'-1'},{name:'Práca',cost:'100000000'}]){
  assert.throws(()=>M.addManual(q,values,'x'));assert.deepEqual(q,before);
 }
 assert.equal(M.money('99,1234'),99.1234);assert.equal(M.money('99999999.9999'),99999999.9999);
 M.setField(q,1,'qty','0');M.setField(q,1,'price','0');assert.equal(q.items[1].qty,0);assert.equal(q.items[1].price,0);
 assert.equal(q.warranty_consent,undefined);
});
test('row mode catalog addition is visible and repeated selection still increases the exact card quantity',()=>{
 const q=quote();M.enableRows(q);
 assert.equal(M.add(q,stock(),'2','unused').merged,true);assert.equal(q.items[1].qty,7);
 const st=stock({id:'second',fingerprint:'fp-second',plu:'PLUsecond'});
 const result=M.add(q,st,'3','new');assert.equal(result.merged,false);assert.equal(result.item.visible,true);
 M.add(q,st,'2','new-again');assert.equal(q.items.length,4);assert.equal(q.items[3].qty,5);
});
test('removed installation guard follows the active wizard scope',()=>{
 const q=quote();M.remove(q,2);assert.equal(M.isRoleRemoved(q,['installation','installation_service']),true);
 rebuild(q,[stock()],'split');assert.equal(M.isRoleRemoved(q,['installation','installation_service']),false);
 assert.ok(q.items.some(i=>i.role==='installation_service'));
 rebuild(q,[stock()],'monoblock');assert.equal(M.isRoleRemoved(q,['installation','installation_service']),true);
 assert.ok(!q.items.some(i=>i.role==='installation_service'));
});
test('missing exact stock card cannot be replaced by a different card with the same PLU',()=>{
 const old=stock(),replacement=stock({id:'other',fingerprint:'fp-other',sell_price_ex_vat:999});
 assert.equal(M.findStock(old,[replacement]),null);
 const q=quote();M.setField(q,1,'name','Vlastný názov');const before=clone(q.items[1]);
 assert.deepEqual(M.refreshExisting(q,[replacement]),{updated:0,missing:['Vlastný názov']});
 assert.deepEqual(q.items[1],before);
});
test('server-approved status blocks every row mutation even with a stale local draft',()=>{
 const q=quote();M.enableRows(q);q._server_status='approved';const before=clone(q);
 for(const act of [()=>M.setField(q,0,'name','Zmena'),()=>M.setQuantity(q,0,'2'),()=>M.remove(q,0),
  ()=>M.add(q,stock(),'1','x'),()=>M.addManual(q,{name:'Text',textOnly:true},'t'),()=>M.enableRows(q),()=>M.setDetailedPdf(q,true)]){
  assert.throws(act);assert.deepEqual(q,before);
 }
 M.capture(q);assert.equal(M.apply(q,[],[]),q.items);assert.deepEqual(q,before);
});
test('atomic storage round trip retains row mode, PDF setting, field edits and manual text identity',async()=>{
 const js=fs.readFileSync(path.join(__dirname,'../js/db.js'),'utf8');let payload;
 const client={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'test'}}}})},rpc:async(name,args)=>{payload=args;return {data:{remote_id:'r',sync_version:2}}}};
 const c=vm.createContext({window:{SPEKTRA_SUPABASE:{url:'x',anonKey:'x'},supabase:{createClient:()=>client}},console});
 vm.runInContext(js,c);await c.window.SpektraDB.init();const q=quote();M.enableRows(q);M.setDetailedPdf(q,true);
 M.setField(q,0,'name','Dve zariadenia');M.setField(q,0,'unit','bal.');M.setField(q,0,'qty','2');M.remove(q,2);
 M.addManual(q,{name:'Samostatná poznámka',textOnly:true},'text-row');
 await c.window.SpektraDB.saveQuote(q,'row-request');
 assert.equal(payload.p_quote.workflow.material_edits.rows_mode,true);assert.equal(payload.p_quote.workflow.material_edits.pdf_detail,true);
 const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
 const declarations=[...html.matchAll(/^(?:async )?function (\w+)\(/gm)],n=declarations.findIndex(m=>m[1]==='remoteQuoteToLocal');
 const context=vm.createContext({stockByCodeMap:new Map(),norm:x=>String(x).toLowerCase()});
 vm.runInContext(html.slice(declarations[n].index,declarations[n+1].index),context);
 const saved=context.remoteQuoteToLocal({...clone(payload.p_quote),id:'r',status:'draft',workflow:clone(payload.p_quote.workflow),quote_items:clone(payload.p_items),sync_version:2});
 assert.equal(M.rowsMode(saved),true);assert.equal(saved.items[0].name,'Dve zariadenia');assert.equal(saved.items[0].unit,'bal.');assert.equal(saved.items[0].qty,2);
 assert.equal(M.isText(saved.items[2]),true);assert.equal(saved.items[2].stored_metadata.quote_material.id,'text-row');
 assert.equal(saved.items[2].cost,0);assert.equal(saved.items[2].cost_override,true);
 saved.items=M.apply(saved,quote().items,[stock()]);assert.equal(saved.items.length,3);assert.equal(saved.items[2].role,'quote_text');
});
