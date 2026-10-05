# Presentation PDF headers

Automatic selection is defined by `js/pdf-banners.js` and used by `getPdfBannerUrl()`.

- `heatpump.jpg`: heat pumps (existing banner unchanged).
- `airconditioning.jpg`: air conditioners (existing banner unchanged).
- `gas-boiler.jpg`: gas boilers (existing banner unchanged).
- `biomass.jpg`: pellet / biomass boilers (existing banner unchanged).
- `default-offer.webp`: user-approved universal artwork, 1500 × 500 (3:1), optimized from the supplied 2172 × 724 PNG. Includes the SPEKTRA INSTALL logo and the exact approved wording: **Riešenie na mieru** / **Vykurovanie · úsporné · overené**.

The universal image is used for ZTI, floor heating, ventilation, water heaters, other work, electric boilers and unrecognized categories without a category-specific banner. A product thumbnail does not replace the offer header. User-selected custom banners and explicit `none` always take priority. Existing Supabase `pdf_banners` category overrides are preserved.

The universal image is a finished composition, rendered once at full 3:1 aspect ratio without an extra logo, slogan or gradient over it. Existing photographic headers keep their original HTML overlay and layout. Technical PDF layout is intentionally unchanged. Failure to load the bundled universal image stops PDF creation with a visible retry message.

No quote, stock, database permissions, prices, signatures, or archived PDF files are rewritten by this display-only change. Asset is served locally with the application; Canva or expiring external URLs are not runtime dependencies.
