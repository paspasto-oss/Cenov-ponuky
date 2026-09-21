window.SpektraStockDB = (() => {
  const DB_NAME='SpektraPonukyDB';
  const DB_VERSION=1;
  const STOCK_STORE='pohoda_stocks';
  const META_STORE='meta';

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STOCK_STORE)){
          const s=db.createObjectStore(STOCK_STORE,{keyPath:'fingerprint'});
          s.createIndex('code','code',{unique:false});
          s.createIndex('plu','plu',{unique:false});
          s.createIndex('name','name',{unique:false});
        }
        if(!db.objectStoreNames.contains(META_STORE)){
          db.createObjectStore(META_STORE,{keyPath:'key'});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  async function getAll(){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STOCK_STORE,'readonly');
      const req=tx.objectStore(STOCK_STORE).getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error);
    });
  }

  async function replaceAll(rows){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STOCK_STORE,'readwrite');
      const store=tx.objectStore(STOCK_STORE);
      store.clear();
      for(const row of rows) store.put(row);
      tx.oncomplete=()=>resolve(rows.length);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
    });
  }

  async function merge(rows){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STOCK_STORE,'readwrite');
      const store=tx.objectStore(STOCK_STORE);
      for(const row of rows) store.put(row);
      tx.oncomplete=()=>resolve(rows.length);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
    });
  }

  async function clear(){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction([STOCK_STORE,META_STORE],'readwrite');
      tx.objectStore(STOCK_STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }

  async function setMeta(key,value){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(META_STORE,'readwrite');
      tx.objectStore(META_STORE).put({key,value});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }

  async function getMeta(key){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(META_STORE,'readonly');
      const req=tx.objectStore(META_STORE).get(key);
      req.onsuccess=()=>resolve(req.result?.value??null);
      req.onerror=()=>reject(req.error);
    });
  }

  return {getAll,replaceAll,merge,clear,setMeta,getMeta};
})();