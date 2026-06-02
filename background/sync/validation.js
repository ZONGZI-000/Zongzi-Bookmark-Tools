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

