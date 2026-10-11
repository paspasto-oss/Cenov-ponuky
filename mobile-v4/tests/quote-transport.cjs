const {test}=require('node:test');const assert=require('node:assert/strict');
const T=require('../js/quote-transport.js'),A=require('../js/quote-assemblies.js'),Q=require('../js/quote-quick.js'),O=require('../js/quote-row-output.js');
const q=()=>({id:'test',status:'draft',customer:{address:'Žilina 1',realization_address:'Rajec 2'},items:[{role:'installation_service',name:'Montáž',qty:48,unit:'čh',price:35,cost:null,stored_metadata:{quote_assembly:{kind:'labor'}}}],vat_pct:23});
const route={round_trip_km:60,is_rajec:false,destination_label:'Žilina 1'};
test('approved examples and all boundary km use one return trip per visit',()=>{
 for(const [km,count,rajec,expected] of [[20,2,false,50],[60,2,false,78],[100,3,false,195],[0,1,true,10],[10,2,true,20],[10,3,true,30]])assert.equal(T.price(km,count,rajec),expected);
 for(const [km,p] of [[20,25],[38,25],[39,25.35],[40,26],[60,39],[100,65],[150,97.5]])assert.equal(T.price(km,1,false),p);
 assert.equal(T.price(60,0,false),0);assert.equal(T.trips(48,2),3);assert.equal(T.trips(24,2),2);assert.equal(T.trips(0,2),0);assert.equal(T.price('39,5',1,false),25.68);
 for(const v of [-1,NaN,Infinity,'',true,'1e3',{},null])assert.throws(()=>T.price(v,1,false));
 assert.throws(()=>T.trips(48,0));assert.throws(()=>T.price(60,1.5,false));
});
test('single row, canonical PDF sums, and unknown cost',()=>{
 const quote=q();T.ensurePending(quote);assert.equal(O.canonicalTotals(quote).complete,false);
 T.apply(quote,route);T.apply(quote,route);const rows=quote.items.filter(r=>A.kind(r)==='transport');assert.equal(rows.length,1);assert.equal(rows[0].qty,1);assert.equal(rows[0].price,117);assert.equal(rows[0].cost,null);assert.equal(quote.material_edits.transport.trips,3);assert.equal(O.canonicalTotals(quote).net,1797);
 assert.equal(T.address(quote),'Rajec 2');
});
test('manual km, visits and prices survive rerouting',()=>{
 const quote=q();T.apply(quote,route,{km:'100',trips:2});T.apply(quote,{...route,round_trip_km:80});let row=quote.items.find(r=>A.kind(r)==='transport');assert.equal(row.price,130);assert.equal(A.metadata(row).total_km,100);
 row.price=111;row.price_override=true;A.metadata(row).manual.price=true;T.apply(quote,{...route,round_trip_km:70},{trips:3});row=quote.items.find(r=>A.kind(r)==='transport');assert.equal(row.price,111);assert.equal(row.qty,1);
});
test('issued, server approved, legacy, included and duplicate guards',()=>{
 for(const status of ['approved','ready','sent']){const quote=q();quote.status=status;const before=JSON.stringify(quote);assert.equal(T.apply(quote,route),false);assert.equal(JSON.stringify(quote),before);}
 const quote=q();quote._server_status='approved';assert.equal(T.apply(quote,route),false);
 const legacy=q();legacy.items.push({name:'Doprava',role:'transport',unit:'km',qty:100,price:.8,cost:null});const before=JSON.stringify(legacy);assert.equal(T.apply(legacy,route),false);assert.equal(JSON.stringify(legacy),before);
 const included=q();A.init(included);A.metadata(included.items[0]).scenario_instance_id='s';included.material_edits.assemblies.scenarios=[{id:'s',covered_services:['transport']}];assert.equal(T.covered(included),true);assert.equal(T.apply(included,route),false);T.ensurePending(included);assert.equal(included.items.length,1);
 const dup=q();dup.items.push({role:'transport'},{role:'transport'});assert.throws(()=>T.apply(dup,route,{explicit:true}));
});
test('missing hours stays unpriced and stores route for correction',()=>{
 const quote=q();quote.items[0].unit='m²';T.apply(quote,route);assert.equal(quote.items.find(r=>A.kind(r)==='transport').price,null);assert.equal(quote.material_edits.transport.route.round_trip_km,60);T.apply(quote,route,{man_hours:48,crew:2});assert.equal(quote.items.find(r=>A.kind(r)==='transport').price,117);
});
test('routing cache, failure retry and invalid zero response',async()=>{
 let calls=0;const routeFn=T.router(async()=>{calls++;return route;});await routeFn('Žilina 1');await routeFn('Žilina 1');assert.equal(calls,1);
 assert.throws(()=>T.validateRoute({...route,round_trip_km:0}));assert.throws(()=>T.validateRoute({...route,is_rajec:null}));
 let failed=0;const retry=T.router(async()=>{if(++failed===1)throw Error('offline');return route;});await assert.rejects(retry('Žilina 1'));await retry('Žilina 1');assert.equal(failed,2);
});
test('automatic floor quote retains BOM, uses shared transport, resize preserves manual price',()=>{
 const config={format:Q.FORMAT,version:1,name:'Podlahovka',materials:[{name:'Rúra',unit:'m',role:'floor_pipe',mode:'area',quantity:7,ref:{code:'PIPE'}}],labor_price:7,labor_cost:4};
 const quote={id:'floor',status:'draft',items:[],vat_pct:23};Q.applyNew(quote,config,138,0,[{code:'PIPE',name:'Rúra',unit:'m',sell_price_ex_vat:1,purchase_price_ex_vat:.5}],{automatic_transport:true});
 assert.equal(Q.supported(quote),true);assert.equal(O.canonicalTotals(quote).complete,false);T.apply(quote,{...route,is_rajec:true},{man_hours:48,crew:2});assert.equal(Q.summary(quote)[2].net,30);assert.equal(Q.travel(quote),60);
 Q.resize(quote,161,60);assert.equal(quote.items.find(r=>A.kind(r)==='transport').price,30);assert.equal(quote.items.find(r=>r.role==='floor_pipe').qty,1127);
});
test('changing labor hours refreshes derived visits, explicit visits win',()=>{
 const quote=q();T.apply(quote,route);quote.items.find(r=>A.kind(r)==='labor').qty=16;T.apply(quote,route);assert.equal(quote.material_edits.transport.trips,1);
 T.apply(quote,route,{trips:4});quote.items.find(r=>A.kind(r)==='labor').qty=32;T.apply(quote,route);assert.equal(quote.material_edits.transport.trips,4);
});
test('legacy explicit correction preserves original total price',()=>{const quote=q();quote.items.push({role:'transport',name:'Doprava',unit:'výjazd',qty:2,price:10,price_override:true});T.apply(quote,route,{explicit:true});assert.equal(quote.items.find(r=>A.kind(r)==='transport').price,20);});

