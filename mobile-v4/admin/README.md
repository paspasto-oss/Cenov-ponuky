# Admin – Aktualizácia zásob

Otvoriť `stock-sync.html`.

## Nákupné ceny z XML

Import načíta `stockHeader/purchasingPrice` ako nákupnú cenu bez DPH.
Ak nie je kladná, skúsi kompatibilné polia `purchasePrice`, `buyPrice`,
`purchasePriceWithoutVat` a nakoniec kladnú `weightedPurchasePrice`.
Poradie polí v XML nemá vplyv na výber. Nulová vážená cena neprekryje
vyplnenú nákupnú cenu; ak všetky ceny chýbajú alebo sú nulové, náklad
zostane nevyplnený.

Po oprave importu treba obnoviť stránku aktualizácie zásob, znova nahrať
aktuálny XML export a stlačiť **Použiť aktualizáciu**. V rozpracovanej ponuke
potom použiť **Načítať aktuálne ceny z POHODY**. Ručné úpravy cien a nákladov
v ponuke zostávajú zachované.

Funkčný MVP:
- načíta POHODA export Zásoby.xlsx priamo v prehliadači,
- normalizuje hlavičky,
- zlúči opakované riadky rovnakého produktu,
- rozpozná konfliktné duplikáty,
- porovná nový export s posledným baseline,
- ukáže nové produkty, zmenené ceny, zmeny skladového stavu, metadata a deaktivované produkty,
- až po potvrdení uloží nový baseline,
- vie exportovať normalizovaný JSON.

Aktuálne sa baseline ukladá lokálne do prehliadača. Po pripojení Supabase/POHODA bridge sa rovnaká obrazovka napojí na `stock_sync_runs`, `stock_sync_staging` a `pohoda_stocks`.

Poznámka: XLSX parser je zatiaľ načítaný cez SheetJS CDN. Pre PWA/offline produkciu ho neskôr zabalíme lokálne.

## Týždenná aktualizácia a schválené ponuky

Po nahratí aktuálneho exportu a potvrdení **Použiť aktualizáciu** sa
v katalógu aktualizujú názvy, nákupné/predajné ceny a ostatné importované
údaje. Nové ponuky používajú aktuálny katalóg. Rozpracované ponuky možno
obnoviť tlačidlom **Načítať aktuálne ceny z POHODY**.

Schválená ponuka používa uložené názvy položiek, množstvá, ceny, náklady,
sadzbu DPH a celkovú sumu. Otvára sa v zobrazení pre zákazníka; prepočet
z katalógu a cenové úpravy sú zablokované. Pri otvorení ani pri tvorbe PDF
sa do starších schválených ponúk nedopĺňa montáž a neprepočítavajú sa
uložené sumy. Zdieľanie nemení stav schválenej ponuky na odoslanú.
Pre nové ceny vytvoriť novú ponuku.

Regresné testy: `node --test mobile-v4/tests/approved-price-lock.cjs`.
