function normalizeLocalExportFilename(filename) {
  const normalized = String(filename || DEFAULT_SETTINGS.remoteFile).replace(/[\\/:*?"<>|]+/g, '-').trim();
  return normalized.endsWith('.json') ? normalized : `${normalized || 'chrome-bookmarks'}.json`;
}

async function recordSyncVersion(entry) {
  const data = await chrome.storage.local.get(STATE_KEYS.syncVersions);
  const versions = normalizeSyncVersions(data[STATE_KEYS.syncVersions]);
  versions.unshift({
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    provider: String(entry.provider || 'webdav'),
    action: String(entry.action || 'sync'),
    message: sanitizeErrorMessage(entry.message || ''),
    etag: String(entry.etag || ''),
    versionUrl: String(entry.versionUrl || ''),
    exportedAt: String(entry.exportedAt || ''),
    rootCount: Number(entry.rootCount || 0),
    createdAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ [STATE_KEYS.syncVersions]: versions.slice(0, 50) });
}

function normalizeSyncVersions(value) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, 50) : [];
}

