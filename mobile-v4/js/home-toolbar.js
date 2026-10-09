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
  function closeMenus(){
    root.document.querySelectorAll('.homeToolbarMenu').forEach(panel=>{panel.hidden=true;});
    root.document.querySelectorAll('.homeToolbarToggle').forEach(button=>button.setAttribute('aria-expanded','false'));
  }
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
    viewport.hidden=true;
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
    const toggle=doc.createElement('button');
    toggle.id=prefix+'FilterToggle';toggle.type='button';
    toggle.className='btn ghost small compactFilterToggle';
    toggle.textContent='Rozbaliť filtre';
    toggle.setAttribute('aria-controls',viewport.id);
    toggle.setAttribute('aria-expanded','false');
    toggle.onclick=()=>{
      viewport.hidden=!viewport.hidden;
      toggle.textContent=viewport.hidden?'Rozbaliť filtre':'Skryť filtre';
      toggle.setAttribute('aria-expanded',String(!viewport.hidden));
    };
    heading.appendChild(toggle);
  }
  function updateView(){
    const doc=root.document,bar=doc.getElementById('homeToolbar');
    if(!bar)return;
    const screen=doc.querySelector('.screen.on')?.id;
    // Keep navigation available in every quote and inspection step.
    bar.hidden=false;
    const active=screen?.startsWith('inspection')?'inspections':'quotes';
    closeMenus();
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
    function styleButton(key,label){
      const button=buttons[key];
      button.type='button';button.className='homeToolbarButton';
      button.dataset.homeAction=key;button.setAttribute('aria-label',label);
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[key]+'</svg><span>'+label+'</span>';
      return button;
    }
    function dropdown(id,symbol,label,items){
      const group=doc.createElement('div');group.className='homeToolbarGroup';
      const toggle=doc.createElement('button');toggle.type='button';toggle.className='homeToolbarButton homeToolbarToggle';
      toggle.textContent=symbol;toggle.setAttribute('aria-label',label);
      toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',id);
      const panel=doc.createElement('div');panel.id=id;panel.className='homeToolbarMenu';panel.hidden=true;
      panel.setAttribute('aria-label',label);
      items.forEach(button=>panel.appendChild(button));
      toggle.onclick=()=>{const open=panel.hidden;closeMenus();panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};
      panel.addEventListener('click',event=>{if(event.target.closest('button'))closeMenus();});
      group.append(toggle,panel);row.appendChild(group);
    }
    row.appendChild(styleButton('inspections','Obhliadky'));
    dropdown('homeCreateMenu','＋','Vytvoriť novú obhliadku alebo ponuku',[
      styleButton('newInspection','Nová obhliadka'),styleButton('newQuote','Nová ponuka')
    ]);
    buttons.sync.onclick=async()=>{
      await root.syncQuotes(true,false);
      await root.SpektraInspections.refresh();
    };
    const xml=doc.createElement('button');xml.type='button';xml.className='homeToolbarButton';xml.textContent='Export XML do POHODY';
    xml.onclick=()=>{
      if(doc.querySelector('.screen.on')?.id!=='step5'){
        root.alert('Najprv otvorte ponuku a prejdite na jej finálny súhrn. Potom zvoľte Export XML.');return;
      }
      root.downloadPohodaIssuedOfferXml();
    };
    dropdown('homeSyncMenu','↻','Synchronizácia, zásoby a export XML',[
      styleButton('sync','Synchronizácia'),styleButton('stock','Aktualizovať zásoby'),xml
    ]);
    row.appendChild(styleButton('quotes','Ponuky'));
    doc.addEventListener('click',event=>{if(!nav.contains(event.target))closeMenus();});
    doc.addEventListener('keydown',event=>{
      if(event.key==='Escape'){
        const toggle=nav.querySelector('[aria-expanded="true"]');closeMenus();toggle?.focus();
      }
    });
    const header=doc.createElement('header');
    header.id='appStickyHeader';header.className='appStickyHeader';
    head.before(header);
    header.appendChild(head);
    doc.querySelector('body > nav.nav')?.remove();
    doc.body.appendChild(nav);
    doc.body.classList.add('hasBottomToolbar');
    hero.remove();
    compactFilters('quote');compactFilters('inspection');
    doc.querySelector('#inspectionHome > .hero')?.remove();
    doc.querySelector('#inspectionHome > .topline')?.remove();
    updateView();
    // Observe only screen visibility, not list rows, editable fields or saves.
    const observer=new root.MutationObserver(updateView);
    doc.querySelectorAll('.screen').forEach(screen=>observer.observe(screen,{attributes:true,attributeFilter:['class']}));
  }
  // Load the optional simple quote UI from the same deployment. If it cannot
  // load, the full editor remains visible and usable; no quote is changed.
  const toolbarSource=root.document.currentScript?.src;
  if(toolbarSource&&root.document.getElementById('quoteWorkbench')){
    const quick=root.document.createElement('script');
    quick.src=new URL('quote-quick.js?v=20261009-simple1',toolbarSource).href;
    quick.async=true;
    quick.onerror=()=>console.warn('Jednoduchý editor sa nenačítal. Obnovte stránku; rozšírený editor zostáva dostupný.');
    root.document.head.appendChild(quick);
  }
  const api={mount,updateView,compactFilters};
  root.SpektraHomeToolbar=api;
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(window);
