import { createStore, isDemo, newCode, isValidCode } from './store.js';
import { $, el, dialog, toast, fail, confirmDelete, fmtDate } from './ui.js';
import { initFreezer, viewFreezer, alerts, badgeCount, fachSettingsCard, freezerReady } from './freezer.js';

const NAME_KEY = 'einkaufsliste-name';
const CODE_KEY = 'einkaufsliste-code';
const app = $('#app');

let store = null;
let items = [];
let loadError = null;
let renderList = () => {};

// ---------- Hilfen ----------

function getName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function setName(v) {
  try { localStorage.setItem(NAME_KEY, v); } catch { /* ignorieren */ }
}

function getCode() {
  try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
}
function setCode(v) {
  try { localStorage.setItem(CODE_KEY, v); } catch { /* ignorieren */ }
}
const needsCode = () => !isDemo && !getCode();

function inviteLink() {
  return `${location.origin}${location.pathname}?liste=${getCode()}`;
}

// Code aus einem eingefügten Einladungslink oder direkt eingegeben.
function parseCode(text) {
  const t = text.trim();
  const m = t.match(/liste=([A-Za-z0-9]+)/);
  const c = m ? m[1] : t;
  return isValidCode(c) ? c : '';
}

async function askName(force) {
  const current = getName();
  if (current && !force) return current;
  const input = el('input', { type: 'text', id: 'name-input', value: current, placeholder: 'z. B. Harald', autocomplete: 'given-name', maxlength: 30 });
  const res = await dialog((f) => {
    f.append(
      el('h2', {}, current ? 'Namen ändern' : 'Wie heißt du?'),
      el('p', {}, 'Dein Name steht bei allem, was du einträgst, abhakst, einlagerst oder entnimmst.'),
      input,
      el('div', { class: 'row' },
        current ? el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen') : null,
        el('button', { class: 'btn', value: 'ok' }, 'Speichern')),
    );
    input.required = true;
  }, { required: !current });
  const v = input.value.trim();
  if (res === 'ok' && v) setName(v);
  return getName();
}

// ---------- Ansichten Einkauf ----------

function itemRow(it) {
  const check = el('button', {
    class: 'check',
    type: 'button',
    'aria-label': it.erledigt ? `${it.artikel} wieder offen` : `${it.artikel} abhaken`,
    onclick: () => toggle(it),
  }, it.erledigt ? '✓' : '');
  const meta = it.erledigt
    ? `gekauft von ${it.erledigtVon || '?'} · ${fmtDate(it.erledigtAm)} · eingetragen von ${it.name}`
    : `${it.name} · ${fmtDate(it.erstelltAm)}`;
  const body = el('div', { class: 'body', role: 'button', tabindex: 0, onclick: () => edit(it), onkeydown: (e) => { if (e.key === 'Enter') edit(it); } },
    el('div', { class: 'what' },
      el('span', { class: 'artikel' }, it.artikel),
      it.menge ? el('span', { class: 'menge' }, it.menge) : null),
    el('div', { class: 'meta' }, meta + (it.pending ? ' · wird gespeichert…' : '')));
  return el('li', { class: `item${it.erledigt ? ' done' : ''}${it.pending ? ' pending' : ''}` }, check, body);
}

function notices() {
  const out = [];
  if (isDemo) out.push(el('div', { class: 'notice' }, 'Demo-Modus: Einträge bleiben nur auf diesem Gerät.'));
  if (loadError === 'permission-denied') out.push(el('div', { class: 'notice' }, 'Kein Zugriff auf die Liste. Bitte den Einladungslink noch einmal öffnen.'));
  else if (loadError) out.push(el('div', { class: 'notice' }, `Verbindung zur Liste fehlgeschlagen: ${loadError}`));
  return out;
}

// Hinweis im Einkauf, wenn im Gefrierschrank etwas abgelaufen ist oder bald abläuft.
function freezerNotice() {
  if (!freezerReady()) return null;
  const { abgelaufen, bald } = alerts();
  if (!abgelaufen.length && !bald.length) return null;
  const teile = [];
  if (abgelaufen.length) teile.push(`${abgelaufen.length} abgelaufen`);
  if (bald.length) teile.push(`${bald.length} läuft bald ab`);
  return el('a', { class: `notice notice-link${abgelaufen.length ? ' red' : ''}`, href: '#/gefrier' }, `❄️ Gefrierschrank: ${teile.join(', ')} ›`);
}

