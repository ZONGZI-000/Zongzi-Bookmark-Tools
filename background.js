try {
  importScripts('app-config.js');
} catch (e) {
  console.error('[粽子书签工具] 加载 app-config.js 失败，请重新加载插件。', e);
  // 兜底定义，避免后续代码直接崩溃
  if (typeof normalizeLanguage !== 'function') {
    self.normalizeLanguage = function (l) { return l === 'en' ? 'en' : 'zh'; };
  }
  if (typeof normalizeDownloadMode !== 'function') {
    self.normalizeDownloadMode = function (m) { return m === 'mirror' ? 'mirror' : 'safe'; };
  }
}

const STATE_KEYS = {
  settings: 'settings',
  lastSyncAt: 'lastSyncAt',
  lastSyncStatus: 'lastSyncStatus',
  lastRemoteEtag: 'lastRemoteEtag',
  localChangeAt: 'localChangeAt',
  syncInProgress: 'syncInProgress',
  invalidScanProgress: 'invalidScanProgress',
  invalidScanControl: 'invalidScanControl',
  cleanRecords: 'cleanRecords',
  syncVersions: 'syncVersions',
};

const ALARM_NAME = 'webdav-bookmark-sync';
const CLEAN_ALARM_NAME = 'webdav-bookmark-clean-bookmarks';
const SUMMARY_ALARM_NAME = 'zongzi-bookmark-summary';
const SHADOW_INDEX_ALARM_NAME = 'zongzi-shadow-index';
const ROOT_CONTAINER_TITLE = 'WebDAV Synced Bookmarks';
const BOOKMARK_SUMMARY_DB_NAME = 'zongziBookmarkSummaryDb';
const BOOKMARK_SUMMARY_DB_VERSION = 2;
const BOOKMARK_SUMMARY_STORE = 'summaries';
const BOOKMARK_INDEX_QUEUE_STORE = 'indexQueue';
const BOOKMARK_SUMMARY_STOP_WORDS = new Set(['http', 'https', 'www', 'com', 'cn', 'net', 'org', 'html', 'index', 'the', 'and', 'for', 'with', 'from', 'this', 'that', '一个', '这个', '以及', '关于']);
const BOOKMARK_SUMMARY_CATEGORY_VECTORS = [
  ['开发', ['github', 'gitlab', 'docs', 'api', 'developer', 'npm', '代码', '开发', 'python', 'javascript', 'react']],
  ['文档', ['doc', 'docs', 'wiki', 'manual', 'help', 'guide', '指南', '文档', '教程']],
  ['新闻', ['news', 'media', 'daily', '日报', '新闻', '资讯', '财经']],
  ['购物', ['shop', 'mall', 'taobao', 'jd', 'amazon', '购物', '订单']],
  ['视频', ['video', 'youtube', 'bilibili', 'douyin', '视频', '直播']],
  ['社交', ['twitter', 'x.com', 'weibo', 'zhihu', 'reddit', '社交', '论坛']],
  ['工具', ['tool', 'app', 'convert', 'generator', '工具', '生成器', '下载']],
];
const SEMANTIC_FALLBACK_TERMS = {
  nas: ['云存储', '服务器', '飞牛', '私有云', '网盘', '存储', '备份'],
  '云存储': ['NAS', '服务器', '私有云', '网盘', '备份'],
  '服务器': ['NAS', '云存储', '飞牛', 'Linux', 'Docker'],
  '飞牛': ['NAS', '云存储', '服务器', '私有云'],
  ai: ['人工智能', '大模型', 'Gemini', 'ChatGPT', '摘要'],
  webdav: ['同步', '备份', '网盘', '云存储', '书签'],
};
let bookmarkSummaryJobRunning = false;
let shadowIndexJobRunning = false;
let bookmarkSummaryScheduleTimer = null;
let semanticModelCache = null;
let suppressLocalChangeTracking = false;

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await saveSettings(settings);
  await setupAlarm(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm(await getSettings());
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CLEAN_ALARM_NAME) {
    const settings = await getSettings();
    if (settings.autoCleanDuplicates || settings.autoCleanEmptyFolders) {
      await runAutoCleanup(settings);
    }
    return;
  }

  if (alarm.name === SUMMARY_ALARM_NAME) {
    const settings = await getSettings();
    if (settings.bookmarkSummaryAutoEnabled) {
      await runBookmarkSummaryJob();
    }
    return;
  }

  if (alarm.name === SHADOW_INDEX_ALARM_NAME) {
    await processShadowIndexQueue();
    return;
  }

  if (alarm.name !== ALARM_NAME) return;
  const settings = await getSettings();
  if (settings.autoSync && isAutoSyncProviderReady(settings)) {
    await runSync('auto', settings);
  }
});

chrome.bookmarks.onCreated.addListener((id, bookmark) => {
  markLocalChange();
  handleBookmarkCreatedForShadowIndex(id, bookmark).catch(() => {});
});
chrome.bookmarks.onRemoved.addListener(markLocalChange);
chrome.bookmarks.onChanged.addListener(markLocalChange);
chrome.bookmarks.onMoved.addListener(markLocalChange);
chrome.bookmarks.onChildrenReordered.addListener(markLocalChange);
chrome.bookmarks.onImportEnded.addListener(markLocalChange);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'GET_STATUS') {
      sendResponse(await getStatus());
      return;
    }

    if (message?.type === 'GET_SYNC_VERSIONS') {
      sendResponse(await getSyncVersions());
      return;
    }

    if (message?.type === 'SAVE_SETTINGS') {
      const currentSettings = await getSettings();
      const incomingSettings = message.settings || {};
      const settings = sanitizeSettings({ ...currentSettings, ...incomingSettings });
      if (Object.prototype.hasOwnProperty.call(incomingSettings, 'bookmarkSummaryAutoEnabled')) {
        const autoEnabled = Boolean(incomingSettings.bookmarkSummaryAutoEnabled);
        settings.shadowIndexEnabled = autoEnabled;
        settings.bookmarkSummaryAutoAi = autoEnabled;
        settings.bookmarkSummaryAutoOffline = autoEnabled;
      }
      await saveSettings(settings);
      await setupAlarm(settings);
      if (settings.bookmarkSummaryAutoEnabled && !currentSettings.bookmarkSummaryAutoEnabled) {
        scheduleBookmarkSummaryIfEnabled(1000);
      }
      if (settings.shadowIndexEnabled && !currentSettings.shadowIndexEnabled) {
        chrome.alarms.create(SHADOW_INDEX_ALARM_NAME, { delayInMinutes: 1 });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'TEST_WEBDAV') {
      const currentSettings = await getSettings();
      const settings = sanitizeSettings({ ...currentSettings, ...(message.settings || {}) });
      sendResponse(await testWebdavConnection(settings));
      return;
    }

    if (message?.type === 'TEST_SYNC_PROVIDER') {
      const currentSettings = await getSettings();
      const settings = sanitizeSettings({ ...currentSettings, ...(message.settings || {}) });
      sendResponse(await testSyncProviderConnection(settings));
      return;
    }

    if (message?.type === 'SYNC_NOW') {
      sendResponse(await runSyncAction(() => runSync('manual'), { allowManualLocalFile: false }));
      return;
    }

    if (message?.type === 'UPLOAD_NOW') {
      sendResponse(await runSyncAction((settings) => uploadLocalBookmarks('manual-upload', settings), { allowManualLocalFile: true }, message.settings));
      return;
    }

    if (message?.type === 'DOWNLOAD_NOW') {
      sendResponse(await runSyncAction((settings) => downloadRemoteBookmarks('manual-download', message.downloadMode, settings), { allowManualLocalFile: false }));
      return;
    }

    if (message?.type === 'IMPORT_LOCAL_FILE_SNAPSHOT') {
      sendResponse(await applyImportedLocalFileSnapshot(message.snapshot, message.downloadMode));
      return;
    }

    if (message?.type === 'CLEAN_DUPLICATES_NOW') {
      sendResponse(await cleanupDuplicateBookmarks('manual-clean', await getSettings()));
      return;
    }

    if (message?.type === 'CLEAN_EMPTY_FOLDERS_NOW') {
      sendResponse(await cleanupEmptyFolders('manual-clean-empty-folders', await getSettings()));
      return;
    }

    if (message?.type === 'CLEAN_ALL_NOW') {
      sendResponse(await cleanupAllBookmarks('manual-clean-all', await getSettings()));
      return;
    }

    if (message?.type === 'SCAN_INVALID_BOOKMARKS') {
      sendResponse(await scanInvalidBookmarks(message.timeoutSeconds, await getSettings()));
      return;
    }

    if (message?.type === 'GET_INVALID_SCAN_PROGRESS') {
      sendResponse(await getInvalidScanProgress());
      return;
    }

    if (message?.type === 'SET_INVALID_SCAN_CONTROL') {
      sendResponse(await setInvalidScanControl(message.action));
      return;
    }

    if (message?.type === 'GET_CLEAN_RECORDS') {
      sendResponse(await getCleanRecords());
      return;
    }

    if (message?.type === 'DELETE_INVALID_BOOKMARKS') {
      sendResponse(await deleteBookmarksByIds(message.ids || [], message.items || []));
      return;
    }

    if (message?.type === 'SEARCH_BOOKMARKS') {
      sendResponse(await searchLocalBookmarks(message.query || ''));
      return;
    }

    if (message?.type === 'GET_BOOKMARK_SEARCH_BOOTSTRAP') {
      sendResponse(await getBookmarkSearchBootstrap());
      return;
    }

    if (message?.type === 'GET_BOOKMARK_SUMMARY_STATUS') {
      sendResponse(await getBookmarkSummaryStatus());
      return;
    }

    if (message?.type === 'GET_SUMMARY_RECORDS') {
      sendResponse(await getSummaryRecords(message));
      return;
    }

    if (message?.type === 'GET_SHADOW_INDEX_STATUS') {
      sendResponse(await getShadowIndexStatus());
      return;
    }

    if (message?.type === 'REINDEX_ALL_BOOKMARKS') {
      sendResponse(await reindexAllBookmarks());
      return;
    }

    if (message?.type === 'REINDEX_BOOKMARK') {
      sendResponse(await reindexBookmark(message.id));
      return;
    }

    if (message?.type === 'REGENERATE_AI_SUMMARY') {
      sendResponse(await regenerateAiSummary(message.id));
      return;
    }

    if (message?.type === 'REBUILD_AI_SUMMARY_INDEX') {
      sendResponse(await rebuildAiSummaryIndex());
      return;
    }

    if (message?.type === 'BATCH_REGENERATE_AI_SUMMARY') {
      sendResponse(await batchRegenerateAiSummary(message.ids || []));
      return;
    }

    if (message?.type === 'BATCH_OFFLINE_SUMMARY') {
      sendResponse(await batchOfflineSummary(message.ids || []));
      return;
    }

    if (message?.type === 'UPDATE_SUMMARY_RECORD_FIELDS') {
      sendResponse(await updateSummaryRecordFields(message));
      return;
    }

    if (message?.type === 'START_BOOKMARK_SUMMARY') {
      sendResponse(await runBookmarkSummaryJob());
      return;
    }

    if (message?.type === 'CHECK_GEMINI_NANO_AVAILABLE') {
      sendResponse(await checkGeminiNanoAvailability());
      return;
    }

    if (message?.type === 'VALIDATE_CUSTOM_AI') {
      sendResponse(await validateCustomAiConnection());
      return;
    }

    if (message?.type === 'DOWNLOAD_LOCAL_SUMMARY_MODEL') {
      // 返回模型信息，让前端打开下载页面
      sendResponse(await downloadLocalSummaryModel(message.modelId));
      return;
    }

    if (message?.type === 'MODEL_DOWNLOAD_COMPLETE') {
      sendResponse(await onModelDownloadComplete(message.modelId, message.fileCount));
      return;
    }

    if (message?.type === 'CHECK_LOCAL_SUMMARY_MODEL') {
      sendResponse(await checkLocalSummaryModel(message.modelId));
      return;
    }

    if (message?.type === 'DELETE_MODEL_FILES') {
      sendResponse(await handleDeleteModelFiles(message.modelId));
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message type.' });
  })().catch((error) => sendResponse({ ok: false, error: sanitizeErrorMessage(error.message) }));

  return true;
});

async function getSettings() {
  const data = await chrome.storage.local.get(STATE_KEYS.settings);
  const stored = data[STATE_KEYS.settings] || {};
  let settings = sanitizeSettings(stored);

  try {
    if (stored[ENCRYPTED_WEBDAV_CONFIG_KEY]) {
      settings = mergeSecureSyncConfig(settings, await decryptWebdavConfig(stored[ENCRYPTED_WEBDAV_CONFIG_KEY]));
    }
  } catch (_error) {
    settings = mergeSecureSyncConfig(settings, { ...getWebdavConfig(stored), githubToken: stored.githubToken, giteeToken: stored.giteeToken, customAiApiKey: stored.customAiApiKey });
  }

  const hasLegacyPlaintext = [...WEBDAV_SECRET_FIELDS, ...GIT_PROVIDER_SECRET_FIELDS].some((field) => Object.prototype.hasOwnProperty.call(stored, field));
  if (hasLegacyPlaintext || !stored[ENCRYPTED_WEBDAV_CONFIG_KEY]) {
    await saveSettings(settings);
  }

  return settings;
}

