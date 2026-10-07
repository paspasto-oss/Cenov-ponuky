// Run: node --test mobile-v4/tests/pdf-pagination.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../js/pdf-pagination.js');
const app=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
const src=fs.readFileSync(path.join(__dirname,'../js/pdf-pagination.js'),'utf8');
function pageMock(index=0){
 return {style:{},ownerDocument:{fonts:{ready:Promise.resolve()}},
  getBoundingClientRect:()=>({width:793.7,height:1122.52,left:0,top:0}),
  querySelectorAll:selector=>selector==='img'?[]:[{href:'https://www.spektrainstall.sk/',getBoundingClientRect:()=>({left:50,top:1080,width:150,height:12})}]};
}
function pdfMock(){return class {
 constructor(opts){this.options=opts;this.pages=1;this.images=[];this.links=[];this.internal={getNumberOfPages:()=>this.pages};}
 addPage(format,orientation){assert.equal(format,'a4');assert.equal(orientation,'portrait');this.pages++;}
 addImage(...args){this.images.push(args);}
 link(...args){this.links.push({page:this.pages,args});}
};}
function renderer(log=[]){return async(p,options)=>{
 const canvas={width:1588,height:2246,toDataURL:()=> 'data:image/jpeg;base64,AA=='};
 log.push({p,options,canvas});return canvas;
};}
test('pagination dimensions are portrait A4, independent of viewport',()=>{
 assert.equal(api.width,210);assert.equal(api.height,297);
});
test('both templates expose explicit table, footer and layout markers',()=>{
 assert.equal((app.match(/data-pdf-items style/g)||[]).length,2);
 assert.equal((app.match(/data-pdf-footer style/g)||[]).length,2);
 assert.ok(app.includes('data-pdf-layout="technical"'));
 assert.ok(app.includes('data-pdf-layout="presentation"'));
 assert.ok(app.includes('data-pdf-content style'));
});
test('trade export returns paginated PDF before reaching legacy fit-to-page code',()=>{
 const start=app.indexOf('async function createPdfFile(){'),end=app.indexOf('async function sharePdf(){');
 const body=app.slice(start,end),branch=body.indexOf('if(paginateTradeOffer)');
 assert.ok(branch>0);assert.ok(body.includes('const paginateTradeOffer=isTradeQuote(current)'));
 assert.ok(body.indexOf('SpektraPdfPagination.render',branch)<body.indexOf('const canvas=await window.html2canvas(root'));
 assert.ok(body.includes('finally{prepared.dispose();}'));
 assert.ok(body.includes('holder.remove();'));
});
test('existing non-trade export retains its separate warranty page',()=>{
 assert.ok(app.includes('const termsPage=holder.children[1]'));
 assert.ok(app.includes('const expectedPages=termsPage?2:1'));
});
test('row boundaries, continued table headers and final totals are explicit',()=>{
 assert.ok(src.includes("row.setAttribute('data-pdf-row-index'"));
 assert.ok(src.includes("activeTable.querySelectorAll('tbody,tfoot,colgroup')"));
 assert.ok(!/querySelectorAll\('thead'\)\.forEach\([^\n]*remove/.test(src));
 assert.ok(src.includes('rows.forEach(appendRow)'));
 assert.equal((app.match(/data-pdf-totals style/g)||[]).length,2);
});
test('no storage, catalog repricing, approval or signature writes in pagination module',()=>{
 assert.ok(!/localStorage|saveQuote|upsertCurrent|SpektraDB|(?:supabase|client|db)\.from\(/i.test(src));
 assert.ok(!/current\./.test(src));
});
test('render produces a page for each A4 node with constant physical width',async()=>{
 const log=[],pages=[pageMock(),pageMock(),pageMock()];
 const pdf=await api.render({pages},{html2canvas:renderer(log),jsPDF:pdfMock()});
 assert.equal(pdf.pages,3);assert.equal(pdf.images.length,3);assert.equal(log.length,3);
 for(const image of pdf.images)assert.deepEqual(image.slice(2,6),[0,0,210,297]);
 assert.deepEqual(pdf.options,{orientation:'portrait',unit:'mm',format:'a4',compress:true});
});
test('single-page offer does not gain a blank trailing page',async()=>{
 const pdf=await api.render({pages:[pageMock()]},{html2canvas:renderer(),jsPDF:pdfMock()});
 assert.equal(pdf.pages,1);assert.equal(pdf.images.length,1);
});
test('rasterization allocates only one bounded A4 canvas at a time',async()=>{
 const log=[];await api.render({pages:[pageMock(),pageMock()]},{html2canvas:renderer(log),jsPDF:pdfMock()});
 for(const {options,canvas} of log){
  assert.equal(options.scale,2);assert.equal(options.width,794);assert.equal(options.height,1123);
  assert.ok(options.width*options.height*options.scale**2<4000000);
  assert.equal(canvas.width,1);assert.equal(canvas.height,1);
 }
});
test('clickable links are attached on every correct page after pagination',async()=>{
 const pdf=await api.render({pages:[pageMock(),pageMock()]},{html2canvas:renderer(),jsPDF:pdfMock()});
 assert.deepEqual(pdf.links.map(l=>l.page),[1,2]);
 for(const l of pdf.links){assert.equal(l.args[4].url,'https://www.spektrainstall.sk/');assert.ok(l.args[1]<297);}
});
test('zero-size raster fails instead of delivering a blank PDF',async()=>{
 await assert.rejects(api.render({pages:[pageMock()]},{html2canvas:async()=>({width:0,height:0}),jsPDF:pdfMock()}),/stranu 1/);
});
test('render errors propagate to cleanup in the export caller',async()=>{
 await assert.rejects(api.render({pages:[pageMock()]},{html2canvas:async()=>{throw Error('test render failure');},jsPDF:pdfMock()}),/test render failure/);
});
test('already loaded images do not wait for events that will never fire',async()=>{
 let waited=false;await api.waitForAssets({ownerDocument:{fonts:{ready:Promise.resolve().then(()=>{waited=true;})}},querySelectorAll:()=>[{complete:true}]});
 assert.equal(waited,true);
});
test('malformed templates fail visibly instead of producing a skinny image',()=>{
 assert.throws(()=>api.structure({getAttribute:()=>'',querySelector:()=>null}),/Šablóna ponuky/);
});
test('very long scopes have a bounded split depth and very long rows fail safely',()=>{
 assert.ok(src.includes('if(depth>8)'));
 assert.ok(src.includes('je vyššia než strana A4'));
 assert.ok(src.includes('catch(e){stage.remove();throw e;}'));
});
test('all pagination and inline scripts compile',()=>{
 new vm.Script(src);
 for(const s of app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(s[1]);
});

// A deterministic measuring DOM exercises the actual pagination state machine.
// Row heights are explicit; these tests do not pretend to verify browser fonts.
class MeasureNode{
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag.toLowerCase();this.children=[];this.attrs={};this.style={};this._text='';this.height=null;}
 appendChild(child){child.remove();this.children.push(child);child.parentNode=this;return child;}
 append(...children){children.forEach(child=>this.appendChild(child));}
 prepend(child){child.remove();this.children.unshift(child);child.parentNode=this;}
 remove(){if(this.parentNode){const children=this.parentNode.children;children.splice(children.indexOf(this),1);this.parentNode=null;}}
 setAttribute(key,value){this.attrs[key]=String(value);}
 getAttribute(key){return this.attrs[key]??null;}
 hasAttribute(key){return Object.hasOwn(this.attrs,key);}
 removeAttribute(key){delete this.attrs[key];}
 get className(){return this.attrs.class||'';}
 set className(value){this.attrs.class=value;}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 set textContent(value){this._text=String(value);this.children.forEach(x=>x.parentNode=null);this.children=[];}
 get firstElementChild(){return this.children[0]||null;}
 get lastElementChild(){return this.children.at(-1)||null;}
 get tBodies(){return this.children.filter(x=>x.tagName==='tbody');}
 get rows(){return this.children.filter(x=>x.tagName==='tr');}
 get cells(){return this.children.filter(x=>['td','th'].includes(x.tagName));}
 get clientHeight(){return this.className==='quotePdfBody'?120:this.scrollHeight;}
 get clientWidth(){return 190;}
 get scrollWidth(){return 190;}
 get scrollHeight(){
  if(this.height!=null)return this.height;
  if(this.className==='quotePdfContinuation')return 15;
  if(this.tagName==='style'||this.tagName==='col'||this.tagName==='colgroup')return 0;
  return this.children.length?this.children.reduce((sum,x)=>sum+x.scrollHeight,0):this._text?10:0;
 }
 matches(selector){
  if(selector.startsWith('.'))return this.className.split(/\s+/).includes(selector.slice(1));
  const match=selector.match(/^([\w-]+)?(?:\[([^\]]+)\])?$/);if(!match)return false;
  return (!match[1]||this.tagName===match[1])&&(!match[2]||this.hasAttribute(match[2]));
 }
 querySelectorAll(selector){
  if(selector.includes(','))return [...new Set(selector.split(',').flatMap(x=>this.querySelectorAll(x)))];
  if(selector.startsWith(':scope > '))return this.children.filter(x=>x.matches(selector.slice(9)));
  if(selector==='thead th')return this.querySelectorAll('thead').flatMap(x=>x.querySelectorAll('th'));
  return this.children.flatMap(x=>[...(x.matches(selector)?[x]:[]),...x.querySelectorAll(selector)]);
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 cloneNode(deep){const node=new MeasureNode(this.ownerDocument,this.tagName);node.attrs={...this.attrs};node.style={...this.style};node.height=this.height;node._text=this._text;if(deep)this.children.forEach(x=>node.appendChild(x.cloneNode(true)));return node;}
}
function measuredDocument(){const doc={createElement:tag=>new MeasureNode(doc,tag)};doc.body=doc.createElement('body');return doc;}
function measuredTable(doc,names,{columns=5,rowHeight=20,headingAt=-1}={}){
 const table=doc.createElement('table');table.setAttribute('data-pdf-items','');
 const head=doc.createElement('thead'),headRow=doc.createElement('tr');headRow.height=10;
 for(let index=0;index<columns;index++){const cell=doc.createElement('th');cell.textContent='COLUMN_'+columns+'_'+index;headRow.appendChild(cell);}
 head.appendChild(headRow);table.appendChild(head);
 const body=doc.createElement('tbody');table.appendChild(body);
 names.forEach((name,index)=>{const row=doc.createElement('tr');row.height=rowHeight;if(index===headingAt)row.setAttribute('data-pdf-group-heading','');const cell=doc.createElement('td');cell.textContent=name;row.appendChild(cell);body.appendChild(row);});
 return table;
}
function measuredQuote(){
 const doc=measuredDocument(),source=doc.createElement('div');source.setAttribute('data-pdf-layout','technical');
 const title=doc.createElement('h1');title.textContent='Cenová ponuka';title.height=20;source.appendChild(title);
 source.appendChild(measuredTable(doc,['MAIN_DEVICE','MAIN_MATERIAL'],{rowHeight:20}));
 const total=doc.createElement('div');total.textContent='TOTAL';total.height=15;source.appendChild(total);
 const section=doc.createElement('section');section.setAttribute('data-pdf-appendix','');section.setAttribute('data-pdf-page-break-before','');
 const heading=doc.createElement('h2');heading.textContent='APPENDIX';heading.height=10;section.appendChild(heading);
 section.appendChild(measuredTable(doc,Array.from({length:13},(_,i)=>'APPENDIX_ITEM_'+i),{columns:4}));source.appendChild(section);
 const footer=doc.createElement('div');footer.setAttribute('data-pdf-footer','');footer.textContent='FOOTER';source.appendChild(footer);
 return {doc,source};
}
test('appendix tables paginate whole rows with their own repeated headers and follow the main totals',()=>{
 const {doc,source}=measuredQuote(),original=source.textContent;
 const result=api.prepare(source,{customerName:'Zákazník',quoteNo:'26NA42',revision:'Revízia R2',variant:'Variant: Komfort'});
 assert.equal(result.pages.length,5);
 assert.match(result.pages[0].textContent,/MAIN_DEVICE.*MAIN_MATERIAL.*TOTAL/);
 assert.doesNotMatch(result.pages[0].textContent,/APPENDIX/);
 assert.ok(result.pages.slice(1).every(page=>page.textContent.includes('Revízia R2')&&page.textContent.includes('Variant: Komfort')));
 const tables=result.pages.flatMap(page=>page.querySelectorAll('table[data-pdf-items]'));
 assert.equal(tables.length,5);assert.equal(tables[0].querySelectorAll('thead th').length,5);
 assert.ok(tables.slice(1).every(table=>table.querySelectorAll('thead th').length===4));
 const labels=tables.flatMap(table=>table.tBodies.flatMap(body=>body.rows.map(row=>row.cells[0].textContent)));
 assert.deepEqual(labels,['MAIN_DEVICE','MAIN_MATERIAL',...Array.from({length:13},(_,i)=>'APPENDIX_ITEM_'+i)]);
 assert.equal(source.textContent,original);result.dispose();assert.equal(doc.body.children.length,0);
});
test('a group heading moves with its next item when the remaining page has space only for the heading',()=>{
 const doc=measuredDocument(),source=doc.createElement('div');source.setAttribute('data-pdf-layout','technical');
 const title=doc.createElement('div');title.textContent='TITLE';title.height=20;source.appendChild(title);
 source.appendChild(measuredTable(doc,['A','B','C','GROUP','FIRST_CHILD'],{rowHeight:20,headingAt:3}));
 const footer=doc.createElement('div');footer.setAttribute('data-pdf-footer','');source.appendChild(footer);
 const result=api.prepare(source);
 assert.equal(result.pages.length,2);assert.doesNotMatch(result.pages[0].textContent,/GROUP/);
 assert.match(result.pages[1].textContent,/GROUP.*FIRST_CHILD/);result.dispose();
});