function shopSeg(active) {
  const open = items.filter((i) => !i.erledigt).length;
  return el('div', { class: 'seg', role: 'tablist' },
    el('a', { href: '#/', class: active === 'offen' ? 'on' : '' }, open ? `Offen (${open})` : 'Offen'),
    el('a', { href: '#/erledigt', class: active === 'erledigt' ? 'on' : '' }, 'Erledigt'));
}

function viewOpen() {
  const artikel = el('input', { type: 'text', id: 'artikel', placeholder: 'Was fehlt?', autocomplete: 'off', enterkeyhint: 'next', maxlength: 80, 'aria-label': 'Artikel' });
  const menge = el('input', { type: 'text', id: 'menge', placeholder: 'Menge', autocomplete: 'off', enterkeyhint: 'done', maxlength: 30, 'aria-label': 'Menge' });
  const form = el('form', {
    class: 'add',
    onsubmit: async (e) => {
      e.preventDefault();
      const a = artikel.value.trim();
      if (!a) { artikel.focus(); return; }
      const name = await askName();
      store.add({ artikel: a, menge: menge.value.trim(), name }).catch(fail);
      artikel.value = '';
      menge.value = '';
      artikel.focus();
    },
  }, artikel, menge, el('button', { class: 'btn', type: 'submit' }, 'Hinzufügen'));

  const segSlot = el('div');
  const alertSlot = el('div');
  const list = el('ul', { class: 'list' });
  app.replaceChildren(...notices(), alertSlot, segSlot, form, list);

  renderList = () => {
    segSlot.replaceChildren(shopSeg('offen'));
    alertSlot.replaceChildren(freezerNotice() || '');
    const open = items.filter((i) => !i.erledigt);
    if (!store) list.replaceChildren(el('li', { class: 'empty' }, 'Liste wird geladen…'));
    else if (!open.length) list.replaceChildren(el('li', { class: 'empty' }, el('span', { class: 'big' }, '🧺'), 'Alles erledigt. Oben eintragen, was fehlt.'));
    else list.replaceChildren(...open.map(itemRow));
  };
}

function viewDone() {
  const list = el('ul', { class: 'list' });
  const clear = el('button', { class: 'btn secondary', type: 'button', onclick: clearDone }, 'Erledigte löschen');
  const segSlot = el('div');
  const alertSlot = el('div');
  const head = el('div', { class: 'section-head' }, el('h2', {}, ''), clear);
  app.replaceChildren(...notices(), alertSlot, segSlot, head, list);

  renderList = () => {
    segSlot.replaceChildren(shopSeg('erledigt'));
    alertSlot.replaceChildren(freezerNotice() || '');
    const done = items.filter((i) => i.erledigt).sort((x, y) => (y.erledigtAm || Infinity) - (x.erledigtAm || Infinity));
    head.firstChild.textContent = done.length ? `Gekauft: ${done.length}` : '';
    clear.hidden = !done.length;
    if (!done.length) list.replaceChildren(el('li', { class: 'empty' }, el('span', { class: 'big' }, '✅'), 'Hier erscheint, was schon gekauft wurde.'));
    else list.replaceChildren(...done.map(itemRow));
  };
}

