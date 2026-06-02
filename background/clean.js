async function deleteBookmarksByIds(ids, items = []) {
  const uniqueIds = [...new Set(ids.map(String))];
  const itemMap = new Map((items || []).map((item) => [String(item.id), item]));
  const removedIds = [];
  const failed = [];

  for (const id of uniqueIds) {
    try {
      await chrome.bookmarks.remove(id);
      removedIds.push(id);
    } catch (error) {
      failed.push({ id, error: sanitizeErrorMessage(error.message) });
    }
  }

  if (removedIds.length) {
    await markLocalChange();
    await appendCleanRecord({
      type: 'invalid',
      deletedAt: new Date().toISOString(),
      count: removedIds.length,
      lowConfidenceCount: removedIds.filter((id) => isLowConfidenceInvalidItem(itemMap.get(id))).length,
      items: removedIds.map((id) => sanitizeCleanRecordItem(itemMap.get(id) || { id })),
    });
  }
  return { ok: failed.length === 0, removed: removedIds.length, failed: failed.length, removedIds, errors: failed };
}

async function getCleanRecords() {
  const [data, settings] = await Promise.all([
    chrome.storage.local.get(STATE_KEYS.cleanRecords),
    getSettings(),
  ]);
  const records = Array.isArray(data[STATE_KEYS.cleanRecords]) ? data[STATE_KEYS.cleanRecords] : [];
  const filteredRecords = filterCleanRecordsByRetention(records, settings.cleanRecordRetentionDays);
  if (filteredRecords.length !== records.length) {
    await chrome.storage.local.set({ [STATE_KEYS.cleanRecords]: filteredRecords });
  }
  return { ok: true, records: filteredRecords };
}

async function appendCleanRecord(record) {
  const [data, settings] = await Promise.all([
    chrome.storage.local.get(STATE_KEYS.cleanRecords),
    getSettings(),
  ]);
  const records = Array.isArray(data[STATE_KEYS.cleanRecords]) ? data[STATE_KEYS.cleanRecords] : [];
  const retainedRecords = filterCleanRecordsByRetention([record, ...records], settings.cleanRecordRetentionDays);
  await chrome.storage.local.set({ [STATE_KEYS.cleanRecords]: retainedRecords.slice(0, 200) });
}

