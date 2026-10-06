from pathlib import Path
import hashlib
p=Path('mobile-v4/app.html'); s=p.read_text()
original=p.read_bytes()
assert hashlib.sha1(b'blob '+str(len(original)).encode()+b'\0'+original).hexdigest()=='98ead24b85ddbb10aaa34a2aea7000bd983c7790'
for name,digest in {'mobile-v4/js/pdf-pagination.js':'d48e36127b5c73511c2c4d8e95d9ef8c1edc7cb2bf8c6edddcecc288254f9df9','mobile-v4/tests/pdf-pagination.cjs':'fd134fd1bbee360c616b5eb9b1fa34212ee2272a319ae14beaf935b3d8632a7a'}.items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest, name

def once(text,a,b):
    assert text.count(a)==1, (a[:100],text.count(a))
    return text.replace(a,b,1)
s=once(s,'<script src="js/pdf-banners.js?v=20261005-universal1"></script>', '<script src="js/pdf-banners.js?v=20261005-universal1"></script>\n<script src="js/pdf-pagination.js?v=20261006-a4-1"></script>')
a=s.index('function offerHtmlTechnical(){');b=s.index('function warrantyTermsHtml(){')
t=s[a:b]
t=once(t,"return '<div style=\"width:190mm;", "return '<div data-pdf-layout=\"technical\" style=\"width:190mm;")
t=once(t,"return '<div style=\"width:210mm;", "return '<div data-pdf-layout=\"presentation\" style=\"width:210mm;")
t=t.replace("'<table style=\"width:100%;", "'<table data-pdf-items style=\"width:100%;")
t=once(t,"'<div style=\"padding:5mm 7mm 64mm\">'", "'<div data-pdf-content style=\"padding:5mm 7mm 64mm\">'")
t=once(t,"'<div style=\"position:absolute;left:9mm;right:9mm;bottom:8mm;", "'<div data-pdf-footer style=\"position:absolute;left:9mm;right:9mm;bottom:8mm;")
t=once(t,"'<div style=\"position:absolute;left:7mm;right:7mm;bottom:4mm;", "'<div data-pdf-footer style=\"position:absolute;left:7mm;right:7mm;bottom:4mm;")
t=once(t,"'<div style=\"font-weight:700;font-size:10px;line-height:1.25;", "'<div data-pdf-item-name style=\"font-weight:700;font-size:10px;line-height:1.25;")
t=once(t,"'<div style=\"font-size:8.2px;color:#5c6670;", "'<div data-pdf-item-description style=\"font-size:8.2px;color:#5c6670;")
t=once(t,"'<div style=\"font-weight:800;font-size:9.8px;line-height:1.25;", "'<div data-pdf-item-name style=\"font-weight:800;font-size:9.8px;line-height:1.25;")
t=once(t,"'<div style=\"font-size:7.9px;color:#617383;", "'<div data-pdf-item-description style=\"font-size:7.9px;color:#617383;")
# The attributes only affect the new trade PDF render copies; existing templates keep their styles.
t=once(t,"'<div style=\"margin-top:14px;padding:10px 12px;background:#f6f6f6;border-left:3px solid #c20000\">'", "'<div data-pdf-note style=\"margin-top:14px;padding:10px 12px;background:#f6f6f6;border-left:3px solid #c20000\">'")
t=once(t,"'<div style=\"margin-top:4mm;padding:3mm;background:#f8fafb;border-left:2px solid #c20000;font-size:8px\">'", "'<div data-pdf-note style=\"margin-top:4mm;padding:3mm;background:#f8fafb;border-left:2px solid #c20000;font-size:8px\">'")
t=once(t,"'<div style=\"margin-top:16px\"><div style=\"font-weight:700;margin-bottom:6px\">Fotografie", "'<div data-pdf-gallery style=\"margin-top:16px\"><div style=\"font-weight:700;margin-bottom:6px\">Fotografie")
t=once(t,"'<div style=\"display:flex;justify-content:flex-end;margin-top:12px\">'", "'<div data-pdf-totals style=\"display:flex;justify-content:flex-end;margin-top:12px\">'")
t=once(t,"'<div style=\"display:grid;grid-template-columns:1.15fr .85fr;gap:4mm;margin-top:4mm\">'", "'<div data-pdf-totals style=\"display:grid;grid-template-columns:1.15fr .85fr;gap:4mm;margin-top:4mm\">'")
s=s[:a]+t+s[b:]
s=once(s,"  holder.innerHTML=offerHtml();\n  document.body.appendChild(holder);", "  holder.innerHTML=offerHtml();\n  const paginateTradeOffer=isTradeQuote(current);\n  const pdfIdentity={quoteNo:current.quote_no||'',customerName:current.customer?.name||''};\n  document.body.appendChild(holder);")
s=once(s,"    if(!root)throw new Error('Chýba obsah ponuky.');", """    if(!root)throw new Error('Chýba obsah ponuky.');

    // Trade offers may contain dozens of individually visible stock rows.
    // Build separate A4 DOM pages before rasterizing; never shrink the long list.
    if(paginateTradeOffer){
      if(!window.SpektraPdfPagination)throw new Error('Stránkovanie PDF sa nenačítalo. Obnovte aplikáciu.');
      await inlineImagesForPdf(root);
      await SpektraPdfPagination.waitForAssets(root);
      const prepared=SpektraPdfPagination.prepare(root,pdfIdentity);
      try{
        const pdf=await SpektraPdfPagination.render(prepared,{html2canvas:window.html2canvas,jsPDF:window.jspdf.jsPDF});
        return new File([pdf.output('blob')],(pdfIdentity.quoteNo||'cenova-ponuka')+'.pdf',{type:'application/pdf'});
      }finally{prepared.dispose();}
    }""")
p.write_text(s)
assert hashlib.sha256(p.read_bytes()).hexdigest()=='0fa59baf9c5826042da2e63666e59d6c83761654179b2112da71d98c06a521ac'
for name in ['index.html','mobile-v4/index.html']:
 p=Path(name);t=p.read_text();t=t.replace('20261005-universal1','20261006-a4-1');p.write_text(t)
print('Applied and verified A4 pagination integration')
