const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../js/hvac-scenarios.js');
const recipes=require('../data/bundle-recipes.json');
const clone=x=>JSON.parse(JSON.stringify(x));
const meta=i=>i.stored_metadata.quote_assembly;
const byRole=(r,role)=>r.items.find(i=>i.role===role);
const stock=(code,price=10,extra={})=>({id:'stock-'+code,code,name:'Katalóg '+code,unit:'ks',sell_price_ex_vat:price,purchase_price_ex_vat:price/2,active:true,...extra});
const device=(extra={})=>({brand:'Midea',model:'Vybrané zariadenie',power_kw:8,sell_price_ex_vat:1000,...extra});
const build=(scenarioId,extra={})=>S.instantiate({scenarioId,recipes,device:device(),stocks:[],...extra});

test('seven scenarios expose usable fields and do not mutate injected source recipes',()=>{
  const before=clone(recipes);
  assert.deepEqual(S.list().map(x=>x.id),['heat_pump','gas_boiler','biomass','ac_single','ac_multi','floor_heating_rehau','zti']);
  for(const d of S.list()){
    assert.ok(d.parameters.every(f=>f.key&&f.label&&Object.hasOwn(f,'default')));
    const result=build(d.id);assert.ok(result.groups.length);assert.ok(result.items.length);
    assert.ok(result.items.every(i=>meta(i).id&&meta(i).group_id&&meta(i).quantity_rule));
    assert.ok(result.groups.every(g=>result.items.some(i=>meta(i).group_id===g.id)));
    assert.ok(result.items.every(i=>i.qty>0||meta(i).kind==='text'));
  }
  assert.deepEqual(recipes,before);
  const list=S.list();list[0].name='Zmenené';assert.notEqual(S.list()[0].name,'Zmenené');
});

test('heat pump route scales only explicit route items, preserves fixed fittings and separates TUV configuration',()=>{
  const small=build('heat_pump',{parameters:{route_m:5}});
  const big=build('heat_pump',{parameters:{route_m:8,trunking_m:11}});
  assert.equal(byRole(small,'copper_pipe_d28').qty,10);assert.equal(byRole(big,'copper_pipe_d28').qty,16);
  assert.equal(byRole(big,'pipe_insulation_13x28').qty,16);
  assert.equal(byRole(big,'copper_elbow_28').qty,14);
  assert.equal(byRole(big,'ball_valves_1in').qty,6);
  assert.equal(byRole(big,'installation_trunking_40x40').qty,6);
  assert.equal(byRole(big,'power_cable_cyky_5x2_5').qty,12);
  assert.equal(meta(byRole(big,'heating_expansion_service_valve')).kind,'material');
  const aio=build('heat_pump',{parameters:{dhw_solution:'integrated'}});
  assert.ok(!byRole(aio,'dhw_expansion_vessel'));assert.ok(!byRole(aio,'dhw_storage_tank'));
  const external=build('heat_pump',{parameters:{dhw_solution:'external'}});
  assert.equal(byRole(external,'dhw_expansion_vessel').qty,1);
  assert.equal(byRole(external,'dhw_storage_tank').price,null);
  assert.match(byRole(external,'dhw_storage_tank').name,/zásobník/);
  assert.ok(big.checks.some(x=>x.code==='labor_scope'));
  const labor=big.groups.find(g=>g.kind==='labor');
  assert.equal(labor.pricing,'fixed');assert.equal(big.items.filter(i=>meta(i).group_id===labor.id).length,1);
  assert.ok(labor.contents.some(x=>x.name.includes('jadrové')));
  assert.ok(!byRole(big,'wall_penetration_80mm_50cm'),'included drilling is not a second billed row');
});

test('standard and economy use existing recipe prices and gas keeps the established fixed rate',()=>{
  assert.equal(byRole(build('heat_pump'),'installation_service').price,900);
  assert.equal(byRole(build('heat_pump',{parameters:{installation_tier:'economy'}}),'installation_service').price,600);
  assert.equal(byRole(build('hp_split_5m',{parameters:{installation_tier:'economy'}}),'installation_service').price,750);
  const gas=build('gas_boiler',{device:device({brand:'Protherm'}),stocks:[stock('PK-MONT',999)]});
  assert.equal(byRole(gas,'installation_service').price,590);
  const biomass=build('biomass',{device:device({brand:'OPOP'})});
  assert.equal(byRole(biomass,'installation_service').price,null,'no invented missing biomass stock rate');
});

