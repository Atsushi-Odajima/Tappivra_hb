// 「この端末へ保存」した閲覧データだけをIndexedDBへ置く。通常の閲覧はメモリー保持。
// 保存するのは検証済みの閲覧ZIPのbytes（開くたびに再検証する）。

export interface SavedDemoMeta {
  id: string;
  title: string;
  savedAt: string;
  generatedAt: string;
  byteLength: number;
}

const DB = 'tappivra-viewer';
const STORE = 'demos';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: 'meta.id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          res(req.result);
        };
        t.onerror = () => {
          db.close();
          rej(t.error ?? req.error);
        };
        t.onabort = () => {
          db.close();
          rej(t.error ?? new Error('aborted'));
        };
      }),
  );
}

export async function listSaved(): Promise<SavedDemoMeta[]> {
  const all = await tx<{ meta: SavedDemoMeta }[]>('readonly', (s) => s.getAll() as IDBRequest<{ meta: SavedDemoMeta }[]>);
  return all.map((x) => x.meta).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveDemo(meta: SavedDemoMeta, bytes: Uint8Array): Promise<void> {
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  await tx('readwrite', (s) => s.put({ meta, bytes }));
}

export async function loadSaved(id: string): Promise<Uint8Array> {
  const r = await tx<{ bytes: Uint8Array } | undefined>('readonly', (s) => s.get(id) as IDBRequest<{ bytes: Uint8Array } | undefined>);
  if (!r) throw new Error('保存したデモが見つかりません');
  return r.bytes;
}

export async function deleteSaved(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function deleteAllSaved(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}
