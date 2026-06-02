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