test('monosplit charges only route extension beyond its included first 3 metres',()=>{
  const input={device:device({power_kw:3.5}),stocks:[stock('2RGC2GRE#GA075AC075',20)]};
  const two=build('ac_single',{...input,parameters:{route_m:2}});
  assert.equal(two.items.length,2);assert.equal(byRole(two,'installation_service').price,350);
  const five=build('ac_single',{...input,parameters:{route_m:5}});
  assert.equal(byRole(five,'refrigerant_pipe_pair').qty,2);
  assert.equal(byRole(five,'refrigerant_pipe_pair').price,20);
  assert.equal(byRole(five,'power_cable').qty,2);
  const seven=build('ac_single',{...input,parameters:{route_m:7}});
  assert.equal(byRole(seven,'refrigerant_pipe_pair').qty,4);
  assert.equal(seven.groups.find(g=>g.kind==='labor').included_material_route_m,3);
});

test('multisplit routes remain separate, selected indoor devices are billed once and common cable once',()=>{
  const r=build('ac_multi',{parameters:{branch_lengths:[3,7]},
    indoorDevices:[device({model:'Vnútorná A',power_kw:2.5}),device({model:'Vnútorná B',power_kw:5})]});
  const pipes=r.items.filter(x=>x.role==='refrigerant_pipe_pair');
  assert.deepEqual(pipes.map(x=>x.qty),[3,7]);
  assert.deepEqual(pipes.map(x=>x.pohoda_code),['2RGC2GRE#GA075AC075','2RGC2GRE#GA075AD075']);
  assert.deepEqual(pipes.map(x=>meta(x).quantity_rule.parameter),['branch_1_m','branch_2_m']);
  assert.equal(r.items.filter(x=>x.role==='power_cable').length,1);assert.equal(byRole(r,'power_cable').qty,5);
  assert.equal(r.items.filter(x=>x.role==='multisplit_indoor_units').length,2);
  const complete=build('ac_multi',{device:device({complete_multisplit_set:true}),parameters:{branch_lengths:[3,7]}});
  assert.ok(!byRole(complete,'multisplit_indoor_units'));
  assert.equal(byRole(complete,'refrigerant_pipe_pair').pohoda_code,null,'unknown indoor power must not silently choose a pipe');
  assert.ok(complete.checks.some(x=>x.code==='multisplit_compatibility'));
  assert.throws(()=>build('ac_multi',{parameters:{indoor_count:3,branch_lengths:[3,7]}}),/Počet dĺžok/);
});

test('foreign boiler choices do not inherit Protherm or OPOP specific fittings silently',()=>{
  const gas=build('gas_boiler',{device:device({brand:'Bosch'}),stocks:[stock('0020257015',75)]});
  assert.equal(byRole(gas,'flue_adapter_a1k').pohoda_code,null);assert.equal(byRole(gas,'flue_adapter_a1k').price,null);
  const biomass=build('biomass',{device:device({brand:'ATMOS'}),stocks:[stock('OPOP-SET',75,{plu:'28'})]});
  assert.equal(byRole(biomass,'boiler_protection_set_opop').price,null);
  assert.ok(biomass.checks.some(x=>x.code==='compatibility'));
});

