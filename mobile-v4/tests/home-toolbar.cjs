const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(base,'js/home-toolbar.js'),'utf8');
const html=fs.readFileSync(path.join(base,'app.html'),'utf8');
function env(screen='home'){
  const buttons=['inspections','quotes','newQuote','sync','stock','newInspection'].map(action=>({
    dataset:{homeAction:action},attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}
  }));
  const bar={hidden:false,querySelectorAll:()=>buttons};
  let current=screen;
  const events=[];
  const document={readyState:'loading',addEventListener(...args){events.push(args)},
    getElementById:id=>id==='homeToolbar'?bar:null,
    querySelector:sel=>sel==='.screen.on'?(current?{id:current}:null):null};
  const window={document};
  vm.runInNewContext(source,{window});
  return {window,events,buttons,bar,change:s=>{current=s}};
}
test('toolbar module compiles and waits for inspection initialization',()=>{
  new vm.Script(source);
  const e=env();assert.equal(e.events.length,1);assert.equal(e.events[0][0],'DOMContentLoaded');
  assert.equal(e.events[0][2].once,true);
  assert.ok(html.indexOf('src="js/home-toolbar.js?')>html.indexOf('src="js/inspections.js?'));
  assert.equal((html.match(/src="js\/home-toolbar\.js\?/g)||[]).length,1);
});
test('six menu entries follow the requested order',()=>{
  const order=[...source.matchAll(/^    \['(\w+)','([^']+)'/gm)].map(m=>m[1]);
  assert.deepEqual(order,['inspections','quotes','newQuote','sync','stock','newInspection']);
});
test('list navigation reflects actual active screen without changing it',()=>{
  const e=env();e.window.SpektraHomeToolbar.updateView();
  assert.equal(e.bar.hidden,false);assert.equal(e.buttons[1].attrs['aria-current'],'page');
  assert.equal(e.buttons[0].attrs['aria-current'],undefined);
  e.change('inspectionHome');e.window.SpektraHomeToolbar.updateView();
  assert.equal(e.buttons[0].attrs['aria-current'],'page');assert.equal(e.buttons[1].attrs['aria-current'],undefined);
});
test('toolbar remains visible in every quote and inspection step',()=>{
  const e=env();
  for(const s of ['step1','step2','step3','step4','step5','inspectionWizard',null]){
    e.change(s);e.window.SpektraHomeToolbar.updateView();
    assert.equal(e.bar.hidden,false);assert.ok(e.buttons.every(b=>!b.attrs['aria-current']));
  }
});
test('repeated mount does not rebuild toolbar or reset inputs',()=>{
  const e=env();const before=e.buttons;
  for(let n=0;n<3;n++)e.window.SpektraHomeToolbar.mount();
  assert.equal(e.buttons,before);assert.equal(e.events.length,1);
});
test('missing entry points fail safely without removing existing content',()=>{
  const e=env();e.window.document.getElementById=()=>null;
  assert.doesNotThrow(()=>e.window.SpektraHomeToolbar.mount());
  assert.doesNotThrow(()=>e.window.SpektraHomeToolbar.compactFilters('quote'));
});
test('enhancement contains no data writes or authentication operations',()=>{
  assert.doesNotMatch(source,/localStorage|indexedDB|\.rpc\(|\.from\(|saveQuote\(|upsertCurrent\(|\.signIn\(|\.signOut\(/);
  // Existing input nodes and clear-filter button are moved, never recreated.
  assert.match(source,/bar\.appendChild\(field\)/);assert.match(source,/bar\.appendChild\(reset\)/);
});
test('homepage integration refreshes entry URLs and leaves original filters in place',()=>{
  for(const suffix of ['Name','Place','From','To'])assert.equal((html.match(new RegExp('id="quoteFilter'+suffix+'"','g'))||[]).length,1);
  for(const entry of [path.join(base,'index.html'),path.join(base,'../index.html')]){
    assert.match(fs.readFileSync(entry,'utf8'),/20261006-menu4/);
  }
  const css=fs.readFileSync(path.join(base,'js/home-toolbar.css'),'utf8');
  assert.match(css,/grid-template-columns:repeat\(6,minmax/);
  assert.match(css,/\.compactFilterViewport\{[^}]*overflow-x:auto/);
  assert.match(css,/\.homeToolbar\[hidden\]/);
});
