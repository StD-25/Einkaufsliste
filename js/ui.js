// Gemeinsame Bausteine für alle Ansichten: Elemente bauen, Dialoge, Hinweise, Datumsformate.

export const $ = (sel) => document.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');

// Zeitpunkt (Date) → "heute 14:30", "gestern 09:10", "Sa 25.10. 14:30"
export function fmtDate(d) {
  if (!d) return 'gerade eben';
  const now = new Date();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `heute ${time}`;
  if (diff === 1) return `gestern ${time}`;
  return `${WT[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${time}`;
}

// Kalendertag als 'JJJJ-MM-TT' (lokale Zeit)
export function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 'JJJJ-MM-TT' → "03.11.2026"
export function fmtDay(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

// Tage von heute bis zum Tag s ('JJJJ-MM-TT'); negativ = vorbei
export function daysUntil(s) {
  const [y, m, d] = s.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

export function addMonths(months, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  return isoDay(d);
}

let toastTimer;
export function toast(text, actionLabel, action) {
  const t = $('#toast');
  $('#toast-text').textContent = text;
  const b = $('#toast-action');
  b.textContent = actionLabel || '';
  b.onclick = () => { t.hidden = true; action?.(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

export function fail(e) {
  console.error(e);
  toast('Speichern hat nicht geklappt. Bitte Internetverbindung prüfen.');
}

// Dialog mit Formular; resolve(Wert des gedrückten Knopfs) oder null bei Abbruch.
export function dialog(build, { required = false } = {}) {
  const dlg = $('#dlg');
  dlg.replaceChildren();
  return new Promise((resolve) => {
    const form = el('form', { method: 'dialog' });
    build(form);
    dlg.append(form);
    // Sofort auf den gedrückten Knopf reagieren (das close-Ereignis kommt je nach Browser verzögert).
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close(value || '');
      resolve(value || null);
    };
    const onCancel = (e) => { if (required) e.preventDefault(); };
    // Ein verspätetes close des vorigen Dialogs darf diesen nicht beenden: nur zählen, wenn wirklich zu.
    const onClose = () => { if (!dlg.open) finish(dlg.returnValue); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(e.submitter?.value || '');
    });
    dlg.addEventListener('cancel', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
    (form.querySelector('[autofocus]') || form.querySelector('input[type="text"]'))?.focus();
  });
}

// Sicherheitsabfrage vor jedem Löschen; "Abbrechen" steht vorne und hat den Fokus.
export async function confirmDelete(title, text) {
  const res = await dialog((f) => f.append(
    el('h2', {}, title),
    el('p', {}, text),
    el('div', { class: 'row' },
      el('button', { class: 'btn secondary', value: '', autofocus: true }, 'Abbrechen'),
      el('button', { class: 'btn danger', value: 'ok' }, 'Ja, löschen')),
  ));
  return res === 'ok';
}

// Zahlenfeld mit −/+ Knöpfen. Liefert { wrap, input }.
export function stepper(id, value, { min = 0, max = 999, label } = {}) {
  const input = el('input', { type: 'number', id, value, min, max, step: 'any', inputmode: 'decimal', 'aria-label': label || 'Anzahl' });
  const change = (delta) => {
    const v = Math.min(max, Math.max(min, (parseFloat(input.value) || 0) + delta));
    input.value = String(Math.round(v * 100) / 100);
  };
  const wrap = el('div', { class: 'stepper' },
    el('button', { type: 'button', class: 'step', 'aria-label': 'weniger', onclick: () => change(-1) }, '−'),
    input,
    el('button', { type: 'button', class: 'step', 'aria-label': 'mehr', onclick: () => change(1) }, '+'));
  return { wrap, input };
}

export const num = (s) => Math.round((parseFloat(String(s).replace(',', '.')) || 0) * 100) / 100;
