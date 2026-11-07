// Kisten: frei angelegte Bereiche (Werkstatt, Garage …) mit nummerierten Kisten,
// Fotos und Inhaltsliste, dazu eine Suche über alle oder ausgewählte Bereiche.
//
// Sammlungen unter listen/<code>/:
//   bereiche  { name, kuerzel, tuerme: [{ id, name }], erstelltAm }
//   kisten    { bereich, turm ('' = ohne Turm), nummer, name, notiz, inhalt: [{ t, n }], titelbild, bildAnzahl, erstelltAm }
//   bilder    { kiste, voll, thumb, erstelltAm, von }   (Fotos als verkleinerte JPEG-Daten, ca. 250 KB)
//
// Ansichten mit Eingabefeldern werden nur einmal aufgebaut; bei neuen Daten wird nur
// der Inhalt aktualisiert, damit Fokus und Getipptes erhalten bleiben.

import { el, dialog, toast, fail, confirmDelete, fmtDate } from './ui.js';

const MAX_BILDER = 20;
const VOLL_MAX = 340000;   // Zeichen Base64 ≈ 250 KB
const SUCH_KEY = 'einkaufsliste-suchbereiche';

let ctx = null;            // { store, app, askName, notices, onChange }
let cols = {};
let bereiche = [];
let kisten = [];
let loaded = { b: false, k: false };
let current = { key: null, update: null };
let bilder = [];
let bilderFor = null;
let bilderUnsub = null;
const neu = new Set();     // gerade angelegt, vom Speicher noch nicht zurückgemeldet

const newId = () => crypto.randomUUID().replace(/-/g, '');
const norm = (s) => String(s || '').toLowerCase();
const byNummer = (a, b) => a.nummer.localeCompare(b.nummer, 'de', { numeric: true });

export function initBoxes(c) {
  ctx = c;
  const s = c.store;
  cols = {
    bereiche: s.collection('bereiche'),
    kisten: s.collection('kisten'),
    bilder: s.collection('bilder'),
  };
  const onErr = (e) => console.warn('Kisten:', e);
  cols.bereiche.subscribe((d) => { bereiche = d; d.forEach((x) => neu.delete(x.id)); loaded.b = true; ctx.onChange(); }, onErr);
  cols.kisten.subscribe((d) => { kisten = d; d.forEach((x) => neu.delete(x.id)); loaded.k = true; ctx.onChange(); }, onErr);
}

export const boxesReady = () => loaded.b && loaded.k;

// Beim Wechsel der Ansicht neu aufbauen.
export function resetBoxView() {
  current = { key: null, update: null };
}

function watchBilder(kisteId) {
  if (bilderFor === kisteId) return;
  bilderUnsub?.();
  bilder = [];
  bilderFor = kisteId;
  bilderUnsub = kisteId
    ? ctx.store.collection('bilder', { where: ['kiste', kisteId] }).subscribe((d) => {
      bilder = d.sort((a, b) => (a.erstelltAm || 0) - (b.erstelltAm || 0));
      current.update?.();
    }, (e) => console.warn('Bilder:', e))
    : null;
}

export function viewBoxes(view, arg) {
  const key = `${view || ''}/${arg || ''}`;
  if (current.key === key && current.update) return current.update();
  watchBilder(view === 'kiste' ? arg : null);
  current = { key, update: null };
  if (view === 'bereich') return viewBereich(arg);
  if (view === 'kiste') return viewKiste(arg);
  return viewOverview();
}

// Bereich/Kiste nicht (mehr) da: kurz warten, wenn gerade angelegt, sonst zur Übersicht.
function missing(id) {
  if (neu.has(id)) ctx.app.replaceChildren(...ctx.notices(), el('p', { class: 'empty' }, 'Wird gespeichert …'));
  else location.hash = '#/kisten';
}

function created(id, promise) {
  neu.add(id);
  promise.catch((e) => { neu.delete(id); fail(e); location.hash = '#/kisten'; });
}

const bereichName = (id) => bereiche.find((b) => b.id === id)?.name || 'ohne Bereich';
const kistenIn = (id) => kisten.filter((k) => k.bereich === id).sort(byNummer);

// ---------- Türme (freiwillige Gruppen innerhalb eines Bereichs) ----------

const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });
const tuermeIn = (bereichId) => [...(bereiche.find((b) => b.id === bereichId)?.tuerme || [])].sort(byName);
// Turm der Kiste, nur wenn er im Bereich der Kiste (noch) existiert
const turmOf = (k) => (k.turm ? tuermeIn(k.bereich).find((t) => t.id === k.turm) || null : null);
const kistenImTurm = (bereichId, turmId) => kistenIn(bereichId).filter((k) => (turmOf(k)?.id || '') === turmId);

