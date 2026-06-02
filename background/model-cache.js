const LocalModelRegistry = self.ZongziModelRegistry || {};
const MODEL_CACHE_DB_NAME = 'zongzi_model_store';
const MODEL_CACHE_DB_VERSION = 3;
const MODEL_CACHE_STORE_NAME = 'modelFiles';
const MODEL_CACHE_META_STORE_NAME = 'modelFileMeta';

async function downloadLocalSummaryModel(modelId) {
  const candidateModelId = modelId || 'distilbart';
  const normalizedModelId = typeof LocalModelRegistry.normalizeModelId === 'function'
    ? LocalModelRegistry.normalizeModelId(candidateModelId)
    : candidateModelId;
  return { ok: true, modelId: normalizedModelId, openDownloadPage: true };
}

async function onModelDownloadComplete(modelId) {
  if (!modelId) return { ok: false, error: 'Missing modelId.' };
  const settings = await getSettings();
  const candidateModelId = modelId || settings.localModelId || 'distilbart';
  const normalizedModelId = typeof LocalModelRegistry.normalizeModelId === 'function'
    ? LocalModelRegistry.normalizeModelId(candidateModelId)
    : candidateModelId;
  const cacheState = await computeLocalModelCacheState(normalizedModelId);
  await saveSettings(sanitizeSettings({
    ...settings,
    localModelId: normalizedModelId,
    localModelDownloaded: cacheState.ready,
    localModelDownloadedAt: cacheState.ready ? (cacheState.lastUpdatedAt || settings.localModelDownloadedAt || new Date().toISOString()) : '',
    aiValidationProvider: cacheState.ready ? 'transformer' : undefined,
    aiValidationOk: cacheState.ready ? true : undefined,
  }));
  return { ok: true, modelId: normalizedModelId, ready: cacheState.ready, fileCount: cacheState.completedFiles, fileStates: cacheState.fileStates };
}

async function checkLocalSummaryModel(modelId) {
  const settings = await getSettings();
  const candidateModelId = modelId || settings.localModelId || 'distilbart';
  const normalizedModelId = typeof LocalModelRegistry.normalizeModelId === 'function'
    ? LocalModelRegistry.normalizeModelId(candidateModelId)
    : candidateModelId;
  const cacheState = await computeLocalModelCacheState(normalizedModelId);
  if (cacheState.ready !== settings.localModelDownloaded) {
    await saveSettings(sanitizeSettings({
      ...settings,
      localModelId: normalizedModelId,
      localModelDownloaded: cacheState.ready,
      localModelDownloadedAt: cacheState.ready ? (cacheState.lastUpdatedAt || settings.localModelDownloadedAt || new Date().toISOString()) : '',
    }));
  }
  return { ok: true, ready: cacheState.ready, modelId: normalizedModelId, fileCount: cacheState.completedFiles, totalFiles: cacheState.totalFiles, fileStates: cacheState.fileStates };
}

async function computeLocalModelCacheState(modelId) {
  const candidateModelId = modelId || 'distilbart';
  const normalizedModelId = typeof LocalModelRegistry.normalizeModelId === 'function'
    ? LocalModelRegistry.normalizeModelId(candidateModelId)
    : candidateModelId;
  const meta = typeof LocalModelRegistry.getModelMeta === 'function'
    ? LocalModelRegistry.getModelMeta(normalizedModelId)
    : null;
  const resolvedMeta = meta || { files: [], fileSizeHints: {} };
  const fileStates = [];
  let completedFiles = 0;
  let totalStoredBytes = 0;
  let lastUpdatedAt = '';

  for (const file of resolvedMeta.files) {
    const key = normalizedModelId + '::' + file;
    const info = await getIndexedDbModelFileInfo(key);
    const expectedSize = Math.max(Number(info.expectedSize) || 0, Number(resolvedMeta.fileSizeHints?.[file]) || 0);
    const storedBytes = Math.max(Number(info.storedBytes) || 0, Number(info.byteLength) || 0);
    const complete = (info.status === 'complete' && storedBytes > 0)
      || (expectedSize > 0 && storedBytes >= expectedSize);
    const status = complete
      ? 'complete'
      : info.lastError
        ? 'failed'
        : storedBytes > 0
          ? (info.status === 'stale' ? 'stale' : (info.status === 'failed' ? 'failed' : 'paused'))
          : (info.status || 'ready');
    const state = {
      file,
      status,
      storedBytes,
      expectedSize,
      mirrorKey: info.mirrorKey || '',
      lastError: info.lastError || '',
      updatedAt: info.updatedAt || '',
      complete,
    };
    fileStates.push(state);
    totalStoredBytes += storedBytes;
    if (complete) completedFiles += 1;
    if (state.updatedAt && (!lastUpdatedAt || state.updatedAt > lastUpdatedAt)) lastUpdatedAt = state.updatedAt;
  }

  return {
    modelId: normalizedModelId,
    totalFiles: resolvedMeta.files.length,
    completedFiles,
    totalStoredBytes,
    ready: resolvedMeta.files.length > 0 && completedFiles === resolvedMeta.files.length,
    lastUpdatedAt,
    fileStates,
  };
}

