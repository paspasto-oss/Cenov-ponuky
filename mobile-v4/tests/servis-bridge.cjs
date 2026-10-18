const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const quote=true;
const file=quote?path.join(__dirname,'../js/spektra-servis-bridge.js'):path.join(__dirname,'../spektra-servis-bridge.js');
function harness(){
 const elements=[],fields=new Map(),messages=[],listeners={};
 const node=()=>({style:{},append(){},remove(){},value:'',dispatchEvent(){}});
 const peer={postMessage:(m,origin)=>messages.push({m,origin})};
 const nonce='11111111-1111-4111-8111-111111111111',origin='https://spektra-servis.vercel.app';
 const context={URL,Event,console,confirm:()=>true,location:{href:'https://test.example/?spektraBridge='+nonce},setInterval:()=>1,clearInterval(){},setTimeout:()=>2,clearTimeout(){},document:{body:{prepend(){}},createElement:()=>{const e=node();elements.push(e);return e;},getElementById:id=>{if(!fields.has(id))fields.set(id,node());return fields.get(id);}},opener:peer,addEventListener:(type,fn)=>listeners[type]=fn,removeEventListener:type=>delete listeners[type],render(){},changeScenario(){}};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8'),context);
 const request=(operation,payload,extra={})=>listeners.message?.({origin,source:peer,data:{type:'spektra-request',nonce,operation,payload},...extra});
 return {context,request,elements,fields,messages,peer,nonce,origin,button:elements[3]};
}
test('bridge rejects foreign origins, windows and nonce before accepting a one-use request',async()=>{
 const h=harness();h.request('prefill',{}, {origin:'https://evil.example'});assert.equal(h.button.disabled,true);
 h.request('prefill',{}, {source:{}});assert.equal(h.button.disabled,true);
 h.request('prefill',{}, {data:{type:'spektra-request',nonce:'wrong',operation:'prefill'}});assert.equal(h.button.disabled,true);
 h.request('prefill',{});assert.equal(h.button.disabled,false);
});
if(quote){
 test('catalog requires source login and transfers only data, not sessions',async()=>{
 const h=harness();h.context.SpektraDB={isAuthenticated:()=>false};h.request('catalog');await h.button.onclick();assert.equal(h.messages.length,0);
 h.context.SpektraDB={isAuthenticated:()=>true,getUser:()=>({id:'u',token:'secret'}),listCustomers:async()=>[{name:'Test'}],listStocks:async()=>[{id:1,name:'Diel'}]};await h.button.onclick();assert.equal(h.messages.length,1);assert.equal(h.messages[0].origin,h.origin);assert.equal(JSON.stringify(h.messages).includes('secret'),false);await h.button.onclick();assert.equal(h.messages.length,1);
 });
 test('prefill uses existing quote item and assembly modules and keeps stock code and price',async()=>{
 const h=harness(),c=h.context;c.SpektraQuoteStorage={uuid:()=>require('node:crypto').randomUUID()};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/quote-materials.js'),'utf8'),c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/quote-assemblies.js'),'utf8'),c);
 c.current=null;c.startWizard=()=>c.current={status:'draft',customer:{},items:[],optional_services:{},material_edits:{}};c.recalcQuoteTotalsFromItems=()=>{};c.openQuoteRows=()=>{};
 h.request('prefill',{customer:{name:'Test'},job:{id:'j',number:'S-1',title:'Servis',costing:[{id:'1',stockId:'5',code:'P01',kind:'material',name:'Diel',unit:'ks',qty:2,sale:10,cost:6,vat:23}]}});await h.button.onclick();
 assert.equal(h.messages.length,1,h.elements[2].textContent);assert.equal(c.current.items[0].price,10);assert.equal(c.current.items[0].pohoda_code,'P01');assert.equal(c.current.system_type,'service');
 });
}else{
 test('RS2 prefill maps device scenario and contact but never fabricates technical measurements',async()=>{
 const h=harness();h.fields.set('inp-co',{value:'12'});
 h.request('prefill',{customer:{name:'Test',phone:'0900'},job:{number:'S-1',address:'Rajec 1',title:'Servis'},device:{type:'heatpump',model:'Nature',serial:'123'}});await h.button.onclick();assert.equal(h.messages.length,1);assert.equal(h.fields.get('inp-name').value,'Test');assert.equal(h.fields.get('inp-scenario').value,'tc');assert.equal(h.fields.get('inp-co').value,'12');
 });
}