// Kistennummern als Knöpfe, ein Tipp öffnet die Kiste
function nummernChips(list, extra) {
  return el('div', { class: 'num-chips' },
    ...list.map((k) => el('a', { class: 'num', href: `#/kisten/kiste/${k.id}` }, k.nummer)),
    extra || null);
}

// Kisten eines Turms als kleine Kacheln: Bild (Tipp = groß) und Nummer (Tipp = Kiste öffnen)
function boxTiles(list, extra) {
  return el('div', { class: 'box-tiles' },
    ...list.map((k) => el('div', { class: 'box-tile' },
      thumbBtn(k),
      el('a', { class: 'num', href: `#/kisten/kiste/${k.id}` }, k.nummer))),
    extra || null);
}

// Vorhandene Kisten des Bereichs einem Turm zuordnen
async function addToTurm(b, t) {
  const kandidaten = kistenIn(b.id).filter((k) => turmOf(k)?.id !== t.id);
  const boxes = kandidaten.map((k) => {
    const other = turmOf(k);
    return el('label', { class: 'check-row' },
      el('input', { type: 'checkbox', value: k.id }),
      el('span', {}, el('strong', {}, k.nummer), k.name ? ` ${k.name}` : ''),
      other ? el('span', { class: 'muted small' }, ` (jetzt in ${other.name})`) : null);
  });
  const res = await dialog((f) => f.append(
    el('h2', {}, `Kisten zu Turm „${t.name}“ hinzufügen`),
    kandidaten.length
      ? el('div', { class: 'check-list' }, boxes)
      : el('p', { class: 'muted small' }, 'Alle Kisten dieses Bereichs stehen schon in diesem Turm.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      kandidaten.length ? el('button', { class: 'btn', value: 'ok' }, 'Hinzufügen') : null),
  ));
  if (res !== 'ok') return;
  const ids = boxes.map((l) => l.querySelector('input')).filter((c) => c.checked).map((c) => c.value);
  ids.forEach((id) => cols.kisten.update(id, { turm: t.id }).catch(fail));
  if (ids.length) toast(ids.length === 1 ? '1 Kiste hinzugefügt' : `${ids.length} Kisten hinzugefügt`);
}

// Auswahl eines Turms als Knöpfe; liefert { wrap, value() }
function turmPicker(bereichId, selected, name) {
  const tuerme = tuermeIn(bereichId);
  const wrap = el('div', { class: 'rchips', role: 'radiogroup' },
    [{ id: '', name: 'kein Turm' }, ...tuerme].map((t) => el('label', { class: 'chip' },
      el('input', { type: 'radio', name, value: t.id, checked: t.id === (selected || '') }),
      el('span', {}, t.name))));
  return { wrap, tuerme, value: () => wrap.querySelector('input:checked')?.value || '' };
}

async function editTurm(b, turm) {
  const isNew = !turm;
  const alle = kistenIn(b.id);
  const drin = new Set(isNew ? [] : kistenImTurm(b.id, turm.id).map((k) => k.id));
  const name = el('input', { type: 'text', id: 't-name', value: turm?.name || '', placeholder: 'z. B. G05 (oberste Kiste)', maxlength: 30, required: true, autofocus: true });
  const suggest = el('div', { class: 'num-chips' });
  const boxes = alle.map((k) => {
    const other = turmOf(k);
    const cb = el('input', { type: 'checkbox', value: k.id, checked: drin.has(k.id) });
    cb.addEventListener('change', renderSuggest);
    return el('label', { class: 'check-row' }, cb,
      el('span', {}, el('strong', {}, k.nummer), k.name ? ` ${k.name}` : ''),
      other && other.id !== turm?.id ? el('span', { class: 'muted small' }, ` (jetzt in ${other.name})`) : null);
  });
  function renderSuggest() {
    const ids = boxes.map((l) => l.querySelector('input')).filter((c) => c.checked).map((c) => c.value);
    const list = alle.filter((k) => ids.includes(k.id));
    suggest.replaceChildren(...list.map((k) => el('button', {
      type: 'button', class: 'num', onclick: () => { name.value = k.nummer; name.focus(); },
    }, k.nummer)));
    suggest.hidden = !list.length;
  }
  renderSuggest();
  const res = await dialog((f) => f.append(
    el('h2', {}, isNew ? `Neuer Turm in ${b.name}` : 'Turm bearbeiten'),
    el('label', { for: 't-name' }, 'Name des Turms'), name,
    el('p', { class: 'muted small' }, 'Antippen übernimmt die Nummer als Namen (z. B. die oberste Kiste):'), suggest,
    el('h3', { class: 'subhead' }, 'Kisten in diesem Turm'),
    alle.length ? el('div', { class: 'check-list' }, boxes) : el('p', { class: 'muted small' }, 'Noch keine Kisten in diesem Bereich.'),
    el('div', { class: 'row' },
      isNew ? null : el('button', { class: 'btn danger', value: 'delete', formnovalidate: true }, 'Löschen'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'save' }, 'Speichern')),
  ));
  const tuerme = [...(bereiche.find((x) => x.id === b.id)?.tuerme || [])];
  if (res === 'delete' && turm) {
    const betroffen = kistenImTurm(b.id, turm.id);
    if (await confirmDelete(`Turm „${turm.name}“ löschen?`, betroffen.length
      ? `Die ${betroffen.length} Kisten bleiben erhalten und stehen danach unter „Ohne Turm“.`
      : 'Der leere Turm wird entfernt.')) {
      cols.bereiche.update(b.id, { tuerme: tuerme.filter((t) => t.id !== turm.id) }).catch(fail);
      betroffen.forEach((k) => cols.kisten.update(k.id, { turm: '' }).catch(fail));
    }
    return;
  }
  if (res !== 'save' || !name.value.trim()) return;
  const id = turm?.id || newId().slice(0, 12);
  const data = { id, name: name.value.trim() };
  const next = isNew ? [...tuerme, data] : tuerme.map((t) => (t.id === id ? data : t));
  cols.bereiche.update(b.id, { tuerme: next }).catch(fail);
  const gewaehlt = new Set(boxes.map((l) => l.querySelector('input')).filter((c) => c.checked).map((c) => c.value));
  for (const k of alle) {
    const jetzt = turmOf(k)?.id || '';
    if (gewaehlt.has(k.id) && jetzt !== id) cols.kisten.update(k.id, { turm: id }).catch(fail);
    else if (!gewaehlt.has(k.id) && jetzt === id) cols.kisten.update(k.id, { turm: '' }).catch(fail);
  }
}

