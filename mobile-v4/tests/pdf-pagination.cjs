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
 assert.ok(!src.includes("querySelectorAll('thead"));
 assert.ok(src.includes('rows.forEach(appendRow)'));
 assert.equal((app.match(/data-pdf-totals style/g)||[]).length,2);
});
test('no storage, catalog repricing, approval or signature writes in pagination module',()=>{
 assert.ok(!/localStorage|saveQuote|upsertCurrent|SpektraDB|\.from\(/.test(src));
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
