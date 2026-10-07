const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../js/quote-row-output.js');
const assemblies=require('../js/quote-assemblies.js');
const workbenchOutput=require('../js/quote-workbench-output.js');
const app=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
const declarations=[...app.matchAll(/^(?:async )?function (\w+)\(/gm)];
function source(name){
  const index=declarations.findIndex(m=>m[1]===name);
  assert.ok(index>=0,name);
  return app.slice(declarations[index].index,declarations[index+1]?.index??app.length);
}
const bill=(name,patch={})=>({role:'quote_material',name,qty:1,unit:'ks',price:10,cost:5,visible:false,pohoda_code:'SKU-'+name,...patch});
const manual=(name,kind='item')=>({role:kind==='text'?'quote_text':'quote_manual',name,qty:1,unit:'ks',price:kind==='text'?0:35,cost:0,cost_override:true,visible:true,
  stored_metadata:{quote_material:{origin:'manual',kind,id:name}}});
function quote(patch={}){
  return {quote_no:'26NA0001',category:'boiler',boiler_type:'gas',system_type:'boiler',created:Date.UTC(2026,9,7),
    customer:{name:'Test',address:'Rajec'},building:{},device:{brand:'Pôvodná značka',model:'Pôvodný model',variant:'NEAKTUALNY_VARIANT',power_kw:999},
    optional_services:{annual_service:false},material_edits:{version:1,rows_mode:true,pdf_detail:true},
    items:[],net:100,vat:23,total:123,vat_pct:23,price_complete:true,pdf_banner_mode:'none',pdf_images_enabled:false,pdf_images:[],...patch};
}
function context(q){
  const c=vm.createContext({current:q,console,Date,File,Blob,SpektraQuoteRowOutput:api,SpektraQuoteAssemblies:assemblies,SpektraQuoteWorkbenchOutput:workbenchOutput,
    POHODA_COMPANY_ICO:'53690036',SPEKTRA_WARRANTY:'Záruka Spektra',SPEKTRA_WARRANTY_TERMS_VERSION:'2026-09-28-v1',
    SPEKTRA_CONSENT:'Súhlasím s podmienkami uvedenými na 2. strane tejto ponuky.',
    ensureHeatPumpInstallationItem(){},recalcQuoteTotalsFromItems(){},ensurePdfTemplateState(){},ensurePdfImagesState(){},
    customerMaterialBundleName:()=> 'Montážny materiál',quoteRowIllustration:()=>'',stockImageUrls:()=>[],
    getPdfBannerUrl:()=>'',getPdfBannerType:()=> 'gas_boiler',pdfPresentationSubtitle:()=> 'Riešenie',absolutePdfUrl:url=>url,
    customerText:x=>String(x??'').replace(/POHODA/g,'').trim(),
    esc:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    eur:x=>x==null?'—':Number(x).toFixed(2)+' €',calculateSubsidy:()=>({program:'none'}),
    isTradeQuote:q=>q.category==='other',annualServiceInfo:()=>null,annualServiceText:()=>'',warrantySignature:()=>null
  });
  const names=['offerHtmlTechnical','offerHtmlPresentation','warrantyConsentHtml','warrantyTermsHtml',
    'xmlEsc','pohodaXmlDate','isPohodaTextServiceItem','validatePohodaOfferItems','createPohodaIssuedOfferXml'];
  vm.runInContext(names.map(source).join('\n'),c);
  return c;
}
test('detailed output keeps every saved line and order without changing the quote',()=>{
  const q=quote({items:[bill('Rúrka',{qty:2.5,unit:'m'}),manual('Podmienky','text'),bill('Zariadenie 2',{role:'device'}),bill('Montáž',{role:'installation',qty:3})]});
  const before=JSON.stringify(q),rows=api.customerRows(q);
  assert.notEqual(rows,q.items);assert.deepEqual(rows,q.items);assert.equal(JSON.stringify(q),before);
});
test('summary groups untouched material and retains all manual or equipment lines',()=>{
  const material=bill('Rúrka',{qty:4,price:2.5}),device=bill('Kotol',{role:'device',price:1000}),install=bill('Montáž',{role:'installation',qty:3,price:35});
  const device2=bill('Zariadenie 2',{role:'device',price:100}),note=manual('Prístup k potrubiu','text'),service={...manual('Skúška'),role:'quote_manual_service'};
  const q=quote({material_edits:{rows_mode:true,pdf_detail:false},items:[device,material,install,device2,note,service]});
  const rows=api.customerRows(q,'Materiál');
  assert.deepEqual(rows.map(x=>x.name),['Kotol','Materiál','Montáž','Zariadenie 2','Prístup k potrubiu','Skúška']);
  assert.equal(rows[1].price,10);assert.equal(api.amounts(install,q).amount,105);
});
test('unknown prices remain unknown and zero VAT is retained',()=>{
  const q=quote({vat_pct:0,material_edits:{pdf_detail:false},items:[bill('Neznáma cena',{price:null})]});
  assert.equal(api.customerRows(q)[0].price,null);
  assert.deepEqual(api.amounts(q.items[0],q),{unit:null,amount:null,gross:null});
  assert.deepEqual(api.amounts(bill('Práca',{qty:2.5,price:4}),q),{unit:4,amount:10,gross:10});
  assert.deepEqual(api.amounts(manual('Poznámka','text'),q),{unit:null,amount:null,gross:null});
});
test('manual row names are preserved literally while legacy cleanup stays available',()=>{
  const item=bill('POHODA – upravený názov');
  const clean=x=>x.replace('POHODA','').trim();
  assert.equal(api.itemName(quote(),item,clean),'POHODA – upravený názov');
  assert.equal(api.itemName({},item,clean),'– upravený názov');
});
for(const template of ['offerHtmlTechnical','offerHtmlPresentation']){
  test(template+' renders edited rows, quantities and full-width safe text without stale model details',()=>{
    const q=quote({vat_pct:0,items:[bill('Prvý riadok',{qty:2.5,unit:'m',price:4}),manual('Poznámka <script> & text','text'),bill('Nový kotol',{role:'device',qty:2,visible:true}),manual('Ručná položka')]});
    const before=JSON.stringify(q),html=context(q)[template](),body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    assert.ok(body.indexOf('Prvý riadok')<body.indexOf('Poznámka &lt;script&gt; &amp; text'));
    assert.ok(body.indexOf('Poznámka &lt;script&gt; &amp; text')<body.indexOf('Nový kotol'));
    assert.match(body,/2\.5 m/);assert.match(body,/10\.00 €/);
    const textRow=body.match(/<tr data-pdf-text-row[\s\S]*?<\/tr>/)[0];
    assert.match(textRow,/colspan="[45]"/);assert.doesNotMatch(textRow,/€|1 ks/);
    assert.doesNotMatch(html,/NEAKTUALNY_VARIANT|999 kW/);
    assert.equal((body.match(/<tr /g)||[]).length,4);assert.equal(JSON.stringify(q),before);
  });
  test(template+' summary keeps a pure note and does not show missing price as zero',()=>{
    const q=quote({material_edits:{rows_mode:true,pdf_detail:false},items:[bill('Materiál A',{price:null}),manual('Samostatná poznámka','text'),{...manual('Samostatná služba'),role:'quote_manual_service'}]});
    const body=context(q)[template]().match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    assert.match(body,/Montážny materiál/);assert.match(body,/Samostatná poznámka/);assert.match(body,/Samostatná služba/);assert.match(body,/—/);
    assert.equal((body.match(/<tr /g)||[]).length,3);
  });
}
test('detailed warranty identifies its last page and edited row snapshot',()=>{
  const c=context(quote());
  assert.match(c.warrantyConsentHtml(),/na poslednej strane/);
  assert.match(c.warrantyTermsHtml(),/Posledná strana/);assert.doesNotMatch(c.warrantyTermsHtml(),/Pôvodný model/);
  c.current.material_edits.pdf_detail=false;
  assert.match(c.warrantyConsentHtml(),/na 2\. strane/);assert.match(c.warrantyTermsHtml(),/Strana 2\/2/);
});

function assembledQuote(output){
  const q=quote({net:1950,vat:448.5,total:2398.5,pdf_images_enabled:true,items:[
    bill('Kotol podľa výberu',{role:'device',price:1000,pohoda:{code:'NEW-CODE',image_url:'https://example.invalid/device.png'}}),
    bill('Rúrka <A>',{qty:3,unit:'m',price:10,note:'PRIVATE_ROW_NOTE'}),
    bill('Ventil & prípojka',{qty:2,price:5,cost:777.1234}),
    bill('Dohodnutá montáž',{role:'installation',price:850,work_scope:['Zameranie na mieste','Vŕtanie','Skúška zariadenia']}),
    bill('Doprava',{role:'transport',price:60}),manual('Poznámka\nDruhý riadok <script>','text')
  ]});
  assemblies.init(q);assemblies.setOutput(q,output);
  q.material_edits.assemblies.revision={number:2,root_quote_no:'26NA0000'};
  q.material_edits.assemblies.variants=[{id:'selected',name:'Komfort <A>'},{id:'alternative',name:'NOT_SELECTED_VARIANT'}];
  q.material_edits.assemblies.active_variant_id='selected';
  return q;
}
for(const template of ['offerHtmlTechnical','offerHtmlPresentation']){
  for(const profile of [
    {name:'summary',material:'summary',labor:'summary',appendix:false},
    {name:'detail',material:'detail',labor:'contents',appendix:false},
    {name:'appendix',material:'detail',labor:'contents',appendix:true}
  ]){
    test(template+' integrates assembly '+profile.name+' safely with images, revision and unchanged totals',()=>{
      const {name,...settings}=profile,q=assembledQuote(settings),c=context(q),before=JSON.stringify(q);
      c.ensureHeatPumpInstallationItem=()=>{throw Error('PDF must not rebuild assemblies');};
      c.recalcQuoteTotalsFromItems=()=>{throw Error('PDF must not mutate saved totals');};
      c.stockImageUrls=stock=>stock?.image_url?[stock.image_url]:[];
      const html=c[template](),bodies=[...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(match=>match[1]);
      assert.match(html,/2398\.50 €/);assert.match(html,/1950\.00 €/);assert.match(html,/448\.50 €/);
      assert.match(html,/data-pdf-revision[^>]*>Revízia R2/);assert.match(html,/26NA0000/);
      assert.match(html,/Variant: Komfort &lt;A&gt;/);assert.doesNotMatch(html,/NOT_SELECTED_VARIANT/);
      assert.match(bodies[0],/https:\/\/example.invalid\/device.png/);
      assert.match(html,/Poznámka\nDruhý riadok &lt;script&gt;/);
      assert.doesNotMatch(html,/PRIVATE_ROW_NOTE|777\.1234|NEAKTUALNY_VARIANT|999 kW|adaptér A1K|Rozsah materiálu|Rozsah montáže/);
      assert.match(html,/na poslednej strane/);
      if(name==='summary'){
        assert.equal(bodies.length,1);assert.doesNotMatch(html,/Rúrka &lt;A&gt;|Zameranie na mieste/);
      }else if(name==='detail'){
        assert.equal(bodies.length,1);assert.match(bodies[0],/Rúrka &lt;A&gt;/);assert.match(bodies[0],/Zameranie na mieste/);
      }else{
        assert.equal(bodies.length,2);assert.doesNotMatch(bodies[0],/Rúrka &lt;A&gt;|Zameranie na mieste/);
        assert.match(bodies[1],/Rúrka &lt;A&gt;/);assert.match(bodies[1],/Zameranie na mieste/);
        assert.ok(html.indexOf('data-pdf-appendix')>html.indexOf('data-pdf-totals'));
      }
      assert.equal(JSON.stringify(q),before);
      assert.match(c.warrantyTermsHtml(),/Posledná strana/);assert.match(c.warrantyTermsHtml(),/Revízia R2/);
    });
  }
}
test('PDF preserves the signature of an unchanged saved offer with fractional item prices',()=>{
  for(const values of [{qty:3,price:0.3333,net:1,total:1.23},{qty:1,price:1.005,net:1.01,total:1.24}]){
   for(const template of ['offerHtmlTechnical','offerHtmlPresentation']){
    // The atomic save RPC rounds the sum first, then the gross total.
    const q=quote({net:values.net,vat:0.23,total:values.total,items:[{...manual('Drobný materiál'),qty:values.qty,price:values.price}]});
    const c=context(q);c.document={getElementById:()=>null};
    vm.runInContext(['isQuotePriceLocked','recalcQuoteTotalsFromItems','warrantyOfferKey','warrantySignature'].map(source).join('\n'),c);
    q.warranty_consent={accepted:true,offer_key:c.warrantyOfferKey(),signature_data_url:'data:image/png;base64,QQ=='};
    assert.ok(c.warrantySignature());
    c[template]();
    assert.equal(q.net,values.net);assert.equal(q.total,values.total);
    assert.ok(c.warrantySignature(),'Rendering '+template+' must preserve a valid saved signature.');
   }
  }
});
test('XML keeps stock mapping and edited unit, allows manual items/services/text, and escapes names',()=>{
  const q=quote({items:[bill('Rúrka & ventil',{qty:2.5,unit:'m',pohoda_code:'000$ABC'}),manual('Príprava'),{...manual('Montáž na mieru'),role:'quote_manual_service'},manual('Poznámka <A>','text')]});
  const c=context(q),xml=c.createPohodaIssuedOfferXml();
  assert.equal((xml.match(/<ofr:offerItem>/g)||[]).length,4);
  assert.equal((xml.match(/<ofr:stockItem>/g)||[]).length,1);
  assert.match(xml,/<typ:ids>000\$ABC<\/typ:ids>/);
  assert.match(xml,/<ofr:quantity>2\.500<\/ofr:quantity>\s+<ofr:unit>m<\/ofr:unit>/);
  assert.match(xml,/<ofr:payVAT>false<\/ofr:payVAT>/);
  assert.match(xml,/Rúrka &amp; ventil/);assert.match(xml,/Poznámka &lt;A&gt;/);
  const note=xml.split('<ofr:offerItem>')[4];assert.doesNotMatch(note,/<ofr:unit>/);assert.match(note,/<typ:unitPrice>0<\/typ:unitPrice>/);
});
test('XML rejects an unknown active price instead of silently dropping that line',()=>{
  const c=context(quote({items:[bill('Dobrá položka'),bill('Chýbajúca cena',{price:null}),bill('Nulové množstvo',{qty:0,price:null})]}));
  const result=c.validatePohodaOfferItems();assert.equal(result.rows.length,2);
  assert.ok(result.problems.some(x=>x.includes('Riadok 2')&&x.includes('cena')));
  assert.throws(()=>c.createPohodaIssuedOfferXml(),/Riadok 2/);
});
test('XML rejects unmapped goods and schema-overlong names or units',()=>{
  const c=context(quote({items:[bill('Bez kódu',{pohoda_code:null}),{...manual('a'.repeat(91)),unit:'12345678901'}]}));
  const errors=c.validatePohodaOfferItems().problems.join('\n');
  assert.match(errors,/nemá POHODA kód/);assert.match(errors,/90 znakov/);assert.match(errors,/10 znakov/);
});
test('XML zero VAT is explicit and malformed prices cannot export',()=>{
  const c=context(quote({vat_pct:0,items:[manual('Práca')]}));
  assert.match(c.createPohodaIssuedOfferXml(),/<ofr:rateVAT>none<\/ofr:rateVAT>/);
  for(const price of ['',NaN,-1,Infinity]){
    c.current.items[0].price=price;assert.throws(()=>c.createPohodaIssuedOfferXml(),/cena/);
  }
});
test('detailed and assembly-summary PDFs add warranty after all paginated offer pages',async()=>{
 for(const q of [quote(),assembledQuote({material:'summary',labor:'summary',appendix:false})]){
  const c=context(q),calls={warranty:0,removed:0,disposed:0};
  const offer={name:'offer'},termsLabel={textContent:''};
  const terms={name:'terms',scrollWidth:794,scrollHeight:1123,querySelector:()=>termsLabel};
  const pages=Array.from({length:3},()=>{const folio={textContent:''};return {folio,querySelector:()=>folio}});
  const holder={style:{},children:[offer,terms],firstElementChild:offer,setAttribute(){},remove(){calls.removed++}};
  const pdf={pages:3,addPage(){this.pages++},addImage(){calls.warranty++},output:()=>new Blob(['pdf']),internal:{getNumberOfPages:()=>pdf.pages}};
  c.offerHtml=()=>'<html>';c.inlineImagesForPdf=async()=>{};
  c.document={createElement:()=>holder,body:{appendChild(){}}};
  c.SpektraPdfPagination={waitForAssets:async()=>{},prepare:()=>({pages,dispose(){calls.disposed++}}),render:async()=>pdf};
  c.window={jspdf:{jsPDF:class{}},SpektraPdfPagination:c.SpektraPdfPagination,html2canvas:async node=>{
    assert.equal(node,terms);return {width:1588,height:2246,toDataURL:()=> 'data:image/jpeg;base64,AA=='};
  }};
  vm.runInContext(source('createPdfFile'),c);
  const file=await c.createPdfFile();
  assert.equal(file.name,'26NA0001.pdf');assert.equal(pdf.pages,4);assert.equal(calls.warranty,1);
  assert.equal(termsLabel.textContent,'Strana 4 / 4');assert.equal(pages[0].folio.textContent,'Strana 1 / 4');
  assert.equal(calls.removed,1);assert.equal(calls.disposed,1);
 }
});
