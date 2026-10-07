const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(base,'js/home-toolbar.js'),'utf8');
const html=fs.readFileSync(path.join(base,'app.html'),'utf8');

// A small connected DOM fixture: moving a button or input preserves its identity,
// and clicks bubble through the mounted menu to the document listeners.
function env(screen='home'){
  const events=[],calls=[],observations=[];
  let focused=null;
  function matches(node,selector){
    const parts=selector.split(/\s*>\s*/);
    if(parts.length>1)return matches(node,parts.pop())&&!!node.parentElement&&matches(node.parentElement,parts.join(' > '));
    const tag=selector.match(/^[a-z][\w-]*/i)?.[0],id=selector.match(/#([\w-]+)/)?.[1];
    return (!tag||node.tagName===tag)&&(!id||node.id===id)
      &&[...selector.matchAll(/\.([\w-]+)/g)].every(m=>node.classList.contains(m[1]))
      &&[...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(m=>m[2]===undefined?node.getAttribute(m[1])!==null:node.getAttribute(m[1])===m[2]);
  }
  function element(tagName){
    const attrs={},listeners=[];
    const node={tagName,id:'',className:'',dataset:{},children:[],parentElement:null,hidden:false,textContent:'',
      setAttribute(k,v){attrs[k]=String(v)},
      getAttribute(k){return k.startsWith('data-')?(this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null):(attrs[k]??null)},
      removeAttribute(k){delete attrs[k]},
      appendChild(child){child.remove();child.parentElement=this;this.children.push(child);return child},
      append(...children){children.forEach(child=>this.appendChild(child))},
      insertBefore(child,reference){child.remove();child.parentElement=this;this.children.splice(this.children.indexOf(reference),0,child);return child},
      before(other){other.remove();const parent=this.parentElement;other.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,other)},
      remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null}},
      querySelectorAll(selector){return this.children.flatMap(child=>[...(matches(child,selector)?[child]:[]),...child.querySelectorAll(selector)])},
      querySelector(selector){return this.querySelectorAll(selector)[0]??null},
      closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)??null},
      contains(other){return this===other||this.children.some(child=>child.contains(other))},
      addEventListener(type,fn){listeners.push([type,fn])},
      dispatch(type,event){listeners.filter(([name])=>name===type).forEach(([,fn])=>fn(event));this.parentElement?.dispatch(type,event)},
      click(){const event={target:this};const result=this.onclick?.(event);this.dispatch('click',event);document.dispatch('click',event);return result},
      focus(){focused=this}
    };
    node.classList={
      contains:name=>node.className.split(/\s+/).includes(name),
      add(...names){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),...names])].join(' ')},
      remove(...names){node.className=node.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ')}
    };
    return node;
  }
  const body=element('body');
  const document={body,readyState:'loading',createElement:element,
    addEventListener(...args){events.push(args)},
    dispatch(type,event){events.filter(([name])=>name===type).forEach(([,fn])=>fn(event))},
    querySelectorAll:selector=>[...(matches(body,selector)?[body]:[]),...body.querySelectorAll(selector)],
    querySelector(selector){return this.querySelectorAll(selector)[0]??null},
    getElementById(id){return this.querySelector('#'+id)}
  };
  function add(parent,tagName,id='',className=''){
    const node=element(tagName);node.id=id;node.className=className;parent.appendChild(node);return node;
  }
  const oldNav=add(body,'nav','','nav'),wrap=add(body,'div','','wrap'),head=add(wrap,'div','','head');
  const screens=Object.fromEntries(['home','step1','step2','step3','step4','step5','inspectionHome','inspectionWizard'].map(id=>[id,add(wrap,'section',id,'screen')]));
  function change(id){Object.values(screens).forEach(node=>node.classList.remove('on'));screens[id]?.classList.add('on')}
  change(screen);
  const hero=add(screens.home,'div','','hero'),actions=add(hero,'div','','actions');
  const buttons={};
  for(const [action,id,handler] of [
    ['inspections','inspectionListHomeBtn',''],['newQuote','','startWizard()'],['sync','','syncQuotes()'],
    ['stock','','location.href="stock-sync.html"'],['newInspection','newInspectionHomeBtn','']
  ]){
    const button=add(actions,'button',id);button.setAttribute('onclick',handler);
    button.onclick=()=>calls.push([action]);buttons[action]=button;
  }
  add(screens.inspectionHome,'div','','hero');add(screens.inspectionHome,'div','','topline');
  const filters={};
  for(const prefix of ['quote','inspection']){
    const card=add(screens[prefix==='quote'?'home':'inspectionHome'],'div','','card');
    const heading=add(card,'div','','row'),reset=add(heading,'button');
    reset.onclick=()=>calls.push([prefix+'Reset']);
    const fields=['Name','Place','From','To'].map((suffix,index)=>{
      const wrapper=index%2?card.children.at(-1):add(card,'div','','grid2');
      const field=add(wrapper,'div','','field'),label=add(field,'label'),input=add(field,'input',prefix+'Filter'+suffix);
      input.value='saved-'+suffix;input.oninput=()=>calls.push([prefix+suffix]);
      return {field,label,input};
    });
    const list=add(card,'div',prefix+'List');filters[prefix]={card,heading,reset,fields,list};
  }
  const window={document,
    go(id){calls.push(['go',id]);change(id)},renderHome(){calls.push(['renderHome'])},
    async syncQuotes(...args){calls.push(['syncQuotes',...args])},
    SpektraInspections:{async refresh(){calls.push(['refreshInspections'])}},
    downloadPohodaIssuedOfferXml(){calls.push(['exportXml'])},alert(message){calls.push(['alert',message])},
    MutationObserver:class{constructor(callback){this.callback=callback}observe(node,options){observations.push({node,options})}}
  };
  vm.runInNewContext(source,{window});
  return {window,document,events,calls,observations,buttons,filters,hero,oldNav,head,wrap,change,
    mount:()=>window.SpektraHomeToolbar.mount(),
    get bar(){return document.getElementById('homeToolbar')},get focused(){return focused}};
}