function backLink(href, text) {
  return el('a', { class: 'back', href }, `‹ ${text}`);
}

// Vorschaubild in Listen: Tipp zeigt das Titelbild groß, ohne Bild öffnet es die Kiste.
function thumbBtn(k) {
  if (!k.titelbild) {
    return el('a', { class: 'thumb thumb-empty', href: `#/kisten/kiste/${k.id}`, 'aria-label': `Kiste ${k.nummer} öffnen` }, '📦');
  }
  return el('button', { type: 'button', class: 'thumb-btn', onclick: () => showTitelbild(k), 'aria-label': `Bild von Kiste ${k.nummer} groß anzeigen` },
    el('img', { class: 'thumb', src: k.titelbild, alt: '', loading: 'lazy' }));
}

// Titelbild groß: sofort die Vorschau, dann das volle Foto nachladen.
async function showTitelbild(k) {
  const img = el('img', { class: 'photo-big', src: k.titelbild, alt: `Foto von Kiste ${k.nummer}` });
  const unsub = ctx.store.collection('bilder', { where: ['kiste', k.id] }).subscribe((d) => {
    const b = d.find((x) => x.thumb === k.titelbild) || d[0];
    if (b?.voll) img.src = b.voll;
  }, () => {});
  const res = await dialog((f) => f.append(
    el('h2', {}, k.name ? `${k.nummer} · ${k.name}` : k.nummer),
    img,
    el('div', { class: 'row' },
      el('button', { class: 'btn secondary', value: 'open' }, 'Kiste öffnen'),
      el('button', { class: 'btn', value: '', autofocus: true }, 'Schließen')),
  ));
  unsub?.();
  if (res === 'open') location.hash = `#/kisten/kiste/${k.id}`;
}

// ---------- Übersicht mit Suche ----------

function getFilter() {
  try { return new Set(JSON.parse(localStorage.getItem(SUCH_KEY)) || []); } catch { return new Set(); }
}
function setFilter(set) {
  try { localStorage.setItem(SUCH_KEY, JSON.stringify([...set])); } catch { /* ignorieren */ }
}

function search(text, filter) {
  const words = norm(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const k of kisten) {
    if (filter.size && !filter.has(k.bereich)) continue;
    const lines = (k.inhalt || []).map((i) => (i.n ? `${i.n} × ${i.t}` : i.t));
    const hay = norm([k.nummer, k.name, k.notiz, ...lines, bereichName(k.bereich), turmOf(k)?.name].join(' \n '));
    if (!words.every((w) => hay.includes(w))) continue;
    const treffer = lines.filter((l) => words.some((w) => norm(l).includes(w)));
    out.push({ k, treffer });
  }
  return out.sort((a, b) => byNummer(a.k, b.k)).slice(0, 100);
}