async function saveSettings(input) {
  const settings = sanitizeSettings(input || {});
  const encryptedWebdavConfig = await encryptWebdavConfig(settings);
  await chrome.storage.local.set({
    [STATE_KEYS.settings]: {
      ...toStoredSettings(settings),
      [ENCRYPTED_WEBDAV_CONFIG_KEY]: encryptedWebdavConfig,
    },
  });
  return settings;
}

async function setupAlarm(settings) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.clear(CLEAN_ALARM_NAME);
  if (!settings.bookmarkSummaryAutoEnabled) await chrome.alarms.clear(SUMMARY_ALARM_NAME);
  if (!settings.shadowIndexEnabled) await chrome.alarms.clear(SHADOW_INDEX_ALARM_NAME);

  if (settings.autoSync && isAutoSyncProviderReady(settings)) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: settings.syncIntervalMinutes,
    });
  }

  if (settings.autoCleanDuplicates || settings.autoCleanEmptyFolders) {
    chrome.alarms.create(CLEAN_ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: settings.cleanIntervalMinutes,
    });
  }

  if (settings.shadowIndexEnabled) {
    chrome.alarms.create(SHADOW_INDEX_ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 10 });
  }
}

async function getStatus() {
  const data = await chrome.storage.local.get(Object.values(STATE_KEYS));
  return {
    settings: await getSettings(),
    lastSyncAt: data[STATE_KEYS.lastSyncAt] || null,
    lastSyncStatus: data[STATE_KEYS.lastSyncStatus] || 'Never synced.',
    lastRemoteEtag: data[STATE_KEYS.lastRemoteEtag] || null,
    localChangeAt: data[STATE_KEYS.localChangeAt] || null,
    syncInProgress: Boolean(data[STATE_KEYS.syncInProgress]),
    syncVersions: normalizeSyncVersions(data[STATE_KEYS.syncVersions]),
  };
}

async function getSyncVersions() {
  const data = await chrome.storage.local.get(STATE_KEYS.syncVersions);
  return { ok: true, versions: normalizeSyncVersions(data[STATE_KEYS.syncVersions]) };
}

async function markLocalChange() {
  if (suppressLocalChangeTracking) return;
  await chrome.storage.local.set({ [STATE_KEYS.localChangeAt]: new Date().toISOString() });
  scheduleBookmarkSummaryIfEnabled();
}

async function withSuppressedLocalChangeTracking(action) {
  suppressLocalChangeTracking = true;
  try {
    return await action();
  } finally {
    suppressLocalChangeTracking = false;
  }
}

async function runSyncAction(action, options = {}, overrideSettings = null) {
  const settings = { ...(await getSettings()), ...(overrideSettings || {}) };
  if (!isSyncProviderReady(settings, options)) {
    return {
      ok: false,
      error: getSyncProviderRequiredMessage(settings),
      i18nKey: getSyncProviderRequiredKey(settings),
    };
  }

  return await action(settings);
}

async function testSyncProviderConnection(settings) {
  try {
    const provider = getSyncProvider(settings);
    validateProviderSettings(settings, provider);
    if (provider.type === 'webdav') return await testWebdavConnection(settings);
    if (provider.type === 'localFile') {
      return { ok: true, message: 'Local file import/export is ready.', i18nKey: 'localFileProviderReady' };
    }
    if (provider.type === 'github' || provider.type === 'gitee') {
      const cfg = getGitProviderConfig(settings, provider.type);
      const meta = provider.type === 'github'
        ? { type: 'github', apiBase: 'https://api.github.com' }
        : { type: 'gitee', apiBase: 'https://gitee.com/api/v5' };
      const response = await fetch(buildGitRepoUrl(cfg, meta), {
        method: 'GET',
        headers: buildGitHeaders(cfg, meta),
        cache: 'no-store',
      });
      if (!response.ok) {
        const detail = await safeReadGitError(response);
        return { ok: false, error: `${provider.type} connection failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}` };
      }
      return { ok: true, message: `${provider.type} repository connection succeeded.`, i18nKey: 'gitProviderConnectionSucceeded' };
    }
    return { ok: false, error: `${provider.type} sync provider is not available yet.` };
  } catch (error) {
    return { ok: false, error: sanitizeErrorMessage(error.message, settings) };
  }
}

async function testWebdavConnection(settings) {
  try {
    validateSettings(settings);
    const response = await webdavRequest(settings, 'PROPFIND', {
      headers: { Depth: '0' },
      body: '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
      timeoutSeconds: settings.requestTimeoutSeconds,
    }, true);

    if ([200, 207, 301, 302].includes(response.status)) {
      return {
        ok: true,
        message: `WebDAV connection succeeded. HTTP ${response.status}`,
        i18nKey: 'webdavConnectionSucceeded',
        params: { status: response.status },
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: `Authentication failed or access denied. HTTP ${response.status}`,
        i18nKey: 'webdavAuthFailed',
        params: { status: response.status },
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        error: 'WebDAV folder was not found. Check the folder URL.',
        i18nKey: 'webdavFolderNotFound',
      };
    }

    return {
      ok: false,
      error: `WebDAV test failed. HTTP ${response.status} ${response.statusText}`,
      i18nKey: 'webdavTestFailed',
      params: { status: response.status, statusText: response.statusText },
    };
  } catch (error) {
    return { ok: false, error: sanitizeErrorMessage(error.message, settings) };
  }
}

async function runSync(source, settings = null) {
  const runtimeSettings = await getRuntimeSettings(settings);
  const provider = getSyncProvider(runtimeSettings);
  const lock = await chrome.storage.local.get(STATE_KEYS.syncInProgress);
  if (lock[STATE_KEYS.syncInProgress]) {
    return { ok: false, error: 'A sync task is already running.' };
  }

  await chrome.storage.local.set({ [STATE_KEYS.syncInProgress]: true });
  try {
    validateProviderSettings(runtimeSettings);

    const remote = await fetchRemoteSnapshot(runtimeSettings, provider);
    if (!remote.exists) {
      return await uploadLocalBookmarks(`${source}: remote file missing`, runtimeSettings, provider);
    }

    const status = await getStatus();
    const localChangedAfterLastSync = status.localChangeAt && (!status.lastSyncAt || status.localChangeAt > status.lastSyncAt);
    const remoteChangedAfterLastSync = remote.etag && status.lastRemoteEtag && remote.etag !== status.lastRemoteEtag;

    if (localChangedAfterLastSync && remoteChangedAfterLastSync) {
      throw new Error('Both local and remote bookmarks changed after the last sync. Use Upload or Download to resolve the conflict.');
    }

    if (remoteChangedAfterLastSync || (!localChangedAfterLastSync && !status.lastSyncAt)) {
      return await applyRemoteSnapshot(remote.snapshot, remote.etag, `${source}: downloaded`, runtimeSettings.downloadMode, runtimeSettings, { provider: provider.type, versionUrl: remote.versionUrl });
    }

    if (localChangedAfterLastSync || !remote.etag) {
      return await uploadLocalBookmarks(`${source}: uploaded`, runtimeSettings, provider);
    }

    await saveSyncState({ ok: true, message: 'Already up to date.', etag: remote.etag });
    return { ok: true, message: 'Already up to date.' };
  } catch (error) {
    const safeMessage = sanitizeErrorMessage(error.message, runtimeSettings);
    await saveSyncState({ ok: false, message: safeMessage });
    await notify('Bookmark sync failed', safeMessage);
    return { ok: false, error: safeMessage };
  } finally {
    await chrome.storage.local.set({ [STATE_KEYS.syncInProgress]: false });
  }
}

async function scanInvalidBookmarks(timeoutSeconds, settings = null) {
  const timeout = normalizeTimeout(timeoutSeconds);
  const scanSettings = settings || await getSettings();
  const [root] = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkItems(root, bookmarks);

  const items = [];
  const recentChecks = [];
  let consecutiveNetworkFailures = 0;
  const sessionId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await setInvalidScanProgress({
    running: true,
    paused: false,
    current: 0,
    total: bookmarks.length,
    issueCount: 0,
    currentUrl: '',
    currentTitle: '',
    lastSuccessUrl: '',
    lastSuccessTitle: '',
    latestItem: null,
    networkWarning: false,
    networkWarningAt: null,
    lastFailedUrl: '',
    lastFailedTitle: '',
    recentChecks: [],
    issueItems: [],
    sessionId,
    done: false,
    error: '',
  });
  await setInvalidScanControl('running', sessionId);
  try {
    for (let index = 0; index < bookmarks.length; index += 1) {
      await waitForInvalidScanResume();
      const bookmark = bookmarks[index];
      await setInvalidScanProgress({
        sessionId,
        running: true,
        paused: false,
        current: index + 1,
        total: bookmarks.length,
        issueCount: items.length,
        currentUrl: bookmark.url,
        currentTitle: bookmark.title || bookmark.url,
        latestItem: null,
        networkWarning: false,
      });

      const result = await checkBookmarkUrl(bookmark.url, timeout, scanSettings);
      if (!result) {
        consecutiveNetworkFailures = 0;
        recentChecks.unshift({
          url: bookmark.url,
          title: bookmark.title || bookmark.url,
          ok: true,
        });
        recentChecks.length = Math.min(recentChecks.length, 2);
        await setInvalidScanProgress({
          sessionId,
          running: true,
          paused: false,
          current: index + 1,
          total: bookmarks.length,
          issueCount: items.length,
          currentUrl: bookmark.url,
          currentTitle: bookmark.title || bookmark.url,
          lastSuccessUrl: bookmark.url,
          lastSuccessTitle: bookmark.title || bookmark.url,
          recentChecks,
          issueItems: items,
          latestItem: null,
          networkWarning: false,
        });
        continue;
      }

      const item = {
        id: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        kind: result.kind,
        reason: result.reason,
      };
      items.push(item);
      consecutiveNetworkFailures = isNetworkFailureResult(result) ? consecutiveNetworkFailures + 1 : 0;
      const shouldPauseForNetwork = consecutiveNetworkFailures >= 10;
      if (shouldPauseForNetwork) {
        consecutiveNetworkFailures = 0;
        await setInvalidScanControl('paused');
      }
      recentChecks.unshift({
        url: bookmark.url,
        title: bookmark.title || bookmark.url,
        ok: false,
      });
      recentChecks.length = Math.min(recentChecks.length, 2);
      await setInvalidScanProgress({
        sessionId,
        running: true,
        paused: shouldPauseForNetwork,
        current: index + 1,
        total: bookmarks.length,
        issueCount: items.length,
        currentUrl: bookmark.url,
        currentTitle: bookmark.title || bookmark.url,
        recentChecks,
        issueItems: items,
        latestItem: item,
        networkWarning: shouldPauseForNetwork,
        networkWarningAt: shouldPauseForNetwork ? Date.now() : null,
        lastFailedUrl: bookmark.url,
        lastFailedTitle: bookmark.title || bookmark.url,
      });
    }

    await setInvalidScanProgress({
      sessionId,
      running: false,
      paused: false,
      current: bookmarks.length,
      total: bookmarks.length,
      issueCount: items.length,
      currentUrl: '',
      currentTitle: '',
      done: true,
      latestItem: null,
      issueItems: items,
      recentChecks,
      networkWarning: false,
      error: '',
    });
    await setInvalidScanControl('idle');
    return { ok: true, total: bookmarks.length, items, sessionId };
  } catch (error) {
    await setInvalidScanProgress({
      sessionId,
      running: false,
      paused: false,
      current: bookmarks.length,
      total: bookmarks.length,
      issueCount: items.length,
      currentUrl: '',
      currentTitle: '',
      error: sanitizeErrorMessage(error.message),
      done: false,
      latestItem: null,
      issueItems: items,
      recentChecks,
      networkWarning: false,
    });
    await setInvalidScanControl('idle');
    throw error;
  }
}

async function getInvalidScanProgress() {
  const data = await chrome.storage.local.get(STATE_KEYS.invalidScanProgress);
  return data[STATE_KEYS.invalidScanProgress] || {
    running: false,
    paused: false,
    current: 0,
    total: 0,
    issueCount: 0,
    currentUrl: '',
    currentTitle: '',
    recentChecks: [],
    issueItems: [],
    sessionId: null,
    done: false,
  };
}

async function setInvalidScanProgress(progress) {
  const previous = await getInvalidScanProgress();
  const previousSessionId = previous?.sessionId || null;
  const hasExplicitSession = Object.prototype.hasOwnProperty.call(progress || {}, 'sessionId');
  const nextSessionId = hasExplicitSession ? progress.sessionId : previousSessionId;
  const isSameSession = Boolean(previousSessionId && nextSessionId && previousSessionId === nextSessionId);

  if (previousSessionId && nextSessionId && previousSessionId !== nextSessionId) {
    await chrome.storage.local.set({ [STATE_KEYS.invalidScanProgress]: progress });
    return;
  }

  const merged = {
    ...previous,
    ...progress,
    sessionId: nextSessionId,
  };

  if (isSameSession) {
    merged.current = Math.max(Number(previous.current || 0), Number(progress.current ?? previous.current ?? 0));
    merged.total = Math.max(Number(previous.total || 0), Number(progress.total ?? previous.total ?? 0), Number(merged.current || 0));
    merged.issueCount = Math.max(Number(previous.issueCount || 0), Number(progress.issueCount ?? previous.issueCount ?? 0));
  }

  await chrome.storage.local.set({ [STATE_KEYS.invalidScanProgress]: merged });
}

