window.SpektraStockDB = (() => {
  const DB_NAME='SpektraPonukyDB';
  const DB_VERSION=2;
  const STOCK_STORE='pohoda_stocks';
  const LITE_STORE='pohoda_stocks_lite';
  const META_STORE='meta';

  function ensureStockStore(db,name){
    if(db.objectStoreNames.contains(name))return;
    const s=db.createObjectStore(name,{keyPath:'fingerprint'});
    s.createIndex('code','code',{unique:false});
    s.createIndex('plu','plu',{unique:false});
    s.createIndex('name','name',{unique:false});
  }

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        ensureStockStore(db,STOCK_STORE);
        ensureStockStore(db,LITE_STORE);
        if(!db.objectStoreNames.contains(META_STORE)){
          db.createObjectStore(META_STORE,{keyPath:'key'});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  async function getAllFrom(storeName){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,'readonly');
      const req=tx.objectStore(storeName).getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error);
    });
  }

  async function replaceStore(storeName,rows){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,'readwrite');
      const store=tx.objectStore(storeName);
      store.clear();
      for(const row of rows) store.put(row);
      tx.oncomplete=()=>resolve(rows.length);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
    });
  }

  async function mergeStore(storeName,rows){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,'readwrite');
      const store=tx.objectStore(storeName);
      for(const row of rows) store.put(row);
      tx.oncomplete=()=>resolve(rows.length);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
    });
  }

  async function getAll(){ return getAllFrom(STOCK_STORE); }
  async function getAllLite(){ return getAllFrom(LITE_STORE); }
  async function replaceAll(rows){ return replaceStore(STOCK_STORE,rows); }
  async function replaceAllLite(rows){ return replaceStore(LITE_STORE,rows); }
  async function merge(rows){ return mergeStore(STOCK_STORE,rows); }
  async function mergeLite(rows){ return mergeStore(LITE_STORE,rows); }

  async function getAllLiteOrFull(){
    const lite=await getAllLite();
    if(lite.length)return lite;
    return getAll();
  }

  async function clear(){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction([STOCK_STORE,LITE_STORE,META_STORE],'readwrite');
      tx.objectStore(STOCK_STORE).clear();
      tx.objectStore(LITE_STORE).clear();
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

  return {
    getAll,getAllLite,getAllLiteOrFull,
    replaceAll,replaceAllLite,merge,mergeLite,
    clear,setMeta,getMeta
  };
})();