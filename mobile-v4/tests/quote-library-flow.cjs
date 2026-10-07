/* Real workbench actions with controllable account-specific DB responses.
 * The small DOM adapter exercises dialog lifetime and edited form values;
 * it does not attempt to measure layout or replace browser rendering tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../js/quote-assemblies.js');
const S=require('../js/hvac-scenarios.js');
const O=require('../js/quote-workbench-output.js');
const source=fs.readFileSync(path.join(__dirname,'../js/quote-workbench.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const cacheKey=owner=>'spektra.quoteLibrary.v1.'+owner;
const pricing=(owner,rate,revision=1)=>({key:'pricing:company',kind:'pricing',revision,payload:{material_mode:'catalog',labor_sell_rate:rate,owner_marker:owner}});
function deferred(){let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};}
const decode=value=>String(value??'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

function environment({initialUser='userA',cache={},list,save}={}){
  const elements=new Map(),storage=new Map(),calls={lists:[],saves:[],cacheWrites:[]};
  let user=initialUser;
  for(const [owner,records]of Object.entries(cache))storage.set(cacheKey(owner),JSON.stringify(records));
  function unregister(node){for(const child of node.children)unregister(child);if(elements.get(node.id)===node)elements.delete(node.id);}
  function create(tag='div',id=''){
    let markup='';const classes=new Set();
    const node={tagName:tag.toUpperCase(),id,value:'',checked:false,disabled:false,dataset:{},children:[],parentNode:null,textContent:'',listeners:{},
      classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),toggle(value,force){const next=force===undefined?!classes.has(value):force;if(next)classes.add(value);else classes.delete(value);return next;}},
      appendChild(child){child.parentNode=node;node.children.push(child);if(child.id)elements.set(child.id,child);return child;},
      remove(){unregister(node);if(node.parentNode){const children=node.parentNode.children,index=children.indexOf(node);if(index>=0)children.splice(index,1);}node.parentNode=null;},
      contains(child){return child===node||node.children.some(item=>item.contains(child));},
      addEventListener(name,callback){node.listeners[name]=callback;},
      querySelector(){return node.children.find(child=>['INPUT','SELECT','BUTTON'].includes(child.tagName))||null;},
      querySelectorAll(){return [];},closest(){return null;},focus(){},setAttribute(){},removeAttribute(){}
    };
    Object.defineProperty(node,'innerHTML',{get:()=>markup,set(html){
      for(const child of node.children)unregister(child);node.children=[];markup=String(html);
      // Only form controls and named workbench nodes need an identity here.
      for(const match of markup.matchAll(/<(input|select|textarea|div|button)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
        const child=create(match[1],decode(match[3])),attrs=match[2];
        child.value=decode(attrs.match(/\bvalue="([^"]*)"/)?.[1]||'');
        child.checked=/\bchecked(?:\s|$)/.test(attrs);
        if(match[1]==='select'){
          const rest=markup.slice(match.index+match[0].length),end=rest.indexOf('</select>'),options=rest.slice(0,end);
          const selected=[...options.matchAll(/<option\b([^>]*)>/g)].find(option=>/\bselected(?:\s|$)/.test(option[1]))||[...options.matchAll(/<option\b([^>]*)>/g)][0];
          child.value=decode(selected?.[1].match(/\bvalue="([^"]*)"/)?.[1]||'');
        }
        node.appendChild(child);
      }
    }});
    if(id)elements.set(id,node);return node;
  }
  const body=create('body','body');
  for(const id of ['quoteWorkbench','rowMaterialEditorSlot','quoteRowsRevision'])body.appendChild(create('div',id));
  const document={body,createElement:create,getElementById:id=>elements.get(id)||null,querySelectorAll:()=>[],querySelector:()=>null};
  const c=vm.createContext({console,document,setTimeout,clearTimeout,
    current:{id:'same-shared-quote',status:'draft',quote_no:'CP-42',customer:{name:'Zákazník'},items:[]},quotes:[],stocks:[],bundleRecipes:{},deviceCatalog:[],
    SpektraQuoteAssemblies:A,SpektraHvacScenarios:S,SpektraQuoteWorkbenchOutput:O,
    eur:value=>value==null?'—':Number(value).toFixed(2)+' €',
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,String(value));calls.cacheWrites.push({key,records:JSON.parse(value)});}},
    SpektraDB:{getUser:()=>({id:user}),isAuthenticated:()=>true,
      async listQuoteLibrary(){const owner=user;calls.lists.push(owner);return copy(await list(owner));},
      async saveQuoteLibrary(key,kind,payload,expectedRevision){
        const call={owner:user,key,kind,payload:copy(payload),expectedRevision};calls.saves.push(call);
        return copy(await save(call));
      }}
  });c.window=c;
  vm.runInContext(source,c,{filename:'quote-workbench.js'});
  const api=c.SpektraQuoteWorkbench;
  const element=id=>{const value=elements.get(id);assert.ok(value,'Expected DOM node '+id);return value;};
  async function openPricing(rate){
    await api.action('pricing');
    if(rate!==undefined)element('wbLaborSell').value=String(rate);
    element('wbPricingMode').value='catalog';element('wbPricingApply').checked=false;
    return element('wbOverlay');
  }
  const confirm=()=>api.action('confirm-dialog',create('button'));
  return {api,c,calls,storage,element,openPricing,confirm,
    get:id=>elements.get(id)||null,
    switchUser:owner=>{user=owner;},
    cached:owner=>JSON.parse(storage.get(cacheKey(owner))||'[]')};
}

test('late library list from user A cannot replace or cache over user B library or its open dialog',async()=>{
  const pendingA=deferred(),remoteB=pricing('userB',72,3);
  const env=environment({cache:{userA:[pricing('cached-A',11)],userB:[pricing('cached-B',22)]},
    list:owner=>owner==='userA'?pendingA.promise:[remoteB],save:()=>{throw Error('No pending writes expected');}});
  const loadA=env.api.loadLibrary();
  env.switchUser('userB');await env.api.loadLibrary();
  assert.deepEqual(env.calls.lists,['userA','userB'],'A pending request must not block loading another account.');
  const dialogB=await env.openPricing(),cacheB=copy(env.cached('userB')),writesBefore=env.calls.cacheWrites.length;
  assert.equal(env.element('wbLaborSell').value,'72');
  pendingA.resolve([pricing('late-A',999,9)]);await loadA;
  assert.deepEqual(env.cached('userB'),cacheB);
  assert.equal(env.cached('userA')[0].payload.owner_marker,'cached-A');
  assert.equal(env.calls.cacheWrites.length,writesBefore);
  assert.equal(env.get('wbOverlay'),dialogB);assert.equal(env.element('wbLaborSell').value,'72');
  await env.openPricing();assert.equal(env.element('wbLaborSell').value,'72','Visible library must still belong to user B.');
});

test('late successful save for user A updates only A cache and leaves user B dialog and edited fields intact',async()=>{
  const savedA=deferred(),startedA=deferred();
  const env=environment({list:owner=>[pricing(owner,owner==='userA'?35:75,owner==='userA'?7:3)],
    save:call=>{assert.equal(call.owner,'userA');startedA.resolve();return savedA.promise;}});
  await env.api.loadLibrary();await env.openPricing(41);
  const confirmationA=env.confirm();await startedA.promise;
  assert.equal(env.calls.saves[0].expectedRevision,7);assert.equal(env.cached('userA')[0].pending,true);
  env.switchUser('userB');await env.api.loadLibrary();
  const dialogB=await env.openPricing(88),cacheB=copy(env.cached('userB')),statusB=env.element('wbStatus').textContent;
  const sent=env.calls.saves[0];savedA.resolve({key:sent.key,kind:sent.kind,payload:sent.payload,revision:8});
  await confirmationA;
  const cacheA=env.cached('userA');assert.equal(cacheA[0].revision,8);assert.equal(cacheA[0].payload.labor_sell_rate,41);assert.equal(cacheA[0].pending,undefined);
  assert.deepEqual(env.cached('userB'),cacheB);assert.equal(env.get('wbOverlay'),dialogB);
  assert.equal(env.element('wbLaborSell').value,'88');assert.equal(env.element('wbStatus').textContent,statusB);
  assert.ok(!env.calls.cacheWrites.filter(write=>write.key===cacheKey('userB')).some(write=>write.records.some(row=>row.payload.labor_sell_rate===41)));
  await env.openPricing();assert.equal(env.element('wbLaborSell').value,'75','A response cannot replace B in-memory pricing either.');
});

test('stale expected revision preserves pending local pricing and error through failed save and remote reload',async()=>{
  let latest=pricing('server',35,5);
  const conflict='Knižnica sa medzičasom zmenila: očakávaná revízia 5, aktuálna 6.';
  const env=environment({list:()=>[latest],save:call=>{
    assert.equal(call.expectedRevision,5);const error=new Error(conflict);error.code='40001';throw error;
  }});
  await env.api.loadLibrary();const dialog=await env.openPricing(49);
  latest=pricing('newer-server',80,6);
  await env.confirm();
  assert.equal(env.calls.saves.length,1);assert.equal(env.calls.saves[0].payload.labor_sell_rate,49);
  let pending=env.cached('userA').find(row=>row.key==='pricing:company');
  assert.equal(pending.pending,true);assert.equal(pending.revision,5);assert.equal(pending.payload.labor_sell_rate,49);assert.equal(pending.error,conflict);
  assert.equal(env.get('wbOverlay'),dialog);assert.match(env.element('wbDialogError').textContent,/očakávaná revízia 5/);
  await env.api.loadLibrary(true);
  pending=env.cached('userA').find(row=>row.key==='pricing:company');
  assert.equal(pending.pending,true);assert.equal(pending.revision,5);assert.equal(pending.payload.labor_sell_rate,49);assert.equal(pending.error,conflict);
  assert.ok(env.calls.saves.every(call=>call.expectedRevision===5),'Reload must not silently upgrade the expected revision and overwrite a newer server entry.');
  await env.openPricing();assert.equal(env.element('wbLaborSell').value,'49');
});

test('conflict review preserves the local payload and confirms only the server revision actually displayed',async()=>{
  let latest=pricing('server',35,5);
  const env=environment({list:()=>[latest],save:call=>{
    if(call.expectedRevision!==latest.revision){
      const error=new Error('Konflikt: očakávaná revízia '+call.expectedRevision+', aktuálna '+latest.revision+'.');error.code='40001';throw error;
    }
    latest={key:call.key,kind:call.kind,payload:copy(call.payload),revision:latest.revision+1};return latest;
  }});
  await env.api.loadLibrary();await env.openPricing(49);env.element('wbTransportSell').value='17';
  latest=pricing('newer-server',80,6);await env.confirm();
  const localPayload=copy(env.calls.saves[0].payload),pendingBeforeReview=copy(env.cached('userA'));
  assert.equal(env.calls.saves[0].expectedRevision,5);

  await env.api.action('library-conflict',{dataset:{id:'pricing:company'}});
  const firstReview=env.element('wbOverlay');
  assert.match(firstReview.innerHTML,/<h3>Moja úprava<\/h3>/);assert.match(firstReview.innerHTML,/<h3>Spoločná verzia<\/h3>/);
  assert.match(firstReview.innerHTML,/<dd>49<\/dd>/);assert.match(firstReview.innerHTML,/<dd>80<\/dd>/);
  assert.equal(env.calls.saves.length,1,'Opening the comparison must not write to the database.');
  assert.deepEqual(env.cached('userA'),pendingBeforeReview,'Review alone must not discard or alter the pending local edit.');

  // Another client writes while this comparison is open. Confirming must still
  // compare against the displayed revision 6, never silently overwrite 7.
  latest=pricing('server-after-review',91,7);await env.confirm();
  assert.equal(env.calls.saves[1].expectedRevision,6);assert.deepEqual(env.calls.saves[1].payload,localPayload);
  assert.equal(env.get('wbOverlay'),firstReview);assert.match(env.element('wbDialogError').textContent,/aktuálna 7/);
  const pending=env.cached('userA')[0];assert.equal(pending.pending,true);assert.equal(pending.revision,6);assert.deepEqual(pending.payload,localPayload);
  assert.equal(latest.payload.labor_sell_rate,91,'The unreviewed server update must survive the rejected save.');

  await env.api.action('library-conflict',{dataset:{id:'pricing:company'}});
  assert.match(env.element('wbOverlay').innerHTML,/<dd>91<\/dd>/);
  await env.confirm();
  assert.deepEqual(env.calls.saves.map(call=>call.expectedRevision),[5,6,7]);
  assert.ok(env.calls.saves.every(call=>JSON.stringify(call.payload)===JSON.stringify(localPayload)),'Every retry must retain all locally edited pricing fields and their timestamp.');
  assert.equal(env.cached('userA')[0].revision,8);assert.deepEqual(env.cached('userA')[0].payload,localPayload);
  assert.equal(env.cached('userA')[0].pending,undefined);assert.equal(env.cached('userA')[0].error,undefined);
  assert.equal(env.get('wbOverlay'),null,'Only a successful confirmed save closes the conflict dialog.');
  await env.openPricing();assert.equal(env.element('wbLaborSell').value,'49');assert.equal(env.element('wbTransportSell').value,'17');
});

test('using the displayed server version resolves local conflict without any database write',async()=>{
  let latest=pricing('server',35,5);
  const env=environment({list:()=>[latest],save:()=>{const error=new Error('Knižnica bola zmenená iným používateľom.');error.code='40001';throw error;}});
  await env.api.loadLibrary();await env.openPricing(49);latest=pricing('reviewed-server',80,6);await env.confirm();
  assert.equal(env.cached('userA')[0].pending,true);
  await env.api.action('library-conflict',{dataset:{id:'pricing:company'}});
  const reviewed=copy(latest),writesBefore=env.calls.saves.length;
  assert.match(env.element('wbOverlay').innerHTML,/<dd>80<\/dd>/);
  latest=pricing('later-server',90,7);
  await env.api.action('use-library-server',{dataset:{id:'pricing:company'}});
  assert.equal(env.calls.saves.length,writesBefore,'Choosing the shared version only adopts the displayed record locally.');
  assert.deepEqual(env.cached('userA'),[reviewed]);assert.equal(env.get('wbOverlay'),null);
  assert.equal(latest.revision,7);assert.equal(latest.payload.labor_sell_rate,90);
  await env.openPricing();assert.equal(env.element('wbLaborSell').value,'80');
});
