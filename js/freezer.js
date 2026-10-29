// Gefrierschrank: Bestand in 8 Fächern, Grundbestand, Ablauf-Hinweise und Verlauf.
//
// Sammlungen unter listen/<code>/:
//   gefrier       ein Posten je Einlagerung { artikel, fach, anzahl, einheit, eingelagertAm, eingelagertVon, haltbarBis }
//   grundbestand  { artikel, soll, einheit }   (soll 0 = kein Grundbestand)
//   verlauf       { typ: ein|aus|korrektur|umlagern|loeschen, artikel, fach, vonFach, anzahl, einheit, wer, wann }
//   einstellungen/faecher  { namen: [8 Texte] }

import { el, dialog, toast, fail, confirmDelete, fmtDate, fmtDay, daysUntil, addMonths, stepper, num } from './ui.js';

export const FAECHER = 8;
export const BALD_TAGE = 30;
const EINHEITEN = ['Stück', 'Beutel', 'Packung', 'Portion', 'Dose', 'Becher', 'kg'];
const VERLAUF_TAGE = 365;

let ctx = null;          // { store, app, askName, getItems, notices, onChange }
let cols = {};
let posten = [];
let grund = [];
let verlauf = [];
let faecher = [];
let pruned = false;

const key = (s) => String(s || '').trim().toLowerCase();

export function initFreezer(c) {
  ctx = c;
  const s = c.store;
  cols = {
    gefrier: s.collection('gefrier'),
    grund: s.collection('grundbestand'),
    verlauf: s.collection('verlauf', { order: 'wann', dir: 'desc', limit: 300 }),
    einst: s.collection('einstellungen'),
  };
  const onErr = (e) => console.warn('Gefrierschrank:', e);
  cols.gefrier.subscribe((d) => { posten = d; ctx.onChange(); }, onErr);
  cols.grund.subscribe((d) => { grund = d; ctx.onChange(); }, onErr);
  cols.verlauf.subscribe((d) => { verlauf = d; pruneVerlauf(); ctx.onChange(); }, onErr);
  cols.einst.subscribe((d) => { faecher = d.find((x) => x.id === 'faecher')?.namen || []; ctx.onChange(); }, onErr);
}

// Alte Verlaufseinträge (älter als 12 Monate) einmal pro Start entfernen.
function pruneVerlauf() {
  if (pruned || !verlauf.length) return;
  pruned = true;
  const grenze = Date.now() - VERLAUF_TAGE * 86400000;
  const alt = verlauf.filter((v) => v.wann instanceof Date && v.wann.getTime() < grenze).map((v) => v.id);
  if (alt.length) cols.verlauf.removeMany(alt).catch((e) => console.warn(e));
}

// ---------- Auswertung ----------

export function fachName(n) {
  const custom = (faecher[n - 1] || '').trim();
  return custom ? `Fach ${n} · ${custom}` : `Fach ${n}`;
}

function status(p) {
  if (!p.haltbarBis) return 'ohne';
  const d = daysUntil(p.haltbarBis);
  if (d < 0) return 'abgelaufen';
  if (d <= BALD_TAGE) return 'bald';
  return 'ok';
}

const byExpiry = (a, b) => (a.haltbarBis || '9999').localeCompare(b.haltbarBis || '9999')
  || (a.eingelagertAm || 0) - (b.eingelagertAm || 0);

function grundFor(artikel) {
  return grund.find((g) => key(g.artikel) === key(artikel));
}

// Artikel über alle Fächer zusammengefasst, inkl. Artikel mit Grundbestand aber leerem Bestand.
function articles() {
  const map = new Map();
  const get = (name, einheit) => {
    const k = key(name);
    if (!map.has(k)) map.set(k, { name, einheit, total: 0, posten: [], faecher: new Set(), soll: 0 });
    return map.get(k);
  };
  for (const p of posten) {
    const a = get(p.artikel, p.einheit);
    a.total = Math.round((a.total + (p.anzahl || 0)) * 100) / 100;
    a.posten.push(p);
    a.faecher.add(p.fach);
  }
  for (const g of grund) {
    if (!(g.soll > 0) && !map.has(key(g.artikel))) continue;
    const a = get(g.artikel, g.einheit);
    a.soll = g.soll || 0;
    if (!a.einheit) a.einheit = g.einheit;
  }
  for (const a of map.values()) a.posten.sort(byExpiry);
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, 'de'));
}