const vm=require('node:vm'),fs=require('node:fs');
function browser(){let timer,resolve,saves=0;const env={current:q(),SpektraQuoteAssemblies:A,document:{addEventListener(){}},setTimeout(fn){timer=fn;return 1;},clearTimeout(){timer=null;},console,Date,Map,Number,JSON,Error};env.window=env;
 env.SpektraDB={routeTransport(){return new Promise(r=>{resolve=r;});}};
 env.SpektraQuoteWorkbench={render(){},async mutate(_m,fn){saves++;fn(env.current);return {ok:true};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/quote-transport.js'),'utf8'),env);
 return {env,T:env.SpektraQuoteTransport,run:()=>timer(),resolve:r=>resolve(r),saves:()=>saves};}
test('delayed routing does not change another quote or changed address',async()=>{
 for(const change of [e=>e.current=q(),e=>e.current.customer.realization_address='Nová 33',e=>e.current.status='approved',e=>e.current.items[0].qty=16]){
 const b=browser();b.T.schedule();const pending=b.run();change(b.env);b.resolve(route);await pending;assert.equal(b.saves(),0);
 }
});
test('routing saves same draft and debounce discards superseded request',async()=>{
 const b=browser();b.T.schedule();const pending=b.run();b.resolve(route);await pending;assert.equal(b.saves(),1);
 const c=browser();c.T.schedule();const old=c.run();c.env.current.customer.realization_address='Nová 33';c.T.schedule();c.resolve(route);await old;assert.equal(c.saves(),0);
});
test('address or labor changes invalidate old automatic price until route is refreshed',()=>{const quote=q();T.apply(quote,route);quote.customer.realization_address='Nová 33';T.invalidate(quote);assert.equal(quote.items.find(r=>A.kind(r)==='transport').price,null);T.apply(quote,route);const r=quote.items.find(r=>A.kind(r)==='transport');r.price=111;r.price_override=true;T.apply(quote,route);quote.customer.realization_address='Iná 44';T.invalidate(quote);assert.equal(quote.items.find(r=>A.kind(r)==='transport').price,111);});