function viewOverview() {
  const app = ctx.app;
  const input = el('input', { type: 'search', id: 'k-suche', placeholder: 'Suchen, z. B. Akkuschrauber', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'In Kisten suchen' });
  const chips = el('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Suchen in' });
  const body = el('div', { class: 'stack' });
  let filter = getFilter();

  const renderChips = () => {
    // Gelöschte Bereiche aus der Auswahl entfernen
    filter = new Set([...filter].filter((id) => bereiche.some((b) => b.id === id)));
    const toggle = (id) => {
      if (id === null) filter.clear();
      else if (filter.has(id)) filter.delete(id);
      else filter.add(id);
      setFilter(filter);
      update();
    };
    chips.replaceChildren(
      el('button', { type: 'button', class: `fchip${filter.size ? '' : ' on'}`, 'aria-pressed': String(!filter.size), onclick: () => toggle(null) }, 'Alle Bereiche'),
      ...[...bereiche].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((b) => el('button', {
        type: 'button', class: `fchip${filter.has(b.id) ? ' on' : ''}`, 'aria-pressed': String(filter.has(b.id)), onclick: () => toggle(b.id),
      }, b.name)));
  };

  const renderTiles = () => {
    if (!bereiche.length) {
      return el('p', { class: 'empty' }, el('span', { class: 'big' }, '📦'), 'Noch keine Bereiche. Lege zuerst einen an, z. B. „Garage“.');
    }
    return el('div', { class: 'fach-grid' }, [...bereiche].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((b) => {
      const n = kistenIn(b.id).length;
      return el('a', { class: 'fach', href: `#/kisten/bereich/${b.id}` },
        el('span', { class: 'fach-nr' }, b.kuerzel || '•'),
        el('span', { class: 'fach-name' }, b.name),
        el('span', { class: 'fach-count' }, n === 1 ? '1 Kiste' : `${n} Kisten`));
    }));
  };

  const renderResults = () => {
    const res = search(input.value, filter);
    if (!res.length) return el('p', { class: 'empty' }, 'Nichts gefunden.');
    return el('div', { class: 'stack' },
      el('h2', { class: 'subhead' }, res.length === 1 ? '1 Kiste gefunden' : `${res.length} Kisten gefunden`),
      el('ul', { class: 'list' }, res.map(({ k, treffer }) => el('li', { class: 'item' },
        thumbBtn(k),
        el('a', { class: 'body box-text', href: `#/kisten/kiste/${k.id}` },
            el('div', { class: 'what' }, el('span', { class: 'artikel' }, k.nummer), k.name ? el('span', {}, k.name) : null),
            el('div', { class: 'meta' }, bereichName(k.bereich), turmOf(k) ? el('strong', {}, ` · im Turm ${turmOf(k).name}`) : null),
            treffer.length ? el('div', { class: 'hits' }, treffer.slice(0, 4).join(' · ')) : null)))));
  };

  const update = () => {
    renderChips();
    body.replaceChildren(input.value.trim() ? renderResults() : renderTiles());
  };

  input.addEventListener('input', update);
  app.replaceChildren(
    ...ctx.notices(),
    el('section', { class: 'card search' }, input, chips),
    body,
    el('button', { class: 'btn big', type: 'button', onclick: editBereich }, '+ Bereich anlegen'),
  );
  current.update = update;
  update();
}

// ---------- Bereich ----------