function viewJoin() {
  renderList = () => {};
  const input = el('input', { type: 'text', id: 'join-code', placeholder: 'Einladungslink oder Code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const err = el('p', { class: 'error', hidden: true }, 'Das ist kein gültiger Einladungslink. Bitte den ganzen Link aus der Einladung einfügen.');
  const confirmNew = el('div', { class: 'row-buttons', hidden: true },
    el('p', {}, 'Das wird eine eigene, leere Liste. Wurdest du eingeladen, öffne lieber den Link.'),
    el('button', { class: 'btn secondary', type: 'button', onclick: () => { confirmNew.hidden = true; } }, 'Abbrechen'),
    el('button', { class: 'btn', type: 'button', onclick: () => join(newCode()) }, 'Ja, neue Liste anlegen'));
  app.replaceChildren(
    el('form', {
      class: 'card',
      onsubmit: (e) => {
        e.preventDefault();
        const c = parseCode(input.value);
        err.hidden = !!c;
        if (c) join(c);
      },
    },
      el('h2', {}, 'Liste öffnen'),
      el('p', {}, 'Öffne den Einladungslink, den du von deiner Familie bekommen hast. Oder füge ihn hier ein:'),
      input, err,
      el('button', { class: 'btn', type: 'submit' }, 'Liste öffnen')),
    el('section', { class: 'card' },
      el('h2', {}, 'Noch keine Liste?'),
      el('p', {}, 'Lege eine neue, leere Liste an und lade danach unter Einstellungen die Familie ein.'),
      el('button', { class: 'btn secondary', type: 'button', onclick: () => { confirmNew.hidden = false; } }, 'Neue Liste anlegen'),
      confirmNew),
  );
}

function join(code) {
  setCode(code);
  location.hash = '#/';
  start();
}

async function copyInvite(field, btn) {
  try {
    await navigator.clipboard.writeText(field.value);
    btn.textContent = 'Kopiert ✓';
  } catch {
    field.select();
    btn.textContent = 'Markiert – jetzt kopieren';
  }
  setTimeout(() => { btn.textContent = 'Link kopieren'; }, 2500);
}

function viewSettings() {
  renderList = () => {};
  const nameLine = el('strong', {}, getName() || '–');
  const link = el('input', { type: 'text', id: 'invite-link', value: inviteLink(), readonly: true, 'aria-label': 'Einladungslink', onfocus: (e) => e.target.select() });
  const copyBtn = el('button', { class: 'btn', type: 'button', onclick: () => copyInvite(link, copyBtn) }, 'Link kopieren');
  const shareBtn = navigator.share
    ? el('button', { class: 'btn secondary', type: 'button', onclick: () => navigator.share({ title: 'Einkaufsliste', text: 'Unsere Einkaufsliste:', url: link.value }).catch(() => {}) }, 'Teilen …')
    : null;
  app.replaceChildren(
    ...notices(),
    el('section', { class: 'card' },
      el('h2', {}, 'Dein Name'),
      el('p', {}, 'Steht bei allem, was du auf diesem Handy einträgst oder abhakst.'),
      el('div', {}, nameLine),
      el('button', { class: 'btn secondary', type: 'button', onclick: async () => { nameLine.textContent = await askName(true); } }, 'Namen ändern')),
    isDemo ? null : el('section', { class: 'card' },
      el('h2', {}, 'Familie einladen'),
      el('p', {}, 'Wer diesen Link hat, kann die Liste sehen und ändern. Schick ihn nur an die Familie.'),
      link,
      el('div', { class: 'row-buttons' }, copyBtn, shareBtn)),
    freezerReady() ? fachSettingsCard() : null,
    el('section', { class: 'card' },
      el('h2', {}, 'App aufs Handy holen'),
      el('p', {}, 'Android (Chrome): Menü ⋮ → „App installieren“.'),
      el('p', {}, 'iPhone (Safari): Teilen-Symbol → „Zum Home-Bildschirm“.'),
      el('p', {}, 'Am besten den Einladungslink öffnen und dann installieren.')),
    el('section', { class: 'card' },
      el('h2', {}, 'Speicher'),
      el('p', {}, isDemo ? 'Demo-Modus: nur dieses Gerät.' : 'Gemeinsame Liste über Firebase. Änderungen sind sofort bei allen sichtbar, offline Eingetragenes wird nachgesendet.')),
  );
}

// ---------- Routing ----------
// #/  #/erledigt  #/gefrier  #/gefrier/artikel  #/gefrier/verlauf  #/gefrier/fach/3  #/einstellungen

function route() {
  $('.tabbar').hidden = needsCode();
  if (needsCode()) return viewJoin();
  const [first, ...rest] = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  const tab = first === 'gefrier' ? 'gefrier' : first === 'einstellungen' ? 'einstellungen' : 'einkauf';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));

  if (tab === 'gefrier') {
    renderList = () => { if (freezerReady()) viewFreezer(rest[0], rest[1]); else app.replaceChildren(...notices(), el('p', { class: 'empty' }, 'Gefrierschrank wird geladen…')); };
  } else if (tab === 'einstellungen') {
    viewSettings();
  } else if (first === 'erledigt') {
    viewDone();
  } else {
    viewOpen();
  }
  renderList();
  if (tab !== 'einkauf') scrollTo(0, 0);
}

