from pathlib import Path
import base64
import hashlib

app=Path('mobile-v4/app.html')
assert hashlib.sha256(app.read_bytes()).hexdigest()=='2dc1d1e1a09b7aa66c4065c7924605cfe844936090c045388a1a024f9d2f839c', 'Source changed; rebase and review before integration'
parts=[Path('.github/banner-transfer')/f'{n:02}.b64' for n in range(4)]
encoded=''.join(p.read_text().strip() for p in parts)
asset=base64.b64decode(encoded,validate=True)
assert hashlib.sha256(asset).hexdigest()=='2bd40d561d7d108906129ae11f700e3c5974af53f569f42542565d4be367ab33', 'Approved image transfer checksum mismatch'
assert len(asset)==42144
Path('mobile-v4/assets/pdf-banners/default-offer.webp').write_bytes(asset)
s=app.read_text()
needle='<script src="js/quote-list-summary.js?v=20261005-list1"></script>'
assert s.count(needle)==1
s=s.replace(needle,needle+'\n<script src="js/pdf-banners.js?v=20261005-universal1"></script>')
a=s.index('function getPdfBannerType(){');b=s.index('function absolutePdfUrl',a)
s=s[:a]+"function getPdfBannerType(){\n  return SpektraPdfBanners.type(current||{});\n}\n"+s[b:]
a=s.index('function getPdfBannerUrl(){');b=s.index('function pdfPresentationSubtitle',a)
s=s[:a]+"function getPdfBannerUrl(){\n  ensurePdfTemplateState();\n  return absolutePdfUrl(SpektraPdfBanners.select(current||{},pdfBannerCatalog).url);\n}\n"+s[b:]
needle="    : '<div style=\"height:58mm;position:relative;overflow:hidden;background:#eaf4f9\">'+"
assert s.count(needle)==1
s=s.replace(needle,"    : SpektraPdfBanners.isUniversal(bannerUrl)\n      ? SpektraPdfBanners.artworkHtml(bannerUrl)\n      : '<div style=\"height:58mm;position:relative;overflow:hidden;background:#eaf4f9\">'+")
needle="      console.warn('PDF image inline failed',src,e);"
assert s.count(needle)==1
s=s.replace(needle,"      if(img.closest('[data-pdf-banner=\"universal\"]')){\n        throw new Error('Univerzálny banner sa nenačítal. Skontrolujte pripojenie a obnovte aplikáciu.');\n      }\n"+needle)
app.write_text(s)
for path in ['index.html','mobile-v4/index.html']:
    p=Path(path);s=p.read_text();assert s.count('20261005-list1')==2
    p.write_text(s.replace('20261005-list1','20261005-universal1'))
Path('mobile-v4/assets/pdf-banners/README.md').write_text('''# Presentation PDF headers

Automatic selection is defined by `js/pdf-banners.js` and used by `getPdfBannerUrl()`.

- `heatpump.jpg`: heat pumps (existing banner unchanged).
- `airconditioning.jpg`: air conditioners (existing banner unchanged).
- `gas-boiler.jpg`: gas boilers (existing banner unchanged).
- `biomass.jpg`: pellet / biomass boilers (existing banner unchanged).
- `default-offer.webp`: user-approved universal artwork, 1500 × 500 (3:1), optimized from the supplied 2172 × 724 PNG. Includes the SPEKTRA INSTALL logo and the exact approved wording: **Riešenie na mieru** / **Vykurovanie · úsporné · overené**.

The universal image is used for ZTI, floor heating, ventilation, water heaters, other work, electric boilers and unrecognized categories without a category-specific banner. A product thumbnail does not replace the offer header. User-selected custom banners and explicit `none` always take priority. Existing Supabase `pdf_banners` category overrides are preserved.

The universal image is a finished composition, rendered once at full 3:1 aspect ratio without an extra logo, slogan or gradient over it. Existing photographic headers keep their original HTML overlay and layout. Technical PDF layout is intentionally unchanged. Failure to load the bundled universal image stops PDF creation with a visible retry message.

No quote, stock, database permissions, prices, signatures, or archived PDF files are rewritten by this display-only change. Asset is served locally with the application; Canva or expiring external URLs are not runtime dependencies.
''')
print('Verified approved banner bytes; integrated display-only fallback.')
