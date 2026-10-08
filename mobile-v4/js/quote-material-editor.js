/* Shared line editor. Item changes use the existing durable quote outbox. */
let quoteRowsEditorActive=false;
let quoteMaterialSearchTimer=null;
let quoteMaterialSearchRows=[];
let quoteMaterialSearchOwner=null;
let quoteMaterialSearchLimit=20;
let quoteMaterialStatusVersion=0;

function openQuoteRows(){
  if(!current)return;
  if(!window.SpektraQuoteMaterials.unlocked(current)){renderFinal();go('step5');return;}
  quoteRowsEditorActive=true;
  renderQuoteMaterialEditor();renderQuoteRowsSummary();go('quoteRows');
  window.SpektraQuoteWorkbench?.onOpen();
}
function renderQuoteMaterialEditor(){
  if(!current)return;
  const api=window.SpektraQuoteMaterials;
  const details=document.getElementById('bomDetails');
  const slot=document.getElementById(quoteRowsEditorActive?'rowMaterialEditorSlot':isTradeQuote(current)?'finalMaterialEditorSlot':'quoteMaterialEditorSlot');
  if(details&&slot&&details.parentElement!==slot)slot.appendChild(details);
  if(details){details.classList.toggle('hidden',!api.unlocked(current));if(quoteRowsEditorActive)details.open=true;}
  if(!api.unlocked(current))return;
  if(quoteMaterialSearchOwner!==current.id){
    quoteMaterialSearchOwner=current.id;quoteMaterialSearchRows=[];quoteMaterialSearchLimit=20;
    clearTimeout(quoteMaterialSearchTimer);
    const input=document.getElementById('quoteMaterialSearch');if(input)input.value='';
    const qty=document.getElementById('quoteMaterialAddQty');if(qty)qty.value='1';
    const results=document.getElementById('quoteMaterialResults');if(results)results.replaceChildren();
    for(const id of ['quoteCatalogPanel','quoteManualPanel'])document.getElementById(id)?.classList.add('hidden');
    resetManualQuoteForm();
    setQuoteMaterialStatus('Zmeny sa ukladajú automaticky po opustení upraveného poľa.');
  }
  const target=document.getElementById('bomItems');if(!target)return;
  const workbenchGroups=quoteRowsEditorActive&&window.SpektraQuoteWorkbench?SpektraQuoteAssemblies.groups(current):null;
  const input=(i,n,field,label,value,extra='')=>'<input aria-label="'+label+' – '+esc(i.name)+'" data-row-field="'+field+'" type="text" '+extra+' value="'+esc(value??'')+'" onchange="setQuoteItemField('+n+',\''+field+'\',this.value,this)">';
  const rows=(current.items||[]).map((i,n)=>{
    const textOnly=api.isText(i),meta=i.stored_metadata?.quote_material;
    const code=i.pohoda?.code||i.pohoda_code||'';
    const missingStock=!textOnly&&(i.stored_metadata?.quote_assembly?.stock_selection_required===true||i.mapping_status==='catalog_item_missing');
    let info=textOnly?'Poznámka bez ceny':meta?.origin==='manual'?(i.role==='quote_manual_service'?'Vlastná práca / služba':'Vlastná položka'):code?'Kód: '+code:'Položka bez skladového kódu';
    if(i.pohoda?.plu)info+=' · PLU: '+i.pohoda.plu;
    if(missingStock)info+=' · čaká na kartu zo zásob POHODA';
    const knownCost=i.cost!=null&&(Number(i.cost)>0||i.cost_override===true);
    const total=Number(i.qty)===0?0:i.price==null?null:Number(i.price)*Number(i.qty);
    return '<tr data-quote-row="'+n+'" class="'+(textOnly?'quoteTextRow':missingStock?'quoteStockPlaceholder':'')+'"><td class="quoteRowName"><div class="quoteRowNameWrap"><span class="quoteRowNumber">'+(n+1)+'</span><div><textarea rows="2" aria-label="Názov položky '+(n+1)+'" data-row-field="name" placeholder="'+esc(missingStock?i.name:'')+'" onchange="setQuoteItemField('+n+',\'name\',this.value,this)">'+(missingStock?'':esc(i.name))+'</textarea><small>'+esc(info)+'</small>'+(quoteRowsEditorActive&&window.SpektraQuoteWorkbench?SpektraQuoteWorkbench.rowGroupControl(n,workbenchGroups):'')+'</div></div></td>'+
      (textOnly?'<td colspan="5" class="quoteTextLabel">Text sa vytlačí bez množstva a ceny.</td>':
        '<td>'+input(i,n,'qty','Množstvo',i.qty,'inputmode="decimal"')+'</td>'+
        '<td>'+input(i,n,'unit','Merná jednotka',i.unit||'ks','maxlength="10"')+'</td>'+
        '<td>'+input(i,n,'price','Predajná cena',i.price,'inputmode="decimal" placeholder="doplniť"')+'</td>'+
        '<td>'+input(i,n,'cost','Nákupná cena',knownCost?i.cost:null,'inputmode="decimal" placeholder="doplniť"')+'</td>'+
        '<td class="quoteRowAmount" data-row-total="'+n+'">'+eur(total)+'</td>')+
      '<td class="wbRowActions">'+(quoteRowsEditorActive&&window.SpektraQuoteWorkbench?SpektraQuoteWorkbench.rowControls(n):'')+'<button type="button" class="quoteRemoveMaterial" title="Vymazať položku" onclick="removeQuoteMaterial('+n+')" aria-label="Vymazať – '+esc(i.name)+'">×</button></td></tr>';
  }).join('');
  target.innerHTML=rows?'<div class="quoteTableScroll" role="region" aria-label="Upraviteľné položky ponuky" tabindex="0"><table class="quoteRowsTable"><thead><tr><th scope="col">Položka / popis</th><th scope="col">Množstvo</th><th scope="col">MJ</th><th scope="col">Predaj / MJ<small>bez DPH</small></th><th scope="col">Nákup / MJ<small>bez DPH</small></th><th scope="col">Spolu<small>bez DPH</small></th><th scope="col"><span class="quoteSrOnly">Odstrániť</span></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="notice">Ponuka zatiaľ nemá položky. Pridajte položku z katalógu alebo vlastný riadok.</div>';
  if(quoteRowsEditorActive)window.SpektraQuoteWorkbench?.bindRows();
  const count=document.getElementById('quoteMaterialCount');
  if(count)count.textContent='Počet riadkov: '+(current.items||[]).length+' · Ceny sú za jednu mernú jednotku.';
  const detail=document.getElementById('quoteRowsDetailedPdf');if(detail)detail.checked=current.material_edits?.pdf_detail===true;
}
function renderQuoteRowsSummary(){
  if(!current)return;
  const title=document.getElementById('quoteRowsTitle');if(title)title.textContent=current.quote_no||'Položky ponuky';
  const customer=document.getElementById('quoteRowsCustomer');if(customer)customer.textContent=[current.customer?.name,current.customer?.address].filter(Boolean).join(' · ');
  const realization=document.getElementById('quoteEstimatedRealizationDate');
  if(realization){realization.value=window.SpektraRealizationDate?.get(current)||'';realization.disabled=!window.SpektraQuoteMaterials.unlocked(current);}
  const result=window.SpektraQuoteSummary.calculate(current);
  const values={quoteRowsNet:current.price_complete?eur(current.net):'Neúplná cena',quoteRowsVat:current.price_complete?eur(current.vat):'—',quoteRowsTotal:result.total==null?'Neúplná cena':eur(result.total),quoteRowsProfit:result.gross==null?'Doplniť náklady':eur(result.gross)};
  for(const [id,value] of Object.entries(values)){const el=document.getElementById(id);if(el)el.textContent=value;}
  const vatLabel=document.getElementById('quoteRowsVatLabel');if(vatLabel)vatLabel.textContent='DPH '+(current.vat_pct??23)+' %';
  const hint=document.getElementById('quoteRowsWarning');
  if(hint){
    let message='';
    const unpriced=(current.items||[]).filter(i=>i.price==null);
    if(!current.items?.length)message='Pridajte aspoň jednu položku.';
    else if(unpriced.length)message='Doplňte predajnú cenu pri '+unpriced.length+' položkách, prípadne nepotrebné riadky vymažte.';
    else if(result.inconsistent)message='Uložený súčet nesedí s riadkami. Skontrolujte položky a stlačte Uložiť zmeny.';
    else if(result.missingCost.length)message='Pri '+result.missingCost.length+' položkách chýba nákupná cena. Pre správny hrubý zisk doplňte aj náklady na prácu.';
    const marginMessage=window.SpektraQuoteWorkbench?.marginWarning()||'';
    if(marginMessage)message+=(message?' ':'')+marginMessage;
    hint.textContent=message;hint.classList.toggle('hidden',!message);
  }
}
function setQuoteMaterialStatus(text,error=false){
  quoteMaterialStatusVersion++;
  const el=document.getElementById('quoteMaterialStatus');
  if(el){el.textContent=text;el.classList.toggle('warn',error);}
}
function renderQuoteAfterMaterialChange(rerender=false){
  recalcQuoteTotalsFromItems();
  if(quoteRowsEditorActive){if(rerender)renderQuoteMaterialEditor();renderQuoteRowsSummary();window.SpektraQuoteWorkbench?.render();}
  else if(isTradeQuote(current))renderFinal();else renderRecommendation();
}
async function saveQuoteMaterialChange(message,rerender=false){
  const owner=current;
  renderQuoteAfterMaterialChange(rerender);
  setQuoteMaterialStatus(message+' Ukladám…');
  const statusVersion=quoteMaterialStatusVersion;
  try{
    const pending=upsertCurrent(),token=owner._edit_token;
    const result=await pending;
    if(current?.id!==owner.id||current._edit_token!==token||quoteMaterialStatusVersion!==statusVersion)return result;
    renderQuoteRowsSummary();
    setQuoteMaterialStatus(result?.ok?(message+(result.synced?' Uložené a synchronizované.':' Uložené v tomto zariadení; čaká na synchronizáciu.')):
      message+' Uloženie nepotvrdené: '+(result?.error||'Skontrolujte stav ponuky.'),!result?.ok);
    return result;
  }catch(e){
    if(current?.id===owner.id&&quoteMaterialStatusVersion===statusVersion)setQuoteMaterialStatus('Uloženie zlyhalo: '+e.message,true);
    return {ok:false,error:e.message};
  }
}
async function setQuoteItemField(index,field,value,input=null){
  if(quoteRowsEditorActive&&window.SpektraQuoteWorkbench)return SpektraQuoteWorkbench.changeRow(index,field,value,input);
  const api=window.SpektraQuoteMaterials;if(!api.unlocked(current))return;
  try{
    api.setField(current,index,field,value);
    if(quoteRowsEditorActive)api.enableRows(current);
    if(input){input.removeAttribute('aria-invalid');input.value=current.items[index][field]??'';}
    const item=current.items[index],total=document.querySelector('[data-row-total="'+index+'"]');
    if(total)total.textContent=eur(Number(item.qty)===0?0:item.price==null?null:Number(item.price)*Number(item.qty));
  }catch(e){if(input)input.setAttribute('aria-invalid','true');setQuoteMaterialStatus(e.message,true);return;}
  return saveQuoteMaterialChange('Položka bola zmenená.');
}
function setQuoteItemQuantity(index,value){return setQuoteItemField(index,'qty',value);}
async function removeQuoteMaterial(index){
  if(quoteRowsEditorActive&&window.SpektraQuoteWorkbench)return SpektraQuoteWorkbench.mutate('Položka bola odstránená. Úpravu možno vrátiť.',q=>SpektraQuoteAssemblies.removeRow(q,index));
  const api=window.SpektraQuoteMaterials;if(!api.unlocked(current)||!current.items?.[index])return;
  if(!confirm('Vymazať z ponuky položku „'+current.items[index].name+'“?'))return;
  try{api.remove(current,index);if(quoteRowsEditorActive)api.enableRows(current);}
  catch(e){setQuoteMaterialStatus(e.message,true);return;}
  return saveQuoteMaterialChange('Položka bola vymazaná.',true);
}
function toggleQuoteAddPanel(kind){
  const id=kind==='catalog'?'quoteCatalogPanel':'quoteManualPanel',panel=document.getElementById(id);
  if(!panel)return;
  const opening=panel.classList.contains('hidden');panel.classList.toggle('hidden',!opening);
  document.getElementById(kind==='catalog'?'quoteManualPanel':'quoteCatalogPanel')?.classList.add('hidden');
  if(opening)document.getElementById(kind==='catalog'?'quoteMaterialSearch':'quoteManualName')?.focus();
}
function resetManualQuoteForm(){
  for(const [id,value] of Object.entries({quoteManualName:'',quoteManualQty:'1',quoteManualUnit:'ks',quoteManualPrice:'',quoteManualCost:'',quoteManualKind:'material'})){const el=document.getElementById(id);if(el)el.value=value;}
  updateQuoteManualKind();
}
function updateQuoteManualKind(){
  const kind=document.getElementById('quoteManualKind')?.value;
  document.getElementById('quoteManualNumbers')?.classList.toggle('hidden',kind==='text');
}
async function addManualQuoteItem(){
  if(quoteRowsEditorActive&&window.SpektraQuoteWorkbench)return SpektraQuoteWorkbench.addManual();
  const api=window.SpektraQuoteMaterials;if(!api.unlocked(current))return;
  const value=id=>document.getElementById(id)?.value;
  try{
    const kind=value('quoteManualKind');
    api.addManual(current,{name:value('quoteManualName'),qty:value('quoteManualQty'),unit:value('quoteManualUnit'),price:value('quoteManualPrice'),cost:value('quoteManualCost'),textOnly:kind==='text',service:kind==='service'},window.SpektraQuoteStorage.uuid());
    if(quoteRowsEditorActive)api.enableRows(current);
    resetManualQuoteForm();
    return await saveQuoteMaterialChange(kind==='text'?'Textová poznámka bola pridaná.':'Vlastná položka bola pridaná.',true);
  }catch(e){setQuoteMaterialStatus(e.message,true);}
}
function searchQuoteMaterials(query,more=false){
  clearTimeout(quoteMaterialSearchTimer);
  if(!window.SpektraQuoteMaterials.unlocked(current))return;
  const owner=current.id;quoteMaterialSearchLimit=more?quoteMaterialSearchLimit+20:20;
  quoteMaterialSearchTimer=setTimeout(()=>{
    if(current?.id!==owner||!window.SpektraQuoteMaterials.unlocked(current))return;
    quoteMaterialSearchOwner=owner;
    const box=document.getElementById('quoteMaterialResults');if(!box)return;
    const found=window.SpektraQuoteMaterials.search(stocks,query,quoteMaterialSearchLimit);quoteMaterialSearchRows=found.rows;
    if(String(query).trim().length<2){box.innerHTML='<div class="sub">Zadajte aspoň 2 znaky.</div>';return;}
    if(!stocks.length){box.innerHTML='<div class="notice warn">Katalóg zásob nie je načítaný. Prihláste sa a synchronizujte zásoby.</div>';return;}
    if(!found.total){box.innerHTML='<div class="sub">V aktívnych zásobách sa nenašla zhoda.</div>';return;}
    box.innerHTML='<div class="sub">Nájdené '+found.total+' · zobrazené '+found.rows.length+'</div>'+found.rows.map((st,n)=>
      '<div class="quoteStockResult"><div><b>'+esc(st.name)+'</b><small>'+esc(['Kód: '+(st.code||'—'),'PLU: '+(st.plu||'—'),st.storage_name||''].filter(Boolean).join(' · '))+'</small>'+
      '<small>Predaj: '+eur(st.sell_price_ex_vat)+' / '+esc(st.unit||'ks')+' bez DPH · Skladom: '+esc(st.quantity_available??'—')+' '+esc(st.unit||'ks')+'</small></div>'+
      '<button type="button" class="btn small" onclick="addQuoteMaterialFromStock('+n+')" aria-label="Pridať – '+esc(st.name)+'">+ Pridať</button></div>').join('')+
      (found.rows.length<found.total?'<button type="button" class="btn ghost full" onclick="searchQuoteMaterials(document.getElementById(\'quoteMaterialSearch\').value,true)">Zobraziť ďalšie</button>':'');
  },more?0:180);
}
async function addQuoteMaterialFromStock(index){
  if(quoteRowsEditorActive&&window.SpektraQuoteWorkbench){
    if(quoteMaterialSearchOwner!==current?.id)return;
    return SpektraQuoteWorkbench.addCatalog(quoteMaterialSearchRows[index],document.getElementById('quoteMaterialAddQty')?.value);
  }
  const api=window.SpektraQuoteMaterials;
  if(!api.unlocked(current)||quoteMaterialSearchOwner!==current.id)return;
  const selected=quoteMaterialSearchRows[index];if(!selected)return;
  const st=api.findStock({id:selected.id,fingerprint:selected.fingerprint,plu:selected.plu,code:selected.code,storage_ref:selected.storage_ref},stocks);
  try{
    const result=api.add(current,st,document.getElementById('quoteMaterialAddQty')?.value,window.SpektraQuoteStorage.uuid());
    if(quoteRowsEditorActive){api.enableRows(current);if(result.item)result.item.visible=true;}
    return await saveQuoteMaterialChange(result.merged?'Množstvo existujúcej položky bolo navýšené.':'Položka z katalógu bola pridaná.',true);
  }catch(e){setQuoteMaterialStatus(e.message,true);}
}
async function setQuoteRowsDetailedPdf(value){
  try{window.SpektraQuoteMaterials.setDetailedPdf(current,!!value);}
  catch(e){setQuoteMaterialStatus(e.message,true);return;}
  return saveQuoteMaterialChange('Rozpis PDF bol nastavený.');
}
async function saveQuoteRows(){
  if(!window.SpektraQuoteMaterials.unlocked(current))return;
  const invalid=document.querySelector('#bomItems [aria-invalid="true"]');
  if(invalid){invalid.focus();setQuoteMaterialStatus('Opravte označené pole pred uložením.',true);return {ok:false};}
  return saveQuoteMaterialChange('Ponuka bola prepočítaná.');
}
async function prepareQuoteRowsForIssue(){
  const owner=current;
  if(!owner)return {ok:false,error:'Nie je otvorená ponuka.'};
  // A repeated print is read-only. Never downgrade an already issued or
  // approved snapshot, and never create a revision just to print it again.
  if(!window.SpektraQuoteMaterials.unlocked(owner))return {ok:true};
  const draft=!owner.status||owner.status==='draft';
  if(!draft&&!owner._dirty&&!owner._outbox)return {ok:true};
  const invalid=document.querySelector('#bomItems [aria-invalid="true"]');
  if(invalid){
    invalid.focus();const error='Opravte označené pole pred vydaním ponuky.';
    setQuoteMaterialStatus(error,true);return {ok:false,error};
  }
  recalcQuoteTotalsFromItems();
  if(!owner.price_complete||!owner.items?.length){
    const error='Pred vydaním ponuky doplňte predajné ceny všetkých položiek.';
    setQuoteMaterialStatus(error,true);return {ok:false,error};
  }
  if(draft)owner.status='ready';
  // Stage the immutable issued version through the durable outbox BEFORE an
  // asynchronous PDF render. The next edit must therefore create a revision.
  // Keep a pending ready state on an ambiguous network failure: that exact
  // request may already have committed and must not be silently downgraded.
  const pending=saveQuoteMaterialChange('Ponuka bola pripravená na vydanie.');
  const token=owner._edit_token,result=await pending;
  if(current!==owner||owner._edit_token!==token)return {...result,ok:false,stale:true,error:'Ponuka sa počas prípravy zmenila. Spustite vydanie znova z otvorenej ponuky.'};
  if(!result?.ok)return {...result,ok:false,error:result?.error||'Ponuku sa pred vydaním nepodarilo uložiť.'};
  return result;
}
async function quoteRowsToFinal(){
  const owner=current,result=await prepareQuoteRowsForIssue();
  if(!result?.ok||current!==owner)return result;
  renderFinal();go('step5');return result;
}
async function copyQuoteForEditing(){
  if(window.SpektraQuoteWorkbench)return SpektraQuoteWorkbench.beginRevision();
  if(!current||!isQuotePriceLocked())return;
  const original=current,copy=JSON.parse(JSON.stringify(original));
  for(const key of Object.keys(copy))if(key.startsWith('_'))delete copy[key];
  for(const key of ['remote_id','remote_customer_id','sync_version','warranty_consent','issued_on','valid_until'])delete copy[key];
  copy.id=window.SpektraQuoteStorage.uuid();copy.quote_no='NÁVRH-'+String(Date.now()).slice(-6);
  copy.status='draft';copy.created=Date.now();copy.updated=Date.now();copy._dirty=true;copy._server_quote_no=false;
  window.SpektraQuoteMaterials.enableRows(copy);
  current=copy;openQuoteRows();
  return saveQuoteMaterialChange('Vytvorená upraviteľná kópia ponuky '+(original.quote_no||'')+'.',true);
}
