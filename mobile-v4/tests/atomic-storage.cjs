const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {create}=require('../js/quote-storage.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function quote(id='local-1'){return {id,status:'draft',customer:{name:'Test'},items:[{name:'Test item',qty:0,price:100,cost:60}],net:0,total:0,vat_pct:23,price_complete:true};}
function response(q,version=1){return {remote_id:'remote-'+q.id,remote_customer_id:'customer',quote_no:'26NA9999',sync_version:version,status:q.status,net:q.net,total:q.total,vat_pct:q.vat_pct,price_complete:true,updated_at:'2026-10-05T12:00:00Z'};}
function env(send){
 let rows=[],current=quote(),online=true,persisted=[],writes=0;
 const e={get rows(){return rows},set rows(v){rows=v},get current(){return current},set current(v){current=v},set online(v){online=v},get persisted(){return persisted},get writes(){return writes},failPersist:false};
 e.api=create({getRows:()=>rows,setRows:v=>rows=v,getCurrent:()=>current,authenticated:()=>online,
   send,persist:()=>{if(e.failPersist)throw Error('Quota exceeded');writes++;persisted=clone(rows)}});
 return e;
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('overlapping saves are serialized; second edit survives and is sent with acknowledged version',async()=>{
 const first=deferred();const calls=[];let active=0,max=0;
 const e=env(async(q,id)=>{active++;max=Math.max(max,active);calls.push({q:clone(q),id});if(calls.length===1)await first.promise;active--;return response(q,calls.length);});
 const p1=e.api.save(e.current);await new Promise(setImmediate);
 e.current.customer.name='Second edit';const p2=e.api.save(e.current);first.resolve();
 const results=await Promise.all([p1,p2]);
 assert.equal(max,1);assert.equal(calls.length,2);assert.equal(calls[1].q.sync_version,1);
 assert.equal(calls[1].q.customer.name,'Second edit');assert.notEqual(calls[0].id,calls[1].id);
 assert.ok(results.every(r=>r.ok&&r.synced));assert.equal(e.rows[0]._dirty,false);assert.equal(e.current.sync_version,2);
});
test('response for offer A cannot overwrite the editor or IDs of offer B',async()=>{
 const wait=deferred();const e=env(async q=>{await wait.promise;return response(q)});
 const p=e.api.save(e.current);await new Promise(setImmediate);e.current=quote('B');wait.resolve();await p;
 assert.equal(e.current.id,'B');assert.equal(e.current.remote_id,undefined);assert.equal(e.rows[0].remote_id,'remote-local-1');
});
test('lost response retries the persisted exact request, even after reload',async()=>{
 const calls=[];const e=env(async(q,id)=>{calls.push({q:clone(q),id});throw Error('Network lost')});
 const result=await e.api.save(e.current);assert.equal(result.ok,false);assert.equal(result.synced,false);
 assert.ok(e.persisted[0]._outbox);const disk=clone(e.persisted);
 const restored=env(async(q,id)=>{calls.push({q:clone(q),id});return response(q)});restored.rows=disk;
 await restored.api.flush();assert.equal(calls[0].id,calls[1].id);assert.deepEqual(calls[0].q,calls[1].q);
 assert.equal(restored.rows[0]._dirty,false);assert.equal(restored.rows[0]._outbox,null);
});
test('cloud merge never drops unsynced local content on a newer server timestamp',()=>{
 const e=env();e.rows=[{...quote(),remote_id:'remote',sync_version:1,_dirty:true,customer:{name:'Local edit'},updated:1}];
 e.api.merge([{...quote(),remote_id:'remote',sync_version:2,customer:{name:'Server edit'},updated:9999}]);
 assert.equal(e.rows[0].customer.name,'Local edit');assert.equal(e.rows[0]._conflict,true);
});
test('version conflict preserves outbox and blocks queued blind retry',async()=>{
 let calls=0;const e=env(async()=>{calls++;const error=Error('Version conflict');error.code='40001';throw error});
 e.current.remote_id='remote';e.current.sync_version=1;
 const result=await e.api.save(e.current);await e.api.flush();
 assert.equal(result.conflict,true);assert.equal(calls,1);assert.ok(e.rows[0]._outbox);assert.equal(e.rows[0]._dirty,true);
});
test('legacy dirty remote draft without baseline version is never blindly uploaded',async()=>{
 let calls=0;const e=env(async()=>{calls++});e.current.remote_id='remote';
 const result=await e.api.save(e.current);assert.equal(result.conflict,true);assert.equal(calls,0);
});
test('local storage failure does not send an undurable request or claim success',async()=>{
 let calls=0;const e=env(async()=>{calls++});e.failPersist=true;
 const result=await e.api.save(e.current);assert.equal(result.ok,false);assert.equal(calls,0);
});
test('offline save is explicitly local and not falsely reported as synchronized',async()=>{
 const e=env();e.online=false;const result=await e.api.save(e.current);
 assert.deepEqual(result,{ok:true,synced:false});assert.equal(e.persisted[0]._dirty,true);
});
test('conflict recovery preserves local copy, drops old signature, and requires review',()=>{
 const e=env();e.rows=[{...quote(),_dirty:true,_conflict:true,warranty_consent:{accepted:true},remote_id:'r',sync_version:1}];
 const copy=e.api.recover('local-1',{...quote(),sync_version:2,_dirty:false});
 assert.equal(e.rows.length,2);assert.equal(copy._needs_review,true);assert.equal(copy.warranty_consent,undefined);
 assert.equal(copy.remote_id,undefined);assert.equal(e.rows[0].sync_version,2);
});
test('server quote mapping preserves zero VAT, zero quantity and frozen customer snapshot',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
 const start=html.indexOf('function remoteQuoteToLocal(');const end=html.indexOf('\nfunction mergeCloudQuotes',start);
 const c=vm.createContext({stockByCodeMap:new Map(),norm:x=>x});vm.runInContext(html.slice(start,end),c);
 const q=c.remoteQuoteToLocal({id:'r',local_id:'x',sync_version:3,status:'approved',vat_pct:0,
   customers:{name:'Changed contact'},customer_snapshot:{name:'Approved customer',note:'Original'},quote_items:[{name:'Zero',qty:0}],subtotal_ex_vat:0,total_inc_vat:0});
 assert.equal(q.vat_pct,0);assert.equal(q.items[0].qty,0);assert.equal(q.customer.name,'Approved customer');assert.equal(q.sync_version,3);
});
test('DB writes use one RPC and preserve zero quantity and VAT',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/db.js'),'utf8');const calls=[];
 const client={auth:{onAuthStateChange(){},async getSession(){return {data:{session:{user:{id:'u'}}}}}},
   async rpc(name,args){calls.push({name,args});return {data:{remote_id:'r',sync_version:1}}},
   from(){throw Error('Client must not issue nontransactional writes')}};
 const window={SPEKTRA_SUPABASE:{url:'test',anonKey:'test'},supabase:{createClient:()=>client}};
 const c=vm.createContext({window,console});vm.runInContext(source,c);await window.SpektraDB.init();
 const q=quote();q.vat_pct=0;await window.SpektraDB.saveQuote(q,'d6ed9ca1-44e6-4308-a2b7-a1c412af0d13');
 assert.equal(calls.length,1);assert.equal(calls[0].name,'save_quote_atomic');assert.equal(calls[0].args.p_quote.vat_pct,0);
 assert.equal(calls[0].args.p_items[0].qty,0);
});

test('validation rollback allows a corrected edit instead of replaying invalid data forever',async()=>{
 let calls=0;const e=env(async q=>{calls++;if(calls===1){const err=Error('Negative price');err.code='22023';throw err}return response(q)});
 e.current.items[0].price=-1;await e.api.save(e.current);assert.equal(e.rows[0]._outbox,null);
 e.current.items[0].price=100;const result=await e.api.save(e.current);assert.equal(result.synced,true);assert.equal(calls,2);
});