export function alerts() {
  const abgelaufen = posten.filter((p) => status(p) === 'abgelaufen').sort(byExpiry);
  const bald = posten.filter((p) => status(p) === 'bald').sort(byExpiry);
  const nachkaufen = articles().filter((a) => a.soll > 0 && a.total < a.soll);
  return { abgelaufen, bald, nachkaufen };
}

export function badgeCount() {
  const { abgelaufen, bald } = alerts();
  return abgelaufen.length + bald.length;
}

const menge = (n, einheit) => `${String(n).replace('.', ',')} ${einheit || ''}`.trim();

function expiryTag(p) {
  const s = status(p);
  if (s === 'ohne') return el('span', { class: 'tag tag-none' }, 'ohne Datum');
  const d = daysUntil(p.haltbarBis);
  const txt = s === 'abgelaufen' ? `abgelaufen seit ${fmtDay(p.haltbarBis)}`
    : d === 0 ? 'läuft heute ab'
      : s === 'bald' ? `noch ${d} Tag${d === 1 ? '' : 'e'}`
        : `bis ${fmtDay(p.haltbarBis)}`;
  return el('span', { class: `tag tag-${s}` }, txt);
}

// ---------- Ansichten ----------

function backLink(href, text) {
  return el('a', { class: 'back', href }, `‹ ${text}`);
}

function seg(active) {
  return el('div', { class: 'seg', role: 'tablist' },
    el('a', { href: '#/gefrier', class: active === 'faecher' ? 'on' : '' }, 'Nach Fächern'),
    el('a', { href: '#/gefrier/artikel', class: active === 'artikel' ? 'on' : '' }, 'Alle Artikel'));
}

function alertBox() {
  const { abgelaufen, bald, nachkaufen } = alerts();
  const out = [];
  if (abgelaufen.length) {
    out.push(el('section', { class: 'alert alert-red' },
      el('h3', {}, `Abgelaufen (${abgelaufen.length})`),
      el('ul', {}, abgelaufen.map((p) => el('li', {},
        el('a', { href: `#/gefrier/fach/${p.fach}` }, `${p.artikel} · ${menge(p.anzahl, p.einheit)} · Fach ${p.fach} · seit ${fmtDay(p.haltbarBis)}`))))));
  }
  if (bald.length) {
    out.push(el('section', { class: 'alert alert-orange' },
      el('h3', {}, `Läuft in den nächsten ${BALD_TAGE} Tagen ab (${bald.length})`),
      el('ul', {}, bald.map((p) => el('li', {},
        el('a', { href: `#/gefrier/fach/${p.fach}` }, `${p.artikel} · Fach ${p.fach} · bis ${fmtDay(p.haltbarBis)}`))))));
  }
  if (nachkaufen.length) {
    const offen = new Set(ctx.getItems().filter((i) => !i.erledigt).map((i) => key(i.artikel)));
    out.push(el('section', { class: 'alert alert-blue' },
      el('h3', {}, `Nachkaufen (${nachkaufen.length})`),
      el('ul', {}, nachkaufen.map((a) => {
        const fehlt = Math.round((a.soll - a.total) * 100) / 100;
        const drauf = offen.has(key(a.name));
        return el('li', { class: 'buy' },
          el('span', {}, `${a.name}: ${menge(a.total, '')} von ${menge(a.soll, a.einheit)}`),
          drauf
            ? el('span', { class: 'muted' }, 'steht schon drauf ✓')
            : el('button', { class: 'btn small', type: 'button', onclick: () => toShoppingList(a.name, menge(fehlt, a.einheit)) }, 'Auf Einkaufsliste'));
      }))));
  }
  return out;
}

export function viewFreezer(view, arg) {
  const app = ctx.app;
  if (view === 'fach') return viewFach(app, Number(arg));
  if (view === 'verlauf') return viewVerlauf(app);
  const isArt = view === 'artikel';
  const body = isArt ? articleList() : fachGrid();
  app.replaceChildren(
    ...ctx.notices(),
    ...alertBox(),
    el('div', { class: 'section-head' },
      seg(isArt ? 'artikel' : 'faecher'),
      el('a', { class: 'link', href: '#/gefrier/verlauf' }, 'Verlauf')),
    body,
    el('button', { class: 'btn big', type: 'button', onclick: () => einlagern() }, '+ Einlagern'),
  );
}

