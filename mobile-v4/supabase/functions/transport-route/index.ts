// Provider key is server-only. Fixed hosts prevent user-controlled proxy/SSRF.
const ORIGIN = 'Hollého 210, 015 01 Rajec, Slovensko';
const cache = new Map<string, {at:number; value:unknown}>();
const limits = new Map<string, {at:number; count:number}>();
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
async function json(url:string, init:RequestInit={}) {
  const res=await fetch(url,{...init,signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Routovacia služba je nedostupná.');
  return res.json();
}
async function geocode(address:string,key:string){
  const url=new URL('https://api.openrouteservice.org/geocode/search');
  url.searchParams.set('text',address);url.searchParams.set('boundary.country','SVK');url.searchParams.set('size','3');
  const data=await json(url.href,{headers:{Authorization:key}});
  const hits=data.features||[],f=hits[0],p=f?.properties;
  if(!p||!['address','venue'].includes(p.layer)||!Number.isFinite(Number(p.confidence))||Number(p.confidence)<.85||!p.housenumber||!p.street||!p.locality||!f.geometry?.coordinates?.every(Number.isFinite))throw Error('Adresa nie je jednoznačná. Doplňte ulicu, číslo a obec.');
  if(hits[1]&&Number(hits[1].properties.confidence)>=Number(p.confidence)-.05&&JSON.stringify(hits[1].geometry.coordinates)!==JSON.stringify(f.geometry.coordinates))throw Error('Našlo sa viac adries. Spresnite adresu realizácie.');
  return f;
}
Deno.serve(async (req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{headers,status});
 if(req.method!=='POST')return reply({error:'Použite POST.'},405);
 try{
  const auth=req.headers.get('Authorization')||'';
  if(!auth.startsWith('Bearer '))return reply({error:'Prihláste sa.'},401);
  const base=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const user=await json(base+'/auth/v1/user',{headers:{Authorization:auth,apikey:anon}});
  const profile=await json(base+'/rest/v1/app_users?select=active&user_id=eq.'+encodeURIComponent(user.id),{headers:{Authorization:auth,apikey:anon}});
  if(!profile[0]?.active)return reply({error:'Prístup nie je povolený.'},403);
  const now=Date.now(),l=limits.get(user.id);if(l&&now-l.at<60000&&l.count>=10)return reply({error:'Priveľa požiadaviek. Skúste o minútu.'},429);
  if(l&&now-l.at<60000)l.count++;else limits.set(user.id,{at:now,count:1});
  if(limits.size>1000)for(const [id,v] of limits)if(now-v.at>60000)limits.delete(id);
  if(Number(req.headers.get('content-length')||0)>2048)return reply({error:'Príliš veľká požiadavka.'},413);
  const body=await req.text();if(body.length>2048)return reply({error:'Príliš veľká požiadavka.'},413);
  const address=JSON.parse(body).address;
  if(typeof address!=='string'||address.trim().length<6||address.length>300)return reply({error:'Doplňte úplnú adresu realizácie.'},400);
  const key=Deno.env.get('ORS_API_KEY');if(!key)return reply({error:'Výpočet trasy nie je nakonfigurovaný (ORS_API_KEY). Použite ručnú korekciu.'},503);
  const id=address.trim().toLowerCase(),hit=cache.get(id);if(hit&&now-hit.at<86400000)return reply(hit.value);
  const [start,end]=await Promise.all([geocode(ORIGIN,key),geocode(address,key)]);
  async function distance(a:number[],b:number[]){const d=await json('https://api.openrouteservice.org/v2/directions/driving-car/json',{method:'POST',headers:{Authorization:key,'Content-Type':'application/json'},body:JSON.stringify({coordinates:[a,b],instructions:false})});const metres=d.routes?.[0]?.summary?.distance;if(!Number.isFinite(metres)||metres<0)throw Error('Cestná trasa sa nenašla.');return metres;}
  const [out,back]=await Promise.all([distance(start.geometry.coordinates,end.geometry.coordinates),distance(end.geometry.coordinates,start.geometry.coordinates)]);
  const km=Math.round((out+back)/10)/100;if(km<=0)throw Error('Trasa má nulovú dĺžku. Skontrolujte adresu alebo zadajte ručne km.');
  const value={round_trip_km:km,outbound_km:out/1000,return_km:back/1000,is_rajec:end.properties.locality.toLocaleLowerCase('sk')==='rajec',destination_label:end.properties.label,source:'openrouteservice',calculated_at:new Date().toISOString()};
  if(cache.size>=500)cache.delete(cache.keys().next().value!);cache.set(id,{at:now,value});return reply(value);
 }catch(_e){return reply({error:_e instanceof Error?_e.message:'Trasu sa nepodarilo vypočítať.'},422);}
});
