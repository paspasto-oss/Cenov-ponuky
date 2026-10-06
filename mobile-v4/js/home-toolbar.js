/* Compact navigation and list filters. Reuses the existing buttons, input nodes
 * and their handlers; never reads/writes quote data, prices or authentication. */
(function(root){
  'use strict';
  const icons={
    inspections:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4"/>',
    quotes:'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>',
    newQuote:'<path d="M12 4v16M4 12h16"/>',
    sync:'<path d="M20 7v5h-5M4 17v-5h5M5.6 7a7.5 7.5 0 0 1 12.6-2L20 8M4 16l1.8 3A7.5 7.5 0 0 0 18.4 17"/>',
    stock:'<path d="M3 8l9-5 9 5v11l-9 4-9-4zM3 8l9 5 9-5M12 13v10M7.5 5.5l9 5"/>',
    newInspection:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M12 9v8M8 13h8"/>'
  };
  const entries=[
    ['inspections','Obhliadky','Rozpracované a dokončené obhliadky'],
    ['quotes','Cenové ponuky','Zobraziť databázu cenových ponúk'],
    ['newQuote','Nová ponuka','Vytvoriť novú cenovú ponuku'],
    ['sync','Synchronizovať','Synchronizovať cenové ponuky medzi zariadeniami'],
    ['stock','Aktualizovať zásoby','Nahrať aktuálne zásoby z POHODY'],
    ['newInspection','Nová obhliadka','Začať novú obhliadku u zákazníka']
  ];
  function compactFilters(prefix){
    const doc=root.document;
    if(doc.getElementById(prefix+'FilterBar'))return;
    const inputs=['Name','Place','From','To'].map(key=>doc.getElementById(prefix+'Filter'+key));
    if(inputs.some(input=>!input))return;
    const fields=inputs.map(input=>input.closest('.field'));
    const card=inputs[0].closest('.card');
    const list=doc.getElementById(prefix==='quote'?'quoteList':'inspectionList');
    const heading=card?.querySelector('.row');
    const reset=heading?.querySelector('button');
    if(!card||!list||!reset||fields.some(field=>!field))return;
    const wrappers=new Set(fields.map(field=>field.parentElement));
    const viewport=doc.createElement('div');
    viewport.className='compactFilterViewport';
    viewport.id=prefix+'FilterViewport';
    viewport.setAttribute('role','region');
    viewport.setAttribute('aria-label',prefix==='quote'?'Filtre cenových ponúk':'Filtre obhliadok');
    const bar=doc.createElement('div');
    bar.id=prefix+'FilterBar';bar.className='compactFilterBar';
    viewport.appendChild(bar);
    card.insertBefore(viewport,list);
    fields.forEach((field,index)=>{
      const label=field.querySelector('label');
      if(label)label.htmlFor=inputs[index].id;
      bar.appendChild(field);
    });
    reset.classList.add('compactFilterReset');
    bar.appendChild(reset);
    wrappers.forEach(wrapper=>{if(wrapper.classList.contains('grid2')&&!wrapper.children.length)wrapper.remove()});
    heading.classList.add('compactListHeading');
    card.classList.add('compactListCard');
  }
  function updateView(){
    const doc=root.document,bar=doc.getElementById('homeToolbar');
    if(!bar)return;
    const screen=doc.querySelector('.screen.on')?.id;
    // Keep navigation available in every quote and inspection step.
    bar.hidden=false;
    const active=screen==='home'?'quotes':screen==='inspectionHome'?'inspections':null;
    bar.querySelectorAll('[data-home-action]').forEach(button=>{
      if(button.dataset.homeAction===active)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
  }
  function mount(){
    const doc=root.document;
    if(doc.getElementById('homeToolbar')){updateView();return;}
    const head=doc.querySelector('.wrap > .head');
    const hero=doc.querySelector('#home > .hero');
    const actions=hero?.querySelector('.actions');
    if(!head||!hero||!actions)return;
    const find=fragment=>[...actions.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes(fragment));
    const buttons={
      inspections:doc.getElementById('inspectionListHomeBtn'),
      newQuote:find('startWizard('),sync:find('syncQuotes('),stock:find('stock-sync.html'),
      newInspection:doc.getElementById('newInspectionHomeBtn')
    };
    // Do not remove the original menu if any expected entry point is missing.
    if(Object.values(buttons).some(button=>!button))return;
    buttons.quotes=doc.createElement('button');
    buttons.quotes.id='quoteListHomeBtn';
    buttons.quotes.onclick=()=>{root.go('home');root.renderHome()};
    const nav=doc.createElement('nav');
    nav.id='homeToolbar';nav.className='homeToolbar';
    nav.setAttribute('aria-label','Hlavné menu');
    const row=doc.createElement('div');row.className='homeToolbarRow';
    nav.appendChild(row);
    entries.forEach(([key,label,title])=>{
      const button=buttons[key];
      button.type='button';
      button.classList.remove('big','primary');
      button.classList.add('homeToolbarButton');
      button.dataset.homeAction=key;button.title=title;
      button.setAttribute('aria-label',key==='newQuote'?'Nová cenová ponuka':key==='sync'?'Synchronizovať ponuky':label);
      // Static icon/label markup only, no user values are injected.
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+icons[key]+'</svg><span>'+label+'</span>';
      row.appendChild(button);
    });
    const header=doc.createElement('header');
    header.id='appStickyHeader';header.className='appStickyHeader';
    head.before(header);
    header.appendChild(head);header.appendChild(nav);
    hero.remove();
    compactFilters('quote');compactFilters('inspection');
    // The shared toolbar also serves the inspection list. Retain its separate
    // synchronization handler as a compact action next to the list heading.
    const inspectionHero=doc.querySelector('#inspectionHome > .hero');
    const refresh=inspectionHero?.querySelector('button[onclick*=".refresh("]');
    const inspectionHeading=doc.querySelector('#inspectionHome .compactListHeading');
    if(refresh&&inspectionHeading){
      refresh.className='btn ghost small';refresh.type='button';
      refresh.textContent='⟳ Synchronizovať obhliadky';
      inspectionHeading.appendChild(refresh);
      inspectionHero.remove();
      doc.querySelector('#inspectionHome > .topline')?.remove();
    }
    updateView();
    // Observe only screen visibility, not list rows, editable fields or saves.
    const observer=new root.MutationObserver(updateView);
    doc.querySelectorAll('.screen').forEach(screen=>observer.observe(screen,{attributes:true,attributeFilter:['class']}));
  }
  const api={mount,updateView,compactFilters};
  root.SpektraHomeToolbar=api;
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(window);
