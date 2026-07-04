import initSqlJs, { type Database } from "sql.js";

const IDB_NAME = "underground-stepfree";
const IDB_STORE = "sqlite";
const IDB_KEY = "seed";
const SEED_URL = "/seed.sqlite";
const WASM_URL = "/sql-wasm.wasm";

let dbPromise: Promise<Database> | null = null;

function openIdb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(IDB_STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function readCachedSeed(): Promise<ArrayBuffer | null> {
	const idb = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = idb.transaction(IDB_STORE, "readonly");
		const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => reject(req.error);
	});
}

async function writeCachedSeed(bytes: ArrayBuffer): Promise<void> {
	const idb = await openIdb();
	return new Promise((resolve, reject) => {
		const tx = idb.transaction(IDB_STORE, "readwrite");
		tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function fetchSeedBytes(): Promise<ArrayBuffer> {
	const res = await fetch(SEED_URL);
	if (!res.ok) throw new Error(`failed to fetch seed data: ${res.status}`);
	return res.arrayBuffer();
}

// Loads the station database once per session: from IndexedDB if already
// cached (works fully offline), otherwise from the bundled static seed file
// (itself precached by the service worker for offline-from-first-load).
// When online and a cached copy exists, refreshes IndexedDB in the
// background for next time without blocking the current session.
export async function getDb(): Promise<Database> {
	if (!dbPromise) {
		dbPromise = (async () => {
			const SQL = await initSqlJs({ locateFile: () => WASM_URL });
			let bytes = await readCachedSeed();
			if (!bytes) {
				bytes = await fetchSeedBytes();
				await writeCachedSeed(bytes);
			} else if (navigator.onLine) {
				fetchSeedBytes()
					.then(writeCachedSeed)
					.catch(() => {
						// Offline or TfL/host unreachable - keep using the cached copy.
					});
			}
			return new SQL.Database(new Uint8Array(bytes));
		})();
	}
	return dbPromise;
}
