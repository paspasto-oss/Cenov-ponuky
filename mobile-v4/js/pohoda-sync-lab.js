/* Offline prototype: never sends XML or changes a quote. */
(function(root){
  'use strict';
  const KEY='spektra_sync_test_jobs_v1';
  function read(){
    const rows=JSON.parse(root.localStorage.getItem(KEY)||'[]');
    if(!Array.isArray(rows))throw new Error('Testovacia fronta má nesprávny formát.');
    return rows;
  }
  function write(rows){root.localStorage.setItem(KEY,JSON.stringify(rows));}
  function enqueue(quoteId,xml){
    if(!quoteId||typeof xml!=='string'||!xml.includes('<ofr:offerType>issuedOffer</ofr:offerType>'))throw new Error('Chýba identifikátor alebo XML vydanej ponuky.');
    const rows=read(),existing=rows.find(row=>row.quoteId===String(quoteId)&&row.xml===xml);
    if(existing)return {job:existing,duplicate:true};
    const job={id:root.crypto.randomUUID(),quoteId:String(quoteId),xml,status:'waiting_simulation',createdAt:new Date().toISOString(),simulationAttempts:0};
    rows.push(job);write(rows);return {job,duplicate:false};
  }
  function simulate(id,success){
    const rows=read(),job=rows.find(row=>row.id===id);
    if(!job)throw new Error('Testovacia úloha neexistuje.');
    if(job.status==='simulated_ok')return job;
    job.status=success?'simulated_ok':'simulated_error';job.simulationAttempts+=1;
    job.lastSimulationAt=new Date().toISOString();
    job.note=success?'Simulácia úspechu; POHODA doklad nevytvorila.':'Simulácia chyby; žiadne údaje neboli odoslané.';
    write(rows);return job;
  }
  root.SpektraSyncLab=Object.freeze({read,enqueue,simulate});
  if(root.document)root.document.addEventListener('DOMContentLoaded',()=>{
    if(!root.SPEKTRA_SYNC_SANDBOX||root.document.getElementById('jobs'))return;
    const banner=root.document.createElement('div');
    banner.style.cssText='padding:12px;background:#fff4d9;border:2px solid #c20000;margin:10px;border-radius:10px';
    banner.textContent='TESTOVACIA KÓPIA — lokálne dáta. Databáza a POHODA sú odpojené. ';
    const link=root.document.createElement('a');link.href='sync-lab/index.html';link.textContent='Test synchronizácie';banner.append(link);
    root.document.body.prepend(banner);
  });
})(typeof window==='undefined'?globalThis:window);
