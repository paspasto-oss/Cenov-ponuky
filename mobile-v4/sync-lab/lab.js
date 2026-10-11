'use strict';
function showError(error){document.getElementById('error').textContent=error.message||String(error);}
function renderJobs(){
  const holder=document.getElementById('jobs');holder.replaceChildren();
  const rows=SpektraSyncLab.read();
  if(!rows.length){holder.textContent='Zatiaľ žiadne testovacie prenosy.';return;}
  const labels={waiting_simulation:'Čaká na simuláciu',simulated_ok:'Simulácia OK',simulated_error:'Simulácia chyby'};
  for(const row of rows){
    const box=document.createElement('section'),info=document.createElement('p');
    info.textContent=row.quoteId+' — '+(labels[row.status]||row.status);box.append(info);
    for(const [success,label] of [[true,'Simulovať úspech'],[false,'Simulovať chybu']]){
      const button=document.createElement('button');button.textContent=label;button.disabled=row.status==='simulated_ok';
      button.onclick=()=>{try{SpektraSyncLab.simulate(row.id,success);renderJobs();}catch(e){showError(e);}};box.append(button);
    }
    const details=document.createElement('details'),summary=document.createElement('summary'),xml=document.createElement('pre');
    summary.textContent='XML snímka';xml.textContent=row.xml;details.append(summary,xml);box.append(details);
    if(row.note){const note=document.createElement('p');note.textContent=row.note;box.append(note);}holder.append(box);
  }
}
document.getElementById('stockFile').onchange=async event=>{
  try{
    const file=event.target.files[0];if(!file)return;
    if(file.size>25*1024*1024)throw new Error('Pre test použite export do 25 MB.');
    const buffer=await file.arrayBuffer(),header=new TextDecoder('ascii').decode(buffer.slice(0,200));
    const encoding=/encoding\s*=\s*["']windows-1250["']/i.test(header)?'windows-1250':'utf-8';
    const text=new TextDecoder(encoding,{fatal:true}).decode(buffer);
    if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('XML s DTD alebo entitami sa nepodporuje.');
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.querySelector('parsererror'))throw new Error('Neplatné XML.');
    const ns='http://www.stormware.cz/schema/version_2/stock.xsd',stocks=[...doc.getElementsByTagNameNS(ns,'stock')];
    if(!stocks.length)throw new Error('Nenašli sa zásoby v XML exporte POHODY.');
    const pick=(node,field)=>node.getElementsByTagNameNS(ns,field)[0]?.textContent.trim()??null;
    const sample=stocks.slice(0,10).map(node=>({id:pick(node,'id'),code:pick(node,'code'),name:pick(node,'name'),count:pick(node,'count')}));
    document.getElementById('stockResult').textContent=JSON.stringify({file:file.name,total:stocks.length,sample,note:'Iba náhľad. Žiadne ceny ani stavy neboli aktualizované.'},null,2);
    document.getElementById('error').textContent='';
  }catch(e){document.getElementById('stockResult').textContent='';showError(e);}
};
try{renderJobs();}catch(e){showError(e);}
