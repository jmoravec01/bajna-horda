# Bájná horda — spec v0.1 (pracovní název)

Pixel-art survivor hra pro mobil v prohlížeči (inspirace: Survivor.io). Ovládání jedním palcem, útoky automaticky.

## 1. Jádro hry (jeden run)
- Pohled shora, na výšku (180×320 logických pixelů, nearest-neighbour upscale). Virtuální joystick vlevo dole / klávesy WASD na PC.
- Hráč se hýbe, zbraně střílejí samy. Příšery se valí v vlnách ze všech stran, padají XP krystaly, mince, srdíčka (heal), magnet.
- Level-up v runu → vyber 1 ze 3 vylepšení (zbraň nebo pasivka). Max 5 zbraní + 5 pasivek, každá lvl 1–8.
- Run = 8 minut, na konci boss. Smrt = run končí, odměna se vyplatí zkrácená (50 %).
- Zbraně (MVP 6): vrhací nože, rotující čepele, šoková vlna, blesk (řetěz), bumerang, ohnivá bomba.
- Pasivky (MVP 6): max HP, rychlost, poškození, rychlost útoku, dosah sběru, bonus XP.

## 2. Dva režimy, každý má vlastní dungeony
| | Single | Multiplayer (co-op) |
|---|---|---|
| Dungeony | 3: Louka → Krypta → Sopka | 3: Jeskyně → Bažina → Ledovec |
| Postup | odemykáš dungeony postupně dokončením předchozího | stejně, ale **samostatný postup** |
| Speciál | rostoucí obtížnost, boss na konci | větší hordy, 2 bossové, oživení spoluhráče (stůj u něj 3 s) |
| Hráči | 1 | 1–6 |

## 3. Společná postava (propojuje oba režimy)
- Jeden účet = až 8 postav, hraje se vždy za jednu aktivní (viz 3b). **Level a výbava jsou na postavě, platí pro Single i Multiplayer; mince jsou společné pro účet.**
- Grind v Singlu → silnější postava → pomůžeš kamarádovi v multiplayeru. A obráceně.
- Zkušenosti za run → level postavy (zvyšuje základní HP a poškození).
- Výbava: 4 sloty (zbraň, brnění, prsten, boty), každý level 1–20, upgrade za mince. Žádný gacha, žádné platby.
- Výchozí zbraň runu se dá vybrat z odemčených (nové zbraně odemykáš level-upem postavy).

## 3b. Postavy a třídy
**Více postav, hraje se jen za jednu**
- Účet má až **8 slotů na postavy** (číslo jde změnit). Každá postava má jméno, třídu, vlastní level, výbavu a talenty. Stejnou třídu lze mít vícekrát.
- Mince jsou společné pro celý účet; výbava a level jsou na postavě.
- V jednu chvíli je **aktivní jedna postava**. Vybíráš ji na obrazovce postav mezi runy, platí pro Single i Multiplayer. Během runu ani v místnosti se nepřepíná.
- Server drží jedno aktivní spojení na účet: druhé zařízení se stejným účtem starší spojení odpojí (nejde hrát za dvě postavy najednou).
- Smazání postavy je nevratné (potvrzení, výbava se nevrací, mince zůstávají).

**Třídy (12, všechny ze slovanských a českých pověstí, všechny odemčené od začátku; změna jde později)**

| Třída | Role | Start. zbraň | Bonus (typ) |
|---|---|---|---|
| Krakonoš | tank, pán hor | otáčivá hůl (čepele) | −15 % příchozího poškození, HP ↑↑, rychlost ↓ (**obrana**) |
| Zbojník | rychlý, na dálku | házené valašky (nože) | +20 % rychlost, šance na krit, HP ↓ (**mobilita**) |
| Perun | hromovládce, podpora | řetězový blesk | léčí spoluhráče v dosahu, +dosah sběru (**podpora**) |
| Čert | skleněné dělo | pekelná bomba | +25 % poškození, ohnivý DoT, ztrácí HP za sílu (**riziko**) |
| Bohatýr | univerzál | kyj s rázem | +20 % XP z krystalů, vyrovnané staty (**růst**) |
| Vědma | léčitelka, jed | jedový oblak | regenerace HP 1/s, bylinky padají častěji (**přežití**) |
| Hastrman | kontrola | vodní louže | louže zpomalují příšery o 40 %, +10 % rychlost ve vodě (**kontrola**) |
| Polednice | časem sílí | polední kruh (AoE) | poškození roste s časem runu až o +60 %, v prvních 2 min slabá (**škálování**) |
| Golem | tank | kamenná pěst (odražení) | HP ↑↑↑, odolnost vůči odhození, rychlost ↓↓ (**odolnost**) |
| Rarášek | šejdíř | kouzelná čepice (blink) | 15 % úhyb, +30 % mincí, blikne při zásahu (**ekonomika**) |
| Morana | zima | ledová tříšť | zmrazí nepřátele (2 s každých 10 s), slabší poškození (**omráčení**) |
| Bába Jaga | přivolávání | chaloupka na kuřích nožkách (věž) | 1 pomocník navíc, vlastní útok jen slabý (**spojenci**) |