function viewBereich(id) {
  const app = ctx.app;
  const update = () => {
    const b = bereiche.find((x) => x.id === id);
    if (!b) { missing(id); return; }
    const list = kistenIn(id);
    const tuerme = tuermeIn(id);
    const ohne = kistenImTurm(id, '');
    const turmCards = tuerme.length ? el('div', { class: 'stack' },
      el('h2', { class: 'subhead' }, 'Türme'),
      ...tuerme.map((t) => {
        const drin = kistenImTurm(id, t.id);
        return el('section', { class: 'turm' },
          el('div', { class: 'turm-head' },
            el('button', { type: 'button', class: 'turm-name', onclick: () => editTurm(b, t), 'aria-label': `Turm ${t.name} bearbeiten` },
              el('strong', {}, `Turm „${t.name}“`), el('span', { class: 'muted small' }, drin.length === 1 ? ' · 1 Kiste' : ` · ${drin.length} Kisten`)),
            el('button', { type: 'button', class: 'btn small secondary', onclick: () => editTurm(b, t), 'aria-label': 'Bearbeiten' }, '✎')),
          boxTiles(drin, el('button', { type: 'button', class: 'box-tile tile-add', onclick: () => addToTurm(b, t), 'aria-label': `Vorhandene Kisten zu Turm ${t.name} hinzufügen` },
            el('span', { class: 'tile-plus' }, '+'), el('span', { class: 'small' }, 'Kisten'))));
      }),
      ohne.length ? el('section', { class: 'turm turm-ohne' },
        el('div', { class: 'turm-head' }, el('span', {}, el('strong', {}, 'Ohne Turm'), el('span', { class: 'muted small' }, ohne.length === 1 ? ' · 1 Kiste' : ` · ${ohne.length} Kisten`))),
        boxTiles(ohne)) : null) : null;
    app.replaceChildren(
      ...ctx.notices(),
      backLink('#/kisten', 'Alle Bereiche'),
      el('div', { class: 'section-head' },
        el('h2', { class: 'title' }, b.name),
        el('button', { class: 'btn small secondary', type: 'button', onclick: () => editBereich(b) }, 'Bearbeiten')),
      turmCards,
      tuerme.length && list.length ? el('h2', { class: 'subhead' }, 'Alle Kisten') : null,
      list.length
        ? el('ul', { class: 'list' }, list.map((k) => el('li', { class: 'item' },
          thumbBtn(k),
          el('a', { class: 'body box-text', href: `#/kisten/kiste/${k.id}` },
              el('div', { class: 'what' }, el('span', { class: 'artikel' }, k.nummer), k.name ? el('span', {}, k.name) : null),
              el('div', { class: 'meta' }, (k.inhalt || []).slice(0, 3).map((i) => i.t).join(', ') || 'noch kein Inhalt eingetragen'),
              el('div', { class: 'meta' }, `${k.inhalt?.length || 0} Einträge · ${k.bildAnzahl || 0} Fotos${turmOf(k) ? ` · Turm ${turmOf(k).name}` : ''}`)))))
        : el('p', { class: 'empty' }, el('span', { class: 'big' }, '📦'), 'Noch keine Kisten in diesem Bereich.'),
      el('div', { class: 'two' },
        el('button', { class: 'btn big', type: 'button', onclick: () => newKiste(b) }, '+ Neue Kiste'),
        el('button', { class: 'btn big secondary', type: 'button', onclick: () => editTurm(b, null) }, '+ Turm')),
    );
  };
  current.update = update;
  update();
}

function defaultKuerzel(name) {
  const clean = name.replace(/[^A-Za-zÄÖÜäöü]/g, '').toUpperCase();
  const used = new Set(bereiche.map((b) => b.kuerzel));
  for (const k of [clean.slice(0, 1), clean.slice(0, 2), clean.slice(0, 3)]) if (k && !used.has(k)) return k;
  return clean.slice(0, 2) || 'K';
}

async function editBereich(b) {
  const isNew = !b || b instanceof Event;
  if (isNew) b = null;
  const name = el('input', { type: 'text', id: 'b-name', value: b?.name || '', placeholder: 'z. B. Garage', maxlength: 40, required: true });
  const kuerzel = el('input', { type: 'text', id: 'b-kuerzel', value: b?.kuerzel || '', placeholder: 'z. B. G', maxlength: 4, autocapitalize: 'characters' });
  if (isNew) name.addEventListener('input', () => { if (!kuerzel.dataset.touched) kuerzel.value = defaultKuerzel(name.value); });
  kuerzel.addEventListener('input', () => { kuerzel.dataset.touched = '1'; });
  const anzahl = b ? kistenIn(b.id).length : 0;
  const res = await dialog((f) => f.append(
    el('h2', {}, isNew ? 'Neuer Bereich' : 'Bereich bearbeiten'),
    el('label', { for: 'b-name' }, 'Name'), name,
    el('label', { for: 'b-kuerzel' }, 'Kürzel für die Kistennummern (G → G01, G02 …)'), kuerzel,
    !isNew && anzahl ? el('p', { class: 'muted small' }, `Enthält ${anzahl} Kisten. Löschen geht erst, wenn der Bereich leer ist.`) : null,
    el('div', { class: 'row' },
      !isNew && !anzahl ? el('button', { class: 'btn danger', value: 'delete', formnovalidate: true }, 'Löschen') : null,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'save' }, 'Speichern')),
  ));
  if (res === 'delete' && b && !kistenIn(b.id).length) {
    if (await confirmDelete(`Bereich „${b.name}“ löschen?`, 'Der leere Bereich wird für alle entfernt.')) {
      cols.bereiche.remove(b.id).catch(fail);
      location.hash = '#/kisten';
    }
    return;
  }
  if (res !== 'save') return;
  const data = {
    name: name.value.trim(),
    kuerzel: (kuerzel.value.trim() || defaultKuerzel(name.value)).toUpperCase().slice(0, 4),
  };
  if (!data.name) return;
  if (isNew) {
    const id = newId();
    created(id, cols.bereiche.set(id, { ...data, erstelltAm: ctx.store.NOW }));
    location.hash = `#/kisten/bereich/${id}`;
  } else {
    cols.bereiche.update(b.id, data).catch(fail);
  }
}