test('catalog matching uses stable identity, unique exact card and preserves unknown costs',()=>{
  const first=stock('ABC',55,{id:'exact',name:'Nový názov',purchase_price_ex_vat:null});
  assert.equal(S.findStock({id:'exact'},[first]).name,'Nový názov');
  assert.equal(S.findStock({id:'removed',code:'ABC'},[first]),null);
  assert.equal(S.findStock({code:'ABC'},[first,stock('ABC',60,{id:'other'})]),null);
  assert.equal(S.findStock({code:'ABC',storage_ref:'A'},[stock('ABC',55,{storage_ref:'A'}),stock('ABC',60,{storage_ref:'B'})]).sell_price_ex_vat,55);
  const result=build('heat_pump',{device:{name:'Názov pre zákazníka',code:'ABC',id:'exact'},stocks:[first]});
  assert.equal(byRole(result,'device').name,'Názov pre zákazníka');assert.equal(byRole(result,'device').cost,null);
  assert.equal(meta(byRole(result,'device')).catalog_ref.id,'exact');
  assert.equal(byRole(result,'device').pohoda_code,'ABC');
  const enriched=build('heat_pump',{device:{...first,brand:'Midea',model:'Model z katalógu',pohoda_stock_id:first.id},stocks:[first]});
  assert.equal(meta(byRole(enriched,'device')).catalog_ref.id,'exact');
  assert.equal(byRole(enriched,'device').pohoda.id,'exact');
  assert.equal(S.findStock(meta(byRole(enriched,'device')).catalog_ref,[{...first,sell_price_ex_vat:60}]).sell_price_ex_vat,60);
});

test('ZTI mirrors material macro coefficients, pipe length is separate and labor norms recalculate',()=>{
  const result=build('zti',{parameters:{water_outlets:2,pipe16_m:10}});
  assert.equal(byRole(result,'zti_water_sleeve_16').qty,4);
  assert.equal(byRole(result,'zti_water_sleeve_20').qty,4);
  assert.equal(byRole(result,'zti_pipe16').qty,10);assert.equal(byRole(result,'zti_tubex18').qty,10);
  assert.equal(byRole(result,'zti_floor_clip').qty,20);
  assert.equal(byRole(result,'installation_service').qty,3);
  assert.equal(byRole(result,'installation_service').price,35);
  assert.equal(byRole(build('zti',{parameters:{water_outlets:1}}),'installation_service').qty,2);
  assert.equal(byRole(build('zti',{parameters:{job_type:'renovation'}}),'installation_service').price,40);
  assert.equal(S.ztiLabor({water_outlets:2,pipe16_m:10}).man_hours,3);
  const preview=S.previewQuantities(result,{water_outlets:4,pipe16_m:20});
  const changed=S.applyQuantities(result,preview);
  assert.equal(byRole(changed,'installation_service').qty,4.5);
  assert.equal(byRole(changed,'zti_water_sleeve_16').qty,8);
  const zero=S.applyQuantities(result,S.previewQuantities(result,{water_outlets:0,pipe16_m:0}));
  assert.equal(byRole(zero,'installation_service').qty,0);
});

test('quantity preview preserves manual edits and never changes saved prices or source templates',()=>{
  const original=build('heat_pump',{parameters:{route_m:5},stocks:[stock('138023023208850005',12)]});
  const changed=clone(original);byRole(changed,'copper_pipe_d28').qty=13;
  const preview=S.previewQuantities(changed,{route_m:9});
  assert.equal(preview.changes.find(x=>x.id===meta(byRole(changed,'copper_pipe_d28')).id).manual,true);
  const applied=S.applyQuantities(changed,preview);
  assert.equal(byRole(applied,'copper_pipe_d28').qty,13);
  assert.equal(byRole(applied,'pipe_insulation_13x28').qty,18);
  assert.equal(byRole(applied,'copper_pipe_d28').price,12);
  assert.equal(byRole(original,'copper_pipe_d28').qty,10);
  const forced=S.applyQuantities(changed,preview,{includeManual:true});assert.equal(byRole(forced,'copper_pipe_d28').qty,18);
  byRole(changed,'copper_pipe_d28').qty=14;
  assert.throws(()=>S.applyQuantities(changed,preview),/Ponuka sa zmenila/);
});

