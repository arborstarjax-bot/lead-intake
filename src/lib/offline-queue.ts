/**
 * Offline write queue backed by IndexedDB.
 *
 * Purpose: a crew member editing a lead in a poor-signal spot shouldn't
 * lose their change. When a PATCH fails because the device is offline,
 * we stash the request here and replay it when the tab regains network
 * (online event, visibilitychange, or interval poll).
 *
 * Deliberately narrow scope:
 *   - Only idempotent writes (PATCH /api/leads/[id]) go through this.
 *   - Creates / deletes / calendar syncs don't queue. A create needs an
 *     immediate server-assigned id; a delete is irreversible; calendar
 *     sync depends on the PATCH landing first. Those just surface the
 *     offline error to the user.
 *
 * No Background Sync API usage — iOS PWAs don't support it. The replay
 * trigger lives in OfflineQueueReplayer, which runs whenever the app
 * window is visible.
 */

const DB_NAME = "leadflow-offline";
const DB_VERSION = 1;
const STORE = "writes";

export type QueuedWrite = {
  id: number;
  url: string;
  method: string;
  body: string;
  /** Optional label shown in the "N pending" toast. */
  label?: string;
  createdAt: number;
  /** Number of replay attempts so we don't loop forever on 4xx. */
  attempts: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // SSR safety — callers are supposed to check typeof window, but
    // returning a rejection here is a better error than a crash.
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
  return dbPromise;
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = fn(store);
    // Normalize the two possible return shapes.
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result as T);
      result.onerror = () => reject(result.error);
    } else {
      Promise.resolve(result).then(resolve, reject);
    }
  });
}

export async function enqueueWrite(input: {
  url: string;
  method: string;
  body: string;
  label?: string;
}): Promise<number> {
  const record = {
    ...input,
    createdAt: Date.now(),
    attempts: 0,
  };
  return tx<number>("readwrite", (store) => {
    const req = store.add(record);
    return req as unknown as IDBRequest<number>;
  });
}

export async function listPending(): Promise<QueuedWrite[]> {
  return tx<QueuedWrite[]>("readonly", (store) => {
    return store.getAll() as unknown as IDBRequest<QueuedWrite[]>;
  });
}

export async function removeWrite(id: number): Promise<void> {
  await tx<undefined>("readwrite", (store) => {
    return store.delete(id) as unknown as IDBRequest<undefined>;
  });
}

export async function bumpAttempts(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result as QueuedWrite | undefined;
      if (!row) {
        resolve();
        return;
      }
      row.attempts = (row.attempts ?? 0) + 1;
      const putReq = store.put(row);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Wrap a fetch call so that transient network failures (offline, dropped
 * connection) stash the request for later replay. Server-side errors
 * (4xx/5xx) are returned as-is so callers still see them.
 *
 * Returns either the real Response or, when queued, a synthetic Response
 * with status 202 and `{ queued: true, offline: true, queuedId }` body.
 * Callers can check `response.headers.get("x-offline-queued")` to branch
 * behavior (typically: show a "Saved offline" toast and update local
 * state optimistically).
 */
export async function fetchWithOfflineQueue(
  url: string,
  init: RequestInit & { label?: string } = {}
): Promise<Response> {
  const { label, ...fetchInit } = init;
  const body = typeof fetchInit.body === "string" ? fetchInit.body : null;
  const method = (fetchInit.method ?? "GET").toUpperCase();

  // Offline gate: shortcut directly to enqueue without burning a request.
  // `navigator.onLine` is lossy on some platforms (returns true while
  // captive-portal'd), but combined with the catch block below it's
  // good enough to capture the common case.
  const knownOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  if (knownOffline && body !== null) {
    const id = await enqueueWrite({ url, method, body, label });
    return queuedResponse(id);
  }

  try {
    return await fetch(url, fetchInit);
  } catch (err) {
    // Any thrown fetch() is a network-level failure (DNS, offline, CORS,
    // or abort). If we have a replayable body, queue it. Otherwise
    // re-throw so callers handle it normally.
    if (body !== null) {
      const id = await enqueueWrite({ url, method, body, label });
      return queuedResponse(id);
    }
    throw err;
  }
}

function queuedResponse(id: number): Response {
  return new Response(
    JSON.stringify({ queued: true, offline: true, queuedId: id }),
    {
      status: 202,
      headers: {
        "content-type": "application/json",
        "x-offline-queued": "1",
      },
    }
  );
}

/**
 * Walk the queue in insertion order and attempt to replay each write.
 *
 *   - 2xx → drop the row.
 *   - 4xx (client error) → drop the row after 3 attempts, since the
 *     server won't ever accept it. Preserves the row on the first few
 *     tries in case the 4xx was spurious (e.g. auth expiring).
 *   - 5xx / network error → keep the row, bump attempts, stop the run.
 *     We intentionally don't continue past a failure so requests are
 *     applied in order — later PATCHes to the same lead shouldn't
 *     overwrite their own earlier state.
 *
 * Returns a summary for the caller to surface via toast.
 */
export type ReplaySummary = {
  replayed: number;
  dropped: number;
  remaining: number;
  stoppedOnError: boolean;
};

const MAX_ATTEMPTS_PER_CLIENT_ERROR = 3;

export async function replayQueue(): Promise<ReplaySummary> {
  const pending = await listPending();
  pending.sort((a, b) => a.id - b.id);

  let replayed = 0;
  let dropped = 0;
  let stoppedOnError = false;

  for (const row of pending) {
    try {
      const res = await fetch(row.url, {
        method: row.method,
        headers: { "content-type": "application/json" },
        body: row.body,
      });
      if (res.ok) {
        await removeWrite(row.id);
        replayed += 1;
      } else if (res.status >= 400 && res.status < 500) {
        if ((row.attempts ?? 0) + 1 >= MAX_ATTEMPTS_PER_CLIENT_ERROR) {
          await removeWrite(row.id);
          dropped += 1;
        } else {
          await bumpAttempts(row.id);
          stoppedOnError = true;
          break;
        }
      } else {
        await bumpAttempts(row.id);
        stoppedOnError = true;
        break;
      }
    } catch {
      await bumpAttempts(row.id);
      stoppedOnError = true;
      break;
    }
  }

  const remaining = (await listPending()).length;
  return { replayed, dropped, remaining, stoppedOnError };
}

export async function pendingCount(): Promise<number> {
  try {
    const rows = await listPending();
    return rows.length;
  } catch {
    return 0;
  }
}
