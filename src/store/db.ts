// Milestone C: persistence. A tiny promise wrapper over IndexedDB (this is a real app,
// so IndexedDB is the right store for templates + in-progress projects, including the
// large image data URLs that would blow past localStorage quotas).
const DB_NAME = 'autospec';
const VERSION = 1;
export const STORES = ['templates', 'projects'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const idbPut = <T>(store: StoreName, value: T): Promise<IDBValidKey> => run(store, 'readwrite', (s) => s.put(value));
export const idbGet = <T>(store: StoreName, id: string): Promise<T | undefined> => run(store, 'readonly', (s) => s.get(id));
export const idbAll = <T>(store: StoreName): Promise<T[]> => run(store, 'readonly', (s) => s.getAll());
export const idbDel = (store: StoreName, id: string): Promise<void> => run(store, 'readwrite', (s) => s.delete(id));

/** test seam: drop the cached connection (so a fresh open simulates an app restart). */
export function _resetConnection(): void { dbPromise = null; }