- Každá třída má 4 talenty (odemykají se levelem postavy 5/10/15/20).
- Různorodá skupina je silnější (tank + léčitel + kontrola), takže multiplayer se hraje jinak než single.
- Třídy jsou data (`shared/classes.js`); nová třída = záznam + sprite, bez zásahu do enginu.
- Další nápady na později: Divoženka, Svatovít, Veles, Libuše (věštkyně), Dalibor (houslista, bard); sever (Berserkr, Skald, Völva, Valkýra) a Egypt (Medjay, Thothův písař, Sachmetina kněžka) z dřívějška.

## 4. Multiplayer
- Každý hráč má **vlastní místnost** (kód 5 znaků + odkaz `#/room/KOD`). Kamarádi se připojí, hrají tvůj dungeon (ten, který máš ty odemčený). Host si vybere dungeon a spustí run. Kdokoli může odejít kdykoli.
- Real-time, server je autorita, WebSocket: klient posílá směr pohybu (20 Hz), server simuluje a posílá snapshoty (10 Hz) jen z okolí hráče; klient predikuje svého hráče a ostatní interpoluje.
- **Škálování obtížnosti** — „level 1 s level 100 je těžší než level 1 s level 20“:
  `threat = nejvyšší power ve skupině × (1 + 0,25 × (počet hráčů − 1))`
  `power = f(level postavy, úroveň výbavy)`. HP a poškození příšer i jejich počet rostou s `threat`, ne s power jednotlivce. Slabý hráč ve skupině se silným tedy dostane těžší hru.
- Vyrovnání: odměna (XP + mince) roste se `threat` → „nosený“ slabý hráč dostane násobek odměny, takže mu to za to stojí.
- Hráči nemají friendly fire; mince jsou každému vlastní, XP krystaly sdílené v dosahu.

## 4b. Účty a ukládání
- Přezdívka + heslo (bez e-mailu). Postup (postava, výbava, mince, postup po dungeonech) je na serveru.
- Host (bez účtu): Single hratelný hned, postup se ukládá jen do prohlížeče. Po registraci se nahraje. Multiplayer jen s účtem nebo s hostovskou přezdívkou bez uložení.
- Single: výsledek runu posílá klient, server ho jen sanity-checkuje (limity mincí/XP za minutu). Plná replay-verifikace není v MVP (hra je soukromá pro přátele).

## 5. Technika
- Klient: vanilla ES moduly + `<canvas>`, bez build stepu, bez npm závislostí. Sprity jako pixel mapy v kódu (žádné stažené assety), generované atlasy. Zvuk Web Audio syntezátor. CZ/EN UI.
- `shared/sim.js`: deterministická simulace (pevný krok 20 Hz) — stejný kód v prohlížeči (Single) i na serveru (Multiplayer).
- Server: Node `node:http` + `node:sqlite` + vlastní WebSocket (RFC 6455).
- Hosting: statický klient na **GitHub Pages** (`jmoravec01.github.io/<repo>`), server přes reverzní proxy s HTTPS (WebSocket `wss://…/ws`). CORS jen pro github.io.
- Chyby na mobilu: dpr cap, adaptivní kvalita, ≤150 příšer na hráče, pooling entit, žádné alokace v herní smyčce.
- Testy (`node --test`): sim determinismus, škálování obtížnosti, API (registrace/přihlášení/run), WS protokol, flood/malformed zprávy. Smoke test v Playwright WebKit + Chromium (mobilní emulace).

## 6. Milníky
1. **M1 — Single jádro:** sim, 1 dungeon, 3 zbraně, joystick, pixel art, level-up výběr. Hratelné lokálně.
2. **M2 — Obsah + meta:** 6 zbraní/6 pasivek, 3 single dungeony, boss, účet, postava, výbava, mince.
3. **M3 — Multiplayer:** místnosti, WS, server sim, škálování `threat`, 3 co-op dungeony, oživení.
4. **M4 — Nasazení:** Docker + GitHub Pages + CI.
5. **M5 — Leštění:** zvuk, balanc, QA na mobilním emulátoru + nezávislé review.

## 7. Předpoklady, které jsem udělal (řekni, když chceš jinak)
- Název „Survivor.io“ v názvu ani textech nebude (ochranná známka).
- Max 6 hráčů v místnosti.
- Žádné platby/reklamy/gacha.