function nextNummer(b) {
  const prefix = b.kuerzel || '';
  const re = new RegExp(`^${prefix.replace(/[^A-Za-zÄÖÜ0-9]/g, '')}(\\d+)$`, 'i');
  const max = kisten.reduce((m, k) => {
    const hit = re.exec(k.nummer || '');
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

async function newKiste(b, turmId = '') {
  const nummer = el('input', { type: 'text', id: 'n-nummer', value: nextNummer(b), maxlength: 12, required: true });
  const name = el('input', { type: 'text', id: 'n-name', placeholder: 'optional, z. B. Weihnachtsdeko', maxlength: 60, autofocus: true });
  const turm = turmPicker(b.id, turmId, 'n-turm');
  const res = await dialog((f) => f.append(
    el('h2', {}, `Neue Kiste in ${b.name}`),
    el('label', { for: 'n-nummer' }, 'Nummer'), nummer,
    el('label', { for: 'n-name' }, 'Bezeichnung'), name,
    turm.tuerme.length ? el('label', {}, 'Turm') : null,
    turm.tuerme.length ? turm.wrap : null,
    el('div', { class: 'row' },
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'ok' }, 'Anlegen')),
  ));
  if (res !== 'ok' || !nummer.value.trim()) return;
  const id = newId();
  created(id, cols.kisten.set(id, {
    bereich: b.id, turm: turm.value(), nummer: nummer.value.trim().toUpperCase(), name: name.value.trim(), notiz: '',
    inhalt: [], titelbild: '', bildAnzahl: 0, erstelltAm: ctx.store.NOW,
  }));
  location.hash = `#/kisten/kiste/${id}`;
}

// ---------- Kiste ----------

function viewKiste(id) {
  const app = ctx.app;
  const k0 = kisten.find((x) => x.id === id);
  if (!k0) { missing(id); return; }

  const head = el('div', { class: 'stack' });
  const photos = el('div', { class: 'photos' });
  const list = el('ul', { class: 'list' });
  const count = el('h2', { class: 'subhead' });
  // Zwei Wege: Kamera direkt (capture) oder mehrere Fotos aus der Galerie.
  const picker = (pid, attrs) => {
    const input = el('input', { type: 'file', id: pid, accept: 'image/*', class: 'visually-hidden', ...attrs });
    input.addEventListener('change', () => {
      const files = [...input.files];
      input.value = '';
      addPhotos(id, files);
    });
    return input;
  };
  const camInput = picker('k-kamera', { capture: 'environment' });
  const fileInput = picker('k-fotos', { multiple: true });

  const text = el('input', { type: 'text', id: 'k-inhalt', placeholder: 'Was ist drin?', autocomplete: 'off', maxlength: 100, enterkeyhint: 'done', 'aria-label': 'Inhalt' });
  const anzahl = el('input', { type: 'text', id: 'k-anzahl', placeholder: 'Anz.', autocomplete: 'off', maxlength: 12, inputmode: 'text', 'aria-label': 'Anzahl' });
  const form = el('form', {
    class: 'add',
    onsubmit: (e) => {
      e.preventDefault();
      const k = kisten.find((x) => x.id === id);
      const t = text.value.trim();
      if (!k || !t) { text.focus(); return; }
      cols.kisten.update(id, { inhalt: [...(k.inhalt || []), { t, n: anzahl.value.trim() }] }).catch(fail);
      text.value = '';
      anzahl.value = '';
      text.focus();
    },
  }, text, anzahl, el('button', { class: 'btn', type: 'submit' }, 'Hinzufügen'));

  const update = () => {
    const k = kisten.find((x) => x.id === id);
    if (!k) { missing(id); return; }
    head.replaceChildren(
      backLink(`#/kisten/bereich/${k.bereich}`, bereichName(k.bereich)),
      el('div', { class: 'section-head' },
        el('h2', { class: 'title' }, k.name ? `${k.nummer} · ${k.name}` : k.nummer),
        el('button', { class: 'btn small secondary', type: 'button', onclick: () => editKiste(k) }, 'Bearbeiten')),
      turmInfo(k),
      k.notiz ? el('p', { class: 'note' }, k.notiz) : null);

    const tiles = bilder.map((b) => el('button', { type: 'button', class: 'photo', onclick: () => showPhoto(k, b), 'aria-label': 'Foto groß anzeigen' },
      el('img', { src: b.thumb, alt: '', loading: 'lazy' })));
    const voll = bilder.length >= MAX_BILDER;
    photos.replaceChildren(...tiles,
      voll ? null : el('label', { class: 'photo photo-add', for: 'k-kamera' }, el('span', { class: 'ico' }, '📷'), el('span', {}, 'Foto machen')),
      voll ? null : el('label', { class: 'photo photo-add', for: 'k-fotos' }, el('span', { class: 'ico' }, '🖼️'), el('span', {}, 'Aus Galerie')));

    const inhalt = k.inhalt || [];
    count.textContent = inhalt.length ? `Inhalt (${inhalt.length})` : 'Inhalt';
    list.replaceChildren(...(inhalt.length
      ? inhalt.map((i, idx) => el('li', { class: 'item' },
        el('div', { class: 'body', role: 'button', tabindex: 0, onclick: () => editLine(id, idx), onkeydown: (e) => { if (e.key === 'Enter') editLine(id, idx); } },
          el('div', { class: 'what' }, el('span', { class: 'artikel' }, i.t), i.n ? el('span', { class: 'menge' }, i.n) : null))))
      : [el('li', { class: 'empty' }, 'Noch nichts eingetragen. Oben eintragen, was in der Kiste ist.')]));
  };

  app.replaceChildren(...ctx.notices(), head, photos, camInput, fileInput, count, form, list);
  current.update = update;
  update();
}

// „im Turm G05 · zusammen mit G02, G11“
function turmInfo(k) {
  const t = turmOf(k);
  if (!t) return null;
  const andere = kistenImTurm(k.bereich, t.id).filter((x) => x.id !== k.id);
  return el('div', { class: 'turm-info' },
    el('span', {}, '🗼 im Turm ', el('strong', {}, t.name), andere.length ? ' · zusammen mit' : ' · allein im Turm'),
    andere.length ? nummernChips(andere) : null);
}

async function editKiste(k) {
  const nummer = el('input', { type: 'text', id: 'e-nummer', value: k.nummer, maxlength: 12, required: true });
  const name = el('input', { type: 'text', id: 'e-name', value: k.name || '', maxlength: 60 });
  const notiz = el('textarea', { id: 'e-notiz', maxlength: 500, rows: 3 }, k.notiz || '');
  const bereich = el('select', { id: 'e-bereich' }, [...bereiche].sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((b) => el('option', { value: b.id, selected: b.id === k.bereich }, b.name)));
  // Turm-Auswahl passend zum gewählten Bereich
  const turmSlot = el('div', { class: 'stack-tight' });
  let turm = null;
  const renderTurm = () => {
    turm = turmPicker(bereich.value, bereich.value === k.bereich ? turmOf(k)?.id : '', 'e-turm');
    turmSlot.replaceChildren(...(turm.tuerme.length ? [el('label', {}, 'Turm'), turm.wrap] : []));
  };
  bereich.addEventListener('change', renderTurm);
  renderTurm();
  const res = await dialog((f) => f.append(
    el('h2', {}, 'Kiste bearbeiten'),
    el('label', { for: 'e-nummer' }, 'Nummer'), nummer,
    el('label', { for: 'e-name' }, 'Bezeichnung'), name,
    el('label', { for: 'e-notiz' }, 'Notiz (z. B. Standort im Regal)'), notiz,
    el('label', { for: 'e-bereich' }, 'Bereich'), bereich,
    turmSlot,
    el('div', { class: 'row' },
      el('button', { class: 'btn danger', value: 'delete', formnovalidate: true }, 'Löschen'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'save' }, 'Speichern')),
  ));
  if (res === 'delete') {
    const n = k.inhalt?.length || 0;
    if (await confirmDelete(`Kiste ${k.nummer} löschen?`, `Die Kiste wird mit ${n} Einträgen und ${bilder.length} Fotos für alle gelöscht.`)) {
      const ids = bilder.filter((b) => b.kiste === k.id).map((b) => b.id);
      if (ids.length) cols.bilder.removeMany(ids).catch(fail);
      cols.kisten.remove(k.id).catch(fail);
      location.hash = `#/kisten/bereich/${k.bereich}`;
      toast(`Kiste ${k.nummer} gelöscht`);
    }
    return;
  }
  if (res !== 'save') return;
  cols.kisten.update(k.id, {
    nummer: nummer.value.trim().toUpperCase() || k.nummer,
    name: name.value.trim(),
    notiz: notiz.value.trim(),
    bereich: bereich.value || k.bereich,
    turm: turm.value(),
  }).catch(fail);
}