test('initial price excludes annual service and common services already included in assembly scope',()=>{
  const r=build('heat_pump',{options:{annual_service:true,flush:true},services:[{role:'transport',name:'Doprava',price:60,qty:1}]});
  assert.ok(!byRole(r,'annual_service'));assert.ok(!byRole(r,'transport'));
  assert.equal(byRole(r,'heating_system_flush_cleaner_inhibitor').price,400);
  assert.equal(r.optional.find(x=>x.items[0].role==='annual_service').selected,true);
  assert.equal(r.optional.find(x=>x.items[0].role==='annual_service').include_in_initial_total,false);
  const zti=build('zti',{services:[{role:'pressure_test',name:'Tlaková skúška',price:90},{role:'transport',name:'Doprava',price:60},{role:'transport',name:'Doprava znova',price:60}]});
  assert.ok(!byRole(zti,'pressure_test'));assert.equal(zti.items.filter(i=>i.role==='transport').length,1);
  const extra=build('heat_pump',{services:[{role:'transport',name:'Ďalší výjazd',price:60,extra:true}]});assert.equal(byRole(extra,'transport').price,60);
});

test('template copy/edit/export/import strips quote context and protects issued quote data',()=>{
  const result=build('heat_pump',{stocks:[stock('138023023208850005',12)]});
  const quote={...result,customer:{name:'Súkromný zákazník'},warranty_consent:{signature_data_url:'SECRET'},material_edits:{assemblies:{groups:result.groups}}};
  const before=clone(quote),g=result.groups.find(x=>x.kind==='material');
  const saved=S.templateFromGroup(quote,g.id,{id:'template-A',name:'Overený materiál',now:'2026-10-07T20:00:00Z'});
  assert.equal(saved.status,'draft');assert.equal(saved.version,1);
  assert.ok(saved.rows.every(r=>r.quantity_rule.type==='fixed'));
  const json=S.exportTemplates([saved]);assert.ok(!json.includes('Súkromný zákazník'));assert.ok(!json.includes('SECRET'));
  assert.deepEqual(S.importTemplates(json),[saved]);
  const updated=S.updateTemplate(saved,{name:'Nový názov',status:'verified',now:'2026-10-08T20:00:00Z'});
  assert.equal(updated.version,2);assert.equal(updated.status,'verified');assert.equal(saved.name,'Overený materiál');
  const copied=S.copyTemplate(updated,{id:'template-B'});assert.equal(copied.version,1);assert.equal(copied.status,'draft');
  assert.equal(S.saveTemplate([saved],updated)[0].version,2);
  assert.throws(()=>S.saveTemplate([updated],saved),/novšiu verziu/);
  assert.deepEqual(quote,before);
});

test('fixed template price remains the agreed package amount when live stock price changes',()=>{
  const r=build('heat_pump',{stocks:[stock('MONT',900,{plu:'63'})]});
  const g=r.groups.find(x=>x.kind==='labor');const q={...r,material_edits:{assemblies:{groups:r.groups}}};
  const saved=S.templateFromGroup(q,g.id,{id:'fixed',name:'Montáž dohodnutá'});saved.rows[0].price=850;
  const result=S.instantiateTemplate(saved,{stocks:[stock('MONT',1200,{plu:'63'})]});
  assert.equal(result.items.length,1);assert.equal(result.items[0].price,850);
  assert.ok(result.groups[0].contents.length);
  assert.equal(S.instantiateTemplate(saved,{refreshPrices:true,stocks:[stock('MONT',1200,{plu:'63'})]}).items[0].price,1200);
});

test('unsafe or invalid imports and formulas cannot become executable configuration',()=>{
  assert.throws(()=>S.importTemplates('{"format":"spektra.hvac-templates","version":1,"templates":[],"__proto__":{"polluted":true}}'),/Nepovolené/);
  assert.equal({}.polluted,undefined);
  assert.throws(()=>S.validateRule({type:'eval',formula:'process.exit()'}),/Neplatný typ/);
  assert.throws(()=>S.validateRule({type:'sum',parameters:['water_outlets'],weights:[1,2]}),/koeficientov/);
  assert.throws(()=>S.validateRule({type:'parameter',parameter:'__proto__'}),/názov parametra/);
  assert.throws(()=>S.normalizeParameters('heat_pump',{route_m:-1}),/nezáporné/);
  assert.throws(()=>S.normalizeParameters('heat_pump',{route_m:Infinity}),/neplatné číslo/);
  assert.throws(()=>S.importTemplates('{bad}'),/platný JSON/);
  assert.throws(()=>S.importTemplates(JSON.stringify({format:S.FORMAT,version:99,templates:[]})),/Nepodporovaný/);
});