async function setInvalidScanControl(action = 'idle', sessionId = null) {
  const status = ['running', 'paused', 'idle'].includes(action) ? action : 'idle';
  await chrome.storage.local.set({ [STATE_KEYS.invalidScanControl]: status });
  const progress = await getInvalidScanProgress();
  await setInvalidScanProgress({
    sessionId: sessionId || progress.sessionId || null,
    paused: status === 'paused',
    running: status !== 'idle' && progress.running,
  });
  return { ok: true, action: status };
}

async function waitForInvalidScanResume() {
  while (true) {
    const data = await chrome.storage.local.get(STATE_KEYS.invalidScanControl);
    const control = data[STATE_KEYS.invalidScanControl] || 'running';
    if (control === 'paused') {
      await delay(400);
      continue;
    }
    return;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkBookmarkUrl(url, timeoutSeconds, settings) {
  const language = settings.language || DEFAULT_SETTINGS.language;
  const carryCredentials = Boolean(settings.carryCredentialsForInvalid);
  if (!/^https?:\/\//i.test(url)) {
    return { kind: 'unsupported_protocol', reason: getReasonText(language, 'unsupportedProtocol') };
  }

  let response = await fetchWithTimeout(url, 'HEAD', timeoutSeconds, carryCredentials);
  if (response.error && shouldRetryWithGet(response.error)) {
    response = await fetchWithTimeout(url, 'GET', timeoutSeconds, carryCredentials);
  }

  if (!response.error && !response.timeout && shouldRetryStatusWithGet(response.status)) {
    const getResponse = await fetchWithTimeout(url, 'GET', timeoutSeconds, carryCredentials);
    if (!getResponse.error && !getResponse.timeout) {
      response = getResponse;
    }
  }

  if (response.timeout) {
    return { kind: 'timeout', reason: getReasonText(language, 'timeout', { seconds: timeoutSeconds }) };
  }

  if (response.error) {
    return await diagnoseFetchError(url, response.error, timeoutSeconds, language);
  }

  if (response.status >= 400) {
    return { kind: classifyHttpStatus(response.status), reason: describeHttpStatus(response.status, language, carryCredentials) };
  }

  return null;
}

async function fetchWithTimeout(url, method, timeoutSeconds, carryCredentials) {
  const request = createInvalidRequestInit(method, timeoutSeconds, carryCredentials);
  try {
    const response = await fetch(url, request.init);
    return { status: response.status };
  } catch (error) {
    return {
      timeout: error.name === 'AbortError',
      error: error.name === 'AbortError' ? null : sanitizeErrorMessage(error.message),
    };
  } finally {
    clearTimeout(request.timer);
  }
}

function shouldRetryWithGet(errorMessage) {
  return /method|405|failed to fetch|network/i.test(errorMessage || '');
}

function shouldRetryStatusWithGet(status) {
  return [401, 403, 405].includes(Number(status));
}

async function diagnoseFetchError(_url, errorMessage, _timeoutSeconds, language) {
  if (/NET::ERR_CERT|certificate|cert_|ssl|privacy/i.test(errorMessage || '')) {
    return { kind: 'certificate_error', reason: getReasonText(language, 'notPrivateConnection') };
  }

  if (!/failed to fetch|network/i.test(errorMessage || '')) {
    return { kind: 'failed', reason: normalizeFetchErrorReason(errorMessage, language) };
  }

  return { kind: 'network_error', reason: normalizeFetchErrorReason(errorMessage, language) };
}

function classifyHttpStatus(status) {
  if ([404, 410].includes(status)) return 'not_found';
  if ([401, 403].includes(status)) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 500) return 'server_error';
  if (status === 502) return 'bad_gateway';
  if (status === 503) return 'service_unavailable';
  if (status === 504) return 'gateway_timeout';
  if (status >= 500) return 'server_error';
  return 'failed';
}

function normalizeFetchErrorReason(errorMessage, language = DEFAULT_SETTINGS.language) {
  if (/failed to fetch|network/i.test(errorMessage || '')) return getReasonText(language, 'networkFailure');
  return sanitizeErrorMessage(errorMessage) || getReasonText(language, 'requestFailed');
}

function describeHttpStatus(status, language = DEFAULT_SETTINGS.language, carryCredentials = false) {
  const credentialHint = carryCredentials ? '插件已按设置携带登录态复查；' : '插件当前未携带登录态；如这是登录后才能访问的链接，可开启“携带登录态”后复扫。';
  const credentialHintEn = carryCredentials ? 'The extension retried with browser credentials as configured; ' : 'The extension did not send browser credentials. If this link requires sign-in, enable "Carry credentials" and rescan. ';
  const descriptions = {
    zh: {
      400: 'HTTP 400：请求格式错误，可能是网站不支持这种检测方式',
      401: `HTTP 401：需要登录或认证。${credentialHint}如果你能手动登录打开，这通常不是失效链接`,
      403: `HTTP 403：网站拒绝访问，可能需要登录、权限或禁止插件检测。${credentialHint}如果你能手动打开，通常不是失效链接`,
      404: 'HTTP 404：页面不存在，链接大概率已失效',
      410: 'HTTP 410：页面已永久删除，链接大概率已失效',
      429: 'HTTP 429：访问太频繁，被网站临时限制，请稍后再试',
      500: 'HTTP 500：网站服务器内部错误，可能是网站临时故障',
      502: 'HTTP 502：网关错误，可能是网站或代理临时故障',
      503: 'HTTP 503：网站暂时不可用，可能在维护或过载',
      504: 'HTTP 504：网关超时，可能是网站响应太慢或代理超时',
      default: `HTTP ${status}：网站返回错误状态，可能无法访问`,
    },
    en: {
      400: 'HTTP 400: Bad request. The site may not support this check method.',
      401: `HTTP 401: Login or authentication is required. ${credentialHintEn}If you can open it after signing in, it is usually not a dead link.`,
      403: `HTTP 403: Access denied. The site may require login/permission or block extension checks. ${credentialHintEn}If you can open it manually, it is usually not a dead link.`,
      404: 'HTTP 404: Page not found. The link is likely invalid.',
      410: 'HTTP 410: Page permanently removed. The link is likely invalid.',
      429: 'HTTP 429: Too many requests. The site temporarily rate-limited the check.',
      500: 'HTTP 500: Server error. The site may be temporarily broken.',
      502: 'HTTP 502: Bad gateway. The site or proxy may be temporarily broken.',
      503: 'HTTP 503: Site temporarily unavailable, possibly maintenance or overload.',
      504: 'HTTP 504: Gateway timeout. The site may be slow or the proxy timed out.',
      default: `HTTP ${status}: The site returned an error status and may be unreachable.`,
    },
  };
  const messages = descriptions[normalizeLanguage(language)] || descriptions.en;
  return messages[status] || messages.default;
}

function getReasonText(language, key, params = {}) {
  const messages = {
    zh: {
      unsupportedProtocol: '非 HTTP/HTTPS 链接',
      networkFailure: '网络连接失败',
      requestFailed: '请求失败',
      timeout: `超时 ${params.seconds} 秒`,
      notPrivateConnection: '证书/隐私错误：Chrome 提示“您的连接不是私密连接”，可能是 HTTPS 证书过期、证书不受信任或域名不匹配',
    },
    en: {
      unsupportedProtocol: 'Unsupported non-HTTP/HTTPS link',
      networkFailure: 'Network connection failed',
      requestFailed: 'Request failed',
      timeout: `Timed out after ${params.seconds}s`,
      notPrivateConnection: 'Certificate/privacy error: Chrome says "Your connection is not private". The HTTPS certificate may be expired, untrusted, or for another domain.',
    },
  };
  return (messages[normalizeLanguage(language)] || messages.en)[key] || key;
}

function isNetworkFailureResult(result) {
  return result?.kind === 'network_error';
}

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

async function getLocalBookmarkItems() {
  const [root] = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarkItems(root, bookmarks);
  return bookmarks;
}

async function getBookmarkSearchBootstrap() {
  const bookmarks = await getLocalBookmarkItems();
  return {
    ok: true,
    items: bookmarks.map((bookmark) => ({
      id: bookmark.id,
      title: bookmark.title || '',
      url: bookmark.url || '',
      folderPath: bookmark.folderPath || '',
      dateAdded: bookmark.dateAdded || 0,
    })),
  };
}

async function searchLocalBookmarks(query) {
  const settings = await getSettings();
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return { ok: true, results: [] };

  const [bookmarks, summaryMap, expandedTerms] = await Promise.all([
    getLocalBookmarkItems(),
    getAllBookmarkSummaries(),
    expandSemanticTerms(query, settings),
  ]);
  const normalizedExpandedTerms = expandedTerms.map(normalizeSearchText).filter(Boolean);
  const results = bookmarks
    .map((bookmark) => buildBookmarkSearchResult(bookmark, summaryMap.get(String(bookmark.id)) || null, normalizedQuery, normalizedExpandedTerms))
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || ((Number(b.dateAdded) || 0) - (Number(a.dateAdded) || 0)))
    .slice(0, settings.bookmarkSearchLimit);

  return { ok: true, results, expandedTerms };
}

function buildBookmarkSearchResult(bookmark, summary, normalizedQuery, normalizedExpandedTerms = []) {
  const title = String(bookmark.title || '');
  const url = String(bookmark.url || '');
  const urlInfo = parseBookmarkUrlInfo(url);
  const offlineParts = buildOfflineSummaryParts(summary, bookmark, urlInfo);
  const aiSummary = String(summary?.aiSummary || '');
  const keywordText = offlineParts.keywords.join(' ');
  const semanticText = Array.isArray(summary?.semanticTerms) ? summary.semanticTerms.join(' ') : '';
  const categoryText = offlineParts.category;
  const folderPath = String(bookmark.folderPath || summary?.folderPath || '');
  const offlineSummary = [offlineParts.source, offlineParts.title, offlineParts.category, keywordText].join(' ');
  const displayText = [title, url, urlInfo.hostname, urlInfo.pathname, folderPath, offlineSummary, aiSummary, semanticText].join(' ');
  const fields = [
    ['title', title, 120],
    ['url', url, 100],
    ['address', `${urlInfo.hostname} ${urlInfo.pathname}`, 88],
    ['folder', folderPath, 82],
    ['aiSummary', aiSummary, 72],
    ['offlineSummary', offlineSummary, 66],
    ['summary', String(summary?.summary || ''), 62],
    ['keywords', keywordText, 56],
    ['category', categoryText, 52],
    ['semantic', semanticText, 34],
  ];
  let score = 0;
  const matchedFields = [];
  const matchedTerms = [];

  for (const [field, value, weight] of fields) {
    const text = normalizeSearchText(value);
    if (!text) continue;
    if (text.includes(normalizedQuery)) {
      score += weight;
      matchedFields.push(field);
      matchedTerms.push(normalizedQuery);
    }
    for (const term of normalizedExpandedTerms) {
      if (term && text.includes(term)) {
        score += Math.max(10, Math.round(weight * 0.45));
        matchedFields.push(field);
        matchedTerms.push(term);
      }
    }
  }

  if (!score) return null;
  return {
    id: bookmark.id,
    title,
    url,
    folderPath,
    summary: offlineSummary || aiSummary || String(summary?.summary || ''),
    offlineSummary,
    offlineParts,
    aiSummary,
    matchLines: buildSearchMatchLines({
      source: offlineParts.source,
      offlineTitle: offlineParts.title,
      category: offlineParts.category,
      keywords: offlineParts.keywords.join('、'),
      aiSummary,
      folder: folderPath,
    }, normalizedQuery, normalizedExpandedTerms),
    matchExcerpt: buildSearchMatchExcerpt(displayText, normalizedQuery, normalizedExpandedTerms),
    category: offlineParts.category,
    keywords: offlineParts.keywords,
    semanticTerms: Array.isArray(summary?.semanticTerms) ? summary.semanticTerms : [],
    matchedFields: [...new Set(matchedFields)],
    matchedTerms: [...new Set(matchedTerms)],
    expandedTerms: normalizedExpandedTerms,
    updatedAt: summary?.updatedAt || '',
    score,
    dateAdded: bookmark.dateAdded || 0,
  };
}

function buildOfflineSummaryParts(summary, bookmark, urlInfo) {
  const keywords = Array.isArray(summary?.keywords) ? summary.keywords : [];
  return {
    source: String(summary?.source || (urlInfo.hostname ? `来自 ${urlInfo.hostname}` : '来源未知')),
    title: String(summary?.offlineTitle || summary?.title || bookmark?.title || ''),
    category: String(summary?.category || '其他'),
    keywords,
  };
}

function buildSearchMatchLines(fields, normalizedQuery, normalizedExpandedTerms = []) {
  const labels = {
    source: '来源',
    offlineTitle: '标题',
    category: '分类',
    keywords: '关键词',
    aiSummary: 'AI摘要',
    snapshot: '快照',
    folder: '文件夹',
  };
  const terms = [normalizedQuery, ...normalizedExpandedTerms].filter(Boolean);
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const normalized = normalizeSearchText(text);
    const matched = terms.find((term) => normalized.includes(term));
    if (!matched) continue;
    lines.push({ key, label: labels[key] || key, text: buildSearchMatchExcerpt(text, matched, []), term: matched });
  }
  return lines.slice(0, 4);
}

