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

