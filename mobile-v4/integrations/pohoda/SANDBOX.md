# Testovacia synchronizácia – fáza 1

Vetva `test/pohoda-sync` vznikla z `5999eafd05153049380f91a9c1928850c60fa171`.
Je to celá kópia kódu v samostatnej vetve, nie kópia produkčnej databázy.
Cloudová konfigurácia je prázdna a SpektraDB odmieta cloudové pripojenie.
Ponuky, obhliadky a IndexedDB majú oddelené názvy. CSP blokuje externé dátové spojenia.
Žiadne migrácie sa nespúšťajú a existujúce dáta sa automaticky nekopírujú.

## Čo funguje
- Testovacia aplikácia s lokálnymi dátami a označením TEST.
- XML snímka ponuky v samostatnej lokálnej fronte, bez zmeny pôvodnej ponuky.
- Prevencia opakovaného zaradenia rovnakého XML v jednej testovacej fronte.
- Simulácia úspechu/chyby a opakovanie po chybe.
- Náhľad XML zásob bez zápisu do katalógu.

Simulovaný úspech nie je potvrdenie POHODY. Fronta zatiaľ nie je cloudová,
nepoužíva mServer a negarantuje deduplikáciu medzi zariadeniami.
XML generátor treba overiť na aktuálnej SK schéme a skúšobným importom.

## Ďalšia fáza vyžaduje
1. Variant a verziu POHODY a dostupnosť Windows PC.
2. Kópiu účtovnej jednotky POHODY zo zálohy, mServer a lokálny účet.
   Heslá sa nastavujú na PC; nepatria do repozitára ani prehliadača.
3. Samostatnú Supabase databázu. Pred vytvorením plateného prostredia overiť
   a potvrdiť cenu; teraz žiadne platené prostredie nevzniklo.
4. Aktuálny úplný XML export zásob a jednej vydanej ponuky z konkrétnej SK verzie.
5. Windows bridge s odchádzajúcim spojením do testovacieho backendu a lokálnym mServerom.
6. Serverovú frontu s unikátnou identitou ponuka/verzia, prenájmom úlohy,
   kontrolou responsePack po položkách a stavom unknown pri strate odpovede.
   Po timeoute neopakovať import slepo: overiť, či doklad už vznikol.

## Prechod na ostrú prevádzku
Nezlučovať celú testovaciu vetvu do main: obsahuje vypnutú konfiguráciu.
Preniesť len overený modul samostatným PR a znovu overiť aktuálny main.
Nikdy nekopírovať testovaciu databázu cez produkčnú.
Pred nasadením: záloha, kontrola cien/DPH/kódov/skladov, test výpadku a duplicít,
kontrola cenových snímok starých ponúk a plán návratu.