function buildSearchMatchExcerpt(text, normalizedQuery, normalizedExpandedTerms = []) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const normalizedSource = normalizeSearchText(source);
  const terms = [normalizedQuery, ...normalizedExpandedTerms].filter(Boolean);
  let index = -1;
  for (const term of terms) {
    index = normalizedSource.indexOf(term);
    if (index >= 0) break;
  }
  if (index < 0) return source.slice(0, 160);
  const start = Math.max(0, index - 52);
  const end = Math.min(source.length, index + 108);
  return `${start > 0 ? '...' : ''}${source.slice(start, end)}${end < source.length ? '...' : ''}`;
}

async function getBookmarkSummaryStatus() {
  const [settings, bookmarks, summaryMap] = await Promise.all([
    getSettings(),
    getLocalBookmarkItems(),
    getAllBookmarkSummaries(),
  ]);
  const currentIds = new Set(bookmarks.map((bookmark) => String(bookmark.id)));
  let summarized = 0;
  let latestUpdatedAt = '';
  for (const bookmark of bookmarks) {
    const record = summaryMap.get(String(bookmark.id));
    if (!record) continue;
    const expectedHash = createBookmarkSummarySourceHash(bookmark, settings.bookmarkSummaryVersion);
    if (record.sourceHash !== expectedHash) continue;
    summarized += 1;
    if (!latestUpdatedAt || String(record.updatedAt || '') > latestUpdatedAt) latestUpdatedAt = record.updatedAt || '';
  }
  const shadowStatus = await getShadowIndexStatus();
  return {
    ok: true,
    total: bookmarks.length,
    summarized,
    pending: Math.max(0, shadowStatus.pending || 0),
    latestUpdatedAt,
    engine: getConfiguredSummaryEngineLabel(settings),
    autoEnabled: settings.bookmarkSummaryAutoEnabled,
    autoAiEnabled: settings.bookmarkSummaryAutoAi !== false,
    autoOfflineEnabled: settings.bookmarkSummaryAutoOffline !== false,
    running: bookmarkSummaryJobRunning || shadowIndexJobRunning,
    shadowIndexEnabled: settings.shadowIndexEnabled,
    shadowIndex: shadowStatus,
  };
}

function getConfiguredSummaryEngineLabel(settings) {
  const mode = normalizeSummaryMode(settings);
  if (mode === 'geminiNano') return settings.aiValidationOk && settings.aiValidationProvider === 'geminiNano' ? 'geminiNano' : 'textrank';
  if (mode === 'customOpenai') return settings.aiValidationOk && settings.aiValidationProvider === 'customOpenai' ? 'customOpenai' : 'textrank';
  if (mode === 'customAnthropic') return settings.aiValidationOk && settings.aiValidationProvider === 'customAnthropic' ? 'customAnthropic' : 'textrank';
  if (mode === 'transformer') return settings.localModelDownloaded ? 'transformer' : 'textrank';
  return 'textrank';
}

function normalizeSummaryMode(settings) {
  if (settings.bookmarkSummaryEngineMode === 'offlineAi') return settings.bookmarkSummaryAiProvider || 'geminiNano';
  if (settings.bookmarkSummaryEngineMode === 'offline') return 'textrank';
  return settings.bookmarkSummaryEngineMode || 'textrank';
}

function canUseAiSummary(settings) {
  const mode = normalizeSummaryMode(settings);
  return ['geminiNano', 'customOpenai', 'customAnthropic'].includes(mode)
    && settings.aiValidationOk
    && settings.aiValidationProvider === mode;
}

function canUseLocalModelSummary(settings) {
  return normalizeSummaryMode(settings) === 'transformer' && Boolean(settings.localModelDownloaded);
}

async function runBookmarkSummaryJob() {
  if (bookmarkSummaryJobRunning) return await getBookmarkSummaryStatus();
  bookmarkSummaryJobRunning = true;
  await chrome.storage.local.set({ bookmarkSummaryProgress: { running: true, processed: 0, total: 0, updatedAt: new Date().toISOString() } });
  try {
    const settings = await getSettings();
    const bookmarks = await getLocalBookmarkItems();
    const summaryMap = await getAllBookmarkSummaries();
    await chrome.storage.local.set({ bookmarkSummaryProgress: { running: true, processed: 0, total: bookmarks.length, updatedAt: new Date().toISOString() } });
    const currentIds = new Set(bookmarks.map((bookmark) => String(bookmark.id)));
    let processed = 0;
    const batchSize = settings.bookmarkSummaryBatchSize;

    for (const bookmark of bookmarks) {
      const sourceHash = createBookmarkSummarySourceHash(bookmark, settings.bookmarkSummaryVersion);
      const existing = summaryMap.get(String(bookmark.id));
      if (!shouldRefreshBookmarkSummary(existing, sourceHash, settings)) continue;
      await putBookmarkSummary(await createBookmarkSummaryRecord(bookmark, settings, sourceHash, existing));
      processed += 1;
      if (processed % batchSize === 0) {
        await chrome.storage.local.set({ bookmarkSummaryProgress: { running: true, processed, total: bookmarks.length, updatedAt: new Date().toISOString() } });
        await waitForNextTick();
      }
    }

    await pruneBookmarkSummaries(currentIds);
    await chrome.storage.local.set({ bookmarkSummaryProgress: { running: false, processed, total: bookmarks.length, updatedAt: new Date().toISOString() } });
    const status = await getBookmarkSummaryStatus();
    return { ...status, processed };
  } finally {
    bookmarkSummaryJobRunning = false;
    const data = await chrome.storage.local.get('bookmarkSummaryProgress');
    await chrome.storage.local.set({ bookmarkSummaryProgress: { ...(data.bookmarkSummaryProgress || {}), running: false, updatedAt: new Date().toISOString() } });
  }
}

async function scheduleBookmarkSummaryIfEnabled(delay = 3000) {
  const settings = await getSettings();
  if (!settings.bookmarkSummaryAutoEnabled) return;
  if (bookmarkSummaryScheduleTimer) clearTimeout(bookmarkSummaryScheduleTimer);
  bookmarkSummaryScheduleTimer = setTimeout(() => {
    bookmarkSummaryScheduleTimer = null;
    runBookmarkSummaryJob().catch(() => {});
  }, delay);
  const delayInMinutes = Math.max(1, Math.ceil(delay / 60000));
  chrome.alarms.create(SUMMARY_ALARM_NAME, { delayInMinutes });
}

async function handleBookmarkCreatedForShadowIndex(id, bookmark) {
  const settings = await getSettings();
  if (!settings.shadowIndexEnabled && !settings.bookmarkSummaryAutoEnabled) return;
  if (!bookmark?.url || !isHttpUrl(bookmark.url)) return;
  await enqueueShadowIndex({ id: String(id), url: bookmark.url, title: bookmark.title || '', reason: 'created' });
  chrome.alarms.create(SHADOW_INDEX_ALARM_NAME, { delayInMinutes: 1 });
  processShadowIndexQueue().catch(() => {});
}

