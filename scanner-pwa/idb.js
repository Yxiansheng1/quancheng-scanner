/* 用 IndexedDB 存页面，刷新/关掉浏览器不会丢。存的是处理好的 JPEG blob。 */

const DB_NAME = 'scanner-mvp';
const DB_VERSION = 1;
const STORE = 'pages';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function savePage(page) {
  return tx('readwrite').then((store) => wrap(store.put(page)));
}

export function listPages() {
  return tx('readonly').then((store) => wrap(store.getAll()));
}

export function deletePage(id) {
  return tx('readwrite').then((store) => wrap(store.delete(id)));
}

export function clearPages() {
  return tx('readwrite').then((store) => wrap(store.clear()));
}
