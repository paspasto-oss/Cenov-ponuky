const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..');
function setup(){
  const data=new Map([['spektra_quotes_v4','DO NOT MODIFY']]);
  const context={localStorage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},crypto:require('node:crypto').webcrypto};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(base,'js/pohoda-sync-lab.js'),'utf8'),context);
  return {api:context.SpektraSyncLab,data};
}
const xml='<ofr:offerType>issuedOffer</ofr:offerType>';
test('copy uses separate quote, inspection and IndexedDB namespaces and blocks external data connections',()=>{
  for(const file of ['app.html','js/contacts.js','js/inspections.js','js/idb-stock.js']){
    const text=fs.readFileSync(path.join(base,file),'utf8');
    for(const name of ['spektra_quotes_v4','spektra_inspections_v1','spektra_inspection_photos_v1','SpektraPonukyDB'])assert.ok(!text.includes(name),file+' contains production namespace '+name);
  }
  for(const file of ['app.html','admin/stock-sync.html'])assert.match(fs.readFileSync(path.join(base,file),'utf8'),/connect-src 'self'/);
});
test('same snapshot is queued once; revision is distinct; production storage is untouched',()=>{
  const {api,data}=setup(),one=api.enqueue('CP1',xml),two=api.enqueue('CP1',xml);
  assert.equal(two.duplicate,true);assert.equal(two.job.id,one.job.id);
  api.enqueue('CP1',xml+' revision');assert.equal(api.read().length,2);
  assert.equal(data.get('spektra_quotes_v4'),'DO NOT MODIFY');
});
test('failure can be retried; simulated success is never real confirmation',()=>{
  const {api}=setup(),{job}=api.enqueue('CP2',xml);
  assert.equal(api.simulate(job.id,false).status,'simulated_error');
  assert.equal(api.simulate(job.id,true).status,'simulated_ok');
  assert.equal(api.simulate(job.id,true).simulationAttempts,2);
  assert.equal(api.read()[0].pohoda_document_id,undefined);
});
test('sandbox cannot connect even if cloud configuration is replaced',async()=>{
  const context={window:{SPEKTRA_SYNC_SANDBOX:true,SPEKTRA_SUPABASE:{url:'https://example.supabase.co',anonKey:'test'},supabase:{createClient(){throw new Error('Must never connect');}}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(base,'js/db.js'),'utf8'),context);
  const result=await context.window.SpektraDB.init();assert.equal(result.online,false);
});
