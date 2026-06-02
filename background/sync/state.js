async function saveSyncState({ ok, message, etag }) {
  const now = new Date().toISOString();
  const safeMessage = sanitizeErrorMessage(message);
  const patch = {
    [STATE_KEYS.lastSyncAt]: now,
    [STATE_KEYS.lastSyncStatus]: ok ? safeMessage : `Failed: ${safeMessage}`,
  };

  if (etag) patch[STATE_KEYS.lastRemoteEtag] = etag;
  if (ok) patch[STATE_KEYS.localChangeAt] = null;

  await chrome.storage.local.set(patch);
}

async function notify(title, message) {
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: sanitizeErrorMessage(message).slice(0, 250),
  });
}

