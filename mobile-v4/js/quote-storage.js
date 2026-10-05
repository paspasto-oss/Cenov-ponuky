/* Durable per-quote outbox. One server transaction, one request ID per snapshot.
 * No dependency on the current editor after an asynchronous request starts.
 */
(function(root){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  function uuid(){
    if(root.crypto?.randomUUID)return root.crypto.randomUUID();
    const b=new Uint8Array(16);root.crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const s=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
    return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
  }
  function create(options){
    const tails=new Map();
    const rows=()=>options.getRows();
    const row=id=>rows().find(q=>q.id===id);
    const store=()=>{options.persist();options.onState?.();};
    function patchEditor(id,token,patch){
      const editor=options.getCurrent();
      if(editor?.id===id&&editor._edit_token===token)Object.assign(editor,clone(patch));
    }
    function ack(id,snapshot,result){
      const q=row(id);if(!q)return;
      const meta={remote_id:result.remote_id,remote_customer_id:result.remote_customer_id,
        quote_no:result.quote_no,_server_quote_no:true,sync_version:result.sync_version,
        _server_status:result.status||snapshot.status,_server_updated_at:result.updated_at,
        issued_on:result.issued_on,valid_until:result.valid_until};
      Object.assign(q,meta);
      const unchanged=q._edit_token===snapshot._edit_token;
      if(unchanged){
        Object.assign(q,{net:result.net,vat_pct:result.vat_pct,total:result.total,
          vat:Math.round((result.total-result.net)*100)/100,price_complete:result.price_complete,
          _dirty:false});
      }
      q._outbox=null;q._sync_error=null;q._conflict=false;
      patchEditor(id,q._edit_token,{...meta,_dirty:!unchanged,_outbox:null,_sync_error:null,_conflict:false,
        ...(unchanged?{net:q.net,vat_pct:q.vat_pct,total:q.total,vat:q.vat,price_complete:q.price_complete}:{})});
      store();
    }
    async function drain(id){
      if(!options.authenticated())return {ok:true,synced:false};
      while(true){
        const q=row(id);
        if(!q||(!q._dirty&&!q._outbox))return {ok:true,synced:true};
        if(q._conflict)return {ok:false,synced:false,conflict:true,error:q._sync_error};
        try{
          if(!q._outbox){
            if(q.remote_id&&!Number.isInteger(q.sync_version)){
              const e=new Error('Starší miestny koncept nemá verziu servera. Zachovajte kópiu a načítajte pôvodnú ponuku zo servera.');
              e.code='40001';throw e;
            }
            const snapshot=clone(q);delete snapshot._outbox;
            q._outbox={request_id:uuid(),snapshot};
            store(); // Must be durable BEFORE sending; retry reuses this exact snapshot.
          }
          const job=clone(q._outbox);
          const response=await options.send(job.snapshot,job.request_id);
          if(!response?.remote_id||!Number.isInteger(response.sync_version))throw new Error('Server nepotvrdil verziu uloženia.');
          ack(id,job.snapshot,response);
        }catch(e){
          const latest=row(id);
          if(latest){
            latest._dirty=true;latest._sync_error=e.message||String(e);
            latest._conflict=['40001','55000','23505'].includes(e.code);
            // A definite validation rollback is safe to discard from the outbox.
            // The next user edit must not be trapped replaying an invalid snapshot.
            if(/^(22|23502|23514)/.test(e.code||''))latest._outbox=null;
            patchEditor(id,latest._edit_token,{_dirty:true,_sync_error:latest._sync_error,_conflict:latest._conflict});
            try{store()}catch(storageError){options.onError?.(storageError)}
          }
          return {ok:false,synced:false,conflict:!!latest?._conflict,code:e.code,error:e.message||String(e)};
        }
      }
    }
    function enqueue(id){
      const previous=tails.get(id)||Promise.resolve();
      const promise=previous.catch(()=>{}).then(()=>drain(id));
      tails.set(id,promise);
      promise.finally(()=>{if(tails.get(id)===promise)tails.delete(id)}).catch(()=>{});
      return promise;
    }
    async function save(editor){
      if(!editor?.id)return {ok:false,synced:false,error:'Chýba ponuka.'};
      try{
        delete editor._needs_review;editor.updated=Date.now();editor._dirty=true;editor._edit_token=uuid();
        const previous=row(editor.id);
        const saved=clone(editor);
        if(previous?._outbox)saved._outbox=clone(previous._outbox);
        if(previous?._conflict){saved._conflict=true;saved._sync_error=previous._sync_error}
        const list=rows().slice();const index=list.findIndex(q=>q.id===saved.id);
        if(index>=0)list[index]=saved;else list.push(saved);
        options.setRows(list);store();
      }catch(e){options.onError?.(e);return {ok:false,synced:false,error:'Miestne uloženie zlyhalo: '+e.message};}
      return enqueue(editor.id);
    }
    function merge(remote){
      const list=new Map(rows().map(q=>[q.id,q]));
      for(const rq of remote){
        const local=list.get(rq.id);
        if(!local||(!local._dirty&&!local._outbox)){list.set(rq.id,rq);continue}
        // A failed response may already have committed. Replay its request first.
        if(!local._outbox&&local.remote_id&&local.sync_version!==rq.sync_version){
          local._conflict=true;
          local._sync_error='Na serveri je iná verzia ponuky. Miestne zmeny zostali zachované.';
        }
      }
      options.setRows([...list.values()]);store();
    }
    async function flush(){
      const pending=rows().filter(q=>(q._dirty||q._outbox)&&!q._needs_review);
      const results=[];for(const q of pending)results.push(await enqueue(q.id));
      return results;
    }
    function recover(id,remote){
      const original=row(id);
      if(!original||!remote)throw new Error('Chýba miestna alebo serverová verzia ponuky.');
      if(tails.has(id))throw new Error('Prebieha uloženie tejto ponuky. Po jeho dokončení zopakujte obnovu.');
      const copy=clone(original);
      for(const key of Object.keys(copy))if(key.startsWith('_'))delete copy[key];
      delete copy.remote_id;delete copy.remote_customer_id;delete copy.sync_version;
      delete copy.warranty_consent;delete copy.issued_on;delete copy.valid_until;
      copy.id=uuid();copy.quote_no='KÓPIA '+(original.quote_no||'ponuky');copy.status='draft';
      copy._dirty=true;copy._needs_review=true;copy._server_quote_no=false;copy.created=Date.now();copy.updated=Date.now();
      options.setRows(rows().map(q=>q.id===id?clone(remote):q).concat(copy));store();
      return copy;
    }
    return {save,merge,flush,recover,enqueue};
  }
  const api={create,uuid};root.SpektraQuoteStorage=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