// ---------- Aktionen ----------

async function toggle(it) {
  const name = await askName();
  const next = !it.erledigt;
  store.update(it.id, { erledigt: next, erledigtVon: next ? name : '' }).catch(fail);
  if (next) {
    toast(`„${it.artikel}“ abgehakt`, 'Rückgängig', () => store.update(it.id, { erledigt: false, erledigtVon: '' }).catch(fail));
  }
}

async function edit(it) {
  const artikel = el('input', { type: 'text', id: 'edit-artikel', value: it.artikel, maxlength: 80 });
  const menge = el('input', { type: 'text', id: 'edit-menge', value: it.menge, maxlength: 30 });
  artikel.required = true;
  const res = await dialog((f) => f.append(
    el('h2', {}, 'Eintrag bearbeiten'),
    el('label', { for: 'edit-artikel' }, 'Artikel'), artikel,
    el('label', { for: 'edit-menge' }, 'Menge'), menge,
    el('p', {}, `Eingetragen von ${it.name} · ${fmtDate(it.erstelltAm)}`),
    el('div', { class: 'row' },
      el('button', { class: 'btn danger', value: 'delete', formnovalidate: true }, 'Löschen'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'save' }, 'Speichern')),
  ));
  if (res === 'save' && artikel.value.trim()) {
    store.update(it.id, { artikel: artikel.value.trim(), menge: menge.value.trim() }).catch(fail);
  } else if (res === 'delete' && await confirmDelete(`„${it.artikel}“ löschen?`, 'Der Eintrag wird für alle aus der Liste entfernt.')) {
    store.remove(it.id).catch(fail);
    toast(`„${it.artikel}“ gelöscht`);
  }
}

async function clearDone() {
  const done = items.filter((i) => i.erledigt);
  if (await confirmDelete('Erledigte löschen?', `${done.length} gekaufte Artikel werden für alle aus der Liste entfernt.`)) {
    store.removeMany(done.map((i) => i.id)).catch(fail);
  }
}

// ---------- Start ----------

function updateBadges() {
  const n = items.filter((i) => !i.erledigt).length;
  $('#count-open').textContent = n ? String(n) : '';
  const f = freezerReady() ? badgeCount() : 0;
  $('#count-freezer').textContent = f ? String(f) : '';
}

function refresh() {
  updateBadges();
  renderList();
}

// Einladungslink ?liste=<code>: Code merken. Er bleibt in der Adresse stehen, damit
// "Zum Home-Bildschirm" auf dem iPhone ihn mitnimmt (dort hat die App eigenen Speicher).
const urlCode = new URLSearchParams(location.search).get('liste');
if (isValidCode(urlCode)) setCode(urlCode);

addEventListener('hashchange', route);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('Service Worker:', e));
}

if (needsCode()) route();
else start();

function start() {
  route();
  askName();
  createStore(getCode())
    .then((s) => {
      store = s;
      s.onConnection((state) => {
        const dot = $('#status');
        dot.className = `status ${isDemo ? '' : state}`;
        dot.title = isDemo ? 'Demo-Modus' : state === 'online' ? 'Verbunden' : 'Offline – wird später gespeichert';
      });
      s.subscribe(
        (list) => { items = list; loadError = null; refresh(); },
        (e) => { loadError = e.code || e.message; route(); },
      );
      initFreezer({ store: s, app, askName, getItems: () => items, notices, onChange: refresh });
      route();
    })
    .catch((e) => {
      console.error(e);
      loadError = e.code || e.message || String(e);
      route();
    });
}