function filterCleanRecordsByRetention(records, retentionDays) {
  const days = Math.min(365, Math.max(1, Number(retentionDays || DEFAULT_SETTINGS.cleanRecordRetentionDays || 30)));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return records.filter((record) => {
    const timestamp = new Date(record?.deletedAt || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function sanitizeCleanRecordItem(item) {
  return {
    id: String(item?.id || ''),
    title: String(item?.title || ''),
    url: String(item?.url || ''),
    reason: String(item?.reason || ''),
    kind: String(item?.kind || ''),
  };
}

function isLowConfidenceInvalidItem(item) {
  return ['rate_limited', 'forbidden', 'certificate_error', 'unsupported_protocol', 'failed'].includes(String(item?.kind || ''));
}

async function runAutoCleanup(settings) {
  const latestSettings = settings || await getSettings();
  if (latestSettings.autoCleanDuplicates && latestSettings.autoCleanEmptyFolders) {
    await cleanupAllBookmarks('auto-clean', latestSettings);
    return;
  }

  if (latestSettings.autoCleanDuplicates) {
    await cleanupDuplicateBookmarks('auto-clean-duplicates', latestSettings);
    return;
  }

  if (latestSettings.autoCleanEmptyFolders) {
    await cleanupEmptyFolders('auto-clean-empty-folders', latestSettings);
  }
}

async function cleanupDuplicateBookmarks(message, _settings = null) {
  const roots = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkItems(roots[0], bookmarks);

  const byUrl = new Map();
  for (const bookmark of bookmarks) {
    const key = normalizeBookmarkUrl(bookmark.url);
    if (!key) continue;
    byUrl.set(key, [...(byUrl.get(key) || []), bookmark]);
  }

  let removed = 0;
  const failed = [];
  for (const duplicates of byUrl.values()) {
    if (duplicates.length < 2) continue;
    const keep = chooseBookmarkToKeep(duplicates);
    for (const duplicate of duplicates) {
      if (duplicate.id === keep.id) continue;
      try {
        await chrome.bookmarks.remove(duplicate.id);
        removed += 1;
      } catch (error) {
        failed.push(`${duplicate.title || duplicate.url}: ${sanitizeErrorMessage(error.message)}`);
      }
    }
  }

  if (removed > 0) await markLocalChange();

  if (failed.length) {
    const resultMessage = `${message || 'clean-duplicates'}: removed ${removed} duplicate bookmark${removed === 1 ? '' : 's'}, ${failed.length} failed.`;
    await saveSyncState({ ok: false, message: resultMessage });
    return {
      ok: false,
      error: resultMessage,
      i18nKey: 'duplicatesCleanedWithFailures',
      params: { count: removed, failed: failed.length },
    };
  }

  if (removed === 0) {
    const resultMessage = `${message || 'clean-duplicates'}: no duplicate bookmarks found.`;
    await saveSyncState({ ok: true, message: resultMessage });
    return {
      ok: true,
      message: resultMessage,
      i18nKey: 'noDuplicateBookmarks',
    };
  }

  const resultMessage = `${message || 'clean-duplicates'}: removed ${removed} duplicate bookmark${removed === 1 ? '' : 's'}.`;
  await saveSyncState({ ok: true, message: resultMessage });
  return {
    ok: true,
    message: resultMessage,
    i18nKey: 'duplicatesCleaned',
    params: { count: removed },
  };
}

async function cleanupAllBookmarks(message, settings = null) {
  const duplicateResult = await cleanupDuplicateBookmarks(`${message || 'clean-all'}: duplicates`, settings);
  const emptyFolderResult = await cleanupEmptyFolders(`${message || 'clean-all'}: empty folders`, settings);
  const duplicateCount = Number(duplicateResult.params?.count || 0);
  const emptyFolderCount = Number(emptyFolderResult.params?.count || 0);
  const failed = Number(duplicateResult.params?.failed || 0) + Number(emptyFolderResult.params?.failed || 0);

  if (failed > 0) {
    const resultMessage = `${message || 'clean-all'}: removed ${duplicateCount} duplicate bookmark${duplicateCount === 1 ? '' : 's'} and ${emptyFolderCount} empty folder${emptyFolderCount === 1 ? '' : 's'}, ${failed} failed.`;
    await saveSyncState({ ok: false, message: resultMessage });
    return {
      ok: false,
      error: resultMessage,
      i18nKey: 'allCleanedWithFailures',
      params: { duplicates: duplicateCount, folders: emptyFolderCount, failed },
    };
  }

  const resultMessage = `${message || 'clean-all'}: removed ${duplicateCount} duplicate bookmark${duplicateCount === 1 ? '' : 's'} and ${emptyFolderCount} empty folder${emptyFolderCount === 1 ? '' : 's'}.`;
  await saveSyncState({ ok: true, message: resultMessage });
  return {
    ok: true,
    message: resultMessage,
    i18nKey: duplicateCount === 0 && emptyFolderCount === 0 ? 'allCleanedNothing' : 'allCleaned',
    params: { duplicates: duplicateCount, folders: emptyFolderCount },
  };
}

async function cleanupEmptyFolders(message, _settings = null) {
  let removed = 0;
  const failed = [];

  while (true) {
    const [root] = await chrome.bookmarks.getTree();
    const emptyFolders = [];
    collectLeafEmptyFolders(root, emptyFolders);

    if (!emptyFolders.length) break;

    let removedThisRound = 0;
    for (const folder of emptyFolders) {
      try {
        await chrome.bookmarks.removeTree(folder.id);
        removed += 1;
        removedThisRound += 1;
      } catch (error) {
        failed.push(`${folder.title || folder.id}: ${sanitizeErrorMessage(error.message)}`);
      }
    }

    if (removedThisRound === 0) break;
  }

  if (removed > 0) await markLocalChange();

  if (failed.length) {
    const resultMessage = `${message || 'clean-empty-folders'}: removed ${removed} empty folder${removed === 1 ? '' : 's'}, ${failed.length} failed.`;
    await saveSyncState({ ok: false, message: resultMessage });
    return {
      ok: false,
      error: resultMessage,
      i18nKey: 'emptyFoldersCleanedWithFailures',
      params: { count: removed, failed: failed.length },
    };
  }

  if (removed === 0) {
    const resultMessage = `${message || 'clean-empty-folders'}: no empty folders found.`;
    await saveSyncState({ ok: true, message: resultMessage });
    return {
      ok: true,
      message: resultMessage,
      i18nKey: 'noEmptyFolders',
    };
  }

  const resultMessage = `${message || 'clean-empty-folders'}: removed ${removed} empty folder${removed === 1 ? '' : 's'}.`;
  await saveSyncState({ ok: true, message: resultMessage });
  return {
    ok: true,
    message: resultMessage,
    i18nKey: 'emptyFoldersCleaned',
    params: { count: removed },
  };
}

function collectLeafEmptyFolders(node, output) {
  if (!node || node.url) return;

  for (const child of node.children || []) {
    collectLeafEmptyFolders(child, output);
  }

  if (isWritableUserFolder(node) && (node.children || []).length === 0) {
    output.push(node);
  }
}

function isWritableUserFolder(node) {
  if (!node || node.url) return false;
  if (!node.parentId) return false;
  if (node.title === ROOT_CONTAINER_TITLE) return true;
  return !['bar', 'other', 'synced'].includes(getRootKey(node));
}

function chooseBookmarkToKeep(bookmarks) {
  return [...bookmarks].sort((a, b) => {
    const rootPriorityDiff = getRootPriority(b.rootKey) - getRootPriority(a.rootKey);
    if (rootPriorityDiff) return rootPriorityDiff;
    return (Number(b.dateAdded) || 0) - (Number(a.dateAdded) || 0);
  })[0];
}

function getRootPriority(rootKey) {
  if (rootKey === 'bar') return 3;
  if (rootKey === 'other') return 2;
  if (rootKey === 'synced') return 1;
  return 0;
}

function collectBookmarkItems(node, output, rootKey = '', folderPath = []) {
  if (!node) return;
  const nextRootKey = getNodeRootKey(node, rootKey);
  const nextFolderPath = node.url || !node.title ? folderPath : [...folderPath, node.title];
  if (node.url) {
    output.push({
      id: node.id,
      url: node.url,
      title: node.title || '',
      dateAdded: node.dateAdded || 0,
      rootKey: nextRootKey,
      folderPath: folderPath.join(' / '),
    });
    return;
  }

  for (const child of node.children || []) {
    collectBookmarkItems(child, output, nextRootKey, nextFolderPath);
  }
}

