# Split TČ do 5 m – pracovný BOM

Monoblok je považovaný za uzavretý základ. Pre split používame rovnakú vnútornú hydrauliku, TÚV balík a spoločný elektrobalík, ale bez:
- nezamŕzavých ventilov,
- vonkajšieho vodného Cu potrubia D28,
- vonkajšej izolácie vodného potrubia.

Namiesto toho split dostane modelovo závislú chladivovú trasu:
- kvapalinové Cu potrubie – 5 m,
- plynové Cu potrubie – 5 m,
- izolácia oboch vetiev – 10 m,
- prepojovací/komunikačný kábel – štandardne 10 m, presný typ podľa výrobcu,
- kondenzát podľa dispozície.

## Už namapované spoločné položky
Hydraulické komponenty a TÚV armatúry sú prevzaté z monoblokového štandardu s rovnakými POHODA kódmi.

## Čo doplníme po novom exporte Zásob
Po vytvorení chýbajúcich skladových kariet v POHODE a nahratí nového `Zásoby.xlsx` sa domapujú:
1. Cu chladivové potrubia podľa priemerov/modelov,
2. izolácie chladivových potrubí,
3. komunikačné/prepojovacie káble,
4. odvod kondenzátu,
5. služba Montáž split TČ do 5 m,
6. prípadné ďalšie modelovo špecifické elektro položky.

Spoločný `hp_electrical_standard` sa už automaticky pridáva ku každému TČ.


## Doplnenie splitového štandardu

- Chladivová trasa sa pre cenotvorbu štandardizuje na **predizolované Cu 3/8\" x 5/8\" – 5 m**, POHODA kód `2RGC2GRE#GC075AE100`, PLU `104991`. Pri menších modeloch je zámerne ponechaná cenová rezerva.
- Prestup cez stenu: **Ø80 mm, hrúbka steny do 50 cm – 1 súb.**. Vytvoriť samostatnú službu v POHODE.
- Pri externom zásobníku TÚV sa do splitu aj monobloku pridá **prepínací ventil + servo**.
- Aktuálni kandidáti z POHODY: ventil `601072` (WZP3-25M) + servo `415001` (SL 10 230 V / 120 s). Pred ostrým použitím potvrdiť ich vzájomnú kompatibilitu; po novom exporte zásob môžeme mapovanie zmeniť bez zásahu do starých ponúk.