function fachGrid() {
  const grid = el('div', { class: 'fach-grid' });
  for (let n = 1; n <= FAECHER; n++) {
    const inFach = posten.filter((p) => p.fach === n);
    const worst = inFach.some((p) => status(p) === 'abgelaufen') ? 'abgelaufen'
      : inFach.some((p) => status(p) === 'bald') ? 'bald' : '';
    const custom = (faecher[n - 1] || '').trim();
    grid.append(el('a', { class: 'fach', href: `#/gefrier/fach/${n}` },
      el('span', { class: 'fach-nr' }, String(n)),
      el('span', { class: 'fach-name' }, custom || `Fach ${n}`),
      el('span', { class: 'fach-count' }, inFach.length ? `${inFach.length} Posten` : 'leer'),
      worst ? el('span', { class: `dot dot-${worst}`, title: worst === 'abgelaufen' ? 'Abgelaufenes im Fach' : 'Läuft bald ab' }) : null));
  }
  return grid;
}

function articleList() {
  const list = articles().filter((a) => a.total > 0 || a.soll > 0);
  if (!list.length) return el('p', { class: 'empty' }, el('span', { class: 'big' }, '❄️'), 'Noch nichts eingelagert. Unten auf „+ Einlagern“ tippen.');
  return el('ul', { class: 'list' }, list.map((a) => {
    const next = a.posten.find((p) => p.haltbarBis);
    const unter = a.soll > 0 && a.total < a.soll;
    return el('li', { class: 'item' },
      el('div', { class: 'body', role: 'button', tabindex: 0, onclick: () => editArticle(a), onkeydown: (e) => { if (e.key === 'Enter') editArticle(a); } },
        el('div', { class: 'what' },
          el('span', { class: 'artikel' }, a.name),
          el('span', { class: `menge${unter ? ' warn' : ''}` }, a.soll > 0 ? `${menge(a.total, '')} / ${menge(a.soll, a.einheit)}` : menge(a.total, a.einheit))),
        el('div', { class: 'meta' },
          a.faecher.size ? `Fach ${[...a.faecher].sort().join(', ')}` : 'nicht vorrätig',
          next ? ' · ' : '', next ? expiryTag(next) : null)),
      a.total > 0 ? el('button', { class: 'btn small secondary', type: 'button', onclick: () => takeArticle(a) }, 'Entnehmen') : null);
  }));
}

function postenRow(p) {
  return el('li', { class: `item${p.pending ? ' pending' : ''}` },
    el('div', { class: 'body', role: 'button', tabindex: 0, onclick: () => editPosten(p), onkeydown: (e) => { if (e.key === 'Enter') editPosten(p); } },
      el('div', { class: 'what' },
        el('span', { class: 'artikel' }, p.artikel),
        el('span', { class: 'menge' }, menge(p.anzahl, p.einheit))),
      el('div', { class: 'meta' }, `eingelagert ${fmtDate(p.eingelagertAm)} von ${p.eingelagertVon || '?'}`),
      el('div', { class: 'meta' }, expiryTag(p))),
    el('button', { class: 'btn small secondary', type: 'button', onclick: () => takePosten(p) }, 'Entnehmen'));
}

function viewFach(app, n) {
  if (!(n >= 1 && n <= FAECHER)) { location.hash = '#/gefrier'; return; }
  const inFach = posten.filter((p) => p.fach === n).sort(byExpiry);
  app.replaceChildren(
    ...ctx.notices(),
    backLink('#/gefrier', 'Gefrierschrank'),
    el('div', { class: 'section-head' }, el('h2', { class: 'title' }, fachName(n))),
    inFach.length
      ? el('ul', { class: 'list' }, inFach.map(postenRow))
      : el('p', { class: 'empty' }, el('span', { class: 'big' }, '🧊'), 'Dieses Fach ist leer.'),
    el('button', { class: 'btn big', type: 'button', onclick: () => einlagern({ fach: n }) }, `+ Einlagern in Fach ${n}`),
  );
}

const VERB = { ein: '➕', aus: '➖', korrektur: '✏️', umlagern: '↔️', loeschen: '🗑' };

function verlaufText(v) {
  const m = menge(v.anzahl, v.einheit);
  switch (v.typ) {
    case 'ein': return `${m} ${v.artikel} → Fach ${v.fach}`;
    case 'aus': return `${m} ${v.artikel} aus Fach ${v.fach} entnommen`;
    case 'umlagern': return `${v.artikel} von Fach ${v.vonFach} nach Fach ${v.fach}`;
    case 'loeschen': return `${v.artikel} (${m}) aus Fach ${v.fach} gelöscht`;
    default: return `${v.artikel} in Fach ${v.fach} korrigiert auf ${m}`;
  }
}

