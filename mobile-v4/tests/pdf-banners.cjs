const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const api=require('../js/pdf-banners.js');
const html=fs.readFileSync(path.join(__dirname,'../app.html'),'utf8');
for(const category of ['zti','floor_heating','water_heater','recovery','other']){
  test(category+' selects approved universal artwork, not the equipment thumbnail',()=>{
    const q={category,pdf_banner_mode:'auto',device:{image_url:'https://example.test/product.jpg'}};
    assert.deepEqual(api.select(q),{type:'generic',url:api.universal,precomposed:true});
  });
}
for(const [q,key] of [[{category:'heat_pump'},'heatpump'],[{category:'air_conditioning'},'airconditioning'],[{category:'boiler',boiler_type:'gas'},'gas_boiler'],[{category:'boiler',boiler_type:'pellet'},'biomass'],[{category:'boiler',boiler_type:'biomass'},'biomass']]){
  test(key+' existing category photo is preserved',()=>{
    assert.equal(api.select(q).url,api.defaults[key]);assert.equal(api.select(q).precomposed,false);
    assert.equal(api.select(q,{[key]:'https://example.test/category.jpg'}).url,'https://example.test/category.jpg');
  });
}
test('electric, unknown and unspecified categories safely use the universal banner',()=>{
  for(const q of [{category:'boiler',boiler_type:'electric'},{category:'new_type'},{}])assert.equal(api.select(q).url,api.universal);
});
test('legacy boiler type stored on the device retains its own photo',()=>{
  assert.equal(api.select({category:'boiler',device:{boiler_type:'gas'}}).url,api.defaults.gas_boiler);
});
test('custom banner and deliberate no-banner mode take precedence',()=>{
  const q={category:'zti',pdf_banner_url:'https://example.test/custom.jpg',pdf_banner_mode:'custom'};
  assert.equal(api.select(q).url,q.pdf_banner_url);
  q.pdf_banner_mode='none';assert.equal(api.select(q).url,null);
});
test('empty custom banner and whitespace catalog URL fall back to bundled artwork',()=>{
  assert.equal(api.select({category:'zti',pdf_banner_mode:'custom',pdf_banner_url:' '},{generic:' '}).url,api.universal);
});
test('a configured generic banner is not overwritten',()=>{
  assert.equal(api.select({category:'other'},{generic:'https://example.test/own.jpg'}).url,'https://example.test/own.jpg');
});
test('banner selection cannot change approved snapshots, numbers, prices or signatures',()=>{
  const q={status:'approved',category:'zti',net:123,total:151.29,items:[{qty:2,price:61.5}],warranty_consent:{signature_data_url:'test'}};
  const before=JSON.stringify(q);api.select(q);api.type(q);assert.equal(JSON.stringify(q),before);
});
test('precomposed artwork contains one image, no overlay headline, and no crop',()=>{
  const out=api.artworkHtml(api.universal);
  assert.equal((out.match(/<img /g)||[]).length,1);
  assert.ok(out.includes('object-fit:contain'));
  assert.ok(out.includes('height:70mm'));
  assert.ok(!out.includes('pre váš komfort'));
  assert.ok(!out.includes('linear-gradient'));
  assert.ok(out.includes('Riešenie na mieru. Vykurovanie · úsporné · overené.'));
});
test('image URL is safely escaped and asset identity ignores only query/fragment',()=>{
  assert.ok(api.artworkHtml('x" onerror="alert(1)').includes('src="x&quot; onerror=&quot;alert(1)"'));
  assert.equal(api.isUniversal('https://host.test/mobile-v4/'+api.universal),true);
  assert.equal(api.isUniversal('https://host.test/photo.jpg?x=assets/pdf-banners/default-offer.webp'),false);
});
test('bundled WebP exists with the reviewed checksum and correct format',()=>{
  const b=fs.readFileSync(path.join(__dirname,'../assets/pdf-banners/default-offer.webp'));
  assert.equal(b.subarray(0,4).toString(),'RIFF');assert.equal(b.subarray(8,12).toString(),'WEBP');
  assert.equal(require('node:crypto').createHash('sha256').update(b).digest('hex'),'2bd40d561d7d108906129ae11f700e3c5974af53f569f42542565d4be367ab33');
});
test('presentation template uses precomposed header and strict PDF loading',()=>{
  assert.ok(html.includes('SpektraPdfBanners.artworkHtml(bannerUrl)'));
  assert.ok(html.includes("img.closest('[data-pdf-banner=\"universal\"]')"));
  assert.ok(html.indexOf('js/pdf-banners.js')<html.indexOf('function getPdfBannerUrl'));
});
test('technical template and customer amounts remain unchanged by integration',()=>{
  const body=html.slice(html.indexOf('function offerHtmlTechnical(){'),html.indexOf('function offerHtmlPresentation(){'));
  assert.ok(!body.includes('SpektraPdfBanners'));
});
test('all inline and banner scripts compile',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  new vm.Script(fs.readFileSync(path.join(__dirname,'../js/pdf-banners.js'),'utf8'));
});
