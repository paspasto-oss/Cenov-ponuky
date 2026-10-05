/* Presentation header selection. This is read-only: no stock/quote mutations. */
(function(root){
  'use strict';
  const universal='assets/pdf-banners/default-offer.webp?v=20261005-universal1';
  const defaults=Object.freeze({
    heatpump:'assets/pdf-banners/heatpump.jpg',
    airconditioning:'assets/pdf-banners/airconditioning.jpg',
    gas_boiler:'assets/pdf-banners/gas-boiler.jpg',
    biomass:'assets/pdf-banners/biomass.jpg'
  });
  const text=x=>typeof x==='string'?x.trim():'';
  const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function type(q={}){
    if(q.category==='heat_pump')return 'heatpump';
    if(q.category==='air_conditioning')return 'airconditioning';
    const boiler=q.boiler_type||q.device?.boiler_type;
    if(q.category==='boiler'&&boiler==='gas')return 'gas_boiler';
    if(q.category==='boiler'&&['pellet','biomass'].includes(boiler))return 'biomass';
    return 'generic';
  }
  function isUniversal(url){
    // Match only the bundled image path, not a filename occurring in a query.
    return /(?:^|\/)assets\/pdf-banners\/default-offer\.webp$/.test(text(url).split(/[?#]/)[0]);
  }
  function select(q={},catalog={}){
    const key=type(q);
    if(q.pdf_banner_mode==='none')return {type:key,url:null,precomposed:false};
    const custom=q.pdf_banner_mode==='custom'?text(q.pdf_banner_url):'';
    const own=text(catalog[key]);
    const url=custom||own||defaults[key]||universal;
    return {type:key,url,precomposed:isUniversal(url)};
  }
  function artworkHtml(url){
    // Artwork includes the approved logo and wording. No duplicate HTML overlay.
    // Its 3:1 aspect ratio is preserved; no text or photo is cropped from the banner.
    return '<div data-pdf-banner="universal" style="width:100%;height:70mm;position:relative;overflow:hidden;background:#fff">'+
      '<img crossorigin="anonymous" src="'+escape(url)+'" width="1500" height="500" alt="SPEKTRA INSTALL – Riešenie na mieru. Vykurovanie · úsporné · overené." style="display:block;width:100%;height:100%;object-fit:contain">'+
      '</div>';
  }
  const api={universal,defaults,type,isUniversal,select,artworkHtml};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.SpektraPdfBanners=api;
})(typeof window!=='undefined'?window:globalThis);
