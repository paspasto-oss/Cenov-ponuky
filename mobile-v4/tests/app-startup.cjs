// Run: node --test mobile-v4/tests/app-startup.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'..');
const repo=path.join(base,'..');
const app=path.join(base,'app.html');
const entries=[path.join(repo,'index.html'),path.join(base,'index.html')];
const html=fs.readFileSync(app,'utf8');

function attribute(attributes,name){
  const match=attributes.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));
  return match?(match[1]??match[2]??match[3]):null;
}
function scriptsFrom(source){
  // These static entry pages use classic scripts. HTML ends script raw text at
  // the first closing tag, including one inside a JavaScript string literal.
  const tags=/<!--[\s\S]*?-->|<script\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;
  return [...source.matchAll(tags)].filter(match=>match[1]!==undefined)
    .map(match=>({src:attribute(match[1],'src'),body:match[2]}));
}
function entryUrl(file){
  return new URL(path.relative(repo,file).split(path.sep).join('/'),'https://spektra.test/');
}
function previewSource(){
  const script=scriptsFrom(html).find(script=>!script.src&&/async function printPDF\(/.test(script.body));
  assert.ok(script,'The PDF preview must belong to an inline application script');
  const source=script.body.match(/^async function printPDF\(\)\{[\s\S]*?^\}/m);
  assert.ok(source,'The complete PDF preview function must remain inside its HTML script boundary');
  return source[0];
}
function environment({blocked=false,render=async()=>({name:'CP-test.pdf'})}={}){
  const calls={order:[],opened:[],replaced:[],created:[],revoked:[],timers:[],downloads:[],errors:[],alerts:[],closed:0};
  const preview={
    document:{title:'',body:{style:{},textContent:''}},
    location:{replace:url=>calls.replaced.push(url)},
    close:()=>calls.closed++
  };
  const context=vm.createContext({
    window:{open(...args){calls.order.push('open');calls.opened.push(args);return blocked?null:preview}},
    document:{createElement(tag){
      assert.equal(tag,'a');
      const anchor={click(){calls.downloads.push({href:anchor.href,download:anchor.download})}};
      return anchor;
    }},
    createPdfFile(){calls.order.push('render');return render()},
    URL:{
      createObjectURL(file){calls.created.push(file);return 'blob:test-pdf'},
      revokeObjectURL:url=>calls.revoked.push(url)
    },
    setTimeout:(callback,delay)=>calls.timers.push({callback,delay}),
    console:{error:error=>calls.errors.push(error)},
    alert:message=>calls.alerts.push(message)
  });
  vm.runInContext(previewSource(),context,{filename:'app.html:printPDF'});
  return {context,calls,preview};
}

test('every local script referenced by the active app and entry pages exists and compiles',()=>{
  const checked=new Set();
  for(const entry of [app,...entries]){
    for(const script of scriptsFrom(fs.readFileSync(entry,'utf8'))){
      if(!script.src)continue;
      const url=new URL(script.src,entryUrl(entry));
      if(url.origin!==entryUrl(entry).origin)continue;
      const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
      assert.ok(fs.existsSync(file),'Missing application script: '+script.src);
      if(checked.has(file))continue;
      new vm.Script(fs.readFileSync(file,'utf8'),{filename:path.relative(repo,file)});
      checked.add(file);
    }
  }
  assert.ok(checked.has(path.join(base,'js/contacts.js')),'Contact suggestions must load with the app');
});

test('both entry pages and their fallback links open the same current application URL',()=>{
  const targets=[];
  for(const entry of entries){
    const source=fs.readFileSync(entry,'utf8');
    const redirects=[];
    for(const script of scriptsFrom(source).filter(script=>!script.src)){
      vm.runInNewContext(script.body,{location:{replace:target=>redirects.push(target)}});
    }
    assert.equal(redirects.length,1,'Each entry must redirect exactly once');
    const target=new URL(redirects[0],entryUrl(entry));
    assert.equal(target.pathname,entryUrl(app).pathname);
    assert.ok(target.searchParams.get('v'),'The application entry must have a cache version');
    const fallback=source.match(/<a\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/i);
    assert.ok(fallback,'A manual entry link must remain available');
    assert.equal(new URL(attribute(fallback[1],'href'),entryUrl(entry)).href,target.href);
    targets.push(target.href);
  }
  assert.equal(targets[0],targets[1],'Desktop and mobile entries must request the same app version');
});

test('PDF preview opens synchronously with a plain loading message before rendering completes',async()=>{
  let finish;
  const file={name:'CP-test.pdf'};
  const rendering=new Promise(resolve=>{finish=resolve});
  const e=environment({render:()=>rendering});
  const pending=e.context.printPDF();
  assert.deepEqual(e.calls.order,['open','render']);
  assert.deepEqual(e.calls.opened,[['about:blank','_blank']]);
  assert.match(e.preview.document.title,/PDF/);
  assert.match(e.preview.document.body.textContent,/Pripravujem.*PDF/);
  assert.doesNotMatch(e.preview.document.body.textContent,/<(?:script|link|body)\b/i);
  assert.deepEqual(e.calls.replaced,[]);
  assert.deepEqual(e.calls.created,[]);
  finish(file);
  await pending;
  assert.deepEqual(e.calls.created,[file]);
  assert.deepEqual(e.calls.replaced,['blob:test-pdf']);
  assert.equal(e.calls.closed,0);
  assert.deepEqual(e.calls.downloads,[]);
  assert.deepEqual(e.calls.alerts,[]);
  assert.deepEqual(e.calls.revoked,[],'The viewer must be able to finish loading the PDF');
  assert.equal(e.calls.timers.length,1);
  assert.ok(e.calls.timers[0].delay>=60000,'Keep the PDF URL alive while the mobile viewer loads');
  e.calls.timers[0].callback();
  assert.deepEqual(e.calls.revoked,['blob:test-pdf']);
});

test('a blocked preview window falls back to downloading the generated PDF',async()=>{
  const e=environment({blocked:true});
  await e.context.printPDF();
  assert.deepEqual(e.calls.order,['open','render']);
  assert.deepEqual(e.calls.downloads,[{href:'blob:test-pdf',download:'CP-test.pdf'}]);
  assert.deepEqual(e.calls.replaced,[]);
  assert.deepEqual(e.calls.alerts,[]);
  assert.equal(e.calls.closed,0);
  assert.deepEqual(e.calls.revoked,[]);
  assert.equal(e.calls.timers.length,1);
  assert.ok(e.calls.timers[0].delay>0,'Release the URL after the download has started');
  e.calls.timers[0].callback();
  assert.deepEqual(e.calls.revoked,['blob:test-pdf']);
});

for(const blocked of [false,true])test('PDF rendering errors clean up '+(blocked?'a blocked popup':'an open preview'),async()=>{
  const error=new Error('Test PDF rendering failure');
  const e=environment({blocked,render:async()=>{throw error}});
  await e.context.printPDF();
  assert.equal(e.calls.closed,blocked?0:1);
  assert.deepEqual(e.calls.errors,[error]);
  assert.equal(e.calls.alerts.length,1);
  assert.match(e.calls.alerts[0],/Test PDF rendering failure/);
  assert.deepEqual(e.calls.created,[]);
  assert.deepEqual(e.calls.replaced,[]);
  assert.deepEqual(e.calls.downloads,[]);
  assert.deepEqual(e.calls.timers,[]);
});