test('toolbar module compiles and waits for inspection initialization',()=>{
  new vm.Script(source);
  const e=env();assert.equal(e.events.length,1);assert.equal(e.events[0][0],'DOMContentLoaded');
  assert.equal(e.events[0][2].once,true);assert.equal(e.bar,null);
  assert.ok(html.indexOf('src="js/home-toolbar.js?')>html.indexOf('src="js/inspections.js?'));
  assert.equal((html.match(/src="js\/home-toolbar\.js\?/g)||[]).length,1);
});
test('bottom bar has inspections, create menu, sync menu and quotes in the requested order',()=>{
  const e=env();e.mount();
  const row=e.bar.querySelector('.homeToolbarRow');
  assert.deepEqual(row.children.map(node=>node.dataset.homeAction||node.querySelector('.homeToolbarToggle').textContent),['inspections','＋','↻','quotes']);
  const create=e.document.getElementById('homeCreateMenu'),sync=e.document.getElementById('homeSyncMenu');
  assert.deepEqual(create.children,[e.buttons.newInspection,e.buttons.newQuote]);
  assert.deepEqual(sync.children.slice(0,2),[e.buttons.sync,e.buttons.stock]);
  assert.equal(sync.children[2].textContent,'Export XML do POHODY');
  assert.equal(create.hidden,true);assert.equal(sync.hidden,true);
  assert.equal(e.bar.parentElement,e.document.body);assert.equal(e.document.body.classList.contains('hasBottomToolbar'),true);
  assert.equal(e.oldNav.parentElement,null);assert.equal(e.hero.parentElement,null);
  assert.equal(e.head.parentElement.id,'appStickyHeader');
});
test('list navigation reflects the actual active screen without changing it',()=>{
  const e=env();e.mount();
  const quotes=e.document.getElementById('quoteListHomeBtn');
  assert.equal(e.bar.hidden,false);assert.equal(quotes.getAttribute('aria-current'),'page');
  assert.equal(e.buttons.inspections.getAttribute('aria-current'),null);
  e.change('inspectionHome');e.window.SpektraHomeToolbar.updateView();
  assert.equal(e.buttons.inspections.getAttribute('aria-current'),'page');assert.equal(quotes.getAttribute('aria-current'),null);
  assert.equal(e.document.querySelector('.screen.on').id,'inspectionHome');assert.deepEqual(e.calls,[]);
});
test('toolbar stays visible and identifies the current section throughout each wizard',()=>{
  const e=env();e.mount();
  for(const [screen,active] of [['step1','quotes'],['step2','quotes'],['step3','quotes'],['step4','quotes'],['step5','quotes'],['inspectionWizard','inspections'],[null,'quotes']]){
    e.change(screen);e.window.SpektraHomeToolbar.updateView();
    assert.equal(e.bar.hidden,false);
    assert.deepEqual(e.bar.querySelectorAll('[aria-current="page"]').map(button=>button.dataset.homeAction),[active]);
    assert.equal(e.document.querySelector('.screen.on')?.id??null,screen);
  }
});
test('menus are exclusive and close after selection, outside click, Escape or screen change',()=>{
  const e=env();e.mount();
  const [createToggle,syncToggle]=e.bar.querySelectorAll('.homeToolbarToggle');
  const create=e.document.getElementById(createToggle.getAttribute('aria-controls'));
  const sync=e.document.getElementById(syncToggle.getAttribute('aria-controls'));
  createToggle.click();assert.equal(create.hidden,false);assert.equal(createToggle.getAttribute('aria-expanded'),'true');
  syncToggle.click();assert.equal(create.hidden,true);assert.equal(createToggle.getAttribute('aria-expanded'),'false');assert.equal(sync.hidden,false);
  createToggle.click();e.buttons.newQuote.click();assert.equal(create.hidden,true);assert.deepEqual(e.calls,[['newQuote']]);
  createToggle.click();e.document.body.click();assert.equal(create.hidden,true);
  syncToggle.click();e.document.dispatch('keydown',{key:'Escape'});assert.equal(sync.hidden,true);assert.equal(e.focused,syncToggle);
  createToggle.click();e.change('inspectionWizard');e.window.SpektraHomeToolbar.updateView();assert.equal(create.hidden,true);
  assert.ok([createToggle,syncToggle].every(button=>button.getAttribute('aria-expanded')==='false'));
});
test('navigation and menu actions retain existing handlers and sync both lists',async()=>{
  const e=env();const originals=Object.fromEntries(Object.entries(e.buttons).map(([key,button])=>[key,button.onclick]));e.mount();
  for(const key of ['inspections','newQuote','stock','newInspection'])assert.equal(e.buttons[key].onclick,originals[key]);
  e.change('inspectionHome');e.document.getElementById('quoteListHomeBtn').click();
  assert.deepEqual(e.calls,[['go','home'],['renderHome']]);assert.equal(e.document.querySelector('.screen.on').id,'home');
  e.calls.length=0;await e.buttons.sync.click();
  assert.deepEqual(e.calls,[['syncQuotes',true,false],['refreshInspections']]);
});
test('XML export requires the quote summary and invokes the existing exporter there',()=>{
  const e=env();e.mount();const xml=e.document.getElementById('homeSyncMenu').children[2];
  xml.click();assert.equal(e.calls.length,1);assert.equal(e.calls[0][0],'alert');assert.match(e.calls[0][1],/finálny súhrn/);
  e.calls.length=0;e.change('step5');xml.click();assert.deepEqual(e.calls,[['exportXml']]);
});
test('repeated mount preserves controls, filter values and handlers without duplicate listeners',()=>{
  const e=env();const filter=e.filters.quote,resetHandler=filter.reset.onclick,inputHandlers=filter.fields.map(({input})=>input.oninput);
  e.mount();const bar=e.bar,eventCount=e.events.length,observerCount=e.observations.length;
  for(let n=0;n<3;n++)e.mount();
  assert.equal(e.bar,bar);assert.equal(e.events.length,eventCount);assert.equal(e.observations.length,observerCount);
  assert.equal(e.document.querySelectorAll('#homeToolbar').length,1);
  const filterBar=e.document.getElementById('quoteFilterBar');
  assert.deepEqual(filterBar.children,[...filter.fields.map(({field})=>field),filter.reset]);
  assert.equal(filter.reset.onclick,resetHandler);
  filter.fields.forEach(({input,label},index)=>{
    assert.equal(e.document.getElementById(input.id),input);assert.equal(input.value,'saved-'+['Name','Place','From','To'][index]);
    assert.equal(input.oninput,inputHandlers[index]);assert.equal(label.htmlFor,input.id);
  });
  const viewport=e.document.getElementById('quoteFilterViewport'),toggle=e.document.getElementById('quoteFilterToggle');
  assert.equal(viewport.hidden,true);toggle.click();assert.equal(viewport.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');
  toggle.click();assert.equal(viewport.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');
});
test('missing entry points fail safely without removing existing content',()=>{
  const e=env();e.buttons.newInspection.remove();
  assert.doesNotThrow(()=>e.mount());assert.equal(e.bar,null);
  assert.equal(e.hero.parentElement.id,'home');assert.equal(e.oldNav.parentElement,e.document.body);assert.equal(e.head.parentElement,e.wrap);
  e.filters.quote.fields[1].input.remove();
  assert.doesNotThrow(()=>e.window.SpektraHomeToolbar.compactFilters('quote'));
  assert.equal(e.document.getElementById('quoteFilterBar'),null);
  assert.doesNotThrow(()=>e.window.SpektraHomeToolbar.updateView());
});
test('enhancement contains no data writes or authentication operations',()=>{
  assert.doesNotMatch(source,/localStorage|indexedDB|\.rpc\(|\.from\(|saveQuote\(|upsertCurrent\(|\.signIn\(|\.signOut\(/);
  // Existing input nodes and clear-filter button are moved, never recreated.
  assert.match(source,/bar\.appendChild\(field\)/);assert.match(source,/bar\.appendChild\(reset\)/);
});
test('entry URLs share a versioned app target, original filters remain and CSS fixes the bar below',()=>{
  for(const suffix of ['Name','Place','From','To'])assert.equal((html.match(new RegExp('id="quoteFilter'+suffix+'"','g'))||[]).length,1);
  const versions=[];
  for(const relative of ['mobile-v4/index.html','index.html']){
    const entry=fs.readFileSync(path.join(base,'..',relative),'utf8');
    const target=entry.match(/location\.replace\('([^']+)'\)/)?.[1];assert.ok(target);
    const url=new URL(target,'https://example.test/'+relative);
    assert.equal(url.pathname,'/mobile-v4/app.html');assert.match(url.searchParams.get('v'),/^\d{8}-[\w-]+$/);
    assert.equal(entry.match(/<a\b[^>]*href="([^"]+)"/)?.[1],target);versions.push(url.searchParams.get('v'));
  }
  assert.equal(new Set(versions).size,1);
  const css=fs.readFileSync(path.join(base,'js/home-toolbar.css'),'utf8');
  assert.match(css,/body\s*>\s*\.homeToolbar\{[^}]*position:fixed[^}]*bottom:0/);
  assert.match(css,/\.homeToolbar \.homeToolbarRow\{[^}]*grid-template-columns:1fr 64px 64px 1fr/);
  assert.match(css,/\.compactFilterViewport\{[^}]*overflow-x:auto/);
  assert.match(css,/\.homeToolbar\[hidden\]/);
});