async function enqueueShadowIndex(bookmark) {
  const now = new Date().toISOString();
  await runBookmarkIndexQueueStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.put({
      id: String(bookmark.id),
      url: String(bookmark.url || ''),
      title: String(bookmark.title || ''),
      reason: bookmark.reason || 'manual',
      status: 'pending',
      attempts: Number(bookmark.attempts || 0),
      nextRunAt: now,
      updatedAt: now,
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}

async function processShadowIndexQueue() {
  if (shadowIndexJobRunning) return await getShadowIndexStatus();
  shadowIndexJobRunning = true;
  try {
    const settings = await getSettings();
    const tasks = await getPendingShadowIndexTasks(settings.shadowIndexMaxPagesPerWake);
    let processed = 0;
    for (const task of tasks) {
      await processShadowIndexTask(task, settings);
      processed += 1;
      await waitForNextTick();
    }
    return { ...(await getShadowIndexStatus()), processed };
  } finally {
    shadowIndexJobRunning = false;
  }
}

async function getPendingShadowIndexTasks(limit) {
  const now = Date.now();
  const records = await runBookmarkIndexQueueStore('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  }));
  return records
    .filter((item) => item.status === 'pending' && Date.parse(item.nextRunAt || 0) <= now)
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
    .slice(0, limit);
}

async function processShadowIndexTask(task, settings) {
  const bookmarks = await getLocalBookmarkItems();
  const bookmark = bookmarks.find((item) => String(item.id) === String(task.id)) || task;
  if (!bookmark?.url || !isHttpUrl(bookmark.url)) {
    await markShadowIndexTaskDone(task.id, 'unsupported');
    return;
  }

  try {
    const sourceHash = createBookmarkSummarySourceHash(bookmark, settings.bookmarkSummaryVersion);
    const record = await createLocalSummaryRecord(bookmark, settings, sourceHash, parseBookmarkUrlInfo(bookmark.url), 'textrank');
    await putBookmarkSummary(record);
    await markShadowIndexTaskDone(task.id, 'done');
  } catch (error) {
    const attempts = Number(task.attempts || 0) + 1;
    const nextRunAt = new Date(Date.now() + Math.min(60, attempts * 5) * 60000).toISOString();
    const fallbackRecord = await createLocalSummaryRecord(bookmark, settings, createBookmarkSummarySourceHash(bookmark, settings.bookmarkSummaryVersion), parseBookmarkUrlInfo(bookmark.url), 'textrank');
    await putBookmarkSummary({ ...fallbackRecord, error: sanitizeErrorMessage(error.message), updatedAt: new Date().toISOString() });
    await runBookmarkIndexQueueStore('readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.put({ ...task, status: attempts >= 3 ? 'failed' : 'pending', attempts, nextRunAt, error: sanitizeErrorMessage(error.message), updatedAt: new Date().toISOString() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }));
  }
}



async function createShadowIndexRecord(bookmark, settings, sourceHash) {
  const existing = (await getAllBookmarkSummaries()).get(String(bookmark.id));
  const urlInfo = parseBookmarkUrlInfo(bookmark.url);
  const title = String(bookmark.title || '未命名书签');
  const readableHost = urlInfo.hostname || '本地地址';
  const rawKeywords = extractBookmarkKeywords(title, urlInfo);
  const keywords = rawKeywords.slice(0, settings.bookmarkSummaryKeywordLimit);
  const category = categorizeBookmark(title, urlInfo, keywords);
  const offlineSummary = buildBookmarkSummary(title, readableHost, category, keywords, settings);
  const aiSummary = await tryCreateAiSummary(`${title}\n${readableHost}\n${offlineSummary}`, offlineSummary, settings);
  const aiMeta = await tryCreateAiMetadata(`${title}\n${readableHost}\n${offlineSummary}`, settings);
  const semanticTerms = await expandSemanticTerms(`${bookmark.title || ''} ${keywords.join(' ')} ${aiMeta.keywords.join(' ')}`, settings);
  return normalizeSummaryRecord({
    ...(existing || {}),
    id: String(bookmark.id),
    title,
    url: String(bookmark.url || ''),
    folderPath: String(bookmark.folderPath || existing?.folderPath || ''),
    summary: offlineSummary,
    offlineSummary,
    source: urlInfo.hostname ? `来自 ${urlInfo.hostname}` : '来源未知',
    offlineTitle: title,
    aiSummary,
    category,
    keywords,
    aiCategory: aiMeta.category,
    aiKeywords: aiMeta.keywords,
    semanticTerms,
    engine: aiSummary ? `${normalizeSummaryMode(settings)}+textrank` : 'textrank',
    version: settings.bookmarkSummaryVersion,
    sourceHash,
    summaryStatus: 'done',
    updatedAt: new Date().toISOString(),
  });
}

async function tryCreateAiSummary(sourceText, fallbackSummary, settings) {
  const text = String(sourceText || fallbackSummary || '');
  if (!text || !canUseAiSummary(settings)) return '';
  const prompt = buildAiSummaryPrompt(text, settings);
  return await runConfiguredAiPrompt(prompt, settings);
}

async function tryCreateAiMetadata(sourceText, settings) {
  const text = String(sourceText || '').trim();
  if (!text || !canUseAiSummary(settings)) return { category: '', keywords: [] };
  const prompt = `请根据下面网页内容输出分类和关键词，必须只返回 JSON，不要解释。格式：{"category":"分类名","keywords":["关键词1","关键词2","关键词3"]}。\n${text.slice(0, settings.bookmarkSummaryMaxInputChars * 8)}`;
  const raw = await runConfiguredAiPrompt(prompt, { ...settings, bookmarkSummaryMaxSummaryChars: 180 });
  return parseAiMetadata(raw, settings);
}

async function runConfiguredAiPrompt(prompt, settings) {
  const provider = normalizeSummaryMode(settings);
  if (provider === 'geminiNano') return await tryCreateGeminiNanoSummary(prompt, settings);
  if (provider === 'customOpenai') return await tryCreateOpenAiSummary(prompt, settings);
  if (provider === 'customAnthropic') return await tryCreateAnthropicSummary(prompt, settings);
  return '';
}

function parseAiMetadata(raw, settings) {
  const text = String(raw || '').trim();
  if (!text) return { category: '', keywords: [] };
  try {
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const data = JSON.parse(jsonText);
    return {
      category: String(data.category || '').trim().slice(0, 20),
      keywords: Array.isArray(data.keywords)
        ? data.keywords.map((item) => String(item || '').trim()).filter(Boolean).slice(0, settings.bookmarkSummaryKeywordLimit)
        : [],
    };
  } catch (_error) {
    const categoryMatch = text.match(/分类[：:]\s*([^，,。\n]+)/);
    const keywordMatch = text.match(/关键词[：:]\s*([^。\n]+)/);
    return {
      category: categoryMatch ? categoryMatch[1].trim().slice(0, 20) : '',
      keywords: keywordMatch ? keywordMatch[1].split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, settings.bookmarkSummaryKeywordLimit) : [],
    };
  }
}

function buildAiSummaryPrompt(text, settings) {
  return `请根据下面内容生成中文摘要，必须控制在50字以内，只输出摘要本身，不要解释。\n${String(text || '').slice(0, settings.bookmarkSummaryMaxInputChars * 8)}`;
}

async function tryCreateGeminiNanoSummary(prompt, settings) {
  const api = getGeminiNanoApi();
  if (!api?.create && !api?.createTextSession) return '';
  try {
    const session = api.createTextSession
      ? await api.createTextSession()
      : await api.create();
    const result = await Promise.race([
      session.prompt(prompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI summary timeout.')), 15000)),
    ]);
    if (session.destroy) session.destroy();
    return limitAiSummary(result, settings);
  } catch (_error) {
    return '';
  }
}

async function tryCreateOpenAiSummary(prompt, settings) {
  if (!settings.customAiBaseUrl || !settings.customAiApiKey || !settings.customAiModel) return '';
  try {
    const response = await fetch(buildOpenAiEndpoint(settings.customAiBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.customAiApiKey}`,
      },
      body: JSON.stringify({
        model: settings.customAiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 120,
      }),
    });
    if (!response.ok) return '';
    const data = await response.json();
    return limitAiSummary(data?.choices?.[0]?.message?.content, settings);
  } catch (_error) {
    return '';
  }
}

async function tryCreateAnthropicSummary(prompt, settings) {
  if (!settings.customAiBaseUrl || !settings.customAiApiKey || !settings.customAiModel) return '';
  try {
    const response = await fetch(buildAnthropicEndpoint(settings.customAiBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.customAiApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.customAiModel,
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) return '';
    const data = await response.json();
    const text = Array.isArray(data?.content) ? data.content.map((item) => item.text || '').join('') : '';
    return limitAiSummary(text, settings);
  } catch (_error) {
    return '';
  }
}

function buildOpenAiEndpoint(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

function buildAnthropicEndpoint(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  return trimmed.endsWith('/messages') ? trimmed : `${trimmed}/messages`;
}

function limitAiSummary(text, settings) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, Math.min(50, settings.bookmarkSummaryMaxSummaryChars || 50));
}

async function markShadowIndexTaskDone(id, status) {
  await runBookmarkIndexQueueStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.put({ id: String(id), status, updatedAt: new Date().toISOString(), nextRunAt: new Date().toISOString() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}

async function getShadowIndexStatus() {
  const records = await runBookmarkIndexQueueStore('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  }));
  return {
    ok: true,
    running: shadowIndexJobRunning,
    pending: records.filter((item) => item.status === 'pending').length,
    done: records.filter((item) => item.status === 'done').length,
    failed: records.filter((item) => item.status === 'failed').length,
  };
}

async function reindexAllBookmarks() {
  const settings = await getSettings();
  const bookmarks = (await getLocalBookmarkItems()).filter((bookmark) => isHttpUrl(bookmark.url));
  for (const bookmark of bookmarks) await enqueueShadowIndex({ ...bookmark, reason: 'manual-all' });
  chrome.alarms.create(SHADOW_INDEX_ALARM_NAME, { delayInMinutes: 1 });
  processShadowIndexQueue().catch(() => {});
  return { ok: true, queued: bookmarks.length, settings };
}

async function reindexBookmark(id) {
  const bookmark = (await getLocalBookmarkItems()).find((item) => String(item.id) === String(id));
  if (!bookmark) return { ok: false, error: 'Bookmark not found.' };
  await enqueueShadowIndex({ ...bookmark, reason: 'manual' });
  chrome.alarms.create(SHADOW_INDEX_ALARM_NAME, { delayInMinutes: 1 });
  processShadowIndexQueue().catch(() => {});
  return { ok: true };
}

async function regenerateAiSummary(id, overrideSettings = null) {
  const settings = overrideSettings || await getSettings();
  const bookmark = (await getLocalBookmarkItems()).find((item) => String(item.id) === String(id));
  if (!bookmark) return { ok: false, error: 'Bookmark not found.' };
  const summaryMap = await getAllBookmarkSummaries();
  const existing = summaryMap.get(String(id));
  const urlInfo = parseBookmarkUrlInfo(bookmark.url);
  const baseRecord = existing || await createLocalSummaryRecord(bookmark, settings, createBookmarkSummarySourceHash(bookmark, settings.bookmarkSummaryVersion), urlInfo, 'textrank');
  const sourceText = `${baseRecord.title || bookmark.title}\n${baseRecord.source || urlInfo.hostname}\n${baseRecord.offlineSummary || ''}`;
  const aiSummary = await tryCreateAiSummary(sourceText, baseRecord.offlineSummary, settings);
  const aiMeta = await tryCreateAiMetadata(sourceText, settings);
  const record = normalizeSummaryRecord({
    ...baseRecord,
    aiSummary: aiSummary || baseRecord.aiSummary,
    aiCategory: aiMeta.category || baseRecord.aiCategory,
    aiKeywords: aiMeta.keywords.length ? aiMeta.keywords : baseRecord.aiKeywords,
    engine: aiSummary ? `${settings.bookmarkSummaryAiProvider}+textrank` : baseRecord.engine,
    aiUpdatedAt: aiSummary ? new Date().toISOString() : baseRecord.aiUpdatedAt,
    aiAttemptedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await putBookmarkSummary(record);
  return { ok: true, record };
}

async function rebuildAiSummaryIndex() {
  const settings = await getSettings();
  const bookmarks = (await getLocalBookmarkItems()).filter((bookmark) => isHttpUrl(bookmark.url));
  let updated = 0;
  for (const bookmark of bookmarks) {
    await regenerateAiSummary(bookmark.id, settings);
    updated += 1;
    if (updated % settings.bookmarkSummaryBatchSize === 0) await waitForNextTick();
  }
  return { ok: true, updated };
}

async function batchRegenerateAiSummary(ids) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'No IDs provided.' };
  const settings = await getSettings();
  const idSet = new Set(ids.map(String));
  let updated = 0;
  for (const id of idSet) {
    await regenerateAiSummary(id, settings);
    updated += 1;
    if (updated % settings.bookmarkSummaryBatchSize === 0) await waitForNextTick();
  }
  return { ok: true, updated };
}

async function batchOfflineSummary(ids) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'No IDs provided.' };
  const settings = await getSettings();
  const summaryMap = await getAllBookmarkSummaries();
  const idSet = new Set(ids.map(String));
  let updated = 0;
  for (const id of idSet) {
    const existing = summaryMap.get(id);
    const title = String(existing?.title || '');
    const url = String(existing?.url || '');
    const urlInfo = parseBookmarkUrlInfo(url);
    const tokens = tokenizeBookmarkText(title, urlInfo, '');
    const keywords = extractBookmarkKeywords(title, urlInfo).slice(0, settings.bookmarkSummaryKeywordLimit);
    const category = categorizeBookmark(title, urlInfo, keywords);
    const readableHost = urlInfo.hostname || '本地地址';
    const offlineSummary = buildBookmarkSummary(title, readableHost, category, keywords, settings);
    await putBookmarkSummary(normalizeSummaryRecord({
      ...(existing || { id }),
      title,
      url,
      source: `来自 ${readableHost}`,
      offlineTitle: title,
      category,
      keywords,
      summary: offlineSummary,
      offlineSummary,
      engine: existing?.engine || 'textrank',
      version: settings.bookmarkSummaryVersion,
      summaryStatus: 'done',
      updatedAt: new Date().toISOString(),
    }));
    updated += 1;
    if (updated % settings.bookmarkSummaryBatchSize === 0) await waitForNextTick();
  }
  return { ok: true, updated };
}

async function updateSummaryRecordFields(message) {
  const id = String(message.id || '');
  const summaryMap = await getAllBookmarkSummaries();
  const existing = summaryMap.get(id);
  if (!existing) return { ok: false, error: 'Summary record not found.' };
  const keywords = String(message.keywords || '')
    .split(/[、,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const record = normalizeSummaryRecord({
    ...existing,
    manualCategory: String(message.category || '').trim(),
    manualKeywords: keywords,
    updatedAt: new Date().toISOString(),
  });
  await putBookmarkSummary(record);
  return { ok: true, record };
}

async function getSummaryRecords(message = {}) {
  const settings = await getSettings();
  const query = normalizeSearchText(message.query || '');
  const filter = String(message.filter || 'all');
  const page = Math.max(1, Number(message.page || 1));
  const pageSize = Math.min(200, Math.max(20, Number(message.pageSize || settings.summaryPageSize)));
  const [bookmarks, summaryMap] = await Promise.all([getLocalBookmarkItems(), getAllBookmarkSummaries()]);
  const records = bookmarks.map((bookmark) => {
    const summary = summaryMap.get(String(bookmark.id));
    const url = bookmark.url || summary?.url || '';
    const urlInfo = parseBookmarkUrlInfo(url);
    return normalizeSummaryRecord({
      ...(summary || {}),
      id: String(bookmark.id),
      title: bookmark.title || summary?.title || '',
      url,
      folderPath: bookmark.folderPath || summary?.folderPath || '',
      source: summary?.source || (urlInfo.hostname ? `来自 ${urlInfo.hostname}` : ''),
      offlineTitle: summary?.offlineTitle || bookmark.title || summary?.title || '',
    });
  }).filter((record) => matchesSummaryFilter(record, filter)).filter((record) => {
    if (!query) return true;
    return [
      record.title,
      record.url,
      record.folderPath,
      record.offlineSummary,
      record.aiSummary,
      record.category,
      record.manualCategory,
      record.aiCategory,
      ...(record.manualKeywords || []),
      ...(record.keywords || []),
      ...(record.aiKeywords || []),
    ].some((value) => normalizeSearchText(value).includes(query));
  }).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.title).localeCompare(String(b.title)));
  const start = (page - 1) * pageSize;
  return {
    ok: true,
    page,
    pageSize,
    total: records.length,
    records: records.slice(start, start + pageSize).map((record) => ({ ...record })),
    stats: buildSummaryRecordStats(bookmarks.length, records, summaryMap),
    aiConfigured: Boolean(
      settings.bookmarkSummaryEngine === 'ai' &&
      (
        settings.bookmarkSummaryAiProvider === 'gemini-nano' ||
        (settings.bookmarkSummaryAiProvider === 'custom-openai' && settings.customAiApiKey) ||
        (settings.bookmarkSummaryAiProvider === 'custom-anthropic' && settings.customAiApiKey)
      )
    ),
    aiEngine: settings.bookmarkSummaryAiProvider || '',
  };
}

function matchesSummaryFilter(record, filter) {
  if (filter === 'all' || !filter) return true;
  const filters = filter.split(',').map((s) => s.trim()).filter(Boolean);
  if (!filters.length || filters.includes('all')) return true;
  return filters.some((f) => {
    if (f === 'ai') return Boolean(record.aiSummary);
    if (f === 'noAi') return !record.aiSummary;
    if (f === 'unprocessed') return !record.offlineSummary && !record.aiSummary;
    return true;
  });
}

function buildSummaryRecordStats(totalBookmarks, records, summaryMap) {
  let aiCount = 0;
  let unprocessedCount = 0;
  for (const [id, summary] of summaryMap) {
    const hasOffline = Boolean(summary.offlineSummary);
    const hasAi = Boolean(summary.aiSummary);
    if (hasAi) aiCount++;
    if (!hasOffline && !hasAi) unprocessedCount++;
  }
  unprocessedCount += Math.max(0, totalBookmarks - summaryMap.size);
  return {
    total: totalBookmarks,
    ai: aiCount,
    unprocessed: unprocessedCount,
  };
}

async function expandSemanticTerms(query, settings) {
  if (!settings.semanticSearchEnabled || !query) return [];
  await loadMiniEmbeddings(settings).catch(() => null);
  const normalized = normalizeSearchText(query);
  const direct = SEMANTIC_FALLBACK_TERMS[normalized] || [];
  const partial = Object.entries(SEMANTIC_FALLBACK_TERMS)
    .filter(([key]) => normalized.includes(normalizeSearchText(key)) || normalizeSearchText(key).includes(normalized))
    .flatMap(([, values]) => values);
  return [...new Set([...direct, ...partial])].slice(0, settings.semanticExpansionLimit);
}

async function loadMiniEmbeddings(settings) {
  if (semanticModelCache) return semanticModelCache;
  try {
    const response = await fetch(chrome.runtime.getURL(settings.embeddingResourcePath || DEFAULT_SETTINGS.embeddingResourcePath));
    semanticModelCache = response.ok ? await response.arrayBuffer() : null;
  } catch (_error) {
    semanticModelCache = null;
  }
  return semanticModelCache;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    parsed.hash = '';
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch (_error) {
    return String(url || '').replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
  }
}

async function checkGeminiNanoAvailability() {
  const result = await probeGeminiNanoRuntime();
  const settings = await getSettings();
  await saveSettings(sanitizeSettings({ ...settings, aiValidationProvider: 'geminiNano', aiValidationOk: result.ok }));
  return {
    ok: true,
    available: result.ok,
    engine: result.ok ? 'geminiNano' : 'textrank',
    reasonKey: result.reasonKey,
  };
}

async function probeGeminiNanoRuntime() {
  const api = getGeminiNanoApi();
  if (!api) return { ok: false, reasonKey: 'geminiNanoApiMissing' };
  if (typeof api.availability === 'function') {
    try {
      const availability = await api.availability();
      if (availability && !['available', 'readily'].includes(String(availability).toLowerCase())) {
        return { ok: false, reasonKey: 'geminiNanoModelNotReady' };
      }
    } catch (_error) {}
  }
  if (typeof api.canCreateTextSession === 'function') {
    try {
      const canCreate = await api.canCreateTextSession();
      if (canCreate && !['readily', 'available', 'yes'].includes(String(canCreate).toLowerCase())) {
        return { ok: false, reasonKey: 'geminiNanoModelNotReady' };
      }
    } catch (_error) {
      return { ok: false, reasonKey: 'geminiNanoModelNotReady' };
    }
  }
  if (typeof api.create !== 'function' && typeof api.createTextSession !== 'function') {
    return { ok: false, reasonKey: 'geminiNanoApiMissing' };
  }
  let session = null;
  try {
    session = typeof api.createTextSession === 'function'
      ? await api.createTextSession()
      : await api.create();
    if (!session || typeof session.prompt !== 'function') return { ok: false, reasonKey: 'geminiNanoPromptFailed' };
    const output = await Promise.race([
      session.prompt('请只回复 OK'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini Nano validation timeout.')), 20000)),
    ]);
    return String(output || '').trim() ? { ok: true } : { ok: false, reasonKey: 'geminiNanoPromptFailed' };
  } catch (_error) {
    return { ok: false, reasonKey: 'geminiNanoPromptFailed' };
  } finally {
    try {
      if (session?.destroy) session.destroy();
    } catch (_error) {}
  }
}

function getGeminiNanoApi() {
  return globalThis.ai || globalThis.LanguageModel || globalThis.ai?.languageModel || null;
}

const LEGACY_MODEL_MAP = { 'qwen3-0.6b': 'lamini-flan-t5' };
const MODEL_CACHE_DB_NAME = 'zongzi_model_store';
const MODEL_CACHE_DB_VERSION = 3;
const MODEL_CACHE_STORE_NAME = 'modelFiles';
const MODEL_CACHE_META_STORE_NAME = 'modelFileMeta';
const MODEL_REGISTRY = {
  'lamini-flan-t5': {
    files: [
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
      'tokenizer.json',
      'config.json',
      'tokenizer_config.json',
    ],
    fileSizeHints: {
      'tokenizer.json': 2400000,
      'config.json': 800,
      'tokenizer_config.json': 2300,
    },
  },
  'mt5-small': {
    files: [
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
      'tokenizer.json',
      'config.json',
      'tokenizer_config.json',
    ],
    fileSizeHints: {
      'tokenizer.json': 4300000,
      'config.json': 1200,
      'tokenizer_config.json': 2300,
    },
  },
  distilbart: {
    files: [
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
      'tokenizer.json',
      'config.json',
      'tokenizer_config.json',
    ],
    fileSizeHints: {
      'tokenizer.json': 1400000,
      'config.json': 800,
      'tokenizer_config.json': 1300,
    },
  },
};

async function downloadLocalSummaryModel(modelId) {
  // 前端会打开独立下载页面（model-download.html）处理下载+进度+取消
  // 后台只返回模型元信息
  const normalizedModelId = LEGACY_MODEL_MAP[modelId] || modelId || 'distilbart';
  return { ok: true, modelId: normalizedModelId, openDownloadPage: true };
}

async function onModelDownloadComplete(modelId) {
  if (!modelId) return { ok: false, error: 'Missing modelId.' };
  const settings = await getSettings();
  const normalizedModelId = LEGACY_MODEL_MAP[modelId] || modelId || settings.localModelId || 'distilbart';
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
  const normalizedModelId = LEGACY_MODEL_MAP[modelId || settings.localModelId] || modelId || settings.localModelId || 'distilbart';
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
  const normalizedModelId = LEGACY_MODEL_MAP[modelId] || modelId || 'distilbart';
  const meta = MODEL_REGISTRY[normalizedModelId] || MODEL_REGISTRY.distilbart;
  const fileStates = [];
  let completedFiles = 0;
  let totalStoredBytes = 0;
  let lastUpdatedAt = '';

  for (const file of meta.files) {
    const key = normalizedModelId + '::' + file;
    const info = await getIndexedDbModelFileInfo(key);
    const expectedSize = Math.max(Number(info.expectedSize) || 0, Number(meta.fileSizeHints?.[file]) || 0);
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
    totalFiles: meta.files.length,
    completedFiles,
    totalStoredBytes,
    ready: meta.files.length > 0 && completedFiles === meta.files.length,
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
    const normalizedModelId = LEGACY_MODEL_MAP[modelId || settings.localModelId] || modelId || settings.localModelId;

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

async function validateCustomAiConnection() {
  const settings = await getSettings();
  const provider = normalizeSummaryMode(settings);
  if (provider === 'geminiNano') return await checkGeminiNanoAvailability();
  if (!settings.customAiBaseUrl || !settings.customAiApiKey || !settings.customAiModel) {
    return { ok: false, error: '请先填写接口地址、API Key 和模型。' };
  }
  const samplePrompt = '请回复“连接成功”，不要输出其他内容。';
  const summary = provider === 'customAnthropic'
    ? await tryCreateAnthropicSummary(samplePrompt, { ...settings, bookmarkSummaryMaxSummaryChars: 50 })
    : await tryCreateOpenAiSummary(samplePrompt, { ...settings, bookmarkSummaryMaxSummaryChars: 50 });
  if (summary) {
    await saveSettings(sanitizeSettings({ ...settings, aiValidationProvider: provider, aiValidationOk: true }));
    return { ok: true, message: summary };
  }
  await saveSettings(sanitizeSettings({ ...settings, aiValidationProvider: provider, aiValidationOk: false }));
  return { ok: false, error: 'AI 连接失败，请检查接口地址、密钥和模型。' };
}

async function scheduleBookmarkSummaryIfEnabled(delay = 3000) {
  const settings = await getSettings();
  if (!settings.bookmarkSummaryAutoEnabled) return;
  if (bookmarkSummaryScheduleTimer) clearTimeout(bookmarkSummaryScheduleTimer);
  bookmarkSummaryScheduleTimer = setTimeout(() => {
    bookmarkSummaryScheduleTimer = null;
    runBookmarkSummaryJob().catch(() => {});
  }, delay);
  const delayInMinutes = Math.max(1, Math.ceil(delay / 60000));
  chrome.alarms.create(SUMMARY_ALARM_NAME, { delayInMinutes });
}

function shouldRefreshBookmarkSummary(existing, sourceHash, settings) {
  if (!existing?.offlineSummary || existing.sourceHash !== sourceHash) return true;
  if (canUseLocalModelSummary(settings) && existing.summaryEngine !== 'transformer') return true;
  return canUseAiSummary(settings) && !existing.aiSummary;
}

async function createBookmarkSummaryRecord(bookmark, settings, sourceHash, existing = null) {
  const urlInfo = parseBookmarkUrlInfo(bookmark.url);
  return await createLocalSummaryRecord(bookmark, settings, sourceHash, urlInfo, 'textrank', '', existing);
}

async function createLocalSummaryRecord(bookmark, settings, sourceHash, urlInfo, engine, fallbackNote = '', existing = null) {
  const tokens = tokenizeBookmarkText(bookmark.title, urlInfo, '').slice(0, settings.bookmarkSummaryMaxInputChars);
  const keywords = engine === 'textrank'
    ? rankBookmarkKeywords(tokens, settings).slice(0, settings.bookmarkSummaryKeywordLimit)
    : extractBookmarkKeywords(bookmark.title, urlInfo).slice(0, settings.bookmarkSummaryKeywordLimit);
  const category = categorizeBookmark(bookmark.title, urlInfo, keywords);
  const readableHost = urlInfo.hostname || '本地地址';
  const title = String(bookmark.title || '未命名书签');
  const fallbackText = `${title}\n${readableHost}`;
  const offlineSummary = buildBookmarkSummary(title, readableHost, category, keywords, settings, fallbackNote);
  const localModelSummary = canUseLocalModelSummary(settings)
    ? await buildLocalModelSummary(`${title}\n${readableHost}\n${offlineSummary}`, settings)
    : '';
  const aiSummary = await tryCreateAiSummary(`${title}\n${readableHost}\n${offlineSummary}`, offlineSummary, settings);
  const aiMeta = await tryCreateAiMetadata(`${title}\n${readableHost}\n${offlineSummary}`, settings);
  return normalizeSummaryRecord({
    ...(existing || {}),
    id: String(bookmark.id),
    title: String(bookmark.title || ''),
    url: String(bookmark.url || ''),
    folderPath: String(bookmark.folderPath || existing?.folderPath || ''),
    summary: offlineSummary,
    offlineSummary,
    source: readableHost ? `来自 ${readableHost}` : '来源未知',
    offlineTitle: title,
    aiSummary: aiSummary || localModelSummary,
    category,
    keywords,
    aiCategory: aiMeta.category,
    aiKeywords: aiMeta.keywords,
    semanticTerms: existing?.semanticTerms || [],
    engine: aiSummary ? `${settings.bookmarkSummaryAiProvider}+${engine}` : (localModelSummary ? `transformer+${engine}` : engine),
    version: settings.bookmarkSummaryVersion,
    sourceHash,
    summaryStatus: 'done',
    updatedAt: new Date().toISOString(),
  });
}

function buildBookmarkSummary(title, readableHost, category, keywords, settings, fallbackNote = '') {
  const keywordText = keywords.length ? `关键词：${keywords.slice(0, settings.bookmarkSummaryKeywordLimit).join('、')}` : '暂无明显关键词';
  const note = fallbackNote ? ` ${fallbackNote}` : '';
  const text = `来自 ${readableHost} 的书签，标题为「${title}」，分类为「${category}」，${keywordText}。${note}`;
  return text.slice(0, settings.bookmarkSummaryMaxSummaryChars);
}

async function buildLocalModelSummary(text, settings) {
  // 使用 Offscreen Document + Transformer.js 进行真实 ONNX 推理
  const modelId = settings.localModelId || 'distilbart';
  return await runOffscreenSummarize(modelId, text, settings);
}

// ---- Offscreen Document management ----

let offscreenCreating = false;
let offscreenReady = false;

async function ensureOffscreenInference() {
  const clients = await chrome.offscreen?.hasDocument?.();
  if (!clients || !clients.length) {
    if (offscreenCreating) {
      // Wait for creation to finish
      let wait = 0;
      while (offscreenCreating && wait < 10000) {
        await sleepPromise(200);
        wait += 200;
      }
      if (offscreenCreating) throw new Error('Offscreen document creation timed out');
      return;
    }
    offscreenCreating = true;
    offscreenReady = false;
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen-inference.html',
        reasons: ['WORKERS'],
        justification: 'Running Transformer.js ONNX inference for bookmark summarization',
      });
    } catch (err) {
      offscreenCreating = false;
      // If offscreen API not available, throw so caller falls back to TextRank
      throw new Error('Offscreen API unavailable: ' + (err.message || ''));
    }
    offscreenCreating = false;
    offscreenReady = true;
  }
}

function sleepPromise(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function runOffscreenSummarize(modelId, text, settings) {
  if (!text || !text.trim()) return '';

  // Resolve legacy model IDs
  const normalizedModelId = LEGACY_MODEL_MAP[modelId] || modelId;

  try {
    await ensureOffscreenInference();
  } catch (_) {
    // Offscreen unavailable, fall back to TextRank
    return buildTextRankSummary(text, settings);
  }

  try {
    const maxLen = settings.bookmarkSummaryMaxSummaryChars || 50;
    const result = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_SUMMARIZE',
      target: 'offscreen-inference',
      modelId: normalizedModelId,
      text: text,
      maxLength: maxLen,
    });

    if (result?.ok && result.summary) {
      return result.summary;
    }
    // Fall back on error
    return buildTextRankSummary(text, settings);
  } catch (err) {
    console.warn('[background] Offscreen inference failed, falling back to TextRank:', err.message);
    return buildTextRankSummary(text, settings);
  }
}

function buildTextRankSummary(text, settings) {
  const sentences = splitSummarySentences(text).slice(0, 80);
  if (!sentences.length) return '';
  const tokenScores = new Map();
  for (const token of tokenizeFreeText(text)) tokenScores.set(token, (tokenScores.get(token) || 0) + 1 + getSummaryVectorBoost(token));
  const ranked = sentences
    .map((sentence, index) => {
      const tokens = tokenizeFreeText(sentence);
      const score = tokens.reduce((sum, token) => sum + (tokenScores.get(token) || 0), 0) / Math.max(1, tokens.length);
      return { sentence, index, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
    .join(' ');
  return ranked.slice(0, settings.bookmarkSummaryMaxSummaryChars || DEFAULT_SETTINGS.bookmarkSummaryMaxSummaryChars);
}

function splitSummarySentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？.!?])\s+|[\r\n]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12 && item.length <= 280);
}

function tokenizeBookmarkText(title, urlInfo, extraText = '') {
  return `${title || ''} ${urlInfo.hostname || ''} ${urlInfo.pathname || ''} ${extraText || ''}`
    .toLowerCase()
    .replace(/[\/#?=&._:\-]+/g, ' ')
    .split(/\s+|(?=[一-龥])|(?<=[一-龥])/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 24 && !BOOKMARK_SUMMARY_STOP_WORDS.has(item));
}

function tokenizeFreeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\/#?=&._:\-，。！？；：、（）【】「」『』《》“”‘’]+/g, ' ')
    .split(/\s+|(?=[一-龥])|(?<=[一-龥])/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 24 && !BOOKMARK_SUMMARY_STOP_WORDS.has(item));
}

function rankBookmarkKeywords(tokens, settings) {
  const uniqueTokens = [...new Set(tokens)];
  const scores = new Map(uniqueTokens.map((token) => [token, 1]));
  const graph = new Map(uniqueTokens.map((token) => [token, new Set()]));
  for (let index = 0; index < tokens.length; index += 1) {
    const source = tokens[index];
    for (let offset = 1; offset <= 4 && index + offset < tokens.length; offset += 1) {
      const target = tokens[index + offset];
      if (source === target) continue;
      graph.get(source)?.add(target);
      graph.get(target)?.add(source);
    }
  }
  for (let iteration = 0; iteration < settings.bookmarkSummaryTextRankIterations; iteration += 1) {
    const nextScores = new Map();
    for (const token of uniqueTokens) {
      let score = 0.15;
      for (const neighbor of graph.get(token) || []) {
        const neighborLinks = graph.get(neighbor)?.size || 1;
        score += 0.85 * ((scores.get(neighbor) || 1) / neighborLinks);
      }
      nextScores.set(token, score + getSummaryVectorBoost(token));
    }
    scores.clear();
    for (const [token, score] of nextScores) scores.set(token, score);
  }
  return uniqueTokens
    .sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0) || a.localeCompare(b))
    .slice(0, settings.bookmarkSummaryKeywordLimit);
}

function getSummaryVectorBoost(token) {
  const text = normalizeSearchText(token);
  for (const [, values] of BOOKMARK_SUMMARY_CATEGORY_VECTORS) {
    if (values.some((value) => text.includes(value) || value.includes(text))) return 0.6;
  }
  return 0;
}

function parseBookmarkUrlInfo(url) {
  try {
    const parsed = new URL(String(url || ''));
    return {
      hostname: parsed.hostname.replace(/^www\./, ''),
      pathname: parsed.pathname || '',
    };
  } catch (_error) {
    return { hostname: '', pathname: String(url || '') };
  }
}

function extractBookmarkKeywords(title, urlInfo) {
  const raw = `${title || ''} ${urlInfo.hostname || ''} ${urlInfo.pathname || ''}`
    .toLowerCase()
    .replace(/[\/?#=&._:\-]+/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 24);
  return [...new Set(raw)].slice(0, 12);
}

function categorizeBookmark(title, urlInfo, keywords) {
  const text = normalizeSearchText(`${title || ''} ${urlInfo.hostname || ''} ${keywords.join(' ')}`);
  const matched = BOOKMARK_SUMMARY_CATEGORY_VECTORS.find(([, values]) => values.some((value) => text.includes(normalizeSearchText(value))));
  return matched ? matched[0] : '其他';
}

function createBookmarkSummarySourceHash(bookmark, version) {
  return simpleHash(`${version}|${bookmark.id}|${bookmark.title || ''}|${bookmark.url || ''}`);
}

function simpleHash(value) {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return String(hash);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSummaryRecord(record = {}) {
  const offlineSummary = String(record.offlineSummary || record.summary || '');
  return {
    ...record,
    id: String(record.id || record.bookmarkId || ''),
    title: String(record.title || ''),
    url: String(record.url || ''),
    folderPath: String(record.folderPath || ''),
    summary: String(record.summary || offlineSummary),
    offlineSummary,
    source: String(record.source || ''),
    offlineTitle: String(record.offlineTitle || record.title || ''),
    aiSummary: String(record.aiSummary || ''),
    manualCategory: String(record.manualCategory || ''),
    manualKeywords: Array.isArray(record.manualKeywords) ? record.manualKeywords : [],
    aiCategory: String(record.aiCategory || ''),
    aiKeywords: Array.isArray(record.aiKeywords) ? record.aiKeywords : [],
    aiUpdatedAt: String(record.aiUpdatedAt || ''),
    aiAttemptedAt: String(record.aiAttemptedAt || ''),
    category: String(record.category || '其他'),
    keywords: Array.isArray(record.keywords) ? record.keywords : [],
    semanticTerms: Array.isArray(record.semanticTerms) ? record.semanticTerms : [],
    summaryStatus: record.summaryStatus || (offlineSummary ? 'done' : 'pending'),
    updatedAt: record.updatedAt || '',
  };
}

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

function getNodeRootKey(node, currentRootKey) {
  if (currentRootKey) return currentRootKey;
  const key = getRootKey(node);
  return ['bar', 'other', 'synced'].includes(key) ? key : '';
}

function normalizeBookmarkUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.searchParams.sort();
    const value = parsed.toString();
    return value.endsWith('/') ? value.slice(0, -1) : value;
  } catch (_error) {
    return String(url || '').trim();
  }
}

async function uploadLocalBookmarks(message, settings = null, existingProvider = null) {
  const runtimeSettings = await getRuntimeSettings(settings);
  const provider = existingProvider || getSyncProvider(runtimeSettings);
  validateProviderSettings(runtimeSettings, provider);

  const snapshot = await createLocalBookmarkSnapshot();
  const { etag, versionUrl } = await provider.writeSnapshot(snapshot);

  await saveSyncState({ ok: true, message: message || 'Uploaded local bookmarks.', etag });
  await recordSyncVersion({
    provider: provider.type,
    action: 'upload',
    message: message || 'Uploaded local bookmarks.',
    etag,
    versionUrl,
    exportedAt: snapshot.exportedAt,
    rootCount: snapshot.roots.length,
  });
  const result = { ok: true, message: message || 'Uploaded local bookmarks.', snapshot };
  if (provider.type === 'localFile') {
    return { ...result, i18nKey: 'localFileExportDone' };
  }
  return result;
}

async function createLocalBookmarkSnapshot() {
  const roots = await chrome.bookmarks.getTree();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    roots: cleanSnapshotRoots(serializeBookmarkRoots(roots)),
  };
}

async function downloadRemoteBookmarks(message, downloadMode, settings = null) {
  const runtimeSettings = await getRuntimeSettings(settings);
  const provider = getSyncProvider(runtimeSettings);
  validateProviderSettings(runtimeSettings, provider);

  const mode = normalizeDownloadMode(downloadMode || runtimeSettings.downloadMode);
  const remote = await fetchRemoteSnapshot(runtimeSettings, provider);
  if (!remote.exists) throw new Error('Remote bookmark file does not exist.');

  return await applyRemoteSnapshot(remote.snapshot, remote.etag, message || 'Downloaded remote bookmarks.', mode, runtimeSettings, { provider: provider.type, versionUrl: remote.versionUrl });
}

async function fetchRemoteSnapshot(settings, existingProvider = null) {
  const provider = existingProvider || getSyncProvider(settings);
  validateProviderSettings(settings, provider);
  return await provider.readSnapshot();
}

async function applyRemoteSnapshot(snapshot, etag, message, downloadMode, settings = null, versionMeta = {}) {
  validateSnapshot(snapshot);
  const runtimeSettings = await getRuntimeSettings(settings);
  const mode = normalizeDownloadMode(downloadMode || runtimeSettings.downloadMode);

  await withSuppressedLocalChangeTracking(async () => {
    if (mode === 'mirror') {
      await mirrorBookmarkRoots(cleanSnapshotRoots(snapshot.roots));
    } else {
      await applySafeModeRoots(cleanSnapshotRoots(snapshot.roots));
    }
  });

  await saveSyncState({ ok: true, message, etag });
  await recordSyncVersion({
    provider: versionMeta.provider || runtimeSettings.syncProvider || DEFAULT_SETTINGS.syncProvider,
    action: versionMeta.action || 'download',
    message,
    etag,
    versionUrl: versionMeta.versionUrl || '',
    exportedAt: snapshot.exportedAt || '',
    rootCount: Array.isArray(snapshot.roots) ? snapshot.roots.length : 0,
  });
  return { ok: true, message };
}

function cleanSnapshotRoots(roots) {
  const rootMap = new Map();

  for (const root of roots || []) {
    collectCleanRoot(root, rootMap);
  }

  return ['bar', 'other', 'synced']
    .filter((rootKey) => rootMap.has(rootKey))
    .map((rootKey) => ({
      type: 'folder',
      title: getRootTitle(rootKey),
      rootKey,
      children: rootMap.get(rootKey),
    }));
}

function collectCleanRoot(node, rootMap) {
  if (!node) return;

  if (isSyncedContainer(node)) {
    for (const child of node.children || []) collectCleanRoot(child, rootMap);
    return;
  }

  const rootKey = getRootKey(node);
  if (['bar', 'other', 'synced'].includes(rootKey)) {
    const children = normalizeChildrenForRoot(node.children || []);
    if (children.length) rootMap.set(rootKey, [...(rootMap.get(rootKey) || []), ...children]);
    return;
  }

  const cleaned = cleanContentNode(node);
  if (cleaned) rootMap.set('other', [...(rootMap.get('other') || []), cleaned]);
}

function normalizeChildrenForRoot(children) {
  const output = [];
  for (const child of children || []) {
    if (isSyncedContainer(child)) {
      for (const nestedChild of child.children || []) {
        if (['bar', 'other', 'synced'].includes(getRootKey(nestedChild))) {
          output.push(...normalizeChildrenForRoot(nestedChild.children || []));
        } else {
          const cleaned = cleanContentNode(nestedChild);
          if (cleaned) output.push(cleaned);
        }
      }
      continue;
    }

    if (['bar', 'other', 'synced'].includes(getRootKey(child))) {
      output.push(...normalizeChildrenForRoot(child.children || []));
      continue;
    }

    const cleaned = cleanContentNode(child);
    if (cleaned) output.push(cleaned);
  }
  return output;
}

function cleanContentNode(node) {
  if (!node || isSyncedContainer(node)) return null;
  if (['bar', 'other', 'synced'].includes(getRootKey(node))) {
    return null;
  }

  const output = { ...node };
  delete output.id;
  delete output.rootKey;

  if (output.children) {
    output.children = normalizeChildrenForRoot(output.children);
  }
  return output;
}

function isSyncedContainer(node) {
  return !node?.url && node?.title === ROOT_CONTAINER_TITLE;
}

function getRootTitle(rootKey) {
  if (rootKey === 'bar') return '书签栏';
  if (rootKey === 'synced') return '移动设备书签';
  return '其他书签';
}

function serializeBookmarkRoots(roots) {
  const root = roots[0];
  return (root.children || [])
    .filter((node) => node.children)
    .map(serializeNode)
    .filter(Boolean);
}

function serializeNode(node) {
  if (!node.url && node.title === ROOT_CONTAINER_TITLE) return null;

  const output = {
    id: node.id || null,
    title: node.title || '',
    rootKey: node.url ? null : getRootKey(node),
    dateAdded: node.dateAdded || null,
  };

  if (node.url) {
    output.type = 'bookmark';
    output.url = node.url;
  } else {
    output.type = 'folder';
    output.children = (node.children || []).map(serializeNode).filter(Boolean);
  }

  return output;
}

async function mirrorBookmarkRoots(roots) {
  const [browserRoot] = await chrome.bookmarks.getTree();
  const writableRoots = browserRoot.children || [];
  const remoteRoots = roots || [];

  for (const localRoot of writableRoots) {
    const remoteRoot = findMatchingRemoteRoot(localRoot, remoteRoots);
    await replaceRootChildren(localRoot.id, remoteRoot?.children || []);
  }
}

async function applySafeModeRoots(roots) {
  const [browserRoot] = await chrome.bookmarks.getTree();
  const localRoots = browserRoot.children || [];
  const remoteRoots = cleanSnapshotRoots(roots).filter((root) => (root.children || []).length > 0);

  for (const remoteRoot of remoteRoots) {
    const rootKey = getRootKey(remoteRoot);
    const localRoot = findLocalRootByKey(localRoots, rootKey);
    if (!localRoot) continue;
    await mergeChildrenIntoParent(localRoot.id, remoteRoot.children || []);
  }
}

function findLocalRootByKey(localRoots, rootKey) {
  return (localRoots || []).find((localRoot) => getRootKey(localRoot) === rootKey) || null;
}

async function mergeChildrenIntoParent(parentId, childrenToMerge) {
  const existingChildren = await chrome.bookmarks.getChildren(parentId);
  for (const child of childrenToMerge || []) {
    await mergeNodeIntoChildren(parentId, child, existingChildren);
  }
}

async function mergeNodeIntoChildren(parentId, node, existingChildren) {
  if (!node) return null;

  if (node.type === 'bookmark') {
    const normalizedUrl = normalizeBookmarkUrl(node.url);
    const existingBookmark = existingChildren.find((child) => child.url && normalizeBookmarkUrl(child.url) === normalizedUrl);
    if (existingBookmark) return existingBookmark;

    const createdBookmark = await chrome.bookmarks.create({
      parentId,
      title: node.title || node.url,
      url: node.url,
    });
    existingChildren.push(createdBookmark);
    return createdBookmark;
  }

  const folderTitle = node.title || '未命名文件夹';
  const existingFolder = existingChildren.find((child) => !child.url && child.title === folderTitle);
  if (existingFolder) {
    const folderChildren = await chrome.bookmarks.getChildren(existingFolder.id);
    for (const child of node.children || []) {
      await mergeNodeIntoChildren(existingFolder.id, child, folderChildren);
    }
    return existingFolder;
  }

  const createdFolder = await chrome.bookmarks.create({ parentId, title: folderTitle });
  existingChildren.push(createdFolder);
  const createdChildren = [];
  for (const child of node.children || []) {
    await mergeNodeIntoChildren(createdFolder.id, child, createdChildren);
  }
  return createdFolder;
}

function findMatchingRemoteRoot(localRoot, remoteRoots) {
  const localKey = getRootKey(localRoot);
  return remoteRoots.find((remoteRoot) => remoteRoot.rootKey === localKey)
    || remoteRoots.find((remoteRoot) => getRootKey(remoteRoot) === localKey)
    || remoteRoots.find((remoteRoot) => remoteRoot.title === localRoot.title)
    || null;
}

function getRootKey(node) {
  const title = String(node.title || '').toLowerCase();
  const id = String(node.id || '').toLowerCase();
  const rootKey = String(node.rootKey || '').toLowerCase();
  if (['bar', 'other', 'synced'].includes(rootKey)) return rootKey;
  if (id === '1' || id === 'bookmarks_bar' || title.includes('bookmark bar') || title.includes('bookmarks bar') || title.includes('favorites bar') || title.includes('收藏夹栏') || title.includes('书签栏')) return 'bar';
  if (id === '2' || id === 'other' || title.includes('other bookmarks') || title.includes('其他书签') || title === '其他') return 'other';
  if (id === '3' || id === 'synced' || title.includes('mobile bookmarks') || title.includes('synced bookmarks') || title.includes('移动设备书签') || title.includes('移动书签')) return 'synced';
  return title;
}

async function replaceRootChildren(parentId, childrenToCreate) {
  const existingChildren = await chrome.bookmarks.getChildren(parentId);
  for (const child of existingChildren) {
    await chrome.bookmarks.removeTree(child.id);
  }

  for (const child of childrenToCreate) {
    await createNode(child, parentId);
  }
}

async function createChildren(parentId, childrenToCreate) {
  for (const child of childrenToCreate) {
    await createNode(child, parentId);
  }
}

async function createNode(node, parentId) {
  if (node.type === 'bookmark') {
    await chrome.bookmarks.create({ parentId, title: node.title || node.url, url: node.url });
    return;
  }

  const folder = await chrome.bookmarks.create({ parentId, title: node.title || '未命名文件夹' });
  for (const child of node.children || []) {
    await createNode(child, folder.id);
  }
}

function getSyncProvider(settings) {
  const providerType = settings.syncProvider || DEFAULT_SETTINGS.syncProvider;
  if (providerType === 'localFile') return createLocalFileProvider(settings);
  if (providerType === 'github') return createGitProvider(settings, { type: 'github', apiBase: 'https://api.github.com' });
  if (providerType === 'gitee') return createGitProvider(settings, { type: 'gitee', apiBase: 'https://gitee.com/api/v5' });
  return createWebdavProvider(settings);
}

function createWebdavProvider(settings) {
  return {
    type: 'webdav',
    async readSnapshot() {
      const response = await webdavRequest(settings, 'GET', { cache: 'no-store' });
      if (response.status === 404) return { exists: false, snapshot: null, etag: null };
      if (!response.ok) throw new Error(`WebDAV download failed: ${response.status} ${response.statusText}`);
      const snapshot = await response.json();
      validateSnapshot(snapshot);
      return { exists: true, snapshot, etag: response.headers.get('ETag') };
    },
    async writeSnapshot(snapshot) {
      const response = await webdavRequest(settings, 'PUT', {
        body: JSON.stringify(snapshot, null, 2),
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
      if (!response.ok) throw new Error(`WebDAV upload failed: ${response.status} ${response.statusText}`);
      return { etag: response.headers.get('ETag') };
    },
  };
}

function createLocalFileProvider(settings) {
  return {
    type: 'localFile',
    async readSnapshot() {
      throw new Error('Choose a local bookmark JSON file to import.');
    },
    async writeSnapshot(snapshot) {
      const filename = normalizeLocalExportFilename(settings.remoteFile || DEFAULT_SETTINGS.remoteFile);
      const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(snapshot, null, 2))}`;
      const downloadId = await chrome.downloads.download({ url, filename, saveAs: true, conflictAction: 'uniquify' });
      return { etag: `local-file:${snapshot.exportedAt || new Date().toISOString()}:${downloadId}` };
    },
  };
}

function createGitProvider(settings, meta) {
  const cfg = getGitProviderConfig(settings, meta.type);
  return {
    type: meta.type,
    async readSnapshot() {
      const file = await fetchGitFile(cfg, meta);
      if (!file.exists) return { exists: false, snapshot: null, etag: null };
      const snapshot = JSON.parse(decodeBase64Utf8(file.content || ''));
      validateSnapshot(snapshot);
      return { exists: true, snapshot, etag: file.sha || null, versionUrl: file.htmlUrl || '' };
    },
    async writeSnapshot(snapshot) {
      const current = await fetchGitFile(cfg, meta);
      const body = {
        message: buildGitCommitMessage(snapshot),
        content: encodeBase64Utf8(JSON.stringify(snapshot, null, 2)),
        branch: cfg.branch,
      };
      if (current.sha) body.sha = current.sha;
      if (meta.type === 'gitee') body.access_token = cfg.token;

      const response = await fetch(buildGitContentsUrl(cfg, meta), {
        method: 'PUT',
        headers: buildGitHeaders(cfg, meta),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = await safeReadGitError(response);
        throw new Error(`${meta.type} upload failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
      }
      const data = await response.json();
      const sha = data?.content?.sha || data?.commit?.sha || current.sha || null;
      const versionUrl = data?.commit?.html_url || data?.content?.html_url || '';
      return { etag: sha, versionUrl };
    },
  };
}

async function fetchGitFile(cfg, meta) {
  const response = await fetch(buildGitContentsUrl(cfg, meta, { ref: cfg.branch }), {
    method: 'GET',
    headers: buildGitHeaders(cfg, meta),
    cache: 'no-store',
  });
  if (response.status === 404) return { exists: false, sha: null, content: '' };
  if (!response.ok) {
    const detail = await safeReadGitError(response);
    throw new Error(`${meta.type} download failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
  }
  const data = await response.json();
  return { exists: true, sha: data.sha || null, content: data.content || '', htmlUrl: data.html_url || '' };
}

function buildGitRepoUrl(cfg, meta) {
  const base = `${meta.apiBase}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  if (meta.type !== 'gitee' || !cfg.token) return base;
  return `${base}?${new URLSearchParams({ access_token: cfg.token }).toString()}`;
}

function buildGitContentsUrl(cfg, meta, query = {}) {
  const encodedPath = cfg.filePath.split('/').map(encodeURIComponent).join('/');
  const base = `${meta.apiBase}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encodedPath}`;
  const params = new URLSearchParams(query);
  if (meta.type === 'gitee' && cfg.token) params.set('access_token', cfg.token);
  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

function buildGitHeaders(cfg, meta) {
  const headers = {
    Accept: 'application/vnd.github+json, application/json',
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (meta.type === 'github' && cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  return headers;
}

function getGitProviderConfig(settings, type) {
  const prefix = type === 'gitee' ? 'gitee' : 'github';
  return {
    type: prefix,
    token: String(settings[`${prefix}Token`] || ''),
    owner: String(settings[`${prefix}Owner`] || ''),
    repo: String(settings[`${prefix}Repo`] || ''),
    branch: String(settings[`${prefix}Branch`] || (prefix === 'gitee' ? 'master' : 'main')),
    filePath: String(settings[`${prefix}FilePath`] || settings.remoteFile || DEFAULT_SETTINGS.remoteFile).replace(/^\/+/, ''),
  };
}

function buildGitCommitMessage(snapshot) {
  return `Update bookmark backup ${snapshot?.exportedAt || new Date().toISOString()}`;
}

async function safeReadGitError(response) {
  try {
    const data = await response.clone().json();
    return String(data?.message || data?.error || '').slice(0, 160);
  } catch (_error) {
    try {
      return String(await response.clone().text()).slice(0, 160);
    } catch (_ignored) {
      return '';
    }
  }
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const clean = String(value || '').replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function validateProviderSettings(settings, provider = getSyncProvider(settings)) {
  if (provider.type === 'webdav') return validateSettings(settings);
  if (provider.type === 'localFile') return;
  if (provider.type === 'github' || provider.type === 'gitee') return validateGitProviderSettings(settings, provider.type);
  throw new Error(`${provider.type} sync provider is not available yet.`);
}

function validateGitProviderSettings(settings, type) {
  const cfg = getGitProviderConfig(settings, type);
  if (!cfg.token || !cfg.owner || !cfg.repo || !cfg.branch || !cfg.filePath) {
    throw new Error(`${type} token, owner, repo, branch and file path are required.`);
  }
}

function isSyncProviderReady(settings, options = {}) {
  const provider = settings?.syncProvider || DEFAULT_SETTINGS.syncProvider;
  if (provider === 'webdav') return hasWebdavConfig(settings);
  if (provider === 'localFile') return Boolean(options.allowManualLocalFile);
  if (provider === 'github' || provider === 'gitee') return hasGitProviderConfig(settings, provider);
  return false;
}

function isAutoSyncProviderReady(settings) {
  const provider = settings?.syncProvider || DEFAULT_SETTINGS.syncProvider;
  if (provider === 'webdav') return hasWebdavConfig(settings);
  if (provider === 'github' || provider === 'gitee') return hasGitProviderConfig(settings, provider);
  return false;
}

function getSyncProviderRequiredKey(settings) {
  const provider = settings?.syncProvider || DEFAULT_SETTINGS.syncProvider;
  if (provider === 'localFile') return 'localFileManualOnly';
  if (provider === 'github') return 'gitProviderRequiredGithub';
  if (provider === 'gitee') return 'gitProviderRequiredGitee';
  return 'webdavRequiredForSync';
}

function getSyncProviderRequiredMessage(settings) {
  const provider = settings?.syncProvider || DEFAULT_SETTINGS.syncProvider;
  if (provider === 'localFile') return 'Local file sync is manual. Use Export Backup or Import Restore.';
  if (provider === 'github') return 'GitHub sync requires token, owner, repo, branch and file path.';
  if (provider === 'gitee') return 'Gitee sync requires token, owner, repo, branch and file path.';
  return 'Set up WebDAV before syncing.';
}

function hasGitProviderConfig(settings, type) {
  const cfg = getGitProviderConfig(settings || {}, type);
  return Boolean(cfg.token && cfg.owner && cfg.repo && cfg.branch && cfg.filePath);
}

async function applyImportedLocalFileSnapshot(snapshot, downloadMode) {
  const runtimeSettings = await getRuntimeSettings();
  const mode = normalizeDownloadMode(downloadMode || runtimeSettings.downloadMode);
  return await applyRemoteSnapshot(
    snapshot,
    `local-file-import:${new Date().toISOString()}`,
    'manual-import: imported local bookmark file',
    mode,
    runtimeSettings,
    { provider: 'localFile', action: 'import' }
  );
}

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

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.roots)) {
    throw new Error('Remote file is not a valid bookmark snapshot.');
  }
}

async function getRuntimeSettings(settings = null) {
  return sanitizeSettings(settings || await getSettings());
}

function validateSettings(settings) {
  if (!hasWebdavConfig(settings)) throw new Error('WebDAV URL is required.');
  try {
    new URL(resolveRemoteUrl(settings));
  } catch (_error) {
    throw new Error('WebDAV URL or remote file path is invalid.');
  }
}

function hasWebdavConfig(settings) {
  return Boolean(settings?.webdavUrl && settings?.remoteFile);
}

function resolveRemoteUrl(settings, useFolder = false) {
  const base = settings.webdavUrl.endsWith('/') ? settings.webdavUrl : `${settings.webdavUrl}/`;
  return useFolder ? base : new URL(settings.remoteFile, base).toString();
}

function webdavRequest(settings, method, init = {}, useFolder = false) {
  const headers = new Headers(init.headers || {});
  if (settings.username || settings.password) {
    headers.set('Authorization', `Basic ${btoa(`${settings.username}:${settings.password}`)}`);
  }

  const timeoutSeconds = normalizeRequestTimeout(init.timeoutSeconds || settings.requestTimeoutSeconds);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const { timeoutSeconds: _timeoutSeconds, ...fetchInit } = init;

  return fetch(resolveRemoteUrl(settings, useFolder), {
    ...fetchInit,
    method,
    headers,
    cache: 'no-store',
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === 'AbortError') {
      throw new Error(`WebDAV request timed out after ${timeoutSeconds}s. If you use a proxy, check that Chrome can access it and increase the timeout.`);
    }
    throw new Error(sanitizeErrorMessage(error.message, settings));
  }).finally(() => clearTimeout(timer));
}

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
