// Speicher der App.
// Mit Firebase-Konfiguration: Firestore (live für alle, offline-fähig).
// Ohne (oder mit ?demo in der Adresse): Demo-Modus in localStorage, nur dieses Gerät.
//
// Jede Familie hat einen geheimen Code; alle Daten liegen unter listen/<code>/<sammlung>.
// Ohne Code lässt sich die Liste weder finden noch lesen (siehe firestore.rules).
//
// Allgemeine Schnittstelle je Sammlung:  store.collection(name, { order, dir, limit })
//   subscribe(cb, onError) -> unsubscribe   cb(docs[])  (Zeitstempel als Date, id, pending)
//   add(data), set(id, data), update(id, patch), remove(id), removeMany(ids)
//   Der Wert store.NOW in data wird zum Server-Zeitpunkt.
// Einkaufsliste (Sammlung items) zusätzlich direkt am store:
//   subscribe, add({artikel, menge, name}), update, remove, removeMany
//   onConnection(cb)  cb('online' | 'offline')

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export const isDemo = !firebaseConfig.apiKey || new URLSearchParams(location.search).has('demo');

// 24 Zeichen aus 57 Buchstaben/Ziffern (ohne 0/O, 1/l/I) ≈ 140 Bit Zufall.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const isValidCode = (c) => typeof c === 'string' && /^[A-Za-z0-9]{20,64}$/.test(c);

const NOW = Symbol('now');

export async function createStore(code) {
  const base = isDemo ? createDemoBackend() : await createFirestoreBackend(code);
  const items = base.collection('items', { order: 'erstelltAm', dir: 'desc' });
  return {
    NOW,
    collection: base.collection,
    onConnection: base.onConnection,
    subscribe: (cb, onError) => items.subscribe((docs) => cb(docs.map((x) => ({
      ...x,
      menge: x.menge || '',
      erledigt: !!x.erledigt,
      erledigtVon: x.erledigtVon || '',
    }))), onError),
    add: ({ artikel, menge, name }) => items.add({
      artikel, menge, name,
      erstelltAm: NOW,
      erledigt: false, erledigtVon: '', erledigtAm: null,
    }),
    update(id, patch) {
      const p = { ...patch };
      if ('erledigt' in p) p.erledigtAm = p.erledigt ? NOW : null;
      return items.update(id, p);
    },
    remove: items.remove,
    removeMany: items.removeMany,
  };
}

async function createFirestoreBackend(code) {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });

  const a = auth.getAuth(app);
  // Ein einmal angemeldetes Gerät bleibt angemeldet, auch offline.
  await a.authStateReady();
  if (!a.currentUser) await auth.signInAnonymously(a);

  const toDate = (t) => (t && typeof t.toDate === 'function' ? t.toDate() : t);
  const prepare = (data) => Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v === NOW ? fs.serverTimestamp() : v]),
  );

  function collection(name, { order, dir = 'asc', limit } = {}) {
    const col = fs.collection(db, 'listen', code, name);
    return {
      subscribe(cb, onError) {
        const parts = [];
        if (order) parts.push(fs.orderBy(order, dir));
        if (limit) parts.push(fs.limit(limit));
        return fs.onSnapshot(
          fs.query(col, ...parts),
          { includeMetadataChanges: true },
          (snap) => cb(snap.docs.map((d) => {
            const x = d.data({ serverTimestamps: 'estimate' });
            const out = { id: d.id, pending: d.metadata.hasPendingWrites };
            for (const [k, v] of Object.entries(x)) out[k] = toDate(v);
            return out;
          })),
          onError,
        );
      },
      add: (data) => fs.addDoc(col, prepare(data)),
      set: (id, data) => fs.setDoc(fs.doc(col, id), prepare(data)),
      update: (id, patch) => fs.updateDoc(fs.doc(col, id), prepare(patch)),
      remove: (id) => fs.deleteDoc(fs.doc(col, id)),
      removeMany(ids) {
        const b = fs.writeBatch(db);
        ids.slice(0, 450).forEach((id) => b.delete(fs.doc(col, id)));
        return b.commit();
      },
    };
  }

  return {
    collection,
    onConnection(cb) {
      const emit = () => cb(navigator.onLine ? 'online' : 'offline');
      addEventListener('online', emit);
      addEventListener('offline', emit);
      emit();
    },
  };
}

function createDemoBackend() {
  const chan = 'BroadcastChannel' in self ? new BroadcastChannel('einkaufsliste-demo') : null;
  const listeners = new Map(); // key -> Set(fn)
  const ISO = /^\d{4}-\d\d-\d\dT/;

  const keyOf = (name) => (name === 'items' ? 'einkaufsliste-demo' : `einkaufsliste-demo-${name}`);
  const load = (key) => {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  };
  const emit = (key) => listeners.get(key)?.forEach((fn) => fn());
  const save = (key, rows) => {
    try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* Speicher blockiert */ }
    chan?.postMessage(key);
    emit(key);
  };
  if (chan) chan.onmessage = (e) => emit(e.data);
  addEventListener('storage', (e) => { if (e.key) emit(e.key); });

  const prepare = (data) => Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v === NOW ? new Date().toISOString() : v]),
  );

  function collection(name, { order, dir = 'asc', limit } = {}) {
    const key = keyOf(name);
    const read = () => {
      let rows = load(key).map((r) => {
        const out = { pending: false };
        for (const [k, v] of Object.entries(r)) out[k] = typeof v === 'string' && ISO.test(v) ? new Date(v) : v;
        return out;
      });
      if (order) {
        const s = dir === 'desc' ? -1 : 1;
        rows.sort((x, y) => (x[order] > y[order] ? s : x[order] < y[order] ? -s : 0));
      }
      if (limit) rows = rows.slice(0, limit);
      return rows;
    };
    return {
      subscribe(cb) {
        const fn = () => cb(read());
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(fn);
        queueMicrotask(fn);
        return () => listeners.get(key).delete(fn);
      },
      async add(data) {
        const id = crypto.randomUUID();
        save(key, [...load(key), { id, ...prepare(data) }]);
        return { id };
      },
      async set(id, data) {
        save(key, [...load(key).filter((r) => r.id !== id), { id, ...prepare(data) }]);
      },
      async update(id, patch) {
        save(key, load(key).map((r) => (r.id === id ? { ...r, ...prepare(patch) } : r)));
      },
      async remove(id) {
        save(key, load(key).filter((r) => r.id !== id));
      },
      async removeMany(ids) {
        const set = new Set(ids);
        save(key, load(key).filter((r) => !set.has(r.id)));
      },
    };
  }

  return { collection, onConnection(cb) { cb('offline'); } };
}