function viewVerlauf(app) {
  app.replaceChildren(
    ...ctx.notices(),
    backLink('#/gefrier', 'Gefrierschrank'),
    el('div', { class: 'section-head' }, el('h2', { class: 'title' }, 'Verlauf')),
    verlauf.length
      ? el('ul', { class: 'list log' }, verlauf.map((v) => el('li', { class: 'item' },
        el('span', { class: 'log-ico', 'aria-hidden': 'true' }, VERB[v.typ] || '•'),
        el('div', { class: 'body' },
          el('div', {}, verlaufText(v)),
          el('div', { class: 'meta' }, `${v.wer || '?'} · ${fmtDate(v.wann instanceof Date ? v.wann : null)}`)))))
      : el('p', { class: 'empty' }, 'Noch keine Bewegungen.'),
    el('p', { class: 'muted small' }, 'Einträge älter als 12 Monate werden automatisch entfernt.'),
  );
}

// ---------- Aktionen ----------

function log(typ, p, extra = {}) {
  return ctx.askName().then((wer) => cols.verlauf.add({
    typ, artikel: p.artikel, fach: p.fach, vonFach: 0, anzahl: p.anzahl, einheit: p.einheit || '',
    wer, wann: ctx.store.NOW, ...extra,
  })).catch(fail);
}

function fachChips(selected) {
  const wrap = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Fach' });
  for (let n = 1; n <= FAECHER; n++) {
    const custom = (faecher[n - 1] || '').trim();
    wrap.append(el('label', { class: 'chip', title: custom || `Fach ${n}` },
      el('input', { type: 'radio', name: 'fach', value: n, checked: n === selected, required: true }),
      el('span', {}, String(n))));
  }
  return wrap;
}
const chosenFach = (form) => Number(form.querySelector('input[name="fach"]:checked')?.value || 0);

function einheitSelect(id, value) {
  const s = el('select', { id }, EINHEITEN.map((e) => el('option', { value: e, selected: e === value }, e)));
  if (value && !EINHEITEN.includes(value)) s.prepend(el('option', { value, selected: true }, value));
  return s;
}

function haltbarField(id, value) {
  const input = el('input', { type: 'date', id, value: value || '' });
  const quick = el('div', { class: 'row-buttons' },
    [3, 6, 12].map((m) => el('button', { type: 'button', class: 'btn small secondary', onclick: () => { input.value = addMonths(m); } }, `+${m} Monate`)),
    el('button', { type: 'button', class: 'btn small secondary', onclick: () => { input.value = ''; } }, 'ohne'));
  return { input, quick };
}

