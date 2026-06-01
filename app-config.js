const DEFAULT_SETTINGS = {
  syncProvider: 'localFile',
  webdavUrl: '',
  username: '',
  password: '',
  remoteFile: 'chrome-bookmarks.json',
  requestTimeoutSeconds: 30,
  syncIntervalMinutes: 30,
  cleanIntervalMinutes: 30,
  autoSync: false,
  autoCleanDuplicates: false,
  autoCleanEmptyFolders: false,
  language: 'zh',
  downloadMode: 'safe',
  invalidTimeoutSeconds: 15,
  carryCredentialsForInvalid: false,
  cleanRecordRetentionDays: 30,
  bookmarkSummaryAutoEnabled: false,
  bookmarkSummaryEngine: 'textrank',
  bookmarkSummaryEngineMode: 'textrank',
  bookmarkSummaryAiProvider: 'geminiNano',
  customAiBaseUrl: '',
  customAiApiKey: '',
  customAiModel: '',
  localModelId: 'lamini-flan-t5',
  aiValidationProvider: '',
  aiValidationOk: false,
  bookmarkSummaryBatchSize: 80,
  bookmarkSearchLimit: 50,
  bookmarkSummaryVersion: 2,
  bookmarkSummaryMaxInputChars: 800,
  bookmarkSummaryMaxSummaryChars: 50,
  bookmarkSummaryKeywordLimit: 8,
  bookmarkSummaryTextRankIterations: 16,
  shadowIndexEnabled: false,
  shadowIndexActiveTabOnly: true,
  shadowIndexFetchTimeoutSeconds: 20,
  shadowIndexMaxPagesPerWake: 5,
  semanticSearchEnabled: true,
  semanticExpansionLimit: 8,
  summaryPageSize: 50,
  embeddingResourcePath: 'models/mini_embeddings.bin',
  superModeEnabled: false,
  githubToken: '',
  githubOwner: '',
  githubRepo: '',
  githubBranch: 'main',
  githubFilePath: 'chrome-bookmarks.json',
  giteeToken: '',
  giteeOwner: '',
  giteeRepo: '',
  giteeBranch: 'master',
  giteeFilePath: 'chrome-bookmarks.json',
};

const WEBDAV_SECRET_FIELDS = ['webdavUrl', 'username', 'password'];
const GIT_PROVIDER_SECRET_FIELDS = ['githubToken', 'giteeToken'];
const CUSTOM_AI_SECRET_FIELDS = ['customAiApiKey'];
const ENCRYPTED_WEBDAV_CONFIG_KEY = 'webdavSecure';

