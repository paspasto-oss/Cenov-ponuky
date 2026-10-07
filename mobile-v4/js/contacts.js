/* Shared customer picker. Reuses saved customers; selection copies fields only,
 * never attaches a new quote to a mutable customer record or edits old offers. */
(function(root){
  'use strict';
  const doc=root.document,fields=['name','phone','email','address'];
  let remote=[],owner=null,loaded=0,pending=null;
  const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function local(key){try{const rows=JSON.parse(root.localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows:[]}catch(_){return []}}
  function contacts(){
    const uid=root.SpektraDB?.getUser()?.id||null;
    if(uid!==owner){remote=[];loaded=0;owner=uid;}
    const records=[...remote,...local('spektra_quotes_v4').map(r=>r.customer),...local('spektra_inspections_v1').map(r=>r.customer)];
    const seen=new Set();return records.filter(Boolean).map(c=>Object.fromEntries(fields.map(k=>[k,String(c[k]||'').trim()]))).filter(c=>{
      if(!c.name||(!c.phone&&!c.email&&!c.address)||fold(c.name)==='bez mena')return false;
      // Keep different people and different site addresses distinct.
      const key=fields.map(k=>k==='phone'?c[k].replace(/\D/g,''):fold(c[k])).join('\u0000');
      if(seen.has(key))return false;seen.add(key);return true;
    }).sort((a,b)=>a.name.localeCompare(b.name,'sk'));
  }
  async function refresh(){
    contacts();
    if(!owner||!root.SpektraDB?.listCustomers)return;
    if(pending)return pending;
    if(Date.now()-loaded<30000)return;
    const requestedOwner=owner;
    pending=(async()=>{
      try{const rows=await root.SpektraDB.listCustomers();if(root.SpektraDB.getUser()?.id===requestedOwner){remote=rows;loaded=Date.now();}}
      finally{pending=null;}
    })();return pending;
  }
  function attach(input){
    if(!input||input.dataset.contactsBound)return;
    input.dataset.contactsBound='true';input.autocomplete='off';
    const prefix=input.id==='icName'?'ic':'c',box=doc.createElement('div');
    box.className='contactSuggestions';box.id=input.id+'Contacts';box.hidden=true;
    box.setAttribute('role','region');box.setAttribute('aria-label','Uložené kontakty');
    input.setAttribute('aria-controls',box.id);input.setAttribute('aria-expanded','false');input.after(box);
    let error=false;
    const close=()=>{box.hidden=true;input.setAttribute('aria-expanded','false');};
    function choose(c){
      for(const key of fields){const el=doc.getElementById(prefix+key[0].toUpperCase()+key.slice(1));if(!el)continue;
        el.value=c[key];el.dispatchEvent(new root.Event('input',{bubbles:true}));el.dispatchEvent(new root.Event('change',{bubbles:true}));}
      close();doc.getElementById(prefix+'Phone')?.focus();
    }
    function show(){
      const query=fold(input.value),tokens=query.split(/\s+/).filter(Boolean);
      const matches=contacts().filter(c=>tokens.every(t=>fold(fields.map(k=>c[k]).join(' ')).includes(t)||c.phone.replace(/\D/g,'').includes(t.replace(/\D/g,''))&&/\d/.test(t)));
      box.replaceChildren();const status=doc.createElement('small');
      status.textContent=error?'Spoločný adresár sa nepodarilo načítať. Zobrazené sú dostupné kontakty.':matches.length?'Vyberte uložený kontakt ('+matches.length+'). Údaje môžete upraviť.':'Žiadny uložený kontakt. Pokračujte vyplnením nového zákazníka.';
      status.setAttribute('role','status');box.append(status);
      matches.slice(0,12).forEach(c=>{const b=doc.createElement('button');b.type='button';const name=doc.createElement('strong'),detail=doc.createElement('span');name.textContent=c.name;detail.textContent=[c.phone,c.email,c.address].filter(Boolean).join(' • ');b.append(name,detail);b.onclick=()=>choose(c);box.append(b)});
      if(matches.length>12){const more=doc.createElement('small');more.textContent='Zobrazených 12 kontaktov. Spresnite meno, telefón alebo adresu.';box.append(more)}
      box.hidden=false;input.setAttribute('aria-expanded','true');
    }
    input.addEventListener('input',show);
    input.addEventListener('focus',()=>{show();refresh().then(()=>{error=false;if(doc.activeElement===input)show()}).catch(()=>{error=true;if(doc.activeElement===input)show()})});
    input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();if(box.hidden)show();box.querySelector('button')?.focus()}if(e.key==='Escape')close()});
    box.addEventListener('keydown',e=>{const buttons=[...box.querySelectorAll('button')],i=buttons.indexOf(doc.activeElement);if(e.key==='Escape'){input.focus();close()}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}});
    const field=input.parentElement;field.addEventListener('focusout',()=>root.setTimeout(()=>{if(!field.contains(doc.activeElement))close()},0));
    // One delegated pointer listener below also closes suggestions on touch.
  }
  function mount(){attach(doc.getElementById('cName'));attach(doc.getElementById('icName'));}
  doc.addEventListener('pointerdown',e=>{doc.querySelectorAll('.contactSuggestions').forEach(box=>{if(!box.parentElement.contains(e.target)){box.hidden=true;box.previousElementSibling?.setAttribute('aria-expanded','false')}})});
  root.SpektraContacts={mount,contacts,refresh};
  mount();new root.MutationObserver(mount).observe(doc.body,{childList:true,subtree:true});
})(window);
