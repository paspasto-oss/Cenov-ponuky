/* Pure document projections. All functions take a quote snapshot explicitly.
 * They never read the catalog, write to the quote, or initiate printing/sharing. */
(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>value==null||typeof value==='boolean'||String(value).trim()===''?null:Number.isFinite(Number(value))?Number(value):null;
  const money=value=>value==null?'—':Number(value).toLocaleString('sk-SK',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const quantity=value=>value==null?'':Number(value).toLocaleString('sk-SK',{maximumFractionDigits:3});
  function rowsApi(options){
    if(options?.rowOutput)return options.rowOutput;
    if(root.SpektraQuoteRowOutput)return root.SpektraQuoteRowOutput;
    if(typeof module==='object'&&module.exports)return require('./quote-row-output.js');
    throw new Error('Modul výstupu ponuky sa nenačítal. Obnovte aplikáciu.');
  }
  function assemblyApi(options){
    if(options?.assemblies)return options.assemblies;
    if(root.SpektraQuoteAssemblies)return root.SpektraQuoteAssemblies;
    if(typeof module==='object'&&module.exports)return require('./quote-assemblies.js');
    throw new Error('Modul zostáv ponuky sa nenačítal. Obnovte aplikáciu.');
  }
  function imageUrl(value){
    const url=String(value??'').trim();
    if(/^(?:https?:\/\/|blob:|data:image\/(?:png|jpeg|jpg|webp|gif);base64,)/i.test(url))return url;
    if(url&&!/^[a-z][a-z\d+.-]*:/i.test(url)&&!/[<>\r\n]/.test(url))return url;
    return '';
  }
  function renderRows(q={},options={}){
    const api=rowsApi(options),model=options.model||api.customerModel(q,options);
    const rows=options.rows||model.rows,technical=options.layout!=='presentation',columns=technical?5:4;
    const fmt=options.formatMoney||money,qty=options.formatQuantity||quantity;
    return rows.map(row=>{
      const meta=row._quote_output||{},type=meta.type||'line',name=api.itemName(q,row,options.cleanName);
      const border='border-bottom:1px solid #d7dce3;',base='padding:7px 5px;'+border+'vertical-align:top;';
      if(type==='text'||api.isText(row))return '<tr data-pdf-text-row style="page-break-inside:avoid"><td colspan="'+columns+'" style="'+base+'white-space:pre-wrap;overflow-wrap:anywhere"><div data-pdf-item-name style="font-size:10px;line-height:1.4">'+esc(name)+'</div></td></tr>';
      if(type==='heading')return '<tr data-pdf-group-heading style="page-break-inside:avoid;background:#edf2f5"><td colspan="'+columns+'" style="'+base+'font-weight:800"><div data-pdf-item-name>'+esc(name)+'</div></td></tr>';
      const values=api.displayAmounts(row,q),hidden=meta.hide_prices===true;
      const amount=hidden?'':esc(fmt(values.amount)),gross=hidden?'':esc(fmt(values.gross));
      const unitPrice=hidden||meta.hide_unit_price||type==='subtotal'?'':esc(fmt(values.unit));
      const count=row.qty==null?'':esc(qty(row.qty))+(row.unit?' '+esc(row.unit):'');
      const image=!meta.depth&&type!=='subtotal'&&typeof options.getImage==='function'?imageUrl(options.getImage(row,q)):'';
      const img=image?'<div style="width:25mm;height:21mm;flex:0 0 auto;display:flex;align-items:center;justify-content:center;margin-right:3mm"><img crossorigin="anonymous" src="'+esc(image)+'" style="max-width:100%;max-height:100%;object-fit:contain"></div>':'';
      const description=row.public_description?'<div data-pdf-item-description style="font-size:8px;color:#57636b;line-height:1.35;margin-top:3px;white-space:pre-wrap">'+esc(row.public_description)+'</div>':'';
      const label='<div style="display:flex;align-items:flex-start">'+img+'<div style="min-width:0"><div data-pdf-item-name style="font-weight:'+(meta.depth?500:700)+';font-size:10px;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere">'+esc(name)+'</div>'+description+'</div></div>';
      return '<tr data-pdf-output-row="'+esc(type)+'"'+(meta.appendix?' data-pdf-appendix-row':'')+' style="page-break-inside:avoid;'+(type==='subtotal'?'background:#f5f7f8;font-weight:700;':'')+'">'+
        '<td style="'+base+(meta.depth?'padding-left:13px;':'')+'">'+label+'</td>'+
        '<td style="'+base+'text-align:center">'+count+'</td>'+
        (technical?'<td style="'+base+'text-align:right">'+unitPrice+'</td>':'')+
        '<td style="'+base+'text-align:right">'+amount+'</td>'+
        '<td style="'+base+'text-align:right;font-weight:700">'+gross+'</td></tr>';
    }).join('');
  }
  function renderTable(q={},options={}){
    const technical=options.layout!=='presentation';
    const headings=technical?['Názov položky','Množstvo','Jednotková cena bez DPH','Celkom bez DPH','Celkom s DPH']:['Názov položky','Množstvo','Celkom bez DPH','Celkom s DPH'];
    return '<table data-pdf-items style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;border:1px solid #d7dce3"><thead><tr style="background:#00539b;color:#fff">'+
      headings.map((label,index)=>'<th style="padding:7px 5px;text-align:'+(index===0?'left':index===1?'center':'right')+';width:'+(index===0?(technical?'44%':'52%'):index===1?'12%':technical?'14.666%':'18%')+'">'+esc(label)+'</th>').join('')+
      '</tr></thead><tbody>'+renderRows(q,options)+'</tbody></table>';
  }
  function renderAppendix(q={},options={}){
    const api=rowsApi(options),model=options.model||api.customerModel(q,options);
    if(!model.appendixRows.length)return '';
    return '<section data-pdf-appendix data-pdf-page-break-before style="margin-top:18px">'+
      '<h2 style="font-size:17px;color:#00539b;margin:0 0 7px">Položková príloha k ponuke '+esc(q.quote_no||'')+'</h2>'+
      '<p style="margin:0 0 10px;font-size:10px">Položky v tejto prílohe sú zahrnuté v cene ponuky.</p>'+
      renderTable(q,{...options,model,rows:model.appendixRows})+'</section>';
  }
  function documentInfo(q={}){
    const state=q.material_edits?.assemblies||{},revision=state.revision||{},value=number(revision.number);
    const revisionLabel=Number.isInteger(value)&&value>0?'Revízia R'+value:'';
    const original=revisionLabel&&revision.root_quote_no&&revision.root_quote_no!==q.quote_no?String(revision.root_quote_no):'';
    const active=(Array.isArray(state.variants)?state.variants:[]).find(variant=>variant.id===state.active_variant_id);
    return {revision:revisionLabel,original_quote_no:original,variant:active?.name?'Variant: '+String(active.name):''};
  }
  function heading(q,title){
    const info=documentInfo(q),dates=root.SpektraRealizationDate||(typeof module==='object'&&module.exports?require('./realization-date.js'):null);
    const realization=dates?.format(dates.get(q))||'';
    return '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:14px"><div><div style="font-size:11px;color:#ba0000;font-weight:800">SPEKTRA INSTALL</div><h2 style="font-size:21px;margin:4px 0 8px;color:#173247">'+esc(title)+'</h2><div style="white-space:pre-wrap">'+esc(q.customer?.name||'')+(q.customer?.address?'<br>'+esc(q.customer.address):'')+'</div></div><div style="text-align:right">Ponuka <b>'+esc(q.quote_no||'—')+'</b>'+(info.revision?'<br>'+esc(info.revision):'')+(info.original_quote_no?'<br>Pôvodná ponuka '+esc(info.original_quote_no):'')+(info.variant?'<br>'+esc(info.variant):'')+(realization?'<br>CCA termín realizácie: '+esc(realization):'')+'</div></div>';
  }
  function renderCustomer(q={},options={}){
    const api=rowsApi(options),model=options.model||api.customerModel(q,options),totals=model.totals,fmt=options.formatMoney||money;
    return '<div data-quote-customer-preview style="font-family:Arial,sans-serif;background:#fff;color:#173247;padding:16px;font-size:12px">'+heading(q,'Cenová ponuka')+
      renderTable(q,{...options,model})+
      '<div data-pdf-totals style="margin:14px 0 0 auto;max-width:290px"><div style="display:flex;justify-content:space-between;padding:4px 0"><span>Celkom bez DPH</span><b>'+esc(fmt(totals.net))+'</b></div><div style="display:flex;justify-content:space-between;padding:4px 0"><span>DPH '+esc(totals.vat_pct)+' %</span><b>'+esc(fmt(totals.vat))+'</b></div><div style="display:flex;justify-content:space-between;border-top:2px solid #173247;padding:7px 0;font-size:17px"><span>SPOLU</span><b>'+esc(fmt(totals.total))+'</b></div></div>'+
      (q.customer?.note?'<div data-pdf-note style="white-space:pre-wrap;margin-top:14px;padding:10px;background:#f5f6f7">'+esc(q.customer.note)+'</div>':'')+
      renderAppendix(q,{...options,model})+'</div>';
  }

  function reference(item,engine){
    const saved=item.catalog_ref||engine.catalogReference?.(item)||item.stored_metadata?.quote_assembly?.catalog_ref||item.stored_metadata?.quote_material?.catalog_ref;
    const stock=item.pohoda||{};
    if(saved)return {source:String(saved.source||'pohoda'),id:saved.id??null,fingerprint:saved.fingerprint??null,
      stock_id:saved.pohoda_stock_id??null,plu:saved.plu??null,code:saved.code??item.pohoda_code??null,storage_ref:saved.storage_ref??null};
    return {source:String(stock.source||'pohoda'),id:stock.id??null,fingerprint:stock.fingerprint??null,
      stock_id:item.pohoda_stock_id??stock.pohoda_stock_id??null,plu:stock.plu??null,code:item.pohoda_code??stock.code??null,storage_ref:stock.storage_ref??null};
  }
  function identity(ref,unit,index){
    // Names may be edited. Identity comparisons stay exact, including leading
    // zeroes, case, warehouse and unit; ambiguous/unmapped rows remain separate.
    const field=['fingerprint','id','stock_id','plu','code'].find(k=>ref[k]!=null&&String(ref[k])!=='');
    return field?JSON.stringify([ref.source,field,String(ref[field]),String(ref.storage_ref??''),String(unit??'')]):'unmapped:'+index;
  }
  function purchaseRows(q={},options={}){
    const engine=assemblyApi(options),groups=engine.groups(q),byIdentity=new Map();let sequence=0;
    for(const group of groups){
      if(!['material','equipment','device','other'].includes(group.kind))continue;
      const fromContents=group.pricing==='fixed'&&group.contents?.length;
      const children=fromContents?group.contents:group.rows||[];
      for(const raw of children){
        const item=typeof raw==='string'?{name:raw}:raw||{},qty=number(item.qty);
        if(fromContents&&item.kind&&!['material','equipment','device','other'].includes(item.kind))continue;
        if(engine.isText(item)||qty===0||item.included_duplicate===true||item.stored_metadata?.quote_assembly?.included_duplicate===true)continue;
        const ref=reference(item,engine),unit=String(item.unit??''),key=identity(ref,unit,sequence++),name=String(item.name??'');
        let row=byIdentity.get(key);
        if(!row){row={identity:key,reference:ref,code:ref.code==null?'':String(ref.code),name,names:[name],qty,unit,groups:[],mapped:!key.startsWith('unmapped:')};byIdentity.set(key,row);}
        else{row.qty=row.qty==null||qty==null?null:Math.round((row.qty+qty)*1000)/1000;if(!row.names.includes(name))row.names.push(name);}
        if(!row.groups.includes(String(group.name||'')))row.groups.push(String(group.name||''));
      }
    }
    return [...byIdentity.values()];
  }
  function internalTable(headings,rows){
    return '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>'+headings.map(x=>'<th style="padding:7px;border-bottom:2px solid #173247;text-align:left">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr style="page-break-inside:avoid">'+cells.map(value=>'<td style="padding:7px;border-bottom:1px solid #d7dce3;vertical-align:top;white-space:pre-wrap">'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }
  function procurementWarnings(q,options={}){
    const engine=assemblyApi(options);
    if(typeof engine.procurement==='function')return (engine.procurement(q).warnings||[]).map(warning=>({name:String(warning.name||''),message:String(warning.message||'')}));
    return engine.groups(q).filter(group=>group.procurement_incomplete&&(group.rows||[]).some(row=>number(row.qty)>0)).map(group=>({name:String(group.name||''),message:'Zostava nemá úplný položkový súpis zahrnutého materiálu. Doplňte materiál pred objednaním.'}));
  }
  function warningHtml(warnings){
    return warnings.length?'<section style="margin:12px 0;padding:10px;border:1px solid #b97812;background:#fff8e8"><b>Súpis materiálu potrebuje doplnenie</b>'+warnings.map(warning=>'<p style="margin:5px 0">'+esc(warning.name)+': '+esc(warning.message)+'</p>').join('')+'</section>':'';
  }
  function renderPurchase(q={},options={}){
    const rows=purchaseRows(q,options),fmt=options.formatQuantity||quantity;
    return '<div data-quote-internal-document="purchase" style="font-family:Arial,sans-serif;padding:16px;background:#fff;color:#173247;font-size:12px">'+heading(q,'Nákupný zoznam')+
      '<p>Interný podklad podľa položiek ponuky.</p>'+warningHtml(procurementWarnings(q,options))+internalTable(['Kód','Položka','Množstvo','MJ','Použitie'],rows.map(row=>[row.code||'Bez kódu',row.names.join('\n'),row.qty==null?'Doplniť':fmt(row.qty),row.unit,row.groups.join('\n')]))+
      (rows.some(row=>!row.mapped||row.qty==null)?'<p style="margin-top:12px">Pri položkách bez kódu alebo množstva doplňte údaje pred objednaním.</p>':'')+'</div>';
  }
  function installerModel(q={},options={}){
    const engine=assemblyApi(options),groups=engine.groups(q),work=[],services=[],notes=[];
    const note=value=>{if(value&&String(value).trim()&&!notes.includes(String(value)))notes.push(String(value));};
    note(q.internal_note);note(q.internal_notes);note(q.customer?.note);
    for(const group of groups){
      for(const item of group.rows||[]){
        if(engine.isText(item)){note(item.name);continue;}
        note(item.internal_note);note(item.note);
      }
      if(['material','equipment','device','other','text'].includes(group.kind))continue;
      const target=group.kind==='labor'?work:services;
      for(const item of group.rows||[]){
        if(engine.isText(item))continue;
        target.push({name:String(item.name??''),qty:number(item.qty),unit:String(item.unit??''),group:String(group.name||''),
          scope:group.pricing==='fixed'&&group.contents?.length?group.contents.map(x=>String(typeof x==='string'?x:x?.name??'')).filter(Boolean):(item.work_scope||[]).map(x=>String(x)),
          status:'Dohodnuté v ponuke; vykonanie sa potvrdzuje samostatne.'});
      }
    }
    return {materials:purchaseRows(q,options),work,services,notes,warnings:procurementWarnings(q,options)};
  }
  function renderInstaller(q={},options={}){
    const data=installerModel(q,options),fmt=options.formatQuantity||quantity;
    const tasks=(title,items)=>items.length?'<h3 style="margin:20px 0 7px">'+esc(title)+'</h3>'+items.map(item=>'<section style="margin:0 0 12px;page-break-inside:avoid"><b>'+esc(item.name)+'</b>'+(item.qty==null?'':' · '+esc(fmt(item.qty))+' '+esc(item.unit))+
      (item.scope.length?'<ul style="margin:6px 0">'+item.scope.map(x=>'<li>'+esc(x)+'</li>').join(''):'')+(item.scope.length?'</ul>':'')+'<div style="font-size:10px;color:#57636b">'+esc(item.status)+'</div></section>').join(''):'';
    return '<div data-quote-internal-document="installer" style="font-family:Arial,sans-serif;padding:16px;background:#fff;color:#173247;font-size:12px">'+heading(q,'Podklad pre montáž')+
      '<p>Rozsah podľa ponuky. Tento podklad nie je potvrdením vykonanej skúšky alebo revízie.</p>'+warningHtml(data.warnings)+
      tasks('Montáž a práce',data.work)+tasks('Dohodnuté služby a skúšky',data.services)+
      '<h3 style="margin:20px 0 7px">Zariadenia a materiál</h3>'+internalTable(['Kód','Položka','Množstvo','MJ','Použitie'],data.materials.map(row=>[row.code,row.name,row.qty==null?'Doplniť':fmt(row.qty),row.unit,row.groups.join('\n')]))+
      (data.notes.length?'<h3 style="margin:20px 0 7px">Poznámky pre realizáciu</h3>'+data.notes.map(x=>'<p style="white-space:pre-wrap">'+esc(x)+'</p>').join(''):'')+'</div>';
  }
  const api={renderRows,renderTable,renderAppendix,renderCustomer,documentInfo,purchaseRows,installerModel,renderPurchase,renderInstaller};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SpektraQuoteWorkbenchOutput=api;
})(typeof window==='object'?window:globalThis);
