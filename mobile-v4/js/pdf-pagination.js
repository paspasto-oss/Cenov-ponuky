/* A4 pagination for inspection/trade offers. Works on detached render copies only:
 * saved rows, prices, signatures and the quote outbox are never modified here. */
(function(root){
  'use strict';
  const WIDTH=210, HEIGHT=297, SCALE=2;
  const stylesheet=`
    .quotePdfPage{box-sizing:border-box!important;width:210mm!important;height:297mm!important;
      padding:9mm 10mm 22mm!important;margin:0!important;position:relative!important;
      color:#173247;background:#fff;font-family:Arial,sans-serif;font-size:11px;line-height:1.4;}
    .quotePdfBody{height:266mm;display:flow-root;overflow:visible;overflow-wrap:anywhere;}
    .quotePdfPage table[data-pdf-items]{table-layout:fixed!important;width:100%!important;
      border-collapse:collapse!important;border-radius:0!important;font-size:11px!important;}
    .quotePdfPage table[data-pdf-items] th{font-size:10.5px!important;line-height:1.3!important;}
    .quotePdfPage table[data-pdf-items] td:not(:first-child){font-size:11px!important;white-space:nowrap;}
    .quotePdfPage [data-pdf-item-name]{font-size:12px!important;line-height:1.35!important;}
    .quotePdfPage [data-pdf-item-description]{font-size:10px!important;line-height:1.4!important;}
    .quotePdfPage td:first-child>div>div{min-width:0;overflow-wrap:anywhere;}
    .quotePdfPage [data-pdf-note]{font-size:11px!important;white-space:pre-wrap;}
    .quotePdfFooter{position:absolute;left:10mm;right:10mm;bottom:5mm;height:12mm;
      display:flex;align-items:end;gap:4mm;border-top:1px solid #9eb8ca;padding-top:2mm;}
    .quotePdfFooterContent{flex:1;min-width:0;font-size:8px;}
    .quotePdfFolio{font-size:9px;white-space:nowrap;color:#516474;}
    .quotePdfContinuation{display:flex;justify-content:space-between;gap:8mm;align-items:start;
      border-bottom:2px solid #00539b;padding-bottom:3mm;margin-bottom:5mm;font-size:11px;}
    .quotePdfContinuation strong{display:block;font-size:14px;color:#00539b;}
    @media print{.quotePdfPage{break-after:page;}.quotePdfPage:last-child{break-after:auto;}}
  `;

  async function waitForAssets(node){
    if(node.ownerDocument.fonts)await node.ownerDocument.fonts.ready;
    await Promise.all([...node.querySelectorAll('img')].map(img=>new Promise(resolve=>{
      if(img.complete){resolve();return;}
      let timer;const done=()=>{clearTimeout(timer);img.removeEventListener('load',done);img.removeEventListener('error',done);resolve();};
      img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true});timer=setTimeout(done,3000);
    })));
  }
  function structure(source){
    const layout=source.getAttribute('data-pdf-layout');
    const table=source.querySelector('table[data-pdf-items]');
    const footer=source.querySelector('[data-pdf-footer]');
    if(!table||!footer||!['technical','presentation'].includes(layout))throw Error('Šablóna ponuky nie je pripravená na stránkovanie. Obnovte aplikáciu.');
    const content=layout==='presentation'?source.querySelector('[data-pdf-content]'):source;
    const children=[...content.children],idx=children.indexOf(table);
    if(idx<0)throw Error('V šablóne chýba tabuľka položiek.');
    const header=children.slice(0,idx);
    if(layout==='presentation')header.unshift(...[...source.children].slice(0,[...source.children].indexOf(content)));
    const after=children.slice(idx+1).filter(n=>n!==footer);
    let footerContent=footer;
    if(layout==='presentation'){
      after.push(...[...footer.children].slice(0,-1));
      footerContent=footer.lastElementChild;
    }
    return {layout,table,header,after,footer:footerContent};
  }

  function prepare(source,meta={}){
    const doc=source.ownerDocument,s=structure(source),pages=[];
    const stage=doc.createElement('div');stage.setAttribute('data-pdf-pagination-stage','');
    stage.style.cssText='position:fixed;left:0;top:0;width:210mm;z-index:-2147483000;pointer-events:none;background:#fff;';
    const style=doc.createElement('style');style.textContent=stylesheet;stage.appendChild(style);
    doc.body.appendChild(stage);
    let page,body,activeTable,activeTbody,used=0;
    const hasContent=()=>used>0;
    const fits=()=>body.scrollHeight<=body.clientHeight+1&&body.scrollWidth<=body.clientWidth+1;
    const fail=text=>{throw Error(text);};
    function newPage(first=false){
      if(pages.length>=200)fail('Ponuka prekročila 200 strán A4. Rozdeľte ju na samostatné ponuky.');
      page=doc.createElement('div');page.className='quotePdfPage';page.setAttribute('data-pdf-page',String(pages.length+1));
      body=doc.createElement('div');body.className='quotePdfBody';page.appendChild(body);
      const foot=doc.createElement('div');foot.className='quotePdfFooter';
      const footContent=s.footer.cloneNode(true);footContent.removeAttribute('data-pdf-footer');
      footContent.style.position='static';footContent.style.margin='0';footContent.style.padding='0';
      footContent.style.border='0';footContent.style.width='100%';
      const wrap=doc.createElement('div');wrap.className='quotePdfFooterContent';wrap.appendChild(footContent);
      const folio=doc.createElement('div');folio.className='quotePdfFolio';foot.append(wrap,folio);page.appendChild(foot);
      stage.appendChild(page);pages.push(page);activeTable=null;activeTbody=null;used=0;
      if(!first){
        const head=doc.createElement('div');head.className='quotePdfContinuation';
        const left=doc.createElement('div'),title=doc.createElement('strong');title.textContent='Cenová ponuka – pokračovanie';
        const name=doc.createElement('div');name.textContent=String(meta.customerName||'');left.append(title,name);
        const right=doc.createElement('div');right.textContent=String(meta.quoteNo||'');head.append(left,right);body.appendChild(head);
        if(!fits())fail('Údaje zákazníka sú príliš dlhé pre hlavičku A4.');
      }
    }
    function addPlain(node){body.appendChild(node);activeTable=null;activeTbody=null;}
    // Oversized text notes are split at word boundaries, not by clipping a canvas.
    function splitText(node){
      const tokens=(node.textContent||'').match(/\S+\s*|\s+/g)||[];
      let start=0;
      while(start<tokens.length){
        const piece=node.cloneNode(false);addPlain(piece);
        let lo=0,hi=tokens.length-start;
        while(lo<hi){const mid=Math.ceil((lo+hi)/2);piece.textContent=tokens.slice(start,start+mid).join('');if(fits())lo=mid;else hi=mid-1;}
        if(lo===0){piece.remove();fail('Text poznámky sa nedá bezpečne rozdeliť na A4. Skráťte neprerušovaný text.');}
        piece.textContent=tokens.slice(start,start+lo).join('');start+=lo;used++;
        if(start<tokens.length)newPage();
      }
    }
    function appendBlock(original,depth=0){
      if(depth>8)fail('Blok ponuky sa nedá bezpečne rozdeliť na A4. Skráťte jeho opis.');
      const node=original.cloneNode(true);addPlain(node);
      if(fits()){used++;return;}
      node.remove();
      if(hasContent())newPage();
      addPlain(node);
      if(fits()){used++;return;}
      node.remove();
      if(!node.children.length){splitText(node);return;}
      // Split exceptionally long scopes/galleries into whole semantic children.
      const list=node.querySelector(':scope > ul');
      const gallery=node.matches('[data-pdf-gallery]')?node.lastElementChild:null;
      if(list||gallery){
        const container=list||gallery;
        for(const child of container.children){
          const section=node.cloneNode(false);
          for(const heading of node.children){if(heading===container)break;section.appendChild(heading.cloneNode(true));}
          const part=container.cloneNode(false);part.style.display='block';part.appendChild(child.cloneNode(true));section.appendChild(part);
          // A single item that is still too long becomes a text continuation.
          if(child.textContent.length>4000&&!child.querySelector('img')){section.textContent=node.firstElementChild.textContent+'\n'+child.textContent;}
          appendBlock(section,depth+1);
        }
        return;
      }
      // A grid of supplementary sections can flow one complete column at a time.
      if(node.children.length>1){for(const child of node.children)appendBlock(child,depth+1);return;}
      if(node.querySelector('img'))fail('Fotografia alebo blok je vyšší než strana A4. Zmenšite prílohu.');
      const text=node.cloneNode(false);text.textContent=node.textContent;splitText(text);
    }
    function tableForPage(){
      if(activeTable)return;
      activeTable=s.table.cloneNode(true);
      activeTable.querySelectorAll('tbody,tfoot,colgroup').forEach(n=>n.remove());
      const widths=s.layout==='technical'?[45,11,14,14,16]:[52,12,18,18];
      const cols=doc.createElement('colgroup');
      widths.forEach(w=>{const c=doc.createElement('col');c.style.width=w+'%';cols.appendChild(c);});
      activeTable.prepend(cols);activeTable.querySelectorAll('th').forEach(th=>th.style.width='auto');
      activeTbody=doc.createElement('tbody');activeTable.appendChild(activeTbody);body.appendChild(activeTable);
    }
    function appendRow(original,index){
      tableForPage();const row=original.cloneNode(true);row.setAttribute('data-pdf-row-index',String(index));activeTbody.appendChild(row);
      if(fits()){used++;return;}
      row.remove();if(!activeTbody.children.length)activeTable.remove();
      newPage();tableForPage();activeTbody.appendChild(row);
      if(!fits())fail('Položka „'+original.cells[0].textContent.trim().slice(0,100)+'“ je vyššia než strana A4. Skráťte jej názov alebo opis.');
      used++;
    }
    try{
      newPage(true);s.header.forEach(n=>appendBlock(n));
      const rows=[...s.table.tBodies].flatMap(b=>[...b.rows]);rows.forEach(appendRow);
      s.after.forEach(n=>appendBlock(n));
      pages.forEach((p,i)=>{p.querySelector('.quotePdfFolio').textContent='Strana '+(i+1)+' / '+pages.length;});
      return {stage,pages,dispose:()=>stage.remove()};
    }catch(e){stage.remove();throw e;}
  }

  async function render(prepared,{html2canvas,jsPDF}){
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
    const {pages}=prepared;
    pages.forEach(p=>p.style.display='none');
    for(let n=0;n<pages.length;n++){
      const page=pages[n];page.style.display='block';await waitForAssets(page);
      const rect=page.getBoundingClientRect(),scaleMm=WIDTH/rect.width;
      const links=[...page.querySelectorAll('a[data-pdf-link]')].map(a=>{
        const r=a.getBoundingClientRect();return {url:a.href,x:(r.left-rect.left)*scaleMm,y:(r.top-rect.top)*scaleMm,w:r.width*scaleMm,h:r.height*scaleMm};
      }).filter(l=>l.w>0&&l.h>0&&/^https?:\/\//i.test(l.url));
      const canvas=await html2canvas(page,{scale:SCALE,useCORS:false,allowTaint:false,backgroundColor:'#fff',logging:false,
        imageTimeout:3000,scrollX:0,scrollY:0,width:Math.ceil(rect.width),height:Math.ceil(rect.height),
        windowWidth:Math.ceil(rect.width),windowHeight:Math.ceil(rect.height)});
      if(!canvas.width||!canvas.height)throw Error('Nepodarilo sa vykresliť stranu '+(n+1)+'.');
      if(n)pdf.addPage('a4','portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg',0.94),'JPEG',0,0,WIDTH,HEIGHT,undefined,'FAST');
      links.forEach(l=>pdf.link(l.x,l.y,l.w,l.h,{url:l.url}));
      // Release each A4 canvas before rendering the next one (important on phones).
      canvas.width=1;canvas.height=1;page.style.display='none';
    }
    if(pdf.internal.getNumberOfPages()!==pages.length)throw Error('Počet strán PDF nesúhlasí so stránkovaním.');
    return pdf;
  }
  const api={prepare,render,waitForAssets,structure,width:WIDTH,height:HEIGHT};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.SpektraPdfPagination=api;
})(typeof window!=='undefined'?window:globalThis);
