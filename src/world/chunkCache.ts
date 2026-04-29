// Persistent chunk-mesh cache backed by IndexedDB.
//
// First time the player visits a chunk we generate it in the worker. The
// resulting MeshArrays are written to IDB keyed by (cx, cz). On subsequent
// sessions, World checks the cache before dispatching to the worker — if a
// cached entry exists for the current CHUNK_CACHE_VERSION, we skip the
// worker entirely and the chunk appears immediately.
//
// Cache invalidation: bump CHUNK_CACHE_VERSION whenever terrain.ts (or
// anything that affects chunk visuals) changes. initChunkCache walks the
// store and deletes any entries that don't match the current version.

import type { MeshArrays } from './chunkData';

const DB_NAME = 'block-flight-chunks';
const DB_VERSION = 1;
const STORE = 'chunks';

// Bump this string whenever terrain generation logic changes — old chunks
// are then deleted on init. Keep the format <generation>-<short-tag>.
export const CHUNK_CACHE_VERSION = 'v7f-river-cabin';

let dbPromise: Promise<IDBDatabase> | null = null;
let cacheReady = false;
let cacheDisabled = false;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      cacheDisabled = true;
      reject(new Error('indexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      cacheDisabled = true;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function clearStaleVersions(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (!c) {
        resolve();
        return;
      }
      const k = c.key as string;
      if (typeof k === 'string' && !k.startsWith(CHUNK_CACHE_VERSION + ':')) {
        c.delete();
      }
      c.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

// Fire-and-forget initializer. Safe to call multiple times.
export async function initChunkCache(): Promise<void> {
  if (cacheReady || cacheDisabled) return;
  try {
    const db = await openDb();
    await clearStaleVersions(db);
    cacheReady = true;
  } catch {
    cacheDisabled = true;
  }
}

function key(cx: number, cz: number): string {
  return `${CHUNK_CACHE_VERSION}:${cx},${cz}`;
}

export function isCacheReady(): boolean {
  return cacheReady;
}

export async function getCachedChunk(cx: number, cz: number): Promise<MeshArrays | null> {
  if (!cacheReady) return null;
  try {
    const db = await openDb();
    return await new Promise<MeshArrays | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key(cx, cz));
      req.onsuccess = () => resolve((req.result ?? null) as MeshArrays | null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// Fire-and-forget. We don't await — the rendering path doesn't care.
export function putCachedChunk(arr: MeshArrays): void {
  if (!cacheReady) return;
  openDb().then((db) => {
    const tx = db.transaction(STORE, 'readwrite');
    // IndexedDB structured-clones the typed arrays — original buffers remain
    // valid in the rendering path.
    tx.objectStore(STORE).put(arr, key(arr.cx, arr.cz));
  }).catch(() => { /* ignore */ });
}

// Wipes EVERYTHING — useful for a debug "reset world" command.
export async function clearChunkCache(): Promise<void> {
  if (cacheDisabled) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}