test('editing template row values updates quantity rule and preserves explicit prices, costs and catalog ids',()=>{
  const original=S.validateTemplate({id:'one',name:'Potrubie',kind:'material',rows:[{name:'Pôvodný názov',qty:5,unit:'m',price:12,cost:7,catalog_ref:{source:'pohoda',code:'CU28',id:'stock-CU28'}}]});
  const rows=clone(original.rows);Object.assign(rows[0],{name:'Názov zákazníka',qty:8,price:15,cost:0});
  const updated=S.updateTemplate(original,{rows});
  assert.deepEqual(updated.rows[0].quantity_rule,{type:'fixed',qty:8});
  const instance=S.instantiateTemplate(updated,{stocks:[stock('CU28',99)]});
  assert.equal(instance.items[0].qty,8);assert.equal(instance.items[0].price,15);assert.equal(instance.items[0].cost,0);
  assert.equal(instance.items[0].cost_override,true);assert.equal(instance.items[0].name,'Názov zákazníka');
  assert.equal(meta(instance.items[0]).catalog_ref.id,'stock-CU28');
});

test('existing recipes adapt into valid reusable groups without duplicate billed fixed-package components',()=>{
  const templates=S.recipesToAssemblies(recipes);
  assert.ok(templates.length>=recipes.bundles.length);
  templates.forEach(t=>S.validateTemplate(t));
  const mono=templates.find(t=>t.id==='hp_monoblock_5m:labor');
  assert.equal(mono.rows.length,1);assert.ok(mono.contents.some(i=>i.name.includes('jadrové')));
  const instance=S.instantiateTemplate(mono,{stocks:[]});assert.equal(instance.items.length,1);
  const service=templates.find(t=>t.id==='hp_optional_services:service');
  const optional=S.instantiateTemplate(service);assert.ok(!optional.items.some(x=>x.role==='annual_service'));
});

test('all six generated scenarios satisfy the shared assembly engine contract',()=>{
  const A=require('../js/quote-assemblies.js');
  for(const s of S.list()){
    const q={id:'integration-'+s.id,status:'draft',items:[]};
    const r=build(s.id,{parameters:s.id==='ac_multi'?{branch_lengths:[3,7]}:{}});
    A.addScenario(q,r);
    assert.equal(q.items.length,r.items.length);
    const preview=A.previewQuantities(q,q.material_edits.assemblies.parameters);
    assert.deepEqual(preview.changes,[],s.id+' starts with consistent quantities');
    assert.deepEqual(preview.missing,[],s.id+' has all rule parameters');
    assert.equal(q.material_edits.assemblies.scenarios.length,1);
  }
});

test('saved template retains its own margin rule through import and uses new verified costs',()=>{
  const q={items:[{role:'pipe',name:'Potrubie',qty:2,unit:'m',price:125,cost:100,
    stored_metadata:{quote_assembly:{id:'r1',group_id:'g1',kind:'material',catalog_ref:{id:'stock-P',code:'P'},price_rule:{mode:'margin',value:20},quantity_rule:{type:'fixed',qty:2}}}}],
    material_edits:{assemblies:{groups:[{id:'g1',name:'Pripojenie',kind:'material',pricing:'computed'}]}}};
  const t=S.templateFromGroup(q,'g1',{id:'priced'});
  const [restored]=S.importTemplates(S.exportTemplates([t]));
  const instance=S.instantiateTemplate(restored,{stocks:[stock('P',999,{purchase_price_ex_vat:120})]});
  assert.equal(instance.items[0].price,150);
  assert.deepEqual(meta(instance.items[0]).price_rule,{mode:'margin',value:20});
  assert.equal(q.items[0].price,125);
  const unknown=S.instantiateTemplate(restored,{stocks:[stock('P',999,{purchase_price_ex_vat:0})]});
  assert.equal(unknown.items[0].price,null,'unknown zero cost must not produce an apparently free margin-priced product');
  const missing=S.instantiateTemplate(restored,{stocks:[stock('P',999,{purchase_price_ex_vat:null})]});
  assert.equal(missing.items[0].cost,null);assert.equal(missing.items[0].price,null,'missing current purchase cost must not use an old template cost');
  assert.throws(()=>S.validatePriceRule({mode:'margin',value:100}),/menšia/);
});

