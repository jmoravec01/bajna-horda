// UI strings (Czech default, English toggle). Names/descriptions of classes, weapons and dungeons live in shared/data.js.
const D = {
  cs: {
    sub: 'Pixelová horda do kapsy', login: 'Přihlásit', register: 'Registrovat', guest: 'Hrát jako host', nick: 'Přezdívka', pass: 'Heslo (min. 6 znaků)', logout: 'Odhlásit',
    guest_note: 'Host: postup se ukládá jen v tomhle prohlížeči.', offline_note: 'Offline verze: postup se ukládá jen v tomhle prohlížeči, bez multiplayeru.',
    single: 'Single', multi: 'Multiplayer', chars: 'Postavy', coins: 'Mince', level: 'Lv', power: 'Síla', back: 'Zpět', ok: 'OK', menu: 'Menu',
    newchar: 'Nová postava', create: 'Vytvořit', del: 'Smazat', confirm_del: 'Smazat postavu? Nejde to vrátit.', name: 'Jméno postavy', pick_class: 'Vyber třídu', active: 'Aktivní', select: 'Vybrat',
    weapon: 'Zbraň', armor: 'Brnění', ring: 'Prsten', boots: 'Boty', upgrade: 'Vylepšit', maxed: 'Max', weapon_d: '+4 % poškození', armor_d: '+5 % HP', ring_d: '+2 % poškození, větší sběr', boots_d: '+1,5 % rychlost, kratší čekání',
    chars_full: 'Máš plný počet postav (8).', no_char: 'Nejdřív vytvoř postavu.', slots: 'Postavy',
    dungeons: 'Dungeony', locked: 'Zamčeno: dokonči předchozí', recommended: 'Doporučená síla', start: 'Start', cleared: 'Dokončeno',
    myroom: 'Moje místnost', join: 'Připojit se', code: 'Kód místnosti', copy: 'Kopírovat odkaz', copied: 'Zkopírováno', invite: 'Pošli kamarádům odkaz nebo kód:', room_of: 'Místnost hráče',
    players: 'Hráči', waiting: 'Čeká se na hostitele…', host: 'hostitel', leave: 'Odejít', pick_dun: 'Dungeon', host_only: 'Spouští hostitel', mychar: 'Moje postava', guest_mp: 'Jako host hraješ bez uložení postupu (postava level 1).',
    connecting: 'Připojuji…', lost: 'Spojení se přerušilo.', not_found: 'Místnost neexistuje (hostitel není online).', in_run: 'V místnosti právě běží hra.', full_room: 'Místnost je plná.', busy: 'Tenhle účet je už připojený jinde.', need_char: 'Vyber postavu.',
    pause: 'Pauza', resume: 'Pokračovat', quit: 'Ukončit run', levelup: 'Level up!', choose: 'Vyber vylepšení', new: 'NOVÉ', revive: 'Stůj u spadlého kamaráda a oživíš ho', dead: 'Jsi mrtvý…',
    win: 'Vítězství!', lose: 'Konec hry', time: 'Čas', kills: 'Zabití', xp: 'Zkušenosti', carry: 'Bonus za těžší hru', lvlup: 'Postava postoupila na level', saving: 'Ukládám…',
    boss: 'BOSS', err_x: 'Něco se pokazilo.', err_offline: 'Server není dostupný.', err_taken: 'Tohle jméno už někdo má.', err_badlogin: 'Špatné jméno nebo heslo.', err_name: 'Jméno: 2–16 písmen, číslic, mezera . _ -', err_pass: 'Heslo musí mít aspoň 6 znaků.',
    err_rate: 'Moc pokusů, zkus to za chvíli.', err_poor: 'Nemáš dost mincí.', err_full: 'Máš plný počet postav.', err_unauthorized: 'Přihlášení vypršelo.',
    sound: 'Zvuk', lang: 'EN', zones: '', hint_move: 'Tahej prstem pro pohyb. Zbraně střílí samy.',
  },
  en: {
    sub: 'A pixel horde in your pocket', login: 'Log in', register: 'Register', guest: 'Play as guest', nick: 'Nickname', pass: 'Password (6+ chars)', logout: 'Log out',
    guest_note: 'Guest: progress is saved in this browser only.', offline_note: 'Offline build: progress is saved in this browser only, no multiplayer.',
    single: 'Single', multi: 'Multiplayer', chars: 'Characters', coins: 'Coins', level: 'Lv', power: 'Power', back: 'Back', ok: 'OK', menu: 'Menu',
    newchar: 'New character', create: 'Create', del: 'Delete', confirm_del: 'Delete this character? This cannot be undone.', name: 'Character name', pick_class: 'Pick a class', active: 'Active', select: 'Select',
    weapon: 'Weapon', armor: 'Armor', ring: 'Ring', boots: 'Boots', upgrade: 'Upgrade', maxed: 'Max', weapon_d: '+4 % damage', armor_d: '+5 % HP', ring_d: '+2 % damage, bigger pickup range', boots_d: '+1.5 % speed, shorter cooldowns',
    chars_full: 'You have the maximum number of characters (8).', no_char: 'Create a character first.', slots: 'Characters',
    dungeons: 'Dungeons', locked: 'Locked: clear the previous one', recommended: 'Recommended power', start: 'Start', cleared: 'Cleared',
    myroom: 'My room', join: 'Join', code: 'Room code', copy: 'Copy link', copied: 'Copied', invite: 'Send friends the link or code:', room_of: 'Room of',
    players: 'Players', waiting: 'Waiting for the host…', host: 'host', leave: 'Leave', pick_dun: 'Dungeon', host_only: 'Host starts the run', mychar: 'My character', guest_mp: 'As a guest you play without saving progress (level 1 character).',
    connecting: 'Connecting…', lost: 'Connection lost.', not_found: 'No such room (host is offline).', in_run: 'A run is in progress in that room.', full_room: 'Room is full.', busy: 'This account is already connected elsewhere.', need_char: 'Pick a character.',
    pause: 'Paused', resume: 'Resume', quit: 'Quit run', levelup: 'Level up!', choose: 'Choose an upgrade', new: 'NEW', revive: 'Stand next to a fallen friend to revive them', dead: 'You are down…',
    win: 'Victory!', lose: 'Game over', time: 'Time', kills: 'Kills', xp: 'Experience', carry: 'Bonus for a harder run', lvlup: 'Character reached level', saving: 'Saving…',
    boss: 'BOSS', err_x: 'Something went wrong.', err_offline: 'Server unreachable.', err_taken: 'That name is taken.', err_badlogin: 'Wrong name or password.', err_name: 'Name: 2–16 letters, digits, space . _ -', err_pass: 'Password needs 6+ characters.',
    err_rate: 'Too many tries, wait a moment.', err_poor: 'Not enough coins.', err_full: 'You have the maximum number of characters.', err_unauthorized: 'Session expired.',
    sound: 'Sound', lang: 'CS', zones: '', hint_move: 'Drag to move. Weapons fire on their own.',
  },
};
let lang = 'cs';
export function setLang(l) { lang = l === 'en' ? 'en' : 'cs'; document.documentElement.lang = lang; }
export const getLang = () => lang;
export const t = (k) => D[lang][k] ?? D.cs[k] ?? k;
export const nm = (o) => o[lang] || o.cs;                     // {cs, en} name of a data entry
export const ds = (o, k = 'd') => o[`${lang}_${k}`] || o[`cs_${k}`] || '';
export const errText = (e) => t('err_' + (e?.message || 'x')) === 'err_' + (e?.message || 'x') ? t('err_x') : t('err_' + e.message);
export function detectLang() { return /^(cs|sk)/i.test(navigator.language || '') ? 'cs' : 'en'; }