function sanitizeSettings(input) {
  if (!input) input = {};
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    syncProvider: normalizeSyncProvider(input.syncProvider),
    webdavUrl: String(input.webdavUrl || DEFAULT_SETTINGS.webdavUrl).trim(),
    username: String(input.username || DEFAULT_SETTINGS.username).trim(),
    password: String(input.password || DEFAULT_SETTINGS.password),
    remoteFile: normalizeRemoteFile(input.remoteFile || DEFAULT_SETTINGS.remoteFile),
    requestTimeoutSeconds: normalizeRequestTimeout(input.requestTimeoutSeconds),
    syncIntervalMinutes: normalizeInterval(input.syncIntervalMinutes, DEFAULT_SETTINGS.syncIntervalMinutes),
    cleanIntervalMinutes: normalizeInterval(input.cleanIntervalMinutes, DEFAULT_SETTINGS.cleanIntervalMinutes),
    autoSync: Boolean(input.autoSync ?? DEFAULT_SETTINGS.autoSync),
    autoCleanDuplicates: Boolean(input.autoCleanDuplicates ?? DEFAULT_SETTINGS.autoCleanDuplicates),
    autoCleanEmptyFolders: Boolean(input.autoCleanEmptyFolders ?? DEFAULT_SETTINGS.autoCleanEmptyFolders),
    language: normalizeLanguage(input.language),
    downloadMode: normalizeDownloadMode(input.downloadMode),
    invalidTimeoutSeconds: normalizeTimeout(input.invalidTimeoutSeconds),
    carryCredentialsForInvalid: Boolean(input.carryCredentialsForInvalid ?? DEFAULT_SETTINGS.carryCredentialsForInvalid),
    cleanRecordRetentionDays: normalizeRetentionDays(input.cleanRecordRetentionDays),
    bookmarkSummaryAutoEnabled: Boolean(input.bookmarkSummaryAutoEnabled ?? DEFAULT_SETTINGS.bookmarkSummaryAutoEnabled),
    bookmarkSummaryEngine: normalizeBookmarkSummaryEngine(input.bookmarkSummaryEngine),
    bookmarkSummaryEngineMode: normalizeBookmarkSummaryEngineMode(input.bookmarkSummaryEngineMode),
    bookmarkSummaryAiProvider: normalizeBookmarkSummaryAiProvider(input.bookmarkSummaryAiProvider),
    customAiBaseUrl: String(input.customAiBaseUrl || DEFAULT_SETTINGS.customAiBaseUrl).trim(),
    customAiApiKey: String(input.customAiApiKey || DEFAULT_SETTINGS.customAiApiKey),
    customAiModel: String(input.customAiModel || DEFAULT_SETTINGS.customAiModel).trim(),
    localModelId: normalizeLocalModelId(input.localModelId),
    aiValidationProvider: String(input.aiValidationProvider || DEFAULT_SETTINGS.aiValidationProvider),
    aiValidationOk: Boolean(input.aiValidationOk ?? DEFAULT_SETTINGS.aiValidationOk),
    bookmarkSummaryBatchSize: normalizeBookmarkSummaryBatchSize(input.bookmarkSummaryBatchSize),
    bookmarkSearchLimit: normalizeBookmarkSearchLimit(input.bookmarkSearchLimit),
    bookmarkSummaryVersion: normalizeBookmarkSummaryVersion(input.bookmarkSummaryVersion),
    bookmarkSummaryMaxInputChars: normalizeBookmarkSummaryMaxInputChars(input.bookmarkSummaryMaxInputChars),
    bookmarkSummaryMaxSummaryChars: normalizeBookmarkSummaryMaxSummaryChars(input.bookmarkSummaryMaxSummaryChars),
    bookmarkSummaryKeywordLimit: normalizeBookmarkSummaryKeywordLimit(input.bookmarkSummaryKeywordLimit),
    bookmarkSummaryTextRankIterations: normalizeBookmarkSummaryTextRankIterations(input.bookmarkSummaryTextRankIterations),
    shadowIndexEnabled: Boolean(input.shadowIndexEnabled ?? input.bookmarkSummaryAutoEnabled ?? DEFAULT_SETTINGS.shadowIndexEnabled),
    shadowIndexActiveTabOnly: Boolean(input.shadowIndexActiveTabOnly ?? DEFAULT_SETTINGS.shadowIndexActiveTabOnly),
    shadowIndexFetchTimeoutSeconds: normalizeShadowIndexFetchTimeout(input.shadowIndexFetchTimeoutSeconds),
    shadowIndexMaxPagesPerWake: normalizeShadowIndexMaxPagesPerWake(input.shadowIndexMaxPagesPerWake),
    semanticSearchEnabled: Boolean(input.semanticSearchEnabled ?? DEFAULT_SETTINGS.semanticSearchEnabled),
    semanticExpansionLimit: normalizeSemanticExpansionLimit(input.semanticExpansionLimit),
    summaryPageSize: normalizeSummaryPageSize(input.summaryPageSize),
    embeddingResourcePath: String(input.embeddingResourcePath || DEFAULT_SETTINGS.embeddingResourcePath),
    superModeEnabled: Boolean(input.superModeEnabled ?? DEFAULT_SETTINGS.superModeEnabled),
    githubToken: String(input.githubToken || DEFAULT_SETTINGS.githubToken),
    githubOwner: normalizeRepoPart(input.githubOwner || DEFAULT_SETTINGS.githubOwner),
    githubRepo: normalizeRepoPart(input.githubRepo || DEFAULT_SETTINGS.githubRepo),
    githubBranch: normalizeGitBranch(input.githubBranch || DEFAULT_SETTINGS.githubBranch),
    githubFilePath: normalizeRemoteFile(input.githubFilePath || input.remoteFile || DEFAULT_SETTINGS.githubFilePath),
    giteeToken: String(input.giteeToken || DEFAULT_SETTINGS.giteeToken),
    giteeOwner: normalizeRepoPart(input.giteeOwner || DEFAULT_SETTINGS.giteeOwner),
    giteeRepo: normalizeRepoPart(input.giteeRepo || DEFAULT_SETTINGS.giteeRepo),
    giteeBranch: normalizeGitBranch(input.giteeBranch || DEFAULT_SETTINGS.giteeBranch),
    giteeFilePath: normalizeRemoteFile(input.giteeFilePath || input.remoteFile || DEFAULT_SETTINGS.giteeFilePath),
  };
}

