function waitForNextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function openBookmarkSummaryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BOOKMARK_SUMMARY_DB_NAME, BOOKMARK_SUMMARY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKMARK_SUMMARY_STORE)) {
        db.createObjectStore(BOOKMARK_SUMMARY_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BOOKMARK_INDEX_QUEUE_STORE)) {
        db.createObjectStore(BOOKMARK_INDEX_QUEUE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllBookmarkSummaries() {
  const records = await runBookmarkSummaryStore('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  }));
  return new Map(records.map((record) => {
    const normalized = normalizeSummaryRecord(record);
    return [String(normalized.id), normalized];
  }));
}

async function putBookmarkSummary(record) {
  await runBookmarkSummaryStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}

async function pruneBookmarkSummaries(currentIds) {
  await runBookmarkSummaryStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (!currentIds.has(String(cursor.key))) cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }));
  await runBookmarkIndexQueueStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (!currentIds.has(String(cursor.key))) cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }));
}

async function runBookmarkSummaryStore(mode, callback) {
  return await runBookmarkSummaryObjectStore(BOOKMARK_SUMMARY_STORE, mode, callback);
}

async function runBookmarkIndexQueueStore(mode, callback) {
  return await runBookmarkSummaryObjectStore(BOOKMARK_INDEX_QUEUE_STORE, mode, callback);
}

async function runBookmarkSummaryObjectStore(storeName, mode, callback) {
  const db = await openBookmarkSummaryDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      Promise.resolve(callback(store)).then(resolve, reject);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

