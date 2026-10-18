/* Explicit, one-use handoff. Never sends auth tokens or writes source records. */
(function(){
 'use strict';
 const origin='https://spektra-servis.vercel.app',nonce=new URL(location.href).searchParams.get('spektraBridge'),peer=window.opener;
 if(!peer||!nonce||!/^[-a-f0-9]{36}$/.test(nonce))return;
 let request=null,used=false;
 const box=document.createElement('section');box.style.cssText='position:sticky;top:0;z-index:99999;background:#fff0f0;border:2px solid #c20000;padding:14px;font:15px Arial;color:#222';
 const title=document.createElement('strong');title.textContent='Prepojenie so Spektra Servis';
 const status=document.createElement('p'),button=document.createElement('button');button.type='button';button.textContent='Pokračovať';button.disabled=true;
 box.append(title,status,button);document.body.prepend(box);
 status.textContent='Čakám na požiadavku z otvorenej zákazky…';
 const send=(message)=>peer.postMessage({...message,nonce},origin);
 const ready=setInterval(()=>send({type:'spektra-ready'}),500);
 const expiry=setTimeout(()=>{clearInterval(ready);window.removeEventListener('message',receive);button.disabled=true;status.textContent='Prepojenie vypršalo. Otvorte ho znova zo Spektra Servisu.';},300000);
 function receive(event){
  if(event.origin!==origin||event.source!==peer||event.data?.nonce!==nonce||event.data?.type!=='spektra-request'||request)return;
  if(!['catalog','prefill'].includes(event.data.operation))return;
  request=event.data;clearInterval(ready);button.disabled=false;
  status.textContent=request.operation==='catalog'?'Prihláste sa v Cenových ponukách. Tlačidlom prenesiete dostupný adresár a sklad do Spektra Servisu v tomto prehliadači.':'Prenesú sa údaje zákazníka a zákazky. Existujúci rozpracovaný formulár nahraďte iba po jeho uložení.';
  button.textContent=request.operation==='catalog'?'Preniesť adresár a sklad':'Predvyplniť zo zákazky';
 }
 window.addEventListener('message',receive);
 button.onclick=async()=>{
  if(!request||used)return;button.disabled=true;
  try{
   const payload=await perform(request);used=true;clearTimeout(expiry);window.removeEventListener('message',receive);
   send({type:'spektra-result',payload});status.textContent='Prenos dokončený. Dokument skontrolujte a uložte; do archívu sa neuložil automaticky.';button.remove();
  }catch(error){status.textContent=error.message||String(error);button.disabled=false;}
 };
 async function perform(request){
   if(request.operation==='catalog'){
   if(!window.SpektraDB?.isAuthenticated())throw Error('Najskôr sa prihláste do Cenových ponúk a potom kliknite na prenos.');
   const user=SpektraDB.getUser().id;
   const contacts=await SpektraDB.listCustomers();
   const stocks=await SpektraDB.listStocks({force:true});
   if(SpektraDB.getUser()?.id!==user)throw Error('Účet sa počas prenosu zmenil. Zopakujte prenos.');
   if(!stocks.length)throw Error('Sklad neobsahuje žiadne dostupné položky. Existujúci sklad v Servise zostane zachovaný.');
   return {contacts,stocks};
  }
  const p=request.payload,c=p?.customer,j=p?.job,d=p?.device;
  if(!c||!j||typeof c.name!=='string'||typeof j.number!=='string')throw Error('Neplatné údaje zákazky.');
  const lines=Array.isArray(j.costing)?j.costing:[];
  if(lines.length>500||lines.some(l=>!Number.isFinite(l.sale)||l.sale<0||!Number.isFinite(l.qty)||l.qty<0||!Number.isFinite(l.vat)))throw Error('Neplatná kalkulácia.');
  const rates=[...new Set(lines.map(l=>l.vat))];
  if(rates.length>1)throw Error('Ponuky podporujú jednu sadzbu DPH. Kalkulácia má viac sadzieb; pred prenosom ich zjednoťte alebo vytvorte oddelené ponuky.');
  if(typeof startWizard!=='function'||!window.SpektraQuoteAssemblies)throw Error('Aplikácia sa ešte načítava. Skúste znova.');
  if(typeof current!=='undefined'&&current&&!confirm('V otvorenom okne je rozpracovaná ponuka. Máte ju uloženú a chcete otvoriť nový návrh zo servisu?'))throw Error('Prenos zrušený.');
  startWizard();
  const customer={name:c.name||c.company||'',phone:c.phone||'',email:c.email||'',address:j.address||c.address||'',note:[j.number,j.title,j.issue,d?[d.manufacturer,d.model,d.serial].filter(Boolean).join(' '):''].filter(Boolean).join('\n')};
  current.customer=customer;
  for(const [field,value] of Object.entries(customer)){const el=document.getElementById('c'+field[0].toUpperCase()+field.slice(1));if(el)el.value=value;}
  current.category='other';current.system_type='service';current.vat_pct=rates[0]??23;
  current.optional_services.annual_service=false;
  current.service_job_id=j.id;current.service_job_number=j.number;
  const A=window.SpektraQuoteAssemblies;A.init(current);
  for(const kind of ['material','labor','transport']){
   const selected=lines.filter(l=>l.kind===kind);if(!selected.length)continue;
   const group=A.createGroup(current,{name:kind==='material'?'Materiál servisu':kind==='labor'?'Servisná práca':'Doprava',kind});
   const temp={status:'draft',items:[]};
   for(const l of selected){const added=SpektraQuoteMaterials.addManual(temp,{name:l.name,qty:l.qty,unit:l.unit,price:l.sale,cost:l.cost,service:kind!=='material'},SpektraQuoteStorage.uuid());added.item.pohoda_code=l.code||null;added.item.note='Zo servisnej zákazky '+j.number;}
   A.addRows(current,group.id,temp.items,{origin:'manual'});
  }
  recalcQuoteTotalsFromItems();openQuoteRows();
  return {prefilled:true};

 }
})();
