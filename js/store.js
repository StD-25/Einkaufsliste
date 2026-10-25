// Speicher der Einkaufsliste.
// Mit Firebase-Konfiguration: Firestore (live für alle, offline-fähig).
// Ohne: Demo-Modus in localStorage, synchronisiert nur zwischen Tabs dieses Geräts.
//
// Jede Familie hat einen geheimen Code; die Einträge liegen unter listen/<code>/items.
// Ohne Code lässt sich die Liste weder finden noch lesen (siehe firestore.rules).
//
// Einheitliche Schnittstelle:
//   subscribe(cb, onError) -> unsubscribe   cb(items[])
//   add({artikel, menge, name}), update(id, patch), remove(id), removeMany(ids)
//   onConnection(cb)  cb('online' | 'offline')
// Ein Eintrag: { id, artikel, menge, name, erstelltAm: Date|null, erledigt, erledigtVon, erledigtAm: Date|null, pending }

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export const isDemo = !firebaseConfig.apiKey;

// 24 Zeichen aus 57 Buchstaben/Ziffern (ohne 0/O, 1/l/I) ≈ 140 Bit Zufall.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const isValidCode = (c) => typeof c === 'string' && /^[A-Za-z0-9]{20,64}$/.test(c);

export async function createStore(code) {
  return isDemo ? createDemoStore() : createFirestoreStore(code);
}

async function createFirestoreStore(code) {
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

  const col = fs.collection(db, 'listen', code, 'items');
  const toDate = (t) => (t && typeof t.toDate === 'function' ? t.toDate() : null);

  return {
    subscribe(cb, onError) {
      const q = fs.query(col, fs.orderBy('erstelltAm', 'desc'));
      return fs.onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap) => {
          cb(snap.docs.map((d) => {
            const x = d.data({ serverTimestamps: 'estimate' });
            return {
              id: d.id,
              artikel: x.artikel,
              menge: x.menge || '',
              name: x.name,
              erstelltAm: toDate(x.erstelltAm),
              erledigt: !!x.erledigt,
              erledigtVon: x.erledigtVon || '',
              erledigtAm: toDate(x.erledigtAm),
              pending: d.metadata.hasPendingWrites,
            };
          }));
        },
        onError,
      );
    },
    add({ artikel, menge, name }) {
      return fs.addDoc(col, {
        artikel, menge, name,
        erstelltAm: fs.serverTimestamp(),
        erledigt: false, erledigtVon: '', erledigtAm: null,
      });
    },
    update(id, patch) {
      const p = { ...patch };
      if ('erledigt' in p) p.erledigtAm = p.erledigt ? fs.serverTimestamp() : null;
      return fs.updateDoc(fs.doc(col, id), p);
    },
    remove(id) {
      return fs.deleteDoc(fs.doc(col, id));
    },
    removeMany(ids) {
      const b = fs.writeBatch(db);
      ids.forEach((id) => b.delete(fs.doc(col, id)));
      return b.commit();
    },
    onConnection(cb) {
      const emit = () => cb(navigator.onLine ? 'online' : 'offline');
      addEventListener('online', emit);
      addEventListener('offline', emit);
      emit();
    },
  };
}

function createDemoStore() {
  const KEY = 'einkaufsliste-demo';
  const chan = 'BroadcastChannel' in self ? new BroadcastChannel(KEY) : null;
  const listeners = new Set();

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  };
  const save = (rows) => {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* Speicher blockiert */ }
    chan?.postMessage('changed');
    emit();
  };
  const emit = () => {
    const items = load()
      .map((r) => ({
        ...r,
        erstelltAm: r.erstelltAm ? new Date(r.erstelltAm) : null,
        erledigtAm: r.erledigtAm ? new Date(r.erledigtAm) : null,
        pending: false,
      }))
      .sort((x, y) => (y.erstelltAm || 0) - (x.erstelltAm || 0));
    listeners.forEach((cb) => cb(items));
  };
  if (chan) chan.onmessage = emit;
  addEventListener('storage', (e) => { if (e.key === KEY) emit(); });

  return {
    subscribe(cb) {
      listeners.add(cb);
      queueMicrotask(emit);
      return () => listeners.delete(cb);
    },
    async add({ artikel, menge, name }) {
      const rows = load();
      rows.push({
        id: crypto.randomUUID(), artikel, menge, name,
        erstelltAm: new Date().toISOString(),
        erledigt: false, erledigtVon: '', erledigtAm: null,
      });
      save(rows);
    },
    async update(id, patch) {
      const p = { ...patch };
      if ('erledigt' in p) p.erledigtAm = p.erledigt ? new Date().toISOString() : null;
      save(load().map((r) => (r.id === id ? { ...r, ...p } : r)));
    },
    async remove(id) {
      save(load().filter((r) => r.id !== id));
    },
    async removeMany(ids) {
      const set = new Set(ids);
      save(load().filter((r) => !set.has(r.id)));
    },
    onConnection(cb) { cb('offline'); },
  };
}
