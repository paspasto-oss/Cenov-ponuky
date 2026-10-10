/* Spektra HVAC scenario library. Pure data only: no DOM, network, storage or eval.
 * Recipes and current stock cards are injected by the existing application.
 * Returned rows are quote snapshots; catalog updates never change them in place.
 */
(function(root){
  'use strict';
  const VERSION=1;
  const FORMAT='spektra.hvac-templates';
  const KINDS=new Set(['equipment','material','labor','transport','revision','pressure','service','text','other']);
  const FORBIDDEN=new Set(['__proto__','prototype','constructor']);
  const source={file:'mobile-v4/data/bundle-recipes.json',quantity_source:'Existujúce zostavy Spektra'};
  const field=(key,label,type,defaultValue,extra={})=>({key,label,type,default:defaultValue,...extra});
  const SCENARIOS=[
    {id:'heat_pump',name:'Tepelné čerpadlo',category:'heat_pump',device_required:true,parameters:[
      field('system_type','Vyhotovenie','select','monoblock',{options:[['monoblock','Monoblok'],['split','Split']]}),
      field('route_m','Dĺžka trasy','number',5,{unit:'m',min:0,step:0.5}),
      field('dhw_solution','Ohrev TÚV','select','none',{options:[['none','Bez zásobníka'],['integrated','Integrovaný zásobník / AiO'],['external','Externý zásobník']]}),
      field('installation_tier','Montáž','select','standard',{options:[['standard','Štandard'],['economy','Ekonom – pripravená stavba']]}),
      field('power_cable_m','Napájací kábel','number',12,{unit:'m',min:0,step:0.5}),
      field('control_cable_m','Komunikačný kábel','number',10,{unit:'m',min:0,step:0.5}),
      field('trunking_m','Elektroinštalačná lišta','number',10,{unit:'m',min:0,step:0.5})]},
    {id:'gas_boiler',name:'Plynový kotol',category:'boiler',boiler_type:'gas',device_required:true,parameters:[
      field('flue_m','Dĺžka odvodu spalín','number',8,{unit:'m',min:0,step:0.5})]},
    {id:'biomass',name:'Kotol na biomasu',category:'boiler',boiler_type:'biomass',device_required:true,parameters:[
      field('pipe_m','Potrubie pripojenia','number',4,{unit:'m',min:0,step:0.5})]},
    {id:'ac_single',name:'Klimatizácia monosplit',category:'air_conditioning',ac_mode:'single',device_required:true,parameters:[
      field('route_m','Dĺžka trasy','number',5,{unit:'m',min:0,step:0.5,help:'Základná montáž už zahŕňa materiál do 3 m. Samostatne sa účtuje len predĺženie.'})]},
    {id:'ac_multi',name:'Klimatizácia multisplit',category:'air_conditioning',ac_mode:'multi',device_required:true,parameters:[
      field('indoor_count','Počet vnútorných jednotiek','number',2,{min:2,max:8,step:1}),
      field('branch_lengths','Trasa každej vnútornej jednotky','branches',[5,5],{unit:'m',min:0,step:0.5}),
      field('power_cable_m','Spoločný napájací kábel','number',5,{unit:'m',min:0,step:0.5})]},
    {id:'floor_heating_rehau',name:'Podlahové kúrenie REHAU',category:'floor_heating',device_required:false,parameters:[
      field('area_m2','Vykurovaná plocha','number',100,{unit:'m²',min:1,step:0.5}),
      field('spacing_mm','Rozstup potrubia','select','150',{options:[['100','100 mm'],['150','150 mm'],['200','200 mm']]}),
      field('pipe_length_m','Potrubie – vlastné množstvo (0 = automaticky)','number',0,{unit:'m',min:0,step:1}),
      field('circuits','Počet okruhov (0 = automaticky)','number',0,{unit:'ks',min:0,step:1}),
      field('manifold_count','Počet rozdeľovačov (0 = automaticky)','number',0,{unit:'ks',min:0,step:1}),
      field('perimeter_m','Okrajová páska – vlastný obvod (0 = odhad)','number',0,{unit:'m',min:0,step:0.5}),
      field('installation_rate','Montáž bez DPH za m²','number',0,{unit:'€/m²',min:0,step:0.5,help:'Vyplňte firemnú sadzbu montáže.'})]},
    {id:'zti',name:'ZTI – vývody a rozvody',category:'other',trade_type:'zti',device_required:false,parameters:[
      field('water_outlets','Vývody vody 16 × 1/2','number',1,{unit:'ks',min:0,step:1}),
      field('waste_outlets','Vývody odpadu DN50','number',0,{unit:'ks',min:0,step:1}),
      field('washing_siphons','Práčkové sifóny','number',0,{unit:'ks',min:0,step:1}),
      field('wc_duofix','WC Geberit Duofix','number',0,{unit:'ks',min:0,step:1}),
      field('boiler_outlets','Vývody technickej miestnosti','number',0,{unit:'ks',min:0,step:1}),
      field('frost_valves','Nezamŕzavé ventily','number',0,{unit:'ks',min:0,step:1}),
      field('main_water_shutoffs','Hlavné uzávery vody','number',0,{unit:'ks',min:0,step:1}),
      field('pipe16_m','Potrubie 16 + izolácia','number',0,{unit:'m',min:0,step:0.5}),
      field('pipe20_m','Potrubie 20 + izolácia','number',0,{unit:'m',min:0,step:0.5}),
      field('pipe25_m','Potrubie 25 + izolácia','number',0,{unit:'m',min:0,step:0.5}),
      field('job_type','Typ prác','select','newbuild',{options:[['newbuild','Novostavba'],['renovation','Rekonštrukcia']]}),
      field('labor_rate','Sadzba práce bez DPH','number',35,{unit:'€/čh',min:0,step:0.5,help:'Existujúci sadzobník ZTI: novostavba 35 €, rekonštrukcia 40 €. Možno upraviť.'})]}
  ];
  const ALIASES={hp_monoblock_5m:'heat_pump',hp_split_5m:'heat_pump',boiler_gas_standard:'gas_boiler',boiler_biomass_standard:'biomass',ac_single_split_5m:'ac_single',ac_multisplit_5m:'ac_multi',zti_water_outlet:'zti'};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const text=value=>String(value??'').trim();
  const round=value=>Math.round((value+Number.EPSILON)*1000)/1000;
  const nullable=value=>value==null||value===''||typeof value==='boolean'||!Number.isFinite(Number(value))?null:Number(value);
  function valueNumber(value,label='hodnota',fallback){
    if((value===undefined||value===null||value==='')&&fallback!==undefined)return fallback;
    if(typeof value==='boolean')throw new Error('Neplatná číselná hodnota: '+label+'.');
    const n=Number(typeof value==='string'?value.trim().replace(',','.'):value);
    if(!Number.isFinite(n)||n<0||n>100000000)throw new Error('Zadajte nezáporné číslo: '+label+'.');
    return round(n);
  }
  function string(value,label,max=500){
    if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))throw new Error('Neplatný '+label+'.');
    return value.trim();
  }
  function safeData(value,depth=0){
    if(depth>20)throw new Error('Údaje zostavy sú príliš vnorené.');
    if(value===null||typeof value==='string'||typeof value==='boolean')return;
    if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Údaje obsahujú neplatné číslo.');return;}
    if(typeof value!=='object')throw new Error('Zostava musí obsahovať iba údaje JSON.');
    if(Array.isArray(value)){if(value.length>10000)throw new Error('Zostava obsahuje priveľa položiek.');value.forEach(v=>safeData(v,depth+1));return;}
    if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new Error('Neplatný objekt zostavy.');
    for(const k of Object.keys(value)){if(FORBIDDEN.has(k))throw new Error('Nepovolené pole v zostave.');safeData(value[k],depth+1);}
  }
  function randomId(prefix){
    return prefix+'-'+(root.crypto?.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10));
  }
  function list(){return clone(SCENARIOS);}
  function describe(id){
    const d=SCENARIOS.find(x=>x.id===(ALIASES[id]||id));
    if(!d)throw new Error('Neznámy HVAC scenár: '+text(id)+'.');
    return clone(d);
  }
  function normalizeParameters(id,input={},device={}){
    safeData(input);
    const d=describe(id),out={};
    for(const f of d.parameters){
      const raw=own(input,f.key)?input[f.key]:clone(f.default);
      if(f.type==='number'){
        out[f.key]=valueNumber(raw,f.label);
        if(f.min!=null&&out[f.key]<f.min||f.max!=null&&out[f.key]>f.max||f.step===1&&!Number.isInteger(out[f.key]))throw new Error('Neplatný rozsah: '+f.label+'.');
      }else if(f.type==='select'){
        if(!f.options.some(([v])=>v===raw))throw new Error('Neplatná voľba: '+f.label+'.');
        out[f.key]=raw;
      }
    }
    if(d.id==='heat_pump'){
      if(!own(input,'system_type')&&['monoblock','split'].includes(device.system_type))out.system_type=device.system_type;
      if(id==='hp_split_5m')out.system_type='split';
      if(!own(input,'dhw_solution')&&input.with_external_dhw_tank===true)out.dhw_solution='external';
    }
    if(d.id==='ac_multi'){
      const branches=input.branch_lengths;
      if(branches!==undefined&&(!Array.isArray(branches)||branches.length<2||branches.length>8))throw new Error('Zadajte dĺžky 2 až 8 vetiev multisplitu.');
      if(Array.isArray(branches)&&!own(input,'indoor_count'))out.indoor_count=branches.length;
      if(!own(input,'indoor_count')&&!branches&&device.multisplit_count!=null)out.indoor_count=valueNumber(device.multisplit_count,'Počet jednotiek');
      if(!Number.isInteger(out.indoor_count)||out.indoor_count<2||out.indoor_count>8)throw new Error('Zadajte 2 až 8 vnútorných jednotiek.');
      if(branches&&branches.length!==out.indoor_count)throw new Error('Počet dĺžok trás sa musí zhodovať s počtom vnútorných jednotiek.');
      out.branch_lengths=Array.from({length:out.indoor_count},(_,i)=>valueNumber(branches?branches[i]:(input['branch_'+(i+1)+'_m']??5),'Dĺžka vetvy '+(i+1)));
      out.branch_lengths.forEach((v,i)=>{out['branch_'+(i+1)+'_m']=v;});
    }
    if(d.id==='floor_heating_rehau'){
      const m=out.spacing_mm==='100'?10:out.spacing_mm==='200'?5:6.7;
      out.pipe_calculated_m=Math.ceil(round(out.area_m2*m*1.10));
      out.pipe_total_m=out.pipe_length_m||out.pipe_calculated_m;
      out.board_m2=Math.ceil(round(out.area_m2*1.05*100))/100;
      out.circuits_total=out.circuits||Math.ceil(out.area_m2*m/90);
      out.manifolds_total=out.manifold_count||Math.ceil(out.circuits_total/12);
      out.edge_tape_m=out.perimeter_m||Math.ceil(out.area_m2*0.45);
      if(out.circuits_total<out.manifolds_total)throw new Error('Počet rozdeľovačov nesmie prevyšovať počet okruhov.');
      if(out.circuits_total>out.manifolds_total*12)throw new Error('Na zvolený počet okruhov treba viac rozdeľovačov (max. 12 okruhov na jeden).');
    }
    if(d.id==='zti'&&!own(input,'labor_rate'))out.labor_rate=out.job_type==='renovation'?40:35;
    return out;
  }
  function fixed(qty){return {type:'fixed',qty:valueNumber(qty,'množstvo')};}
  function parameter(name,factor=1,offset=0){return {type:'parameter',parameter:name,factor,offset,min:0};}
  function validateRule(rule){
    safeData(rule);
    if(!rule||typeof rule!=='object')throw new Error('Chýba pravidlo množstva.');
    if(rule.type==='fixed')return fixed(rule.qty);
    if(rule.type!=='parameter'&&rule.type!=='sum')throw new Error('Neplatný typ pravidla množstva.');
    const names=rule.type==='sum'?rule.parameters:[rule.parameter];
    if(!Array.isArray(names)||!names.length||names.length>20)throw new Error('Neplatné parametre pravidla množstva.');
    names.forEach(n=>{if(typeof n!=='string'||!n||n.length>200||FORBIDDEN.has(n))throw new Error('Neplatný názov parametra.');});
    const result={type:rule.type,factor:valueNumber(rule.factor??1,'násobok'),offset:Number(rule.offset??0),min:valueNumber(rule.min??0,'minimum')};
    if(!Number.isFinite(result.offset)||Math.abs(result.offset)>100000000)throw new Error('Neplatná korekcia množstva.');
    if(rule.type==='sum'){
      result.parameters=names.slice();
      if(rule.weights!==undefined){
        if(!Array.isArray(rule.weights)||rule.weights.length!==names.length)throw new Error('Počet koeficientov sa nezhoduje s parametrami.');
        result.weights=rule.weights.map(v=>valueNumber(v,'koeficient'));
      }
    }else result.parameter=names[0];
    if(rule.ceil_step!==undefined){result.ceil_step=valueNumber(rule.ceil_step,'zaokrúhlenie');if(!result.ceil_step)throw new Error('Krok zaokrúhlenia musí byť kladný.');}
    if(rule.zero_when_empty!==undefined){if(typeof rule.zero_when_empty!=='boolean')throw new Error('Neplatná podmienka prázdneho rozsahu.');result.zero_when_empty=rule.zero_when_empty;}
    if(rule.ceil!==undefined){if(typeof rule.ceil!=='boolean')throw new Error('Neplatné zaokrúhlenie množstva.');result.ceil=rule.ceil;}
    return result;
  }
  function evaluateRule(rule,parameters={}){
    const r=validateRule(rule);
    if(r.type==='fixed')return r.qty;
    const names=r.type==='sum'?r.parameters:[r.parameter];
    const values=names.map(k=>{if(!own(parameters,k))throw new Error('Chýba parameter '+k+'.');return valueNumber(parameters[k],k);});
    if(r.zero_when_empty&&values.every(v=>v===0))return 0;
    let n=values.reduce((sum,v,index)=>sum+v*(r.weights?.[index]??1),0);
    n=Math.max(r.min,n*r.factor+r.offset);
    if(r.ceil_step)n=Math.ceil(round(n)/r.ceil_step-1e-9)*r.ceil_step;
    return valueNumber(r.ceil?Math.ceil(n):round(n),'vypočítané množstvo');
  }
  function validatePriceRule(rule){
    safeData(rule);
    if(!rule||!['catalog','markup','margin','fixed'].includes(rule.mode))throw new Error('Neplatné cenové pravidlo zostavy.');
    if(rule.mode==='catalog')return {mode:'catalog'};
    const value=nullable(rule.value);
    if(value==null||value<0||value>=100000000)throw new Error('Doplňte nezápornú hodnotu cenového pravidla.');
    if(rule.mode==='margin'&&value>=100)throw new Error('Marža musí byť menšia ako 100 %.');
    return {mode:rule.mode,value};
  }
  function priceFromCost(rule,cost,catalogPrice){
    const r=validatePriceRule(rule);
    if(r.mode==='catalog')return nullable(catalogPrice);
    if(r.mode==='fixed')return r.value;
    if(cost==null)return null;
    const raw=r.mode==='margin'?cost/(1-r.value/100):cost*(1+r.value/100);
    return Math.round((raw+Number.EPSILON)*10000)/10000;
  }
  function reference(item={}){
    const m=item.stored_metadata?.quote_assembly?.catalog_ref||item.stored_metadata?.quote_material?.catalog_ref;
    const st=item.pohoda||item.stock||item;
    if(m)return {...clone(m),source:m.source||'pohoda'};
    return {source:'pohoda',...(st.match_by==='code'?{match_by:'code'}:{}),id:st.id??null,fingerprint:st.fingerprint??null,plu:st.plu??st.pohoda_plu??null,
      code:st.code??st.pohoda_code??null,storage_ref:st.storage_ref??null,pohoda_stock_id:st.pohoda_stock_id??item.pohoda_stock_id??null};
  }
  function findStock(ref,stocks=[]){
    if(!ref)return null;
    const pool=stocks.filter(x=>x&&x.active!==false&&(!ref.storage_ref||String(x.storage_ref??'')===String(ref.storage_ref)));
    if(ref.match_by==='code'){
      const code=text(ref.code);if(!code)return null;
      const matches=stocks.filter(x=>x&&x.active!==false&&text(x.code)===code);
      if(matches.length===1)return matches[0];
      const scoped=ref.storage_ref?matches.filter(x=>String(x.storage_ref??'')===String(ref.storage_ref)):[];
      return scoped.length===1?scoped[0]:null;
    }
    const identity=ref.id?'id':ref.fingerprint?'fingerprint':ref.pohoda_stock_id?'pohoda_stock_id':null;
    if(identity){const rows=pool.filter(x=>String(x[identity]??'')===String(ref[identity]));return rows.length===1?rows[0]:null;}
    // A recipe may contain both identifiers. Require agreement when both exist.
    let matches=pool.filter(x=>(ref.code&&text(x.code)===text(ref.code))||(ref.plu&&text(x.plu)===text(ref.plu)));
    if(ref.code&&ref.plu){const exact=matches.filter(x=>text(x.code)===text(ref.code)&&text(x.plu)===text(ref.plu));if(exact.length===1)return exact[0];}
    return matches.length===1?matches[0]:null;
  }
  function recipeArray(recipes){
    const out=Array.isArray(recipes)?recipes:recipes?.bundles;
    return Array.isArray(out)?out:[];
  }
  function kindFor(r){
    if(r.kind&&KINDS.has(r.kind))return r.kind;
    if(r.role==='quote_text')return 'text';
    if(['device','multisplit_indoor_units','dhw_storage_tank','dhw_tank_fe120'].includes(r.role))return 'equipment';
    if(r.role==='installation'||r.role==='installation_service'||r.mapping_status==='included_in_installation')return 'labor';
    if(r.role==='transport')return 'transport';
    if(r.role==='revision')return 'revision';
    if(r.role==='pressure'||r.role==='pressure_test')return 'pressure';
    if(r.charge_mode||r.visible_to_customer||['annual_service','heating_system_flush_cleaner_inhibitor'].includes(r.role)||(r.role||'').endsWith('_service'))return 'service';
    return 'material';
  }
  function ruleFor(r,bundleKey){
    if(r.quantity_rule)return validateRule(r.quantity_rule);
    if(r.qty_formula){
      const formula=text(r.qty_formula).replace(/\s+/g,'');
      if(formula==='2*route_m')return parameter('route_m',2);
      if(formula==='route_m')return parameter('route_m');
      throw new Error('Nepodporovaný vzorec množstva pre '+text(r.expected_name||r.role)+'.');
    }
    if(bundleKey==='ac_single_split_5m'&&r.role!=='installation_service'&&r.unit==='m')return parameter('route_m',1,-3);
    if(bundleKey==='hp_split_5m'&&['refrigerant_pipe_pair_3_8_5_8','condensate_drain'].includes(r.role))return parameter('route_m');
    if(bundleKey==='boiler_gas_standard'&&r.role==='flue_flex_dn60_black')return parameter('flue_m');
    if(bundleKey==='boiler_biomass_standard'&&r.role==='carbon_steel_pipe_28')return parameter('pipe_m');
    if(bundleKey==='hp_electrical_standard'){
      if(r.role==='power_cable_cyky_5x2_5')return parameter('power_cable_m');
      if(r.role==='control_cable_4x0_75')return parameter('control_cable_m');
      if(r.role==='installation_trunking_40x40')return {...parameter('trunking_m',0.5),ceil:true};
    }
    return fixed(r.qty??r.qty_at_5m??1);
  }
  function pipeRecipe(power){
    const p=nullable(power);
    if(p==null||p<=0)return {expected_name:'Chladivové potrubie – zvoľte rozmer',mapping_status:'needs_compatibility_check'};
    const x=p<=3.6?['2RGC2GRE#GA075AC075','104992','Predizolované Cu potrubie 1/4 × 3/8 × 0,8 mm']:
      p<=5.5?['2RGC2GRE#GA075AD075','104993','Predizolované Cu potrubie 1/4 × 1/2 × 0,8 mm']:
      ['2RGC2GRE#GC075AE100','104991','Predizolované Cu potrubie 3/8 × 5/8'];
    return {pohoda_code:x[0],pohoda_plu:x[1],expected_name:x[2],mapping_status:'spektra_power_default',note:'Predvolený rozmer podľa existujúceho firemného pravidla; potvrdiť podľa pripojení konkrétnej jednotky.'};
  }
  function makeContext(input,d,p){
    return {input,d,p,items:[],groups:[],optional:[],warnings:[],checks:[],covered:new Set(),counter:0,
      instance:text(input.instanceId)||d.id,stocks:Array.isArray(input.stocks)?input.stocks:[],recipes:recipeArray(input.recipes)};
  }
  function warn(c,code,message,row){
    if(!c.warnings.includes(message))c.warnings.push(message);
    c.checks.push({code,message,...(row?{row_id:row.stored_metadata.quote_assembly.id}: {})});
  }
  function group(c,id,name,kind,pricing='computed',templateId){
    let g=c.groups.find(x=>x.id===id);
    if(!g){g={id,name,kind,pricing,template_id:templateId||null,template_version:c.input.recipes?.version??null};c.groups.push(g);}
    return g;
  }
  function row(c,r,groupId,templateId,rule,options={}){
    const ref=r.catalog_ref||reference({code:r.pohoda_code??r.code,plu:r.pohoda_plu??r.plu,id:r.pohoda_stock_id??null,storage_ref:r.storage_ref??null});
    const st=options.stock||findStock(ref,c.stocks);
    const kind=options.kind||kindFor(r),qty=evaluateRule(rule,c.p);
    const priceOverride=r.price_override===true||options.fixedPackage===true;
    const tier=r.installation_tiers?.[c.p.installation_tier]?.price_ex_vat;
    let cost=kind==='text'?null:options.preserveCost?nullable(r.cost):st?nullable(st.purchase_price_ex_vat):nullable(r.cost);
    let price=options.preservePrice?nullable(r.price):(nullable(st?.sell_price_ex_vat)??nullable(r.price)??nullable(tier)??nullable(r.default_sell_price_ex_vat));
    if(options.template&&st&&!options.preservePrice)price=nullable(st.sell_price_ex_vat);
    if(r.price_rule&&!options.preservePrice)price=priceFromCost(r.price_rule,cost!=null&&(cost>0||r.cost_override===true||r.cost_known===true)?cost:null,price);
    if(templateId==='boiler_gas_standard'&&r.role==='installation_service'&&r.default_sell_price_ex_vat!=null)price=nullable(r.default_sell_price_ex_vat);
    if(r.mapping_status==='included_in_installation')price=0;
    const missingCodeCard=ref.match_by==='code'&&!st;
    const unitKey=v=>text(v).toLowerCase().replace('²','2').replace('³','3');
    const codeUnitChanged=ref.match_by==='code'&&st&&r.unit&&unitKey(r.unit)!==unitKey(st.unit);
    if(missingCodeCard||codeUnitChanged){price=null;cost=null;} // Never bill stale prices or pack prices for metre quantities.
    if(codeUnitChanged)warn(c,'catalog_unit_changed','Skladová karta zmenila MJ: '+text(st.name)+'. Znovu priraďte kartu a potvrďte množstvo.');
    const item={role:r.role||(kind==='text'?'quote_text':'quote_manual'),name:text(options.name||st?.name||r.name||r.expected_name||r.role)||'Položka',
      qty,unit:text(r.unit||st?.unit)||'ks',price:kind==='text'?null:price,
      cost,
      pohoda:st?clone(st):null,pohoda_code:st?.code??ref.code??null,pohoda_stock_id:st?.pohoda_stock_id??r.pohoda_stock_id??null,
      visible:kind!=='material',customer_group:options.customer_group||c.groups.find(g=>g.id===groupId)?.name||r.customer_group||'',
      mapping_status:missingCodeCard?'catalog_item_missing':codeUnitChanged?'catalog_unit_changed':st?'mapped':r.mapping_status||'unmapped',note:text(r.note),work_scope:Array.isArray(r.work_scope)?r.work_scope.map(text).filter(Boolean):[],
      ...(priceOverride?{price_override:true}:{}),...(r.cost_override===true?{cost_override:true}:{}),
      stored_metadata:{quote_assembly:{id:c.instance+':row:'+(++c.counter),group_id:groupId,kind,
        scenario_id:c.d.id,origin:'scenario',template_id:templateId||null,template_version:c.input.recipes?.version??null,
        catalog_ref:st?reference({...st,...(ref.match_by==='code'?{match_by:'code'}:{})}):ref,quantity_rule:clone(rule),baseline_quantity:qty,
        manual:{qty:false,price:priceOverride,cost:r.cost_override===true,name:r.name_override===true,unit:false},
        ...(missingCodeCard||codeUnitChanged?{stock_selection_required:true}:{}),
        ...(r.price_rule?{price_rule:validatePriceRule(r.price_rule)}:{}),...(r.cost_known===true?{cost_known:true}:{}),
        ...(r.singleton_key?{singleton_key:r.singleton_key}:{}),
        ...(r.mapping_status==='included_in_installation'?{charge_mode:'included',included_in_installation:true}:{}),
        ...(r.charge_mode?{charge_mode:r.charge_mode}:{}),
        ...(r.include_in_initial_total===false?{include_in_initial_total:false}:{}),
        ...(r.condition?{condition:r.condition}:{}),
        ...(r.price_source?{price_source:r.price_source}:{}),
        ...(options.branch!=null?{branch:options.branch}: {})}}};
    if(!options.optional&&qty>0&&kind!=='text'&&price==null)warn(c,'missing_price','Chýba predajná cena: '+item.name+'.',item);
    if(r.mapping_status==='needs_compatibility_check'||r.mapping_status==='mapped_needs_compatibility_check')warn(c,'compatibility','Overte príslušenstvo pre zvolené zariadenie: '+item.name+'.',item);
    if(!options.optional)c.items.push(item);
    return item;
  }
  function recipeEnabled(r,c){
    const choices=c.input.options||c.input.selectedOptions||{};
    if(own(choices,r.role))return choices[r.role]===true;
    if(r.condition==='with_external_dhw_tank')return c.p.dhw_solution==='external';
    if(r.condition)return false;
    return r.required!==false||r.default_enabled===true||r.role==='installation_service';
  }
  function addRecipe(c,key){
    const b=c.recipes.find(x=>x.key===key);
    if(!b){warn(c,'missing_recipe','Nie je načítaná zostava '+key+'.');return;}
    const material=()=>group(c,c.instance+':'+key+':material',b.customer_label||b.label||'Montážny materiál','material','computed',key);
    let materialGroup;
    for(const original of b.items||[]){
      let r=clone(original);
      if(!recipeEnabled(r,c))continue;
      if(r.role==='installation_service'&&r.tier_pohoda_plu)r.pohoda_plu=r.tier_pohoda_plu[c.p.installation_tier||'standard']||r.pohoda_plu;
      if(key==='ac_single_split_5m'&&r.role==='refrigerant_pipe_pair')r={...r,...pipeRecipe(c.input.device?.power_kw)};
      const brand=text(c.input.device?.brand||c.input.device?.manufacturer).toLowerCase();
      if(key==='boiler_gas_standard'&&r.role==='flue_adapter_a1k'&&brand!=='protherm')r={...r,pohoda_code:null,pohoda_plu:null,expected_name:'Pripojovací adaptér odvodu spalín podľa kotla',mapping_status:'needs_compatibility_check'};
      if(key==='boiler_biomass_standard'&&r.role==='boiler_protection_set_opop'&&brand!=='opop')r={...r,pohoda_code:null,pohoda_plu:null,expected_name:'Ochranná zostava podľa vybraného kotla',mapping_status:'needs_compatibility_check'};
      const kind=kindFor(r);
      if(r.mapping_status==='included_in_installation'){
        const g=group(c,c.instance+':'+key+':labor','Montáž','labor','fixed',key);
        g.contents=(g.contents||[]).concat({name:r.expected_name||r.name||r.role,qty:evaluateRule(ruleFor(r,key),c.p),unit:r.unit||'ks',kind:'labor',included_duplicate:true});
        continue;
      }
      let g;
      if(kind==='labor')g=group(c,c.instance+':'+key+':labor','Montáž','labor','fixed',key);
      else if(kind==='material')g=materialGroup||(materialGroup=material());
      else g=group(c,c.instance+':'+key+':'+kind,r.customer_group||'Služby',kind,'computed',key);
      const i=row(c,r,g.id,key,ruleFor(r,key));
      if(r.role==='installation_service'){
        g.fixed_row_id=i.stored_metadata.quote_assembly.id;
        g.contents=i.work_scope.map(name=>({name})).concat(g.contents||[]);
        if(key.startsWith('hp_')||key==='boiler_gas_standard'||key==='boiler_biomass_standard')c.covered.add('transport');
        if(key==='ac_single_split_5m'){
          g.included_material_route_m=3;
          g.procurement_incomplete=true;
          warn(c,'incomplete_package_material','Montáž klimatizácie zahŕňa materiál do 3 m bez úplného katalógového rozpisu. Nákupný zoznam obsahuje iba samostatne rozpísaný materiál.');
        }
      }
    }
    if(key==='hp_electrical_standard')warn(c,'electrical_spec','Elektroinštalačná zostava je firemný cenový štandard. Istenie a prierezy treba potvrdiť pre vybrané zariadenie.');
    if((key==='hp_monoblock_5m'||key==='hp_split_5m')&&c.p.route_m>5)warn(c,'labor_scope','Trasa presahuje 5 m. Materiál je prepočítaný; cenu a rozsah montáže upravte podľa zákazky.');
  }
  function addDevice(c,selection,role='device',index=0){
    const g=group(c,c.instance+':equipment','Zariadenia','equipment');
    const fallback=role==='multisplit_indoor_units'?'Vnútorná jednotka '+index:role==='dhw_storage_tank'?'Vyberte externý zásobník TÚV':'Vyberte zariadenie';
    const d=selection||{};
    let ref=d.pohoda||d.stock?reference(d.pohoda||d.stock):{source:'pohoda',id:d.stock_id??null,fingerprint:d.fingerprint??null,plu:d.pohoda_plu??d.plu??null,code:d.pohoda_code??d.code??null,storage_ref:d.storage_ref??null,pohoda_stock_id:d.pohoda_stock_id??null};
    // The picker enriches an exact stock card with device model metadata. Keep
    // its stock id even when it has a model; device-catalog-only ids stay separate.
    if(!ref.id&&d.id&&d.code&&(d.name||c.stocks.some(x=>String(x.id)===String(d.id)&&text(x.code)===text(d.code))))ref.id=d.id;
    const st=findStock(ref,c.stocks);
    const name=text(d.name)||[d.brand,d.model,d.variant].filter(Boolean).join(' ')||fallback;
    const item=row(c,{role,expected_name:name,unit:d.unit||'ks',catalog_ref:ref,
      price:nullable(d.sell_price_ex_vat)??nullable(d.price),cost:nullable(d.purchase_price_ex_vat)??nullable(d.cost)},g.id,null,fixed(1),{stock:st,name,kind:'equipment'});
    if(!selection)warn(c,'device_required',fallback+'.',item);
    return item;
  }
  function addOptionalRecipes(c,key){
    const b=c.recipes.find(x=>x.key===key);
    if(!b)return;
    for(const r of b.items||[]){
      if(r.role==='dhw_tank_fe120'&&c.input.device?.dhw_mode&&c.input.device.dhw_mode!=='none')continue;
      const kind=kindFor(r),id=c.instance+':optional:'+r.role;
      const g={id,name:r.customer_group||r.expected_name||'Voliteľný doplnok',kind,pricing:'computed',template_id:key};
      const item=row(c,r,g.id,key,fixed(r.qty??1),{optional:true});
      const choices=c.input.options||c.input.selectedOptions||{};
      const alias=r.role==='heating_system_flush_cleaner_inhibitor'?'flush':r.role==='condensate_pump_sanibroy'?'condensate_pump':r.role;
      const selected=choices[r.role]===true||choices[alias]===true;
      const option={id,name:item.name,kind,selected,include_in_initial_total:r.include_in_initial_total!==false,items:[item],groups:[g],template_id:key};
      if(selected&&option.include_in_initial_total){c.items.push(item);c.groups.push(g);if(item.price==null)warn(c,'missing_price','Chýba predajná cena: '+item.name+'.',item);}
      c.optional.push(option);
    }
  }
  function addMultisplit(c){
    const selected=Array.isArray(c.input.indoorDevices)?c.input.indoorDevices:Array.isArray(c.input.device?.indoor_units)?c.input.device.indoor_units:[];
    const complete=c.input.device?.complete_multisplit_set===true;
    const suppliedPipes=Array.isArray(c.input.branchPipes)?c.input.branchPipes:[];
    for(let index=0;index<c.p.indoor_count;index++){
      if(!complete)addDevice(c,selected[index], 'multisplit_indoor_units',index+1);
      const key='multisplit_branch_'+(index+1),g=group(c,c.instance+':'+key,'Montážny materiál – vetva '+(index+1),'material','computed',key);
      const pipe=suppliedPipes[index]?{...suppliedPipes[index],pohoda_code:suppliedPipes[index].code??suppliedPipes[index].pohoda_code,expected_name:suppliedPipes[index].name??suppliedPipes[index].expected_name}:pipeRecipe(selected[index]?.power_kw);
      const defs=[{...pipe,role:'refrigerant_pipe_pair'},
        {role:'communication_cable',pohoda_code:'JYTY-O 4x1',pohoda_plu:'105109',expected_name:'Kábel špeciálny JYTY-O 4x1'},
        {role:'condensate_drain',pohoda_code:'ART01375',pohoda_plu:'104891',expected_name:'PVC trubka na odvod kondenzátu 20 mm Artiplastic'},
        {role:'pvc_trunking',pohoda_code:'LIŠTA0',pohoda_plu:'106378',expected_name:'Lišta inštalačná PVC 80 × 40 biela'}];
      defs.forEach(r=>row(c,{...r,unit:'m'},g.id,key,parameter('branch_'+(index+1)+'_m'),{branch:index+1}));
    }
    const g=group(c,c.instance+':multisplit_power','Spoločný napájací materiál','material','computed','multisplit_power');
    row(c,{role:'power_cable',pohoda_code:'KÁBEL1',pohoda_plu:'106389',expected_name:'Kábel pevný Cu CYKY-J 3 × 2,5',unit:'m'},g.id,'multisplit_power',parameter('power_cable_m'));
    warn(c,'multisplit_compatibility','Kombináciu vonkajšej a vnútorných jednotiek a rozmery chladivových pripojení potvrďte podľa vybraných modelov.');
  }
  // Material and man-hour coefficients copied from inspections.js ZTI macros.
  // Pipes are entered separately from outlets, so the same route is never added twice.
  const ZTI=[
    ['water_outlets','Vývod voda',0.45,[['14563581001','REHAU RAUTITAN nástenka 16 × 1/2',1,'ks','water_wallplate_16'],['11600611001','REHAU RAUTITAN T-kus 20–16–20',1,'ks','water_tee_20_16_20'],['11600011001','REHAU RAUTITAN objímka 16',2,'ks','water_sleeve_16'],['11600021001','REHAU RAUTITAN objímka 20',2,'ks','water_sleeve_20']]],
    ['waste_outlets','Vývod odpad',0.35,[['112140','HT PLUS koleno DN50 87°',1,'ks','waste_elbow_50'],['112040','HT PLUS rúra DN50 1000 mm',1,'ks','waste_pipe_50_1m']]],
    ['washing_siphons','Práčkový sifón',0.3,[['PT100PS3','CONCEPT podomietkový práčkový sifón DN40/50',1,'ks','washing_siphon']]],
    ['wc_duofix','WC Geberit Duofix',1.75,[['111.154.11.2','Geberit Duofix Delta pre WC',1,'ks','wc_duofix']]],
    ['boiler_outlets','Vývod technická miestnosť',0.5,[['14563611001','REHAU RAUTITAN nástenka 25 × 3/4',1,'ks','boiler_wallplate_25'],['11600031001','REHAU RAUTITAN objímka 25',1,'ks','boiler_sleeve_25']]],
    ['frost_valves','Nezamŕzavý ventil',0.75,[['039970399','SCHELL POLAR II nezámrzný ventil DN15',1,'ks','frost_valve']]],
    ['main_water_shutoffs','Hlavný uzáver vody',2.5,[['154079591609750002','IVR 954 EVERLAST guľový kohút FF1"',3,'ks','main_ball_valve_1'],['2520009','T-kus mosadzný 1"',1,'ks','main_brass_tee_1'],['200001','Vsuvka 1" mosadz',8,'ks','main_brass_nipple_1'],['5061001','Šróbenie V4300 1" mosadz',4,'ks','main_union_1'],['22116032','PE prechod 32 × 1" vonkajší závit',2,'ks','main_pe_transition_32_1'],['38100','Sada filtra Senior 10" MONO, komplet 1"',1,'ks','main_filter_10'],['PPS1020','Vložka filtra 10" × 2,5" 20 micron',1,'ks','main_filter_cartridge_10'],['150047100009300038','HERZ tlakový ventil DN25 redukčný',1,'ks','main_pressure_reducer']]],
    ['pipe16_m','Potrubie 16 + izolácia',0.06,[['11301211100','REHAU RAUTITAN STABIL 16',1,'m','pipe16'],['511450013','TUBEX STANDARD 10–18',1,'m','tubex18']]],
    ['pipe20_m','Potrubie 20 + izolácia',0.07,[['11301311100','REHAU RAUTITAN STABIL 20',1,'m','pipe20'],['511450014','TUBEX STANDARD 10–22',1,'m','tubex22']]],
    ['pipe25_m','Potrubie 25 + izolácia',0.08,[['11301411050','REHAU RAUTITAN STABIL 25',1,'m','pipe25'],['511450015','TUBEX STANDARD 10–28',1,'m','tubex28']]]
  ];
  function ztiLabor(parameters){
    const p=normalizeParameters('zti',parameters);
    const parts=ZTI.map(([key,name,mh])=>({key,name,qty:p[key],man_hours:round(p[key]*mh)}));
    const hasScope=parts.some(x=>x.qty>0);
    const raw=hasScope?round(1.5+parts.reduce((sum,x)=>sum+x.man_hours,0)):0;
    const manHours=hasScope?Math.max(2,Math.ceil(raw*4)/4):0;
    return {parts,raw,man_hours:manHours,base_man_hours:hasScope?1.5:0,adjustment_man_hours:round(manHours-raw),rate:p.labor_rate};
  }
  function addZti(c){
    const labor=group(c,c.instance+':zti_labor','Montáž ZTI','labor','computed','zti_labor');
    const active=ZTI.filter(([key])=>c.p[key]>0);
    const rule=active.length?{type:'sum',parameters:active.map(x=>x[0]),weights:active.map(x=>x[2]),factor:1,offset:1.5,min:2,ceil_step:0.25,zero_when_empty:true}:fixed(0);
    const work_scope=['príprava a rozmeranie','montáž vývodov a zariadení podľa rozsahu ponuky','montáž potrubných rozvodov, izolácie a uchytenia','tlaková skúška'];
    const laborItem=row(c,{role:'installation_service',kind:'labor',expected_name:'Montáž ZTI podľa rozsahu',unit:'čh',price:c.p.labor_rate,work_scope,
      price_source:'Sadzba ZTI; koeficienty a minimum podľa inspections.js'},labor.id,'zti_labor',rule);
    laborItem.stored_metadata.quote_assembly.norm={source:'mobile-v4/js/inspections.js',base_man_hours:1.5,minimum_man_hours:2,rounding_man_hours:0.25};
    labor.contents=work_scope.map(name=>({name}));
    c.covered.add('pressure');
    for(const [key,label,mh,defs] of ZTI){
      const g=group(c,c.instance+':zti_'+key,label,'material','computed','zti_'+key);
      for(const [code,name,qty,unit,role] of defs)row(c,{role:'zti_'+role,pohoda_code:code,expected_name:name,unit},g.id,'zti_'+key,parameter(key,qty));
    }
    const clips=group(c,c.instance+':zti_clips','Uchytenie potrubia','material','computed','zti_clips');
    row(c,{role:'zti_floor_clip',pohoda_code:'144013000000001257',expected_name:'Podlahová príchytka potrubia',unit:'ks'},clips.id,'zti_clips',{type:'sum',parameters:['pipe16_m','pipe20_m','pipe25_m'],factor:2,offset:0,min:0});
  }
  function addFloorHeating(c){
    const p=c.p;
    const g=group(c,c.instance+':floor_material','Podlahové kúrenie REHAU – materiál','material','computed','floor_heating_rehau');
    const defs=[
      ['floor_pipe','REHAU RAUTHERM S 17×2', 'm','pipe_total_m'],
      ['floor_board','REHAU Varionova systémová doska','m²','board_m2'],
      ['floor_edge','Okrajová dilatačná páska','m','edge_tape_m'],
      ['floor_manifold','Rozdeľovač podľa počtu okruhov','ks','manifolds_total'],
      ['floor_cabinet','Skrinka rozdeľovača','ks','manifolds_total'],
      ['floor_eurocone','Eurokonus – pripojenie okruhu','ks','circuits_total',2],
      ['floor_sleeve','Ochranná rúrka pripojenia','ks','circuits_total',2]
    ];
    for(const [role,name,unit,key,factor] of defs){
      const i=row(c,{role,expected_name:name,unit,mapping_status:'needs_compatibility_check'},g.id,'floor_heating_rehau',parameter(key,factor||1));
      i.stored_metadata.quote_assembly.stock_selection_required=true;
    }
    const labor=group(c,c.instance+':floor_labor','Montáž podlahového kúrenia','labor','computed','floor_heating_rehau');
    row(c,{role:'installation_service',expected_name:'Montáž podlahového kúrenia vrátane tlakovej skúšky',unit:'m²',
      price:p.installation_rate||null,price_override:true,work_scope:['Pokládka systémových dosiek a potrubia','Pripojenie rozdeľovača','Tlaková skúška']},
      labor.id,'floor_heating_rehau',parameter('area_m2'));
    labor.contents=[{name:'Pokládka potrubia a systémových dosiek'},{name:'Pripojenie okruhov a tlaková skúška'}];
    c.covered.add('pressure');
    warn(c,'floor_design','Počet okruhov je orientačný. Overte hydrauliku, skutočné dĺžky slučiek a výber rozdeľovača. Materiál spárujte s presnými kartami POHODA.');
    if(!p.installation_rate)warn(c,'floor_labor_price','Doplňte sadzbu montáže €/m².');
  }
  function addCommonServices(c){
    const services=Array.isArray(c.input.services)?c.input.services:[];
    const used=new Set(c.items.map(i=>i.stored_metadata.quote_assembly.singleton_key).filter(Boolean));
    for(const def of services){
      const kind=kindFor(def),singleton=def.singleton_key||(['transport','revision','pressure'].includes(kind)?kind:null);
      if(singleton&&used.has(singleton)&&def.extra!==true)continue;
      if(singleton&&c.covered.has(singleton)&&def.extra!==true){warn(c,'already_included',text(def.name||def.expected_name||singleton)+' už patrí do rozsahu montáže.');continue;}
      const g=group(c,c.instance+':service:'+(c.counter+1),text(def.group_name||def.name||def.expected_name)||'Služba',kind);
      row(c,{...def,...(singleton&&def.extra!==true?{singleton_key:singleton}:{})},g.id,null,def.quantity_rule||fixed(def.qty??1));
      if(singleton)used.add(singleton);
    }
  }
  function instantiate(input={}){
    const id=input.scenarioId||input.scenario_id||input.id;
    if(input.template)return instantiateTemplate(input.template,input);
    const d=describe(id),p=normalizeParameters(id,input.parameters||{},input.device||{}),c=makeContext(input,d,p);
    if(d.device_required)addDevice(c,input.device);
    if(d.id==='heat_pump'){
      addRecipe(c,p.system_type==='split'?'hp_split_5m':'hp_monoblock_5m');addRecipe(c,'hp_electrical_standard');
      if(p.dhw_solution==='external')addDevice(c,input.tank,'dhw_storage_tank');
      addOptionalRecipes(c,'hp_optional_services');
    }else if(d.id==='gas_boiler'){addRecipe(c,'boiler_gas_standard');addOptionalRecipes(c,'boiler_gas_optional_services');}
    else if(d.id==='biomass')addRecipe(c,'boiler_biomass_standard');
    else if(d.id==='ac_single')addRecipe(c,'ac_single_split_5m');
    else if(d.id==='ac_multi'){addRecipe(c,'ac_multisplit_5m');addMultisplit(c);}
    else if(d.id==='zti')addZti(c);
    else if(d.id==='floor_heating_rehau')addFloorHeating(c);
    addCommonServices(c);
    // The existing quote backend treats any unpriced row as incomplete. Inactive
    // recipe entries remain in the scenario definition, never in billed q.items.
    c.items=c.items.filter(i=>i.qty>0||i.stored_metadata.quote_assembly.kind==='text');
    const activeGroups=new Set(c.items.map(i=>i.stored_metadata.quote_assembly.group_id));
    c.groups=c.groups.filter(g=>activeGroups.has(g.id));
    const result={version:VERSION,scenario:d,parameters:p,groups:c.groups,items:c.items,optional:c.optional,
      warnings:c.warnings,checks:c.checks,covered_services:[...c.covered],procurement_complete:!c.groups.some(g=>g.procurement_incomplete)};
    result.assemblies=c.groups.map(g=>({...clone(g),templateId:g.template_id,type:g.kind,pricingMode:g.pricing,rows:c.items.filter(i=>i.stored_metadata.quote_assembly.group_id===g.id).map(clone)}));
    return result;
  }
  function recipesToAssemblies(recipes){
    const out=[];
    for(const b of recipeArray(recipes)){
      const groups=new Map();
      const scenarioId=ALIASES[b.key]||(b.key.startsWith('hp_')?'heat_pump':b.key.startsWith('boiler_gas')?'gas_boiler':null);
      const parameters=scenarioId?normalizeParameters(b.key in ALIASES?b.key:scenarioId):{};
      for(const r of b.items||[]){
        const kind=kindFor(r),key=b.key+':'+kind;
        if(!groups.has(key))groups.set(key,{id:key,name:kind==='labor'?'Montáž – '+(b.customer_label||b.label||b.key):(b.customer_label||b.label||b.key),kind,version:1,status:'draft',pricing:kind==='labor'?'fixed':'computed',source:{...source,recipe_key:b.key,recipe_version:recipes?.version??null},parameters:clone(parameters),rows:[],contents:[]});
        const target=groups.get(key);
        if(r.mapping_status==='included_in_installation'){
          target.contents.push({name:r.expected_name||r.role,qty:r.qty??1,unit:r.unit||'ks'});
          continue;
        }
        if(kind==='labor'&&Array.isArray(r.work_scope))target.contents.push(...r.work_scope.map(name=>({name})));
        groups.get(key).rows.push({role:r.role,name:r.expected_name||r.role,unit:r.unit||'ks',qty:r.qty??r.qty_at_5m??1,price:nullable(r.default_sell_price_ex_vat),cost:null,
          catalog_ref:reference({code:r.pohoda_code,plu:r.pohoda_plu}),quantity_rule:ruleFor(r,b.key),condition:r.condition||null,required:r.required!==false,
          default_enabled:r.default_enabled===true,kind,work_scope:clone(r.work_scope||[]),mapping_status:r.mapping_status||null,
          ...(r.include_in_initial_total===false?{include_in_initial_total:false}:{}),...(r.charge_mode?{charge_mode:r.charge_mode}:{})});
      }
      out.push(...groups.values());
    }
    return clone(out);
  }
  function templateRow(item,index){
    const meta=item.stored_metadata?.quote_assembly||{};
    const kind=item.kind||meta.kind||kindFor(item);
    if(!KINDS.has(kind))throw new Error('Neplatný druh položky.');
    const result={role:text(item.role)|| (kind==='text'?'quote_text':'quote_manual'),name:string(item.name,'názov položky',1000),kind,
      qty:kind==='text'?0:valueNumber(item.qty??1,'množstvo'),unit:text(item.unit)||(kind==='text'?'':'ks'),
      price:kind==='text'?null:nullable(item.price),cost:kind==='text'?null:nullable(item.cost),
      catalog_ref:clone(item.catalog_ref||meta.catalog_ref||reference(item)),
      quantity_rule:validateRule(item.quantity_rule||meta.quantity_rule||fixed(kind==='text'?0:item.qty??1)),
      work_scope:Array.isArray(item.work_scope)?item.work_scope.map(x=>string(x,'popis práce',1000)):[],
      mapping_status:text(item.mapping_status)||null};
    if(result.price!=null)valueNumber(result.price,'cena');
    if(result.cost!=null)valueNumber(result.cost,'náklad');
    if(item.price!=null&&result.price==null)throw new Error('Neplatná cena položky '+(index+1)+'.');
    if(item.cost!=null&&result.cost==null)throw new Error('Neplatný náklad položky '+(index+1)+'.');
    if(item.singleton_key||meta.singleton_key)result.singleton_key=string(item.singleton_key||meta.singleton_key,'spoločná položka',200);
    if(item.condition)result.condition=string(item.condition,'podmienka',200);
    if(typeof item.required==='boolean')result.required=item.required;
    if(typeof item.default_enabled==='boolean')result.default_enabled=item.default_enabled;
    if(item.include_in_initial_total===false||meta.include_in_initial_total===false)result.include_in_initial_total=false;
    if(item.charge_mode||meta.charge_mode)result.charge_mode=text(item.charge_mode||meta.charge_mode);
    if(item.note)result.note=string(item.note,'poznámka',4000);
    if(item.price_override===true||meta.manual?.price===true)result.price_override=true;
    if(item.cost_override===true||meta.manual?.cost===true)result.cost_override=true;
    if(item.name_override===true||meta.manual?.name===true)result.name_override=true;
    if(item.price_rule||meta.price_rule)result.price_rule=validatePriceRule(item.price_rule||meta.price_rule);
    if(item.cost_known===true||meta.cost_known===true)result.cost_known=true;
    return result;
  }
  function validateTemplate(template){
    safeData(template);
    if(!template||Array.isArray(template))throw new Error('Neplatná zostava.');
    const id=string(template.id,'identifikátor zostavy',200),name=string(template.name,'názov zostavy',300);
    if(!Array.isArray(template.rows)||template.rows.length<1||template.rows.length>1000)throw new Error('Zostava musí obsahovať 1 až 1 000 položiek.');
    const kind=template.kind||'material';if(!KINDS.has(kind))throw new Error('Neplatný druh zostavy.');
    const pricing=template.pricing||'computed';if(!['computed','fixed'].includes(pricing))throw new Error('Neplatný spôsob ocenenia zostavy.');
    const version=valueNumber(template.version??1,'verzia');if(!Number.isInteger(version)||version<1)throw new Error('Neplatná verzia zostavy.');
    const status=template.status||'draft';if(!['draft','verified'].includes(status))throw new Error('Neplatný stav zostavy.');
    const rows=template.rows.map(templateRow);
    if(pricing==='fixed'&&rows.filter(r=>r.kind!=='text'&&r.charge_mode!=='included'&&r.mapping_status!=='included_in_installation').length!==1)throw new Error('Pevná zostava musí mať jeden účtovaný riadok. Rozpis prác patrí do obsahu zostavy.');
    const out={id,name,kind,pricing,version,status,rows};
    if(template.contents_basis_quantity!=null){out.contents_basis_quantity=valueNumber(template.contents_basis_quantity,'základ množstiev obsahu');if(!out.contents_basis_quantity)throw new Error('Základ množstiev obsahu musí byť väčší ako nula.');}
    if(template.parameters){safeData(template.parameters);out.parameters=clone(template.parameters);}
    if(template.contents){
      if(!Array.isArray(template.contents)||template.contents.length>300)throw new Error('Neplatný obsah zostavy.');
      out.contents=template.contents.map(x=>{
        const item={name:string(typeof x==='string'?x:x?.name,'popis obsahu',1000)};
        if(x&&typeof x==='object'){
          if(x.qty!=null)item.qty=valueNumber(x.qty,'množstvo obsahu');
          if(text(x.unit))item.unit=text(x.unit);
          if(x.kind){if(!KINDS.has(x.kind))throw new Error('Neplatný druh obsahu zostavy.');item.kind=x.kind;}
          if(x.catalog_ref)item.catalog_ref=clone(x.catalog_ref);
          if(x.included_duplicate===true)item.included_duplicate=true;
        }
        return item;
      });
    }
    if(template.source)out.source=clone(template.source);
    if(template.updated_at)out.updated_at=string(template.updated_at,'dátum aktualizácie',100);
    return out;
  }
  function templateFromGroup(q,groupId,options={}){
    const g=(q.material_edits?.assemblies?.groups||q.groups||[]).find(x=>x.id===groupId);
    if(!g)throw new Error('Vybraná skupina ponuky neexistuje.');
    const rows=(q.items||[]).filter(i=>i.stored_metadata?.quote_assembly?.group_id===groupId).map(i=>{
      const r=templateRow(i,0);if(options.keepRules!==true)r.quantity_rule=fixed(r.qty);return r;
    });
    const t={id:options.id||randomId('assembly'),name:options.name||g.name,kind:g.kind||'material',pricing:g.pricing||'computed',version:1,status:'draft',rows,
      contents:clone(g.contents||[]),source:{type:'quote_group'},updated_at:options.now||new Date().toISOString()};
    if(g.contents_basis_quantity!=null)t.contents_basis_quantity=g.contents_basis_quantity;
    for(const key of ['category','system_type','boiler_type','ac_mode'])if(typeof q[key]==='string'&&q[key])t.source[key]=q[key];
    return validateTemplate(t);
  }
  // Save all quote groups as a reusable material + labor + transport assembly,
  // without including customer details or changing the original quote.
  function templateFromQuote(q,options={}){
    const rows=(q.items||[]).map((item,index)=>{
      const r=templateRow(item,index);
      if(options.keepRules!==true)r.quantity_rule=fixed(r.qty);
      return r;
    });
    const t={id:options.id||randomId('assembly'),name:options.name||'Vlastná zostava',
      kind:'material',pricing:'computed',version:1,status:'draft',rows,
      source:{type:'quote_bundle'},updated_at:options.now||new Date().toISOString()};
    for(const key of ['category','system_type','boiler_type','ac_mode'])
      if(typeof q[key]==='string'&&q[key])t.source[key]=q[key];
    return validateTemplate(t);
  }
  function copyTemplate(template,options={}){
    const t=validateTemplate(template);
    return validateTemplate({...t,id:options.id||randomId('assembly'),name:options.name||t.name+' – kópia',version:1,status:'draft',source:{...t.source,type:'template',template_id:t.id,template_version:t.version},updated_at:options.now||new Date().toISOString()});
  }
  function updateTemplate(template,patch={}){
    const t=validateTemplate(template);safeData(patch);
    const allowed={};for(const k of ['name','kind','pricing','rows','contents','parameters','status'])if(own(patch,k))allowed[k]=patch[k];
    if(allowed.rows){
      allowed.rows=allowed.rows.map((r,index)=>{
        const next=clone(r),old=t.rows[index];
        if(old){
          for(const [key,flag] of [['price','price_override'],['cost','cost_override'],['name','name_override']])if(own(next,key)&&next[key]!==old[key])next[flag]=true;
          if(own(next,'qty')&&next.qty!==old.qty&&JSON.stringify(next.quantity_rule)===JSON.stringify(old.quantity_rule))next.quantity_rule=fixed(next.qty);
        }
        return next;
      });
    }
    return validateTemplate({...t,...allowed,version:t.version+1,status:allowed.status||'draft',updated_at:patch.now||new Date().toISOString()});
  }
  function saveTemplate(library,template){
    if(!Array.isArray(library))throw new Error('Neplatná knižnica zostáv.');
    const t=validateTemplate(template),out=library.map(validateTemplate),index=out.findIndex(x=>x.id===t.id);
    if(index<0)out.push(t);else {if(t.version<=out[index].version)throw new Error('Knižnica už obsahuje rovnakú alebo novšiu verziu zostavy.');out[index]=t;}
    return out;
  }
  function exportTemplates(templates){
    if(!Array.isArray(templates)||templates.length>200)throw new Error('Možno exportovať najviac 200 zostáv.');
    const seen=new Set(),rows=templates.map(validateTemplate);
    for(const t of rows){if(seen.has(t.id))throw new Error('Duplicitný identifikátor zostavy.');seen.add(t.id);}
    return JSON.stringify({format:FORMAT,version:VERSION,templates:rows},null,2);
  }
  function importTemplates(json){
    if(typeof json!=='string'||json.length>2*1024*1024)throw new Error('Súbor zostáv je prázdny alebo väčší ako 2 MB.');
    let data;try{data=JSON.parse(json);}catch(_){throw new Error('Súbor nie je platný JSON.');}
    safeData(data);
    if(data?.format!==FORMAT||data.version!==VERSION||!Array.isArray(data.templates)||data.templates.length>200)throw new Error('Nepodporovaný formát knižnice zostáv.');
    const seen=new Set();return data.templates.map(t=>{const valid=validateTemplate(t);if(seen.has(valid.id))throw new Error('Duplicitný identifikátor zostavy.');seen.add(valid.id);return valid;});
  }
  function instantiateTemplate(template,input={}){
    const t=validateTemplate(template),p=clone(input.parameters||t.parameters||{});
    if(own(p,'assembly_count')){
      const count=valueNumber(p.assembly_count,'počet zostáv');if(!count)throw new Error('Počet zostáv musí byť väčší ako nula.');p.assembly_count=count;
      for(const r of t.rows){
        if(r.kind==='text')continue;
        if(r.quantity_rule.type==='fixed')r.quantity_rule=parameter('assembly_count',r.qty);
        const rule=r.quantity_rule,names=rule.type==='parameter'?[rule.parameter]:rule.type==='sum'?rule.parameters:[];
        if(count!==1&&names.some(name=>name!=='assembly_count'))throw new Error('Zostava obsahuje vlastné parametre množstva. Vložte ju s počtom 1 a upravte jej parametre, alebo uložte zostavu s pevnými množstvami.');
      }
    }
    const allowedCategories=new Set(['heat_pump','air_conditioning','boiler','zti','floor_heating','water_heater','recovery','other']);
    const d={id:'custom',name:t.name,category:allowedCategories.has(t.source?.category)?t.source.category:'other'};
    for(const key of ['system_type','boiler_type','ac_mode'])if(typeof t.source?.[key]==='string')d[key]=t.source[key];
    const c=makeContext(input,d,p);
    const isQuoteBundle=t.source?.type==='quote_bundle';
    const kindNames={equipment:'Zariadenie',material:'Materiál',labor:'Montáž',transport:'Doprava',
      revision:'Revízia',pressure:'Tlaková skúška',service:'Služby',text:'Text',other:'Ostatné'};
    const g=isQuoteBundle?null:group(c,c.instance+':'+t.id,t.name,t.kind,t.pricing,t.id);
    if(g){g.template_version=t.version;g.contents=clone(t.contents||[]);}
    if(t.pricing==='fixed'){
      const billed=t.rows.find(r=>r.kind!=='text'&&r.charge_mode!=='included'&&r.mapping_status!=='included_in_installation');
      // Quantities in template contents describe the saved template, while the
      // instantiated charged row may represent several copies of that template.
      g.contents_basis_quantity=t.contents_basis_quantity??(billed?.qty>0?billed.qty:1);
    }
    for(const r of t.rows){
      const target=isQuoteBundle?group(c,c.instance+':'+t.id+':'+r.kind,
        t.name+' – '+(kindNames[r.kind]||r.kind),r.kind,'computed',t.id):g;
      target.template_version=t.version;
      if(r.charge_mode==='included'||r.mapping_status==='included_in_installation'){
        if(!Array.isArray(target.contents))target.contents=[];
        target.contents.push({name:r.name,qty:evaluateRule(r.quantity_rule,p),unit:r.unit,kind:r.kind,catalog_ref:clone(r.catalog_ref),...(r.kind!=='material'?{included_duplicate:true}:{})});continue;
      }
      if(r.condition&&!recipeEnabled(r,c))continue;
      const future=r.include_in_initial_total===false,unselected=r.required===false&&!recipeEnabled(r,c);
      const i=row(c,r,target.id,t.id,r.quantity_rule,{kind:r.kind,name:r.catalog_ref?.match_by==='code'&&r.name_override!==true?undefined:r.name,template:true,fixedPackage:t.pricing==='fixed',optional:future||unselected,preservePrice:input.refreshPrices!==true&&(t.pricing==='fixed'||r.price_override===true),preserveCost:input.refreshPrices!==true&&r.cost_override===true});
      i.stored_metadata.quote_assembly.template_version=t.version;
      if(t.pricing==='fixed'&&r.kind!=='text'&&r.charge_mode!=='included'&&r.mapping_status!=='included_in_installation')target.fixed_row_id=i.stored_metadata.quote_assembly.id;
      if(future||unselected)c.optional.push({id:c.instance+':optional:'+c.counter,name:i.name,kind:r.kind,selected:false,include_in_initial_total:!future,items:[i],groups:[clone(g)],template_id:t.id});
    }
    c.items=c.items.filter(i=>i.qty>0||i.stored_metadata.quote_assembly.kind==='text');
    const active=new Set(c.items.map(i=>i.stored_metadata.quote_assembly.group_id));c.groups=c.groups.filter(x=>active.has(x.id));
    return {version:VERSION,scenario:d,parameters:p,groups:c.groups,items:c.items,optional:c.optional,warnings:c.warnings,checks:c.checks,covered_services:[]};
  }
  function previewQuantities(target,parameters={}){
    const p={...(target.parameters||{}),...parameters},changes=[],warnings=[];
    for(const item of target.items||[]){
      const meta=item.stored_metadata?.quote_assembly;if(!meta?.quantity_rule)continue;
      let next;try{next=evaluateRule(meta.quantity_rule,p);}catch(e){warnings.push(e.message);continue;}
      const from=valueNumber(item.qty,'množstvo');if(next===from)continue;
      const manual=meta.manual?.qty===true||(meta.baseline_quantity!=null&&from!==meta.baseline_quantity);
      changes.push({id:meta.id,name:item.name,from,to:next,manual,apply:!manual});
    }
    return {parameters:clone(p),changes,warnings};
  }
  function applyQuantities(target,preview,options={}){
    const out=clone(target),byId=new Map((out.items||[]).map(i=>[i.stored_metadata?.quote_assembly?.id,i]));
    for(const change of preview.changes||[]){
      const item=byId.get(change.id);if(!item)throw new Error('Položka prepočtu už neexistuje.');
      if(Number(item.qty)!==change.from)throw new Error('Ponuka sa zmenila. Vytvorte nový náhľad prepočtu.');
      if(change.manual&&options.includeManual!==true)continue;
      item.qty=valueNumber(change.to,'množstvo');item.stored_metadata.quote_assembly.baseline_quantity=item.qty;
      if(options.includeManual===true)item.stored_metadata.quote_assembly.manual.qty=false;
    }
    out.parameters=clone(preview.parameters||{});return out;
  }
  const api={VERSION,FORMAT,list,describe,normalizeParameters,instantiate,recipesToAssemblies,adaptRecipes:recipesToAssemblies,
    reference,findStock,validateRule,evaluateRule,validatePriceRule,pipeRecipe,ztiLabor,templateFromGroup,templateFromQuote,copyTemplate,updateTemplate,saveTemplate,
    validateTemplate,exportTemplates,importTemplates,instantiateTemplate,previewQuantities,applyQuantities};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SpektraHvacScenarios=api;
})(typeof window==='object'?window:globalThis);
