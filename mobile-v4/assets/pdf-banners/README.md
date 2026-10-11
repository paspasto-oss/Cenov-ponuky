# Presentation PDF headers

Automatic selection is defined by `js/pdf-banners.js` and used by `getPdfBannerUrl()`.

- `heatpump.jpg`: heat pumps (existing banner unchanged).
- `airconditioning.jpg`: air conditioners (existing banner unchanged).
- `gas-boiler.jpg`: gas boilers (existing banner unchanged).
- `biomass.jpg`: pellet / biomass boilers (existing banner unchanged).
- `default-offer.webp`: user-approved universal artwork, 1500 × 500 (3:1), optimized from the supplied 2172 × 724 PNG. Includes the SPEKTRA INSTALL logo and the exact approved wording: **Riešenie na mieru** / **Vykurovanie · úsporné · overené**.

New original illustrative installation images (built-in imagegen, 2026-10-11), stored locally as JPEG:

- `zti.jpg`: domestic water and waste plumbing (`zti`).
- `floor-heating.jpg`: hydronic underfloor heating (`floor_heating`).
- `stainless-pipes.jpg`: stainless press-fit pipe distribution (`stainless_pipes`, `stainless_piping`, or `trade_type=stainless_pipes`). ZTI/other offers also recognize explicit stainless pipe/distribution names in offer titles, assembly groups or rows. Incidental stainless filters do not trigger this banner.
- `water-heater.jpg`: domestic hot water storage heater (`water_heater`).
- `recovery.jpg`: local decentralized heat recovery (`recovery`).

Generation prompt set: professional photorealistic technical installation, wide 3:1 composition, main installation on the right, quiet pale space on the left for the existing logo and headline, white/gray/silver/black with restrained red accents, no generated text/logos/people. Subjects: bathroom water and waste plumbing; red pipe loops on gray floor panels and manifold; stainless press fittings and valves; white cylindrical hot water storage heater; local wall ventilation unit with illustrative through-wall exchanger cutaway. These are illustrative scenes, not installation plans or specific manufacturer products.

The universal image is used for other work, electric boilers and unrecognized categories without a category-specific banner. A product thumbnail does not replace the offer header. User-selected custom banners and explicit `none` always take priority. Existing Supabase `pdf_banners` category overrides are preserved.

The universal image is a finished composition, rendered once at full 3:1 aspect ratio without an extra logo, slogan or gradient over it. Existing photographic headers keep their original HTML overlay and layout. Technical PDF layout is intentionally unchanged. Failure to load the bundled universal image stops PDF creation with a visible retry message.

No quote, stock, database permissions, prices, signatures, or archived PDF files are rewritten by this display-only change. Asset is served locally with the application; Canva or expiring external URLs are not runtime dependencies.

Validation (2026-10-11): all 317 Node tests passed, including local asset signatures, category selection, overrides, no-banner mode, stainless discrimination and actual presentation-header HTML/labels. All five actual header fragments were rendered at A4 size using WeasyPrint and visually reviewed after PDF rasterization. Full browser/html2canvas export was not exercised: Chromium was unavailable and its download failed in this environment. Existing PDF pagination tests passed. The four existing photos and universal WebP remain byte-for-byte unchanged.