async function einlagern({ fach = 0 } = {}) {
  const name = await ctx.askName();
  const bekannte = [...new Set([...posten, ...grund, ...verlauf].map((x) => x.artikel).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const artikel = el('input', { type: 'text', id: 'f-artikel', list: 'f-vorschlaege', placeholder: 'z. B. Erbsen', autocomplete: 'off', maxlength: 80, required: true });
  const datalist = el('datalist', { id: 'f-vorschlaege' }, bekannte.map((b) => el('option', { value: b })));
  const anzahl = stepper('f-anzahl', 1, { min: 0, label: 'Anzahl' });
  const einheit = einheitSelect('f-einheit', 'Stück');
  const haltbar = haltbarField('f-haltbar', addMonths(6));
  const soll = el('input', { type: 'number', id: 'f-soll', min: 0, max: 999, step: 'any', inputmode: 'decimal', placeholder: 'leer lassen = keiner' });
  let chips = fachChips(fach);
  const chipsSlot = el('div', {}, chips);

  // Bekannter Artikel: Einheit, Fach, Haltbarkeit und Grundbestand vom letzten Mal vorschlagen.
  artikel.addEventListener('change', () => {
    const k = key(artikel.value);
    const last = [...posten].filter((p) => key(p.artikel) === k).sort((a, b) => (b.eingelagertAm || 0) - (a.eingelagertAm || 0))[0];
    const g = grundFor(artikel.value);
    if (last) {
      einheit.value = last.einheit;
      if (!fach) { chips = fachChips(last.fach); chipsSlot.replaceChildren(chips); }
      if (last.haltbarBis && last.eingelagertAm instanceof Date) {
        const monate = Math.max(1, Math.round((new Date(last.haltbarBis) - last.eingelagertAm) / (30.44 * 86400000)));
        haltbar.input.value = addMonths(monate);
      }
    } else if (g?.einheit) einheit.value = g.einheit;
    if (g && g.soll > 0) soll.value = String(g.soll);
  });

  let form;
  const res = await dialog((f) => {
    form = f;
    f.append(
      el('h2', {}, 'Einlagern'),
      el('label', { for: 'f-artikel' }, 'Artikel'), artikel, datalist,
      el('div', { class: 'two' },
        el('div', {}, el('label', { for: 'f-anzahl' }, 'Anzahl'), anzahl.wrap),
        el('div', {}, el('label', { for: 'f-einheit' }, 'Einheit'), einheit)),
      el('label', {}, 'Fach'), chipsSlot,
      el('label', { for: 'f-haltbar' }, 'Haltbar bis'), haltbar.input, haltbar.quick,
      el('label', { for: 'f-soll' }, 'Grundbestand (optional)'), soll,
      el('div', { class: 'row' },
        el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
        el('button', { class: 'btn', value: 'ok' }, 'Einlagern')),
    );
  });
  if (res !== 'ok') return;
  const a = artikel.value.trim();
  const n = num(anzahl.input.value);
  const fachNr = chosenFach(form);
  if (!a || n <= 0 || !fachNr) { toast('Bitte Artikel, Anzahl und Fach angeben.'); return; }
  const p = { artikel: a, fach: fachNr, anzahl: n, einheit: einheit.value, haltbarBis: haltbar.input.value || null };
  cols.gefrier.add({ ...p, eingelagertAm: ctx.store.NOW, eingelagertVon: name }).catch(fail);
  log('ein', p);
  if (soll.value !== '') setSoll(a, num(soll.value), einheit.value);
  toast(`${menge(n, p.einheit)} ${a} in Fach ${fachNr} eingelagert`);
}

function setSoll(artikel, sollWert, einheit) {
  const g = grundFor(artikel);
  if (g) return cols.grund.update(g.id, { soll: sollWert, einheit }).catch(fail);
  if (sollWert > 0) return cols.grund.add({ artikel, soll: sollWert, einheit }).catch(fail);
}

async function askAmount(title, max, einheit) {
  const s = stepper('t-anzahl', Math.min(1, max), { min: 0, max, label: 'Anzahl' });
  const res = await dialog((f) => f.append(
    el('h2', {}, title),
    el('label', { for: 't-anzahl' }, `Wie viele? (vorhanden: ${menge(max, einheit)})`),
    s.wrap,
    el('div', { class: 'row' },
      el('button', { class: 'btn secondary', value: '' }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'ok', autofocus: true }, 'Entnehmen')),
  ));
  if (res !== 'ok') return 0;
  return Math.min(max, num(s.input.value));
}

// n Einheiten aus einem Posten nehmen; bei 0 verschwindet der Posten.
function takeFromPosten(p, n) {
  const rest = Math.round((p.anzahl - n) * 100) / 100;
  (rest > 0 ? cols.gefrier.update(p.id, { anzahl: rest }) : cols.gefrier.remove(p.id)).catch(fail);
  log('aus', p, { anzahl: n });
}

async function takePosten(p) {
  const n = await askAmount(`${p.artikel} entnehmen`, p.anzahl, p.einheit);
  if (n <= 0) return;
  takeFromPosten(p, n);
  toast(`${menge(n, p.einheit)} ${p.artikel} aus Fach ${p.fach} entnommen`);
}

// Über alle Fächer entnehmen, zuerst was am frühesten abläuft.
async function takeArticle(a) {
  let n = await askAmount(`${a.name} entnehmen`, a.total, a.einheit);
  if (n <= 0) return;
  const genommen = [];
  for (const p of a.posten) {
    if (n <= 0) break;
    const t = Math.min(n, p.anzahl);
    takeFromPosten(p, t);
    genommen.push(`Fach ${p.fach}`);
    n = Math.round((n - t) * 100) / 100;
  }
  toast(`${a.name} entnommen aus ${[...new Set(genommen)].join(', ')}`);
}

async function editPosten(p) {
  const artikel = el('input', { type: 'text', id: 'e-artikel', value: p.artikel, maxlength: 80, required: true });
  const anzahl = stepper('e-anzahl', p.anzahl, { min: 0, label: 'Anzahl' });
  const einheit = einheitSelect('e-einheit', p.einheit);
  const haltbar = haltbarField('e-haltbar', p.haltbarBis);
  let form;
  const res = await dialog((f) => {
    form = f;
    f.append(
      el('h2', {}, 'Posten bearbeiten'),
      el('label', { for: 'e-artikel' }, 'Artikel'), artikel,
      el('div', { class: 'two' },
        el('div', {}, el('label', { for: 'e-anzahl' }, 'Anzahl'), anzahl.wrap),
        el('div', {}, el('label', { for: 'e-einheit' }, 'Einheit'), einheit)),
      el('label', {}, 'Fach'), fachChips(p.fach),
      el('label', { for: 'e-haltbar' }, 'Haltbar bis'), haltbar.input, haltbar.quick,
      el('p', {}, `Eingelagert ${fmtDate(p.eingelagertAm)} von ${p.eingelagertVon || '?'}`),
      el('div', { class: 'row' },
        el('button', { class: 'btn danger', value: 'delete', formnovalidate: true }, 'Löschen'),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
        el('button', { class: 'btn', value: 'save' }, 'Speichern')),
    );
  });
  if (res === 'delete') {
    if (await confirmDelete(`„${p.artikel}“ löschen?`, `Der Posten (${menge(p.anzahl, p.einheit)}) wird aus ${fachName(p.fach)} entfernt.`)) {
      cols.gefrier.remove(p.id).catch(fail);
      log('loeschen', p);
      toast(`„${p.artikel}“ gelöscht`);
    }
    return;
  }
  if (res !== 'save') return;
  const neu = {
    artikel: artikel.value.trim() || p.artikel,
    anzahl: num(anzahl.input.value),
    einheit: einheit.value,
    fach: chosenFach(form) || p.fach,
    haltbarBis: haltbar.input.value || null,
  };
  if (neu.anzahl <= 0) {
    if (await confirmDelete(`„${p.artikel}“ löschen?`, 'Die Anzahl ist 0. Der Posten wird entfernt.')) {
      cols.gefrier.remove(p.id).catch(fail);
      log('loeschen', p);
    }
    return;
  }
  cols.gefrier.update(p.id, neu).catch(fail);
  if (neu.fach !== p.fach) log('umlagern', { ...p, ...neu }, { vonFach: p.fach });
  if (neu.anzahl !== p.anzahl) log('korrektur', { ...p, ...neu });
}

async function editArticle(a) {
  const soll = el('input', { type: 'number', id: 'g-soll', min: 0, max: 999, step: 'any', inputmode: 'decimal', value: a.soll || '' });
  const einheit = einheitSelect('g-einheit', a.einheit || 'Stück');
  const res = await dialog((f) => f.append(
    el('h2', {}, a.name),
    el('p', {}, a.total > 0 ? `Vorrätig: ${menge(a.total, a.einheit)} in Fach ${[...a.faecher].sort().join(', ')}` : 'Zurzeit nicht vorrätig.'),
    el('div', { class: 'two' },
      el('div', {}, el('label', { for: 'g-soll' }, 'Grundbestand'), soll),
      el('div', {}, el('label', { for: 'g-einheit' }, 'Einheit'), einheit)),
    el('p', { class: 'muted small' }, '0 oder leer = kein Grundbestand.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'save' }, 'Speichern')),
  ));
  if (res === 'save') setSoll(a.name, num(soll.value), einheit.value);
}

async function toShoppingList(artikel, mengeText) {
  const name = await ctx.askName();
  ctx.store.add({ artikel, menge: mengeText.slice(0, 30), name }).catch(fail);
  toast(`„${artikel}“ steht jetzt auf der Einkaufsliste`);
}

// ---------- Einstellungen ----------

export function fachSettingsCard() {
  const inputs = [];
  for (let n = 1; n <= FAECHER; n++) {
    inputs.push(el('input', { type: 'text', id: `fach-${n}`, value: faecher[n - 1] || '', placeholder: `Fach ${n}`, maxlength: 30, 'aria-label': `Name für Fach ${n}` }));
  }
  const btn = el('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      cols.einst.set('faecher', { namen: inputs.map((i) => i.value.trim()) })
        .then(() => toast('Fachnamen gespeichert')).catch(fail);
    },
  }, 'Fachnamen speichern');
  return el('section', { class: 'card' },
    el('h2', {}, 'Gefrierschrank-Fächer'),
    el('p', {}, 'Gib den Fächern Namen, z. B. „Fleisch“ oder „Schublade oben“. Leer = nur die Nummer.'),
    el('div', { class: 'fach-names' }, inputs.map((i, k) => el('label', { class: 'fach-name-row' }, el('span', {}, String(k + 1)), i))),
    btn);
}

export const freezerReady = () => !!cols.einst;
