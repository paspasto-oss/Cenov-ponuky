# Admin – Aktualizácia zásob

Otvoriť `stock-sync.html`.

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