async function editLine(kisteId, idx) {
  const k = kisten.find((x) => x.id === kisteId);
  const line = k?.inhalt?.[idx];
  if (!line) return;
  const text = el('input', { type: 'text', id: 'l-text', value: line.t, maxlength: 100, required: true });
  const anzahl = el('input', { type: 'text', id: 'l-anzahl', value: line.n || '', maxlength: 12 });
  const res = await dialog((f) => f.append(
    el('h2', {}, 'Eintrag bearbeiten'),
    el('label', { for: 'l-text' }, 'Inhalt'), text,
    el('label', { for: 'l-anzahl' }, 'Anzahl'), anzahl,
    el('div', { class: 'row' },
      el('button', { class: 'btn danger', value: 'delete', formnovalidate: true }, 'Löschen'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn secondary', value: '', formnovalidate: true }, 'Abbrechen'),
      el('button', { class: 'btn', value: 'save' }, 'Speichern')),
  ));
  // Aktuellen Stand neu holen: jemand anderes könnte die Liste inzwischen geändert haben.
  const now = kisten.find((x) => x.id === kisteId);
  const list = [...(now?.inhalt || [])];
  const pos = list.findIndex((x) => x.t === line.t && (x.n || '') === (line.n || ''));
  if (pos < 0) return;
  if (res === 'delete') {
    if (await confirmDelete(`„${line.t}“ löschen?`, 'Der Eintrag wird aus der Kiste entfernt.')) {
      list.splice(pos, 1);
      cols.kisten.update(kisteId, { inhalt: list }).catch(fail);
    }
  } else if (res === 'save' && text.value.trim()) {
    list[pos] = { t: text.value.trim(), n: anzahl.value.trim() };
    cols.kisten.update(kisteId, { inhalt: list }).catch(fail);
  }
}

// ---------- Fotos ----------

// Bild laden; createImageBitmap dreht Handyfotos richtig (EXIF) und braucht keine sichtbare Seite.
async function loadImage(file) {
  if ('createImageBitmap' in self) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* Rückfall unten */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild nicht lesbar'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toJpeg(img, maxSide, quality) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Foto auf höchstens ca. 250 KB verkleinern, dazu ein kleines Vorschaubild.
async function compress(file) {
  const img = await loadImage(file);
  let voll = '';
  for (const [side, q] of [[1600, 0.8], [1600, 0.7], [1400, 0.65], [1200, 0.6], [1000, 0.6], [800, 0.55]]) {
    voll = toJpeg(img, side, q);
    if (voll.length <= VOLL_MAX) break;
  }
  let thumb = toJpeg(img, 240, 0.6);
  if (thumb.length > 30000) thumb = toJpeg(img, 160, 0.5);
  return { voll, thumb };
}

async function addPhotos(kisteId, files) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  const name = await ctx.askName();
  const vorher = bilder.length;
  const platz = MAX_BILDER - vorher;
  const batch = images.slice(0, platz);
  if (images.length > platz) toast(`Höchstens ${MAX_BILDER} Fotos pro Kiste. ${images.length - platz} wurden nicht übernommen.`);
  let first = '';
  let ok = 0;
  for (let i = 0; i < batch.length; i++) {
    toast(`Foto ${i + 1} von ${batch.length} wird verkleinert …`);
    try {
      const { voll, thumb } = await compress(batch[i]);
      if (voll.length > 400000) throw new Error('zu groß');
      cols.bilder.set(newId(), { kiste: kisteId, voll, thumb, erstelltAm: ctx.store.NOW, von: name }).catch(fail);
      if (!first) first = thumb;
      ok++;
    } catch (e) {
      console.warn(e);
      toast(`Foto ${i + 1} konnte nicht gelesen werden.`);
    }
  }
  if (!ok) return;
  const k = kisten.find((x) => x.id === kisteId);
  if (k) {
    cols.kisten.update(kisteId, {
      // bilder kann die neuen Fotos schon enthalten (sofortige lokale Rückmeldung)
      bildAnzahl: Math.min(MAX_BILDER, Math.max(bilder.length, vorher + ok)),
      ...(k.titelbild ? {} : { titelbild: first }),
    }).catch(fail);
  }
  toast(ok === 1 ? 'Foto gespeichert' : `${ok} Fotos gespeichert`);
}

async function showPhoto(k, b) {
  const istTitel = k.titelbild === b.thumb;
  const res = await dialog((f) => f.append(
    el('img', { class: 'photo-big', src: b.voll || b.thumb, alt: `Foto von Kiste ${k.nummer}` }),
    el('p', { class: 'muted small' }, `${b.von || '?'} · ${fmtDate(b.erstelltAm instanceof Date ? b.erstelltAm : null)}`),
    el('div', { class: 'row' },
      el('button', { class: 'btn danger', value: 'delete' }, 'Löschen'),
      el('span', { class: 'spacer' }),
      istTitel ? null : el('button', { class: 'btn secondary', value: 'titel' }, 'Als Titelbild'),
      el('button', { class: 'btn', value: '', autofocus: true }, 'Schließen')),
  ));
  if (res === 'titel') {
    cols.kisten.update(k.id, { titelbild: b.thumb }).catch(fail);
  } else if (res === 'delete' && await confirmDelete('Foto löschen?', `Das Foto wird aus Kiste ${k.nummer} entfernt.`)) {
    cols.bilder.remove(b.id).catch(fail);
    const rest = bilder.filter((x) => x.id !== b.id);
    cols.kisten.update(k.id, {
      bildAnzahl: rest.length,
      ...(istTitel ? { titelbild: rest[0]?.thumb || '' } : {}),
    }).catch(fail);
  }
}