function toStoredSettings(settings) {
  const stored = { ...settings };
  for (const field of [...WEBDAV_SECRET_FIELDS, ...GIT_PROVIDER_SECRET_FIELDS, ...CUSTOM_AI_SECRET_FIELDS]) delete stored[field];
  delete stored[ENCRYPTED_WEBDAV_CONFIG_KEY];
  return stored;
}

function mergeWebdavConfig(settings, secureConfig) {
  if (!secureConfig) secureConfig = {};
  return mergeSecureSyncConfig(settings, secureConfig);
}

function mergeSecureSyncConfig(settings, secureConfig) {
  if (!secureConfig) secureConfig = {};
  return sanitizeSettings({
    ...settings,
    webdavUrl: secureConfig.webdavUrl,
    username: secureConfig.username,
    password: secureConfig.password,
    githubToken: secureConfig.githubToken,
    giteeToken: secureConfig.giteeToken,
    customAiApiKey: secureConfig.customAiApiKey,
  });
}

function getWebdavConfig(settings) {
  if (!settings) settings = {};
  return {
    webdavUrl: String(settings.webdavUrl || '').trim(),
    username: String(settings.username || '').trim(),
    password: String(settings.password || ''),
  };
}

function getSecureSyncConfig(settings) {
  if (!settings) settings = {};
  return {
    ...getWebdavConfig(settings),
    githubToken: String(settings.githubToken || ''),
    giteeToken: String(settings.giteeToken || ''),
    customAiApiKey: String(settings.customAiApiKey || ''),
  };
}

function normalizeSyncProvider(value) {
  return ['webdav', 'localFile', 'github', 'gitee'].includes(value) ? value : DEFAULT_SETTINGS.syncProvider;
}

function normalizeRemoteFile(remoteFile) {
  return String(remoteFile).trim().replace(/^\/+/, '') || DEFAULT_SETTINGS.remoteFile;
}