test('copying a quote template keeps its trade classification without customer metadata',()=>{
  const r=build('zti');
  const q={...r,category:'zti',system_type:'service',customer:{name:'Private'},material_edits:{assemblies:{groups:r.groups}}};
  const t=S.templateFromGroup(q,r.groups.find(g=>g.kind==='material').id,{id:'zti'});
  const copied=S.copyTemplate(t,{id:'copy'});
  assert.equal(S.instantiateTemplate(copied).scenario.category,'zti');
  assert.equal(S.instantiateTemplate(copied).scenario.system_type,'service');
  assert.ok(!JSON.stringify(copied).includes('Private'));
});

test('fixed template counts scale charged units and quantified contents through recalc, purchase and customer output',()=>{
  const A=require('../js/quote-assemblies.js'),O=require('../js/quote-workbench-output.js'),Rows=require('../js/quote-row-output.js');
  const template=S.validateTemplate({id:'fixed-material',name:'Pripojovací balík',kind:'material',pricing:'fixed',rows:[
    {name:'Pripojovací balík',role:'quote_manual',kind:'material',qty:1,unit:'súb.',price:100,cost:60}],contents:[
    {name:'Ventil',kind:'material',qty:2,unit:'ks',catalog_ref:{source:'pohoda',id:'valve',code:'VALVE'}},{name:'Kontrola zostavy'}]});
  const copied=clone(template);copied.parameters={assembly_count:3};
  for(const row of copied.rows)row.quantity_rule={type:'parameter',parameter:'assembly_count',factor:row.qty};
  const result=S.instantiateTemplate(copied,{parameters:copied.parameters});
  assert.equal(result.items[0].qty,3);assert.equal(result.items[0].price,100);assert.equal(result.groups[0].contents_basis_quantity,1);
  const q={id:'counts',status:'draft',items:[],vat_pct:23};const added=A.addScenario(q,result),key=added.scenario.parameters.assembly_count;
  assert.equal(A.groups(q)[0].contents[0].qty,6);assert.equal(A.procurement(q).items[0].qty,6);assert.equal(O.purchaseRows(q)[0].qty,6);
  assert.equal(A.groups(q)[0].contents[1].qty,undefined,'textual operation has no invented quantity');
  A.setOutput(q,{material:'detail'});
  assert.equal(Rows.customerModel(q).rows.find(r=>r.name==='Ventil').qty,6);
  const before=JSON.stringify(q);O.purchaseRows(q);Rows.customerModel(q);assert.equal(JSON.stringify(q),before,'output cannot alter source basis');
  A.applyQuantities(q,A.previewQuantities(q,{[key]:5}));
  assert.equal(q.items[0].qty,5);assert.equal(q.items[0].price,100);assert.equal(A.procurement(q).items[0].qty,10);
  assert.equal(O.purchaseRows(q)[0].qty,10);assert.equal(Rows.customerModel(q).rows.find(r=>r.name==='Ventil').qty,10);
  A.setField(q,0,'qty',4);assert.equal(A.groups(q)[0].contents[0].qty,8);
  const stored=S.templateFromGroup(q,A.groups(q)[0].id,{id:'saved-count'});
  const again=S.instantiateTemplate(stored,{parameters:{assembly_count:2}});
  const second={id:'next',status:'draft',items:[]};A.addScenario(second,again);
  assert.equal(second.items[0].qty,8);assert.equal(A.procurement(second).items[0].qty,16);
});