async function openModelCacheDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MODEL_CACHE_DB_NAME, MODEL_CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MODEL_CACHE_STORE_NAME)) {
        db.createObjectStore(MODEL_CACHE_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(MODEL_CACHE_META_STORE_NAME)) {
        db.createObjectStore(MODEL_CACHE_META_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getIndexedDbModelFileInfo(key) {
  try {
    const db = await openModelCacheDb();
    return await new Promise((resolve) => {
      try {
        const hasFileStore = db.objectStoreNames.contains(MODEL_CACHE_STORE_NAME);
        const hasMetaStore = db.objectStoreNames.contains(MODEL_CACHE_META_STORE_NAME);
        if (!hasFileStore && !hasMetaStore) {
          db.close();
          resolve({ exists: false, byteLength: 0, storedBytes: 0, status: 'ready' });
          return;
        }
        const stores = [];
        if (hasFileStore) stores.push(MODEL_CACHE_STORE_NAME);
        if (hasMetaStore) stores.push(MODEL_CACHE_META_STORE_NAME);
        const tx = db.transaction(stores, 'readonly');
        const result = { exists: false, byteLength: 0, storedBytes: 0, status: 'ready', expectedSize: 0, mirrorKey: '', lastError: '', updatedAt: '' };
        if (hasFileStore) {
          const fileReq = tx.objectStore(MODEL_CACHE_STORE_NAME).get(key);
          fileReq.onsuccess = () => {
            const value = fileReq.result;
            const byteLength = value instanceof ArrayBuffer
              ? value.byteLength
              : Number(value?.byteLength || value?.buffer?.byteLength || 0);
            result.exists = value !== undefined;
            result.byteLength = Math.max(0, byteLength || 0);
          };
        }
        if (hasMetaStore) {
          const metaReq = tx.objectStore(MODEL_CACHE_META_STORE_NAME).get(key);
          metaReq.onsuccess = () => {
            Object.assign(result, metaReq.result || {});
          };
        }
        tx.oncomplete = () => {
          result.storedBytes = Math.max(Number(result.storedBytes) || 0, Number(result.byteLength) || 0);
          result.exists = result.exists || result.storedBytes > 0;
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          resolve({ exists: false, byteLength: 0, storedBytes: 0, status: 'ready' });
        };
      } catch (_) {
        db.close();
        resolve({ exists: false, byteLength: 0, storedBytes: 0, status: 'ready' });
      }
    });
  } catch (_) {
    return { exists: false, byteLength: 0, storedBytes: 0, status: 'ready' };
  }
}

async function countIndexedDbModelFiles(modelId) {
  const state = await computeLocalModelCacheState(modelId);
  return state.completedFiles;
}

async function handleDeleteModelFiles(modelId) {
  try {
    const settings = await getSettings();
    const candidateModelId = modelId || settings.localModelId || 'distilbart';
    const normalizedModelId = typeof LocalModelRegistry.normalizeModelId === 'function'
      ? LocalModelRegistry.normalizeModelId(candidateModelId)
      : candidateModelId;

    const deleted = await new Promise((resolve) => {
      openModelCacheDb().then((db) => {
        try {
          const stores = [];
          if (db.objectStoreNames.contains(MODEL_CACHE_STORE_NAME)) stores.push(MODEL_CACHE_STORE_NAME);
          if (db.objectStoreNames.contains(MODEL_CACHE_META_STORE_NAME)) stores.push(MODEL_CACHE_META_STORE_NAME);
          if (stores.length === 0) { db.close(); resolve(0); return; }
          const tx = db.transaction(stores, 'readwrite');
          let maxDeleted = 0;
          let doneStores = 0;
          stores.forEach((storeName) => {
            const getAllReq = tx.objectStore(storeName).getAllKeys();
            getAllReq.onsuccess = () => {
              const keys = getAllReq.result.filter(k => String(k).startsWith(normalizedModelId + '::'));
              keys.forEach((key) => tx.objectStore(storeName).delete(key));
              maxDeleted = Math.max(maxDeleted, keys.length);
              doneStores += 1;
              if (doneStores === stores.length) {
                tx.oncomplete = () => { db.close(); resolve(maxDeleted); };
                tx.onerror = () => { db.close(); resolve(0); };
              }
            };
            getAllReq.onerror = () => {
              doneStores += 1;
              if (doneStores === stores.length) {
                tx.oncomplete = () => { db.close(); resolve(maxDeleted); };
                tx.onerror = () => { db.close(); resolve(0); };
              }
            };
          });
        } catch (_) { db.close(); resolve(0); }
      }).catch(() => resolve(0));
    });

    await saveSettings(sanitizeSettings({
      ...settings,
      localModelId: normalizedModelId,
      localModelDownloaded: false,
      localModelDownloadedAt: '',
    }));

    return { ok: true, deleted, modelId: normalizedModelId };
  } catch (_) { return { ok: false, error: 'Failed to delete model files.' }; }
}

