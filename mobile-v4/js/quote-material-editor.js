/* UI for quote-materials.js. Uses the existing quote outbox, totals and PDF rows. */
let quoteMaterialSearchTimer=null;
let quoteMaterialSearchRows=[];
let quoteMaterialSearchOwner=null;
let quoteMaterialSearchLimit=20;

function renderQuoteMaterialEditor(){
  if(!current)return;
  const api=window.SpektraQuoteMaterials;
  const details=document.getElementById('bomDetails');
  const slot=document.getElementById(isTradeQuote(current)?'finalMaterialEditorSlot':'quoteMaterialEditorSlot');
  if(details&&slot&&details.parentElement!==slot)slot.appendChild(details);
  if(details)details.classList.toggle('hidden',!api.unlocked(current));
  if(!api.unlocked(current))return;
  if(quoteMaterialSearchOwner!==current.id){
    quoteMaterialSearchOwner=current.id;quoteMaterialSearchRows=[];quoteMaterialSearchLimit=20;
    clearTimeout(quoteMaterialSearchTimer);
    const input=document.getElementById('quoteMaterialSearch');if(input)input.value='';
    const qty=document.getElementById('quoteMaterialAddQty');if(qty)qty.value='1';
    const results=document.getElementById('quoteMaterialResults');if(results)results.replaceChildren();
    setQuoteMaterialStatus('Množstvá aj vymazané položky sa zachovajú pri obnove cien.');
  }
  const target=document.getElementById('bomItems');
  if(!target)return;
  target.innerHTML=(current.items||[]).map((i,index)=>{
    const canEdit=api.editable(i);
    const code=i.pohoda?.code||i.pohoda_code||'';
    let info=code?'Kód: '+code:'Bez skladového kódu';
    if(i.pohoda?.plu)info+=' · PLU: '+i.pohoda.plu;
    if(i.mapping_status==='included_in_installation')info+=' · zahrnuté v montáži';
    if(i.mapping_status==='catalog_item_missing')info+=' · karta nie je v aktuálnom katalógu; uložená cena ostala';
    const knownPurchase=i.cost_override===true||(i.cost!=null&&Number(i.cost)>0);
    const amount=i.price==null?null:Number(i.price)*Number(i.qty);
    return '<div class="item quoteMaterialRow">'+
      '<div class="quoteMaterialInfo"><b>'+esc(customerText(i.name))+'</b><small>'+esc(info)+'</small>'+
      '<small>'+(knownPurchase?'Nákupný náklad je započítaný.':'⚠ Nákupný náklad chýba – doplň ho pre správny zisk.')+'</small>'+
      (!canEdit?'<small>Zariadenie / služba – upravuje sa v technickom návrhu.</small>':'')+'</div>'+
      '<div class="quoteMaterialNumbers">'+
        '<label>Množstvo ('+esc(i.unit||'ks')+')'+(canEdit?
          '<input aria-label="Množstvo – '+esc(i.name)+'" data-material-qty="'+index+'" type="text" inputmode="decimal" value="'+esc(i.qty)+'" onchange="setQuoteItemQuantity('+index+',this.value)">':
          '<span class="quoteFixedQty">'+esc(i.qty)+' '+esc(i.unit||'ks')+'</span>')+'</label>'+
        '<label>Predaj / MJ bez DPH<input aria-label="Predajná cena – '+esc(i.name)+'" type="number" step="0.0001" min="0" value="'+(i.price==null?'':Number(i.price))+'" onchange="setQuoteItemPrice('+index+',this.value)"></label>'+
        '<label>Nákup / MJ bez DPH<input aria-label="Nákupná cena – '+esc(i.name)+'" type="number" step="0.0001" min="0" placeholder="doplniť" value="'+(knownPurchase?Number(i.cost):'')+'" onchange="setQuoteItemCost('+index+',this.value)"></label>'+
      '</div><div class="quoteMaterialLineTotal"><span>Spolu bez DPH <b>'+eur(amount)+'</b></span>'+
        (canEdit?'<button type="button" class="btn ghost small quoteRemoveMaterial" data-material-remove="'+index+'" onclick="removeQuoteMaterial('+index+')" aria-label="Vymazať – '+esc(i.name)+'">Vymazať</button>':'')+
      '</div></div>';
  }).join('');
  const count=document.getElementById('quoteMaterialCount');
  if(count)count.textContent='Materiálové položky: '+(current.items||[]).filter(api.editable).length;
}
function setQuoteMaterialStatus(text,error=false){
  const el=document.getElementById('quoteMaterialStatus');
  if(el){el.textContent=text;el.classList.toggle('warn',error)}
}
function renderQuoteAfterMaterialChange(){
  recalcQuoteTotalsFromItems();
  if(isTradeQuote(current))renderFinal();else renderRecommendation();
}
async function saveQuoteMaterialChange(message){
  const owner=current;
  renderQuoteAfterMaterialChange();
  setQuoteMaterialStatus(message+' Ukladám…');
  const pending=upsertCurrent();
  const token=owner._edit_token;
  try{
    const result=await pending;
    if(current?.id!==owner.id||current._edit_token!==token)return;
    setQuoteMaterialStatus(result?.ok?(message+(result.synced?' Uložené a synchronizované.':' Uložené v tomto zariadení; čaká na synchronizáciu.')):
      message+' Synchronizácia nepotvrdená: '+(result?.error||'Skontrolujte stav ponuky.'),!result?.ok);
  }catch(e){
    if(current?.id===owner.id)setQuoteMaterialStatus('Uloženie zlyhalo: '+e.message,true);
  }
}
async function setQuoteItemQuantity(index,value){
  if(!window.SpektraQuoteMaterials.unlocked(current))return;
  try{window.SpektraQuoteMaterials.setQuantity(current,index,value)}
  catch(e){renderQuoteMaterialEditor();setQuoteMaterialStatus(e.message,true);return}
  return saveQuoteMaterialChange('Množstvo bolo zmenené.');
}
async function removeQuoteMaterial(index){
  const api=window.SpektraQuoteMaterials;
  if(!api.unlocked(current)||!api.editable(current.items?.[index]))return;
  const item=current.items[index];
  if(!confirm('Vymazať z ponuky položku „'+item.name+'“? Skladová karta v POHODE zostane zachovaná.'))return;
  try{api.remove(current,index)}catch(e){setQuoteMaterialStatus(e.message,true);return}
  return saveQuoteMaterialChange('Položka bola vymazaná z ponuky.');
}
function searchQuoteMaterials(query,more=false){
  clearTimeout(quoteMaterialSearchTimer);
  if(!window.SpektraQuoteMaterials.unlocked(current))return;
  const owner=current.id;
  quoteMaterialSearchLimit=more?quoteMaterialSearchLimit+20:20;
  quoteMaterialSearchTimer=setTimeout(()=>{
    if(current?.id!==owner||!window.SpektraQuoteMaterials.unlocked(current))return;
    quoteMaterialSearchOwner=owner;
    const box=document.getElementById('quoteMaterialResults');if(!box)return;
    const found=window.SpektraQuoteMaterials.search(stocks,query,quoteMaterialSearchLimit);
    quoteMaterialSearchRows=found.rows;
    if(String(query).trim().length<2){box.innerHTML='<div class="sub">Zadajte aspoň 2 znaky.</div>';return}
    if(!stocks.length){box.innerHTML='<div class="notice warn">Katalóg zásob nie je načítaný. Prihláste sa a synchronizujte zásoby.</div>';return}
    if(!found.total){box.innerHTML='<div class="sub">V aktívnych zásobách sa nenašla zhoda.</div>';return}
    box.innerHTML='<div class="sub">Nájdené '+found.total+' · zobrazené '+found.rows.length+'</div>'+found.rows.map((st,n)=>
      '<div class="quoteStockResult"><div><b>'+esc(st.name)+'</b><small>'+esc(['Kód: '+(st.code||'—'),'PLU: '+(st.plu||'—'),st.storage_name||''].filter(Boolean).join(' · '))+'</small>'+
      '<small>Predaj: '+eur(st.sell_price_ex_vat)+' / '+esc(st.unit||'ks')+' bez DPH · Skladom: '+esc(st.quantity_available??'—')+' '+esc(st.unit||'ks')+'</small></div>'+
      '<button type="button" class="btn small" onclick="addQuoteMaterialFromStock('+n+')" aria-label="Pridať – '+esc(st.name)+'">+ Pridať</button></div>').join('')+
      (found.rows.length<found.total?'<button type="button" class="btn ghost full" onclick="searchQuoteMaterials(document.getElementById(\'quoteMaterialSearch\').value,true)">Zobraziť ďalšie</button>':'');
  },more?0:180);
}
async function addQuoteMaterialFromStock(index){
  if(!window.SpektraQuoteMaterials.unlocked(current)||quoteMaterialSearchOwner!==current.id)return;
  const selected=quoteMaterialSearchRows[index];
  if(!selected)return;
  // Validate the original result against the latest in-memory catalog, not the row index.
  const st=window.SpektraQuoteMaterials.findStock({id:selected.id,fingerprint:selected.fingerprint,plu:selected.plu,code:selected.code,storage_ref:selected.storage_ref},stocks);
  try{
    const qty=document.getElementById('quoteMaterialAddQty')?.value;
    const result=window.SpektraQuoteMaterials.add(current,st,qty,window.SpektraQuoteStorage.uuid());
    await saveQuoteMaterialChange(result.merged?'Množstvo existujúcej položky bolo navýšené.':'Materiál bol pridaný do ponuky.');
  }catch(e){setQuoteMaterialStatus(e.message,true)}
}