function normalizeRepoPart(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function normalizeGitBranch(value) {
  return String(value || 'main').trim() || 'main';
}

function normalizeInterval(value, fallback) {
  return Math.max(5, Number(value || fallback));
}

function normalizeTimeout(value) {
  return Math.max(3, Number(value || DEFAULT_SETTINGS.invalidTimeoutSeconds));
}

function normalizeRetentionDays(value) {
  return Math.min(365, Math.max(1, Number(value || DEFAULT_SETTINGS.cleanRecordRetentionDays)));
}

function normalizeBookmarkSummaryEngine(value) {
  return ['simple', 'textrank', 'geminiNano', 'customOpenai', 'customAnthropic'].includes(value) ? value : DEFAULT_SETTINGS.bookmarkSummaryEngine;
}

function normalizeBookmarkSummaryEngineMode(value) {
  return ['textrank', 'transformer', 'geminiNano', 'customOpenai', 'customAnthropic', 'offline', 'offlineAi'].includes(value) ? value : DEFAULT_SETTINGS.bookmarkSummaryEngineMode;
}

function normalizeBookmarkSummaryAiProvider(value) {
  return ['geminiNano', 'customOpenai', 'customAnthropic'].includes(value) ? value : DEFAULT_SETTINGS.bookmarkSummaryAiProvider;
}

function normalizeLocalModelId(value) {
  return ['qwen3-0.6b', 'lamini-flan-t5', 'mt5-small', 'distilbart'].includes(value) ? value : DEFAULT_SETTINGS.localModelId;
}

function normalizeBookmarkSummaryBatchSize(value) {
  return Math.min(300, Math.max(10, Number(value || DEFAULT_SETTINGS.bookmarkSummaryBatchSize)));
}

function normalizeBookmarkSearchLimit(value) {
  return Math.min(200, Math.max(10, Number(value || DEFAULT_SETTINGS.bookmarkSearchLimit)));
}

function normalizeBookmarkSummaryVersion(value) {
  return Math.max(1, Number(value || DEFAULT_SETTINGS.bookmarkSummaryVersion));
}

function normalizeBookmarkSummaryMaxInputChars(value) {
  return Math.min(3000, Math.max(120, Number(value || DEFAULT_SETTINGS.bookmarkSummaryMaxInputChars)));
}

function normalizeBookmarkSummaryMaxSummaryChars(value) {
  return Math.min(300, Math.max(50, Number(value || DEFAULT_SETTINGS.bookmarkSummaryMaxSummaryChars)));
}

function normalizeBookmarkSummaryKeywordLimit(value) {
  return Math.min(20, Math.max(3, Number(value || DEFAULT_SETTINGS.bookmarkSummaryKeywordLimit)));
}

function normalizeBookmarkSummaryTextRankIterations(value) {
  return Math.min(40, Math.max(5, Number(value || DEFAULT_SETTINGS.bookmarkSummaryTextRankIterations)));
}

function normalizeShadowIndexFetchTimeout(value) {
  return Math.min(60, Math.max(5, Number(value || DEFAULT_SETTINGS.shadowIndexFetchTimeoutSeconds)));
}

function normalizeShadowIndexMaxPagesPerWake(value) {
  return Math.min(20, Math.max(1, Number(value || DEFAULT_SETTINGS.shadowIndexMaxPagesPerWake)));
}

function normalizeSemanticExpansionLimit(value) {
  return Math.min(20, Math.max(0, Number(value || DEFAULT_SETTINGS.semanticExpansionLimit)));
}

function normalizeSummaryPageSize(value) {
  return Math.min(200, Math.max(20, Number(value || DEFAULT_SETTINGS.summaryPageSize)));
}

function normalizeRequestTimeout(value) {
  return Math.max(5, Number(value || DEFAULT_SETTINGS.requestTimeoutSeconds));
}

function normalizeDownloadMode(downloadMode) {
  return ['safe', 'mirror'].includes(downloadMode) ? downloadMode : DEFAULT_SETTINGS.downloadMode;
}

function normalizeLanguage(language) {
  return ['en', 'zh'].includes(language) ? language : DEFAULT_SETTINGS.language;
}

async function encryptWebdavConfig(settings) {
  assertWebdavCryptoAvailable();
  const payload = JSON.stringify(getSecureSyncConfig(settings));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getWebdavCryptoKey();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
  return {
    version: 1,
    algorithm: 'AES-GCM',
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptWebdavConfig(encryptedConfig) {
  if (!encryptedConfig?.data || !encryptedConfig?.iv) return getSecureSyncConfig(DEFAULT_SETTINGS);
  assertWebdavCryptoAvailable();
  const key = await getWebdavCryptoKey();
  const iv = base64ToBytes(encryptedConfig.iv);
  const data = base64ToBytes(encryptedConfig.data);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return getSecureSyncConfig(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function getWebdavCryptoKey() {
  assertWebdavCryptoAvailable();
  const seed = 'webdav-bookmark-sync:' + (chrome.runtime.id || 'local-extension-key');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function assertWebdavCryptoAvailable() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('Browser Web Crypto is required to store WebDAV settings securely.');
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function createInvalidRequestInit(method, timeoutSeconds, carryCredentials) {
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, normalizeTimeout(timeoutSeconds) * 1000);
  return {
    timer,
    init: {
      method,
      cache: 'no-store',
      redirect: 'follow',
      credentials: carryCredentials ? 'include' : 'omit',
      signal: controller.signal,
    },
  };
}

function sanitizeErrorMessage(message, settings) {
  let safeMessage = String(message || '')
    .replace(/(Authorization:\s*Basic\s+)[A-Za-z0-9+/=]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1[redacted]@')
    .replace(/([?&](?:password|passwd|pwd|token|access_token|auth|key|secret)=)[^\s&#]+/gi, '$1[redacted]');

  const webdavConfig = settings ? getWebdavConfig(settings) : null;
  const sensitiveValues = [
    webdavConfig?.password,
    webdavConfig?.username && webdavConfig?.password ? webdavConfig.username + ':' + webdavConfig.password : '',
    settings?.githubToken,
    settings?.giteeToken,
    settings?.customAiApiKey,
  ].filter(function(value) { return String(value || '').length >= 3; });

  for (const value of sensitiveValues) {
    safeMessage = safeMessage.replaceAll(String(value), '[redacted]');
  }

  return safeMessage;
}