test('fixed quantified contents keep the basis when copying or selecting an optional group snapshot',()=>{
  const A=require('../js/quote-assemblies.js');
  const t={id:'fixed',name:'Balík',kind:'material',pricing:'fixed',rows:[{name:'Balík',qty:2,unit:'súb.',price:100,cost:60}],
    contents:[{name:'Ventil',kind:'material',qty:3,unit:'ks',catalog_ref:{code:'VALVE'}}]};
  const q={id:'copy',status:'draft',items:[]};A.addScenario(q,S.instantiateTemplate(t,{parameters:{assembly_count:3}}));
  assert.equal(q.items[0].qty,6);assert.equal(A.groups(q)[0].contents[0].qty,9);
  const original=A.groups(q)[0];A.copyGroup(q,original.id);
  assert.equal(A.procurement(q).items[0].qty,18);
  const option=A.addOptional(q,{name:original.name,kind:original.kind,groups:[original],items:original.rows});
  A.removeGroup(q,original.id);A.selectOptional(q,option.id,true);
  assert.equal(A.procurement(q).items[0].qty,18,'optional group view must not multiply expanded contents again');
  const g=A.groups(q).find(x=>x.id===original.id)||A.groups(q).find(x=>x.rows.some(r=>A.metadata(r).optional_id===option.id));
  const contents=clone(g.contents);contents[0].name='Upravený ventil';A.updateGroup(q,g.id,{contents});
  assert.equal(A.groups(q).find(x=>x.id===g.id).contents[0].qty,9);
  A.setField(q,g.rows[0].stored_metadata.quote_assembly.id,'qty',4);
  assert.equal(A.groups(q).find(x=>x.id===g.id).contents[0].qty,6);
});

test('number of templates cannot silently partly multiply imported route formulas',()=>{
  const t=S.validateTemplate({id:'parametric',name:'Trasa',kind:'material',parameters:{route_m:5},rows:[
    {name:'Potrubie',qty:5,unit:'m',price:10,cost:5,quantity_rule:{type:'parameter',parameter:'route_m'}},
    {name:'Koleno',qty:2,unit:'ks',price:5,cost:2,quantity_rule:{type:'fixed',qty:2}}]});
  const before=clone(t);
  assert.throws(()=>S.instantiateTemplate(t,{parameters:{route_m:5,assembly_count:3}}),/vlastné parametre množstva/);
  assert.deepEqual(t,before);
  const one=S.instantiateTemplate(t,{parameters:{route_m:7,assembly_count:1}});assert.deepEqual(one.items.map(x=>x.qty),[7,2]);
  assert.throws(()=>S.instantiateTemplate(t,{parameters:{route_m:5,assembly_count:0}}),/väčší ako nula/);
});

test('company pricing sees a saved fixed package as an explicit price and scopes default changes to inserted rows',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),A=require('../js/quote-assemblies.js');
  const code=fs.readFileSync(path.join(__dirname,'../js/quote-workbench.js'),'utf8');
  const start=code.indexOf('  function companyPrices('),end=code.indexOf('\n  function previewCompanyPricing(',start);
  assert.ok(start>=0&&end>start);
  const apply=vm.runInNewContext('('+code.slice(start,end).trim()+')',{A:()=>A,clone,state:{library:[]}});
  const q={id:'pricing-count',status:'draft',items:[{name:'Pôvodný materiál',role:'pipe',qty:1,unit:'m',price:12,cost:7}]};A.init(q);
  const fixed=S.instantiateTemplate({id:'fixed',name:'Balík',kind:'material',pricing:'fixed',rows:[{name:'Balík',qty:1,unit:'súb.',price:100,cost:60}]},{parameters:{assembly_count:3}});
  const added=A.addScenario(q,fixed);apply(q,{material_mode:'markup',material_value:50},new Set(added.items.map(A.rowId)));
  assert.equal(q.items[0].price,12);assert.equal(q.items[1].price,100);assert.equal(q.items[1].qty,3);
  assert.equal(A.groups(q).find(g=>g.rows.some(r=>A.rowId(r)===A.rowId(q.items[1]))).pricing,'fixed');
  const computed=S.instantiateTemplate({id:'computed',name:'Nový materiál',kind:'material',rows:[{name:'Materiál',qty:1,unit:'m',price:20,cost:10}]});
  const more=A.addScenario(q,computed);apply(q,{material_mode:'markup',material_value:50},new Set(more.items.map(A.rowId)));
  assert.equal(q.items[0].price,12);assert.equal(q.items[1].price,100);assert.equal(q.items[2].price,15);
});
