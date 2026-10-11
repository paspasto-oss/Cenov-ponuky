/* One transport row; immutable issued quotes; routing never substitutes zero. */
(function(root){
'use strict';
const A=root.SpektraQuoteAssemblies||(typeof module==='object'?require('./quote-assemblies.js'):null);
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function number(x){if(x==null||String(x).trim()==='')throw Error('Doplňte hodnotu.');if(typeof x!=='string'&&typeof x!=='number')throw Error('Neplatná hodnota.');const raw=String(x).trim().replace(',','.');if(!/^\d+(?:\.\d+)?$/.test(raw))throw Error('Neplatná hodnota.');const n=Number(raw);if(!Number.isFinite(n)||n<0)throw Error('Neplatná nezáporná hodnota.');return n;}
const locked=q=>['ready','sent','approved'].some(s=>q.status===s||q._server_status===s);
const address=q=>String(q.customer?.realization_address||q.customer?.address||'').trim();
function trips(hours,crew){crew=number(crew);if(!crew||!Number.isInteger(crew))throw Error('Počet montérov musí byť kladné celé číslo.');return Math.ceil(number(hours)/crew/8);}
function price(km,count,rajec){km=number(km);count=number(count);if(!Number.isInteger(count))throw Error('Výjazdy musia byť celé číslo.');return round(count*(rajec?10:Math.max(25,km*.65)));}
function covered(q){return (q.material_edits?.assemblies?.scenarios||[]).some(s=>(s.covered_services||[]).includes('transport')&&(q.items||[]).some(r=>A.metadata(r).scenario_instance_id===s.id&&['labor','service'].includes(A.kind(r))&&Number(r.qty)>0));}
function hours(q){const explicit=q.material_edits?.transport?.man_hours;if(q.material_edits?.transport?.manual_hours&&explicit!=null)return number(explicit);const rows=(q.items||[]).filter(r=>A.kind(r)==='labor'&&['čh','h','hod','hod.'].includes(r.unit));return rows.length?rows.reduce((n,r)=>n+number(r.qty),0):null;}
function apply(q,route,options={}){
 if(locked(q))return false;
 if(covered(q))return false;
 const rows=(q.items||[]).filter(r=>A.kind(r)==='transport');
 if(rows.length>1)throw Error('Ponuka obsahuje viac dopr áv. Upravte ich v rozšírenom editore.'.replace('dopr áv','dopráv'));
 const old=rows[0],meta=old?A.metadata(old):{};
 // Never migrate legacy prices or manual overrides implicitly.
 if(old&&!meta.transport_auto&&!options.explicit)return false;
 const saved=q.material_edits?.transport||{};
 const km=options.km!==undefined?number(options.km):saved.manual_km?number(saved.km):number(route.round_trip_km);
 const crew=options.crew??saved.crew??2,manHours=options.man_hours??hours(q);
 const count=options.trips!==undefined?number(options.trips):saved.manual_trips?number(saved.trips):manHours==null?null:trips(manHours,crew);
 if(count!==null&&!Number.isInteger(count))throw Error('Výjazdy musia byť celé číslo.');
 number(crew);if(!Number.isInteger(Number(crew))||Number(crew)<=0)throw Error('Počet montérov musí byť kladné celé číslo.');
 const rajec=options.rajec??route.is_rajec;
 if(typeof rajec!=='boolean')throw Error('Nie je overená obec zákazky.');
 const preserve=old&&(meta.transport_manual_price||meta.manual?.price===true||old.price_override===true)&&!options.reset_price;
 const preservedTotal=preserve?round(number(old.price)*number(old.qty)):null;
 const data={...saved,route,km,trips:count,crew,man_hours:manHours,address:address(q),manual_hours:options.man_hours!==undefined||saved.manual_hours===true,manual_km:options.km!==undefined||saved.manual_km===true,manual_trips:options.trips!==undefined||saved.manual_trips===true};
 A.init(q);q.material_edits.transport=data;
 let row=q.items.find(r=>A.kind(r)==='transport');
 if(!row){const g=A.createGroup(q,{name:'Doprava',kind:'transport'});A.addRows(q,g.id,[{name:'Doprava',role:'transport',qty:1,unit:'súb.',price:0,cost:null,visible:true,stored_metadata:{quote_assembly:{kind:'transport',singleton_key:'transport',origin:'manual',transport_auto:true}}}]);row=q.items.find(r=>A.kind(r)==='transport');}
 row.qty=1;row.unit='súb.';row.name='Doprava – '+km+' km tam aj späť'+(count==null?' (doplňte výjazdy)':' × '+count+' výjazdov');
 row.price=preserve?preservedTotal:count==null?null:price(km,count,rajec);row.cost=null;row.cost_override=false;row.price_override=!!preserve;
 Object.assign(A.metadata(row),{transport_auto:true,transport_manual_price:!!preserve,total_km:km,trip_count:count,rate_per_km:.65,minimum_price:25,is_rajec:rajec,quantity_rule:{type:'fixed',qty:1},manual:{...meta.manual,qty:false,price:!!preserve}});
 return true;
}
function invalidate(q){
 if(locked(q))return;const saved=q.material_edits?.transport;if(!saved)return;
 if(saved.address===address(q)&&saved.man_hours===hours(q))return;
 for(const r of q.items||[])if(A.kind(r)==='transport'&&A.metadata(r).transport_auto&&!A.metadata(r).transport_manual_price&&!A.metadata(r).manual?.price&&!r.price_override)r.price=null;
}
function ensurePending(q){
 if(locked(q)||covered(q)||!(q.items||[]).length||q.items.some(r=>A.kind(r)==='transport'))return;
 const g=A.createGroup(q,{name:'Doprava',kind:'transport'});A.addRows(q,g.id,[{name:'Doprava – čaká na trasu a rozsah práce',role:'transport',qty:1,unit:'súb.',price:null,cost:null,visible:true,stored_metadata:{quote_assembly:{kind:'transport',singleton_key:'transport',transport_auto:true,manual:{price:false},quantity_rule:{type:'fixed',qty:1}}}}]);
}
function validateRoute(r){if(!r||typeof r.is_rajec!=='boolean'||!r.destination_label||number(r.round_trip_km)<=0)throw Error('API nevrátilo platnú cestnú trasu.');return r;}
function router(invoke){const cache=new Map();return async function(addr){if(addr.length<6)throw Error('Doplňte úplnú adresu realizácie.');const key=addr.trim().toLowerCase(),hit=cache.get(key);if(hit&&Date.now()-hit.at<86400000)return hit.value;const value=validateRoute(await invoke(addr));if(cache.size>100)cache.delete(cache.keys().next().value);cache.set(key,{value,at:Date.now()});return value;};}
const api={number,trips,price,locked,address,covered,hours,apply,invalidate,ensurePending,validateRoute,router};
if(typeof module==='object'&&module.exports){module.exports=api;return;}
root.SpektraQuoteTransport=api;
let timer,request=0,last='',message='',busy=false,ownerId='';
const route=router(addr=>root.SpektraDB.routeTransport(addr));
function active(){return typeof current!=='undefined'?current:null;}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
api.panel=function(q){if(ownerId!==q.id){ownerId=q.id;message='';}const d=q.material_edits?.transport||{},h=hours(q);return '<div class="wbTransport"><strong>Doprava</strong><p role="status" aria-live="polite">'+esc(covered(q)?'Doprava je zahrnutá v montáži.':message||(d.route?'Trasa vypočítaná: '+d.km+' km. '+(d.trips==null?'Doplňte človekohodiny alebo výjazdy.':''):'Trasa sa určí z adresy realizácie.'))+'</p><div class="wbGrid"><label>Človekohodiny <input data-transport="man_hours" inputmode="decimal" value="'+esc(h??'')+'"></label><label>Montéri <input data-transport="crew" inputmode="numeric" value="'+esc(d.crew??2)+'"></label><label>Spiatočné km (ručná korekcia) <input data-transport="km" inputmode="decimal" value="'+esc(d.km??'')+'"></label><label>Výjazdy (ručná korekcia) <input data-transport="trips" inputmode="numeric" value="'+esc(d.trips??'')+'"></label></div><button type="button" class="btn ghost" data-transport-retry>Prepočítať trasu</button><button type="button" class="btn ghost" data-transport-reset>Obnoviť automatické km a výjazdy</button><button type="button" class="btn ghost" data-transport-price>Obnoviť automatickú cenu</button></div>';};
function paint(){root.SpektraQuoteWorkbench?.render();root.SpektraQuickQuote?.render?.();}
api.schedule=function(force=false){const q=active();if(!q||locked(q)||covered(q)||!(q.items||[]).length)return;
 const existing=q.items.filter(r=>A.kind(r)==='transport');if(existing.some(r=>!A.metadata(r).transport_auto))return;
 const key=JSON.stringify([q.id,address(q),hours(q),q.material_edits?.transport?.crew]);if(!force&&last===key)return;last=key;
 const token=++request;const scheduled=q;clearTimeout(timer);timer=setTimeout(async()=>{const owner=active();if(owner!==scheduled||locked(owner))return;const addr=address(owner),snapshot=JSON.stringify([owner.items,owner.material_edits]);message='Počítam trasu…';busy=true;paint();
 try{const result=await route(addr);if(token!==request||active()!==owner||address(owner)!==addr||locked(owner)||snapshot!==JSON.stringify([owner.items,owner.material_edits]))return;
 const saved=await root.SpektraQuoteWorkbench.mutate('Trasa vypočítaná.',draft=>apply(draft,result));message=saved.ok?'Trasa vypočítaná: '+result.round_trip_km+' km · '+result.destination_label+(active()?.material_edits?.transport?.trips==null?' · Doplňte človekohodiny alebo výjazdy.':''):'Trasu sa nepodarilo uložiť.';
 }catch(e){if(token===request)message='Trasu sa nepodarilo vypočítať: '+e.message+' Zadajte ručne spiatočné km a obec.';}
 finally{if(token===request){busy=false;paint();}}
 },650);};
root.document.addEventListener('click',async e=>{if(e.target.closest('[data-transport-price]')){const q=active(),d=q?.material_edits?.transport;if(!q||locked(q)||!d?.route)return;if(d.address!==address(q)){message='Najprv prepočítajte trasu pre novú adresu.';paint();return;}if(!root.confirm('Nahradiť ručnú cenu dopravy automatickým výpočtom?'))return;await root.SpektraQuoteWorkbench.mutate('Automatická cena obnovená.',draft=>apply(draft,d.route,{reset_price:true}));paint();}if(e.target.closest('[data-transport-retry]')){last='';api.schedule(true);}if(e.target.closest('[data-transport-reset]')){const q=active();if(!q||locked(q))return;await root.SpektraQuoteWorkbench.mutate('Automatické korekcie obnovené.',d=>{if(d.material_edits?.transport){d.material_edits.transport.manual_km=false;d.material_edits.transport.manual_trips=false;}});api.schedule(true);}});
root.document.addEventListener('change',async e=>{const key=e.target.dataset.transport;if(!key)return;const q=active();if(!q||locked(q))return;try{const v=number(e.target.value),saved=q.material_edits?.transport;
 let r=saved?.route;if(!r){if(key!=='km')throw Error('Najprv vypočítajte trasu alebo zadajte ručne km.');const town=root.prompt('Presný názov obce realizácie (Rajec má miestnu sadzbu):');if(!town?.trim())return;r={round_trip_km:v,is_rajec:town.trim().toLocaleLowerCase('sk')==='rajec',destination_label:town.trim(),source:'manual'};}
 const options={[key]:v,explicit:true};if(key==='km'&&!saved?.trips&&hours(q)==null){const n=root.prompt('Plánovaný počet výjazdov:');if(n===null)return;options.trips=number(n);}
 await root.SpektraQuoteWorkbench.mutate('Doprava bola upravená.',d=>apply(d,r,options));last='';api.schedule();
 }catch(err){message=err.message;paint();}});
})(typeof window==='object'?window:globalThis);
