/* Display preference only. Runs in the head before the first painted frame;
 * never reads or changes customers, quote rows, prices or cloud records. */
(function(root){
  'use strict';
  const doc=root.document,key='spektra.ui.theme.v1';
  const media=typeof root.matchMedia==='function'?root.matchMedia('(prefers-color-scheme: dark)'):null;
  const valid=value=>['light','dark','system'].includes(value)?value:'system';
  let preference='system';
  try{preference=valid(root.localStorage.getItem(key));}catch(_){/* Private mode still supports the current session. */}
  function current(){return preference==='system'?(media?.matches?'dark':'light'):preference;}
  function controls(){
    const dark=current()==='dark';
    doc.querySelectorAll('[data-theme-toggle]').forEach(button=>{
      button.setAttribute('aria-pressed',String(dark));
      button.title=dark?'Prepnúť na svetlý režim':'Prepnúť na tmavý režim';
    });
  }
  function apply(){
    const theme=current();doc.documentElement.setAttribute('data-theme',theme);
    const meta=doc.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',theme==='dark'?'#101820':'#f3f6f8');
    controls();return theme;
  }
  function set(value){
    preference=valid(value);let saved=true;
    try{root.localStorage.setItem(key,preference);}catch(_){saved=false;}
    const theme=apply(),status=doc.getElementById('themeStatus');
    if(status)status.textContent=(theme==='dark'?'Tmavý režim je zapnutý.':'Svetlý režim je zapnutý.')+(saved?'':' Voľbu sa nepodarilo zapamätať v zariadení.');
    return theme;
  }
  function mount(){
    doc.querySelectorAll('[data-theme-toggle]').forEach(button=>{
      if(button.dataset.themeBound)return;
      button.dataset.themeBound='true';
      button.addEventListener('click',()=>set(current()==='dark'?'light':'dark'));
    });
    controls();
  }
  apply();
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  const systemChanged=()=>{if(preference==='system')apply();};
  if(media?.addEventListener)media.addEventListener('change',systemChanged);
  else if(media?.addListener)media.addListener(systemChanged);
  root.addEventListener('storage',event=>{
    if(event.key!==key&&event.key!==null)return;
    if(event.storageArea){try{if(event.storageArea!==root.localStorage)return;}catch(_){return;}}
    preference=valid(event.newValue);apply();
  });
  root.SpektraTheme={current,set,mount};
})(window);
