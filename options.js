const form = document.querySelector('#settingsForm');
const messageEl = document.querySelector('#message');
const syncDescriptionEl = document.querySelector('#syncDescription');
const testWebdavBtn = document.querySelector('#testWebdav');
const togglePasswordBtn = document.querySelector('#togglePassword');
const toggleGitTokenBtn = document.querySelector('#toggleGitToken');
const toggleCustomAiApiKeyBtn = document.querySelector('#toggleCustomAiApiKey');
const settingsTabs = Array.from(document.querySelectorAll('.settings-tab'));
const syncSettingsPanel = document.querySelector('#syncSettingsPanel');
const summarySettingsPanel = document.querySelector('#summarySettingsPanel');

const fields = {
  syncProvider: document.querySelector('#syncProvider'),
  webdavSettingsCard: document.querySelector('#webdavSettingsCard'),
  localFileSettingsCard: document.querySelector('#localFileSettingsCard'),
  exportSettingsLocalFile: document.querySelector('#exportSettingsLocalFile'),
  importSettingsLocalFile: document.querySelector('#importSettingsLocalFile'),
  settingsLocalFileInput: document.querySelector('#settingsLocalFileInput'),
  localFileMessage: document.querySelector('#localFileMessage'),
  gitSettingsCard: document.querySelector('#gitSettingsCard'),
  gitSettingsTitle: document.querySelector('#gitSettingsTitle'),
  gitToken: document.querySelector('#gitToken'),
  gitOwner: document.querySelector('#gitOwner'),
  gitRepo: document.querySelector('#gitRepo'),
  gitBranch: document.querySelector('#gitBranch'),
  gitFilePath: document.querySelector('#gitFilePath'),
  saveGitSettings: document.querySelector('#saveGitSettings'),
  testGitProvider: document.querySelector('#testGitProvider'),
  gitMessage: document.querySelector('#gitMessage'),
  syncProviderHint: document.querySelector('#syncProviderHint'),
  webdavUrl: document.querySelector('#webdavUrl'),
  username: document.querySelector('#username'),
  password: document.querySelector('#password'),
  remoteFile: document.querySelector('#remoteFile'),
  requestTimeoutSeconds: document.querySelector('#requestTimeoutSeconds'),
  syncIntervalMinutes: document.querySelector('#syncIntervalMinutes'),
  downloadMode: document.querySelector('#downloadMode'),
  autoSync: document.querySelector('#autoSync'),
};

const summaryEls = {
  engineModeSelect: document.querySelector('#bookmarkSummaryEngineMode'),
  localModelTools: document.querySelector('#localModelTools'),
  localModelSelect: document.querySelector('#localModelSelect'),
  geminiNanoTools: document.querySelector('#geminiNanoTools'),
  setupGeminiNanoBtn: document.querySelector('#setupGeminiNano'),
  validateGeminiNanoBtn: document.querySelector('#validateGeminiNano'),
  customAiSettings: document.querySelector('#customAiSettings'),
  customAiBaseUrlInput: document.querySelector('#customAiBaseUrl'),
  customAiApiKeyInput: document.querySelector('#customAiApiKey'),
  customAiModelInput: document.querySelector('#customAiModel'),
  validateCustomAiBtn: document.querySelector('#validateCustomAi'),
  saveCustomAiConfigBtn: document.querySelector('#saveCustomAiConfig'),
  aiValidationStatus: document.querySelector('#summaryAiValidationStatus'),
  importModelFolderBtn: document.querySelector('#importModelFolderBtn'),
  localModelFileFolderInput: document.querySelector('#localModelFileFolderInput'),
  inlineDeleteBtn: document.querySelector('#inlineDeleteBtn'),
  inlineDownloadStatus: document.querySelector('#inlineDownloadStatus'),
  importResult: document.querySelector('#importResult'),
  importResultTitle: document.querySelector('#importResultTitle'),
  importResultList: document.querySelector('#importResultList'),
  deleteModelActions: document.querySelector('#deleteModelActions'),
  mirrorLinksRow: document.querySelector('#mirrorLinksRow'),
  importRequiredFiles: document.querySelector('#importRequiredFiles'),
};

const ZongziModelRegistry = window.ZongziModelRegistry || {};

const DB_NAME = 'zongzi_model_store';
const DB_VERSION = 3;
const STORE_NAME = 'modelFiles';
const META_STORE_NAME = 'modelFileMeta';

let currentLanguage = 'zh';
let currentDownloadMode = 'safe';
let currentSyncIntervalMinutes = 30;
let currentCleanIntervalMinutes = 30;
let currentAutoSync = true;
let currentAutoCleanDuplicates = false;
let currentAutoCleanEmptyFolders = false;
let currentInvalidTimeoutSeconds = 15;
let currentCarryCredentialsForInvalid = false;
let currentSettings = {};
let currentSyncProvider = 'localFile';
let currentSettingsTab = 'sync';

loadSettings();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.settings?.newValue) return;
  refreshLocalState(changes.settings.newValue);
  applyLanguage(currentLanguage);
  updateSyncProviderVisibility();
  updateSummaryVisibility();
});

fields.syncProvider.addEventListener('change', async () => {
  currentSyncProvider = fields.syncProvider.value;
  updateSyncProviderVisibility();
  await saveSettings({ syncProvider: currentSyncProvider });
});

bindSensitiveToggle(togglePasswordBtn, fields.password);
bindSensitiveToggle(toggleGitTokenBtn, fields.gitToken);
bindSensitiveToggle(toggleCustomAiApiKeyBtn, summaryEls.customAiApiKeyInput);

testWebdavBtn.addEventListener('click', async () => {
  if (currentSyncProvider !== 'webdav') {
    messageEl.textContent = translate(currentLanguage, 'webdavOnlyTest');
    return;
  }
  testWebdavBtn.disabled = true;
  messageEl.textContent = translate(currentLanguage, 'testingWebdav');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'TEST_WEBDAV', settings: collectSyncSettings() });
    messageEl.textContent = formatWebdavTestResult(result);
  } catch (error) {
    messageEl.textContent = error.message || translate(currentLanguage, 'actionFailed');
  } finally {
    testWebdavBtn.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: collectSyncSettings() });
  messageEl.textContent = result.ok ? translate(currentLanguage, 'settingsSaved') : result.error;
});

fields.saveGitSettings?.addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: collectSyncSettings() });
  fields.gitMessage.textContent = result.ok ? translate(currentLanguage, 'settingsSaved') : result.error;
});

fields.testGitProvider?.addEventListener('click', async () => {
  fields.testGitProvider.disabled = true;
  fields.gitMessage.textContent = translate(currentLanguage, 'testingSyncProvider');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'TEST_SYNC_PROVIDER', settings: collectSyncSettings() });
    fields.gitMessage.textContent = result.i18nKey ? translate(currentLanguage, result.i18nKey, result.params || {}) : (result.message || result.error || translate(currentLanguage, 'actionFailed'));
  } catch (error) {
    fields.gitMessage.textContent = error.message || translate(currentLanguage, 'actionFailed');
  } finally {
    fields.testGitProvider.disabled = false;
  }
});

fields.exportSettingsLocalFile?.addEventListener('click', async () => {
  fields.localFileMessage.textContent = translate(currentLanguage, 'running');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'UPLOAD_NOW', settings: { ...collectSyncSettings(), syncProvider: 'localFile' } });
    fields.localFileMessage.textContent = result.i18nKey ? translate(currentLanguage, result.i18nKey, result.params || {}) : (result.message || result.error || translate(currentLanguage, 'actionCompleted'));
  } catch (error) {
    fields.localFileMessage.textContent = error.message || translate(currentLanguage, 'actionFailed');
  }
});

fields.importSettingsLocalFile?.addEventListener('click', () => fields.settingsLocalFileInput?.click());
fields.settingsLocalFileInput?.addEventListener('change', handleSettingsLocalFileImport);

settingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => switchSettingsTab(tab.dataset.settingsTab));
});

summaryEls.engineModeSelect.addEventListener('change', handleSummaryEngineChange);
summaryEls.localModelSelect.addEventListener('change', async () => {
  await saveSettings({
    localModelId: summaryEls.localModelSelect.value,
  });
  renderImportGuide(getCurrentModelId());
  await checkModelCacheStatus();
});
summaryEls.setupGeminiNanoBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('gemini-guide.html') });
  summaryEls.aiValidationStatus.textContent = translate(currentLanguage, 'geminiNanoGuideStarted');
});
summaryEls.validateGeminiNanoBtn.addEventListener('click', validateGeminiNanoStatus);
summaryEls.validateCustomAiBtn.addEventListener('click', validateCustomAiStatus);
summaryEls.saveCustomAiConfigBtn.addEventListener('click', async () => {
  await saveCustomConfig();
  summaryEls.aiValidationStatus.textContent = translate(currentLanguage, 'settingsUpdated');
});
summaryEls.importModelFolderBtn?.addEventListener('click', () => summaryEls.localModelFileFolderInput?.click());
summaryEls.localModelFileFolderInput?.addEventListener('change', handleImportModelFolder);
summaryEls.inlineDeleteBtn?.addEventListener('click', handleDeleteModel);

async function loadSettings() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  const settings = status.settings;
  currentSettings = settings;
  refreshLocalState(settings);

  fields.syncProvider.value = settings.syncProvider || 'localFile';
  fields.webdavUrl.value = settings.webdavUrl;
  fields.username.value = settings.username;
  fields.password.value = settings.password;
  fields.remoteFile.value = settings.remoteFile;
  fields.gitToken.value = getGitField(settings, 'token');
  fields.gitOwner.value = getGitField(settings, 'owner');
  fields.gitRepo.value = getGitField(settings, 'repo');
  fields.gitBranch.value = getGitField(settings, 'branch');
  fields.gitFilePath.value = getGitField(settings, 'filePath');
  fields.requestTimeoutSeconds.value = settings.requestTimeoutSeconds;

  updateSyncProviderVisibility();
  populateSummaryForm();
  applyLanguage(currentLanguage);
  switchSettingsTab(getRequestedSettingsTab());
  updateSummaryVisibility();
  await checkModelCacheStatus();
}

function refreshLocalState(settings) {
  currentLanguage = normalizeLanguage(settings.language);
  currentSyncProvider = settings.syncProvider || 'localFile';
  currentDownloadMode = normalizeDownloadMode(settings.downloadMode);
  currentSyncIntervalMinutes = settings.syncIntervalMinutes;
  currentCleanIntervalMinutes = settings.cleanIntervalMinutes;
  currentAutoSync = settings.autoSync;
  currentAutoCleanDuplicates = settings.autoCleanDuplicates;
  currentAutoCleanEmptyFolders = settings.autoCleanEmptyFolders;
  currentInvalidTimeoutSeconds = settings.invalidTimeoutSeconds;
  currentCarryCredentialsForInvalid = Boolean(settings.carryCredentialsForInvalid);
  currentSettings = { ...currentSettings, ...settings };
}

function collectSyncSettings() {
  return {
    syncProvider: currentSyncProvider,
    language: currentLanguage,
    webdavUrl: fields.webdavUrl.value,
    username: fields.username.value,
    password: fields.password.value,
    remoteFile: fields.remoteFile.value,
    githubToken: currentSyncProvider === 'github' ? fields.gitToken.value : currentSettings.githubToken,
    githubOwner: currentSyncProvider === 'github' ? fields.gitOwner.value : currentSettings.githubOwner,
    githubRepo: currentSyncProvider === 'github' ? fields.gitRepo.value : currentSettings.githubRepo,
    githubBranch: currentSyncProvider === 'github' ? fields.gitBranch.value : currentSettings.githubBranch,
    githubFilePath: currentSyncProvider === 'github' ? fields.gitFilePath.value : currentSettings.githubFilePath,
    giteeToken: currentSyncProvider === 'gitee' ? fields.gitToken.value : currentSettings.giteeToken,
    giteeOwner: currentSyncProvider === 'gitee' ? fields.gitOwner.value : currentSettings.giteeOwner,
    giteeRepo: currentSyncProvider === 'gitee' ? fields.gitRepo.value : currentSettings.giteeRepo,
    giteeBranch: currentSyncProvider === 'gitee' ? fields.gitBranch.value : currentSettings.giteeBranch,
    giteeFilePath: currentSyncProvider === 'gitee' ? fields.gitFilePath.value : currentSettings.giteeFilePath,
    requestTimeoutSeconds: fields.requestTimeoutSeconds.value,
    syncIntervalMinutes: currentSyncIntervalMinutes,
    cleanIntervalMinutes: currentCleanIntervalMinutes,
    downloadMode: currentDownloadMode,
    autoSync: currentAutoSync,
    autoCleanDuplicates: currentAutoCleanDuplicates,
    autoCleanEmptyFolders: currentAutoCleanEmptyFolders,
    invalidTimeoutSeconds: currentInvalidTimeoutSeconds,
    carryCredentialsForInvalid: currentCarryCredentialsForInvalid,
  };
}

function formatWebdavTestResult(result) {
  if (!result.i18nKey) return result.ok ? result.message : result.error;
  return translate(currentLanguage, result.i18nKey, result.params || {});
}

function getSyncDescriptionKey(provider) {
  const keyMap = {
    webdav: 'syncDescriptionWebdav',
    localFile: 'syncDescriptionLocalFile',
    github: 'syncDescriptionGithub',
    gitee: 'syncDescriptionGitee',
  };
  return keyMap[provider] || 'syncDescription';
}

function applyLanguage(language) {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = translate(language, 'settingsTitle');

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = translate(language, element.dataset.i18n);
  }

  syncDescriptionEl.textContent = translate(language, getSyncDescriptionKey(currentSyncProvider));
  updateSensitiveToggleText(togglePasswordBtn, fields.password, language);
  updateSensitiveToggleText(toggleGitTokenBtn, fields.gitToken, language);
  updateSensitiveToggleText(toggleCustomAiApiKeyBtn, summaryEls.customAiApiKeyInput, language);
  updateSyncProviderVisibility();
  renderImportGuide(getCurrentModelId());
  if (summaryEls.localModelTools && !summaryEls.localModelTools.hidden) {
    checkModelCacheStatus().catch(function() {});
  }
}

function updateSyncProviderVisibility() {
  const isWebdav = currentSyncProvider === 'webdav';
  const isLocalFile = currentSyncProvider === 'localFile';
  const isGitProvider = currentSyncProvider === 'github' || currentSyncProvider === 'gitee';
  fields.syncProvider.value = currentSyncProvider;
  if (fields.webdavSettingsCard) fields.webdavSettingsCard.hidden = !isWebdav;
  if (fields.localFileSettingsCard) fields.localFileSettingsCard.hidden = !isLocalFile;
  if (fields.gitSettingsCard) fields.gitSettingsCard.hidden = !isGitProvider;
  if (isGitProvider) populateGitForm(currentSettings);
  if (fields.gitSettingsTitle) fields.gitSettingsTitle.textContent = translate(currentLanguage, currentSyncProvider === 'gitee' ? 'giteeSettingsTitle' : 'githubSettingsTitle');
  if (testWebdavBtn) testWebdavBtn.disabled = !isWebdav;
  if (fields.syncProviderHint) {
    const keyMap = {
      webdav: 'syncProviderWebdavHint',
      localFile: 'syncProviderLocalFileHint',
      github: 'syncProviderGithubHint',
      gitee: 'syncProviderGiteeHint',
    };
    fields.syncProviderHint.textContent = translate(currentLanguage, keyMap[currentSyncProvider] || 'syncProviderWebdavHint');
  }
}

function isAutoSyncCapable(provider) {
  return provider === 'webdav' || provider === 'github' || provider === 'gitee';
}

function populateGitForm(settings) {
  if (!settings) settings = currentSettings;
  if (!fields.gitToken) return;
  fields.gitToken.value = getGitField(settings, 'token');
  fields.gitOwner.value = getGitField(settings, 'owner');
  fields.gitRepo.value = getGitField(settings, 'repo');
  fields.gitBranch.value = getGitField(settings, 'branch');
  fields.gitFilePath.value = getGitField(settings, 'filePath');
}

function getGitField(settings, field) {
  const prefix = currentSyncProvider === 'gitee' ? 'gitee' : 'github';
  const defaults = { branch: prefix === 'gitee' ? 'master' : 'main', filePath: fields.remoteFile?.value || 'chrome-bookmarks.json' };
  const key = prefix + field.charAt(0).toUpperCase() + field.slice(1);
  return settings?.[key] || defaults[field] || '';
}

function switchSettingsTab(tabName) {
  currentSettingsTab = tabName === 'summary' ? 'summary' : 'sync';
  syncSettingsPanel.hidden = currentSettingsTab !== 'sync';
  summarySettingsPanel.hidden = currentSettingsTab !== 'summary';
  settingsTabs.forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.settingsTab === currentSettingsTab);
  });
  const hash = currentSettingsTab === 'summary' ? '#summary' : '#sync';
  if (window.location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

function getRequestedSettingsTab() {
  return window.location.hash === '#summary' ? 'summary' : 'sync';
}

function bindSensitiveToggle(button, input) {
  if (!button || !input) return;
  button.addEventListener('click', function() {
    const shouldShow = input.type === 'password';
    input.type = shouldShow ? 'text' : 'password';
    updateSensitiveToggleText(button, input, currentLanguage);
  });
}

function updateSensitiveToggleText(button, input, language) {
  if (!button || !input) return;
  button.textContent = translate(language, input.type === 'text' ? 'hidePassword' : 'showPassword');
}

function normalizeSummaryModeForUi(mode, provider) {
  if (mode === 'offlineAi') return provider || 'geminiNano';
  if (mode === 'offline') return 'textrank';
  return ['textrank', 'transformer', 'geminiNano', 'customOpenai', 'customAnthropic'].includes(mode) ? mode : 'textrank';
}

function getAiProviderFromSummaryMode(mode) {
  return ['geminiNano', 'customOpenai', 'customAnthropic'].includes(mode) ? mode : (currentSettings?.bookmarkSummaryAiProvider || 'geminiNano');
}

function populateSummaryForm() {
  summaryEls.engineModeSelect.value = normalizeSummaryModeForUi(currentSettings.bookmarkSummaryEngineMode, currentSettings.bookmarkSummaryAiProvider);
  summaryEls.localModelSelect.value = currentSettings.localModelId || 'lamini-flan-t5';
  updateSummaryVisibility();
}

function updateSummaryVisibility() {
  const mode = summaryEls.engineModeSelect.value;
  summaryEls.localModelTools.hidden = mode !== 'transformer';
  summaryEls.geminiNanoTools.hidden = mode !== 'geminiNano';
  summaryEls.customAiSettings.hidden = !(mode === 'customOpenai' || mode === 'customAnthropic');
  if (mode === 'textrank') {
    summaryEls.aiValidationStatus.textContent = translate(currentLanguage, 'aiValidationOfflineOnly');
  } else if (mode === 'transformer') {
    summaryEls.aiValidationStatus.textContent = translate(currentLanguage, 'localModelValidationIdle');
  } else {
    summaryEls.aiValidationStatus.textContent = translate(currentLanguage, 'aiValidationIdle');
  }
}

async function saveSettings(patch) {
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: patch });
}

async function handleSettingsLocalFileImport(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  fields.localFileMessage.textContent = translate(currentLanguage, 'importingLocalFile');
  try {
    const snapshot = JSON.parse(await file.text());
    const result = await chrome.runtime.sendMessage({
      type: 'IMPORT_LOCAL_FILE_SNAPSHOT',
      snapshot,
      downloadMode: currentDownloadMode,
    });
    fields.localFileMessage.textContent = result.i18nKey ? translate(currentLanguage, result.i18nKey, result.params || {}) : (result.message || result.error || translate(currentLanguage, 'actionCompleted'));
  } catch (error) {
    fields.localFileMessage.textContent = error.message || translate(currentLanguage, 'localFileImportFailed');
  } finally {
    if (fields.settingsLocalFileInput) fields.settingsLocalFileInput.value = '';
  }
}

async function handleSummaryEngineChange() {
  updateSummaryVisibility();
  const mode = summaryEls.engineModeSelect.value;
  await saveSettings({
    bookmarkSummaryEngineMode: mode,
    bookmarkSummaryAiProvider: getAiProviderFromSummaryMode(mode),
    localModelId: summaryEls.localModelSelect.value || 'lamini-flan-t5',
  });
  if (mode === 'transformer') {
    renderImportGuide(getCurrentModelId());
    checkModelCacheStatus();
  }
}

async function saveCustomConfig() {
  await saveSettings({
    bookmarkSummaryEngineMode: summaryEls.engineModeSelect.value,
    bookmarkSummaryAiProvider: getAiProviderFromSummaryMode(summaryEls.engineModeSelect.value),
    customAiBaseUrl: summaryEls.customAiBaseUrlInput.value,
    customAiApiKey: summaryEls.customAiApiKeyInput.value,
    customAiModel: summaryEls.customAiModelInput.value,
    localModelId: summaryEls.localModelSelect.value || 'lamini-flan-t5',
  });
}

async function validateGeminiNanoStatus() {
  summaryEls.aiValidationStatus.textContent = translate(currentLanguage, 'aiValidationChecking');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_GEMINI_NANO_AVAILABLE' });
    summaryEls.aiValidationStatus.textContent = result.available
      ? translate(currentLanguage, 'geminiNanoPromptOk')
      : translate(currentLanguage, result.reasonKey || 'geminiNanoPromptFailed');
  } catch (error) {
    summaryEls.aiValidationStatus.textContent = error.message;
  }
}

async function validateCustomAiStatus() {
  summaryEls.aiValidationStatus.textContent = translate(currentLanguage, 'aiValidationChecking');
  await saveCustomConfig();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'VALIDATE_CUSTOM_AI' });
    summaryEls.aiValidationStatus.textContent = result.ok
      ? translate(currentLanguage, 'customAiConnectionOk')
      : (result.error || translate(currentLanguage, 'customAiConnectionFailed'));
  } catch (error) {
    summaryEls.aiValidationStatus.textContent = error.message;
  }
}

// ============================================================
// IndexedDB operations (unchanged from original)
// ============================================================

function openDB() {
  return new Promise(function(resolve, reject) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function() {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
      if (!req.result.objectStoreNames.contains(META_STORE_NAME)) {
        req.result.createObjectStore(META_STORE_NAME);
      }
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

async function saveModelFile(key, buffer) {
  const db = await openDB();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(buffer, key);
    tx.oncomplete = function() { db.close(); resolve(); };
    tx.onerror = function() { db.close(); reject(tx.error); };
  });
}

async function saveModelFileMeta(key, patch) {
  const db = await openDB();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(META_STORE_NAME, 'readwrite');
    const store = tx.objectStore(META_STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = function() {
      const current = getReq.result || {};
      const next = Object.assign({}, current, patch, { updatedAt: new Date().toISOString() });
      store.put(next, key);
    };
    getReq.onerror = function() {
      const next = Object.assign({}, patch, { updatedAt: new Date().toISOString() });
      store.put(next, key);
    };
    tx.oncomplete = function() { db.close(); resolve(); };
    tx.onerror = function() { db.close(); reject(tx.error); };
  });
}

async function getModelFileMeta(key) {
  return new Promise(function(resolve) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = function() {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains(META_STORE_NAME)) {
          db.close();
          resolve({});
          return;
        }
        const tx = db.transaction(META_STORE_NAME, 'readonly');
        const getReq = tx.objectStore(META_STORE_NAME).get(key);
        getReq.onsuccess = function() {
          const value = getReq.result || {};
          db.close();
          resolve(value);
        };
        getReq.onerror = function() {
          db.close();
          resolve({});
        };
      } catch (_) {
        db.close();
        resolve({});
      }
    };
    req.onerror = function() { resolve({}); };
  });
}

async function getModelFileInfo(key) {
  return new Promise(function(resolve) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = function() {
      const db = req.result;
      try {
        const hasFileStore = db.objectStoreNames.contains(STORE_NAME);
        const hasMetaStore = db.objectStoreNames.contains(META_STORE_NAME);
        if (!hasFileStore && !hasMetaStore) {
          db.close();
          resolve({ exists: false, byteLength: 0, storedBytes: 0, status: 'ready' });
          return;
        }
        const stores = [];
        if (hasFileStore) stores.push(STORE_NAME);
        if (hasMetaStore) stores.push(META_STORE_NAME);
        const tx = db.transaction(stores, 'readonly');
        const result = {
          exists: false,
          byteLength: 0,
          storedBytes: 0,
          status: 'ready',
          expectedSize: 0,
          mirrorKey: '',
          lastError: '',
          resumed: false,
          updatedAt: '',
          etag: '',
          lastModified: '',
          contentRangeSupported: false,
        };

        const finalize = function() {
          result.storedBytes = Math.max(result.storedBytes || 0, result.byteLength || 0);
          result.exists = result.exists || result.storedBytes > 0;
          db.close();
          resolve(result);
        };

        if (!hasFileStore) {
          const metaReq = tx.objectStore(META_STORE_NAME).get(key);
          metaReq.onsuccess = function() {
            Object.assign(result, metaReq.result || {});
          };
          tx.oncomplete = finalize;
          tx.onerror = finalize;
          return;
        }

        const fileReq = tx.objectStore(STORE_NAME).get(key);
        fileReq.onsuccess = function() {
          const value = fileReq.result;
          const byteLength = value instanceof ArrayBuffer
            ? value.byteLength
            : Number(value?.byteLength || value?.buffer?.byteLength || 0);
          result.exists = value !== undefined;
          result.byteLength = Math.max(0, byteLength || 0);
        };
        fileReq.onerror = function() {};

        if (hasMetaStore) {
          const metaReq = tx.objectStore(META_STORE_NAME).get(key);
          metaReq.onsuccess = function() {
            Object.assign(result, metaReq.result || {});
          };
        }

        tx.oncomplete = finalize;
        tx.onerror = finalize;
      } catch (_) {
        db.close();
        resolve({ exists: false, byteLength: 0, storedBytes: 0, status: 'ready' });
      }
    };
    req.onerror = function() { resolve({ exists: false, byteLength: 0, storedBytes: 0, status: 'ready' }); };
  });
}

async function modelFileExists(key) {
  const info = await getModelFileInfo(key);
  return info.exists;
}

async function deleteModelFiles(modelId) {
  return new Promise(function(resolve) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = function() {
      const db = req.result;
      try {
        const stores = [];
        if (db.objectStoreNames.contains(STORE_NAME)) stores.push(STORE_NAME);
        if (db.objectStoreNames.contains(META_STORE_NAME)) stores.push(META_STORE_NAME);
        if (stores.length === 0) { db.close(); resolve(0); return; }
        const tx = db.transaction(stores, 'readwrite');
        const deleteByPrefix = function(storeName, done) {
          const getAllReq = tx.objectStore(storeName).getAllKeys();
          getAllReq.onsuccess = function() {
            const keys = getAllReq.result.filter(function(k) { return String(k).startsWith(modelId + '::'); });
            keys.forEach(function(key) { tx.objectStore(storeName).delete(key); });
            done(keys.length);
          };
          getAllReq.onerror = function() { done(0); };
        };

        let deleted = 0;
        let completed = 0;
        stores.forEach(function(storeName) {
          deleteByPrefix(storeName, function(count) {
            deleted = Math.max(deleted, count);
            completed += 1;
            if (completed === stores.length) {
              tx.oncomplete = function() { db.close(); resolve(deleted); };
              tx.onerror = function() { db.close(); resolve(0); };
            }
          });
        });
      } catch (_) { db.close(); resolve(0); }
    };
    req.onerror = function() { resolve(0); };
  });
}

function getCurrentModelId() {
  const id = summaryEls.localModelSelect.value || 'lamini-flan-t5';
  return typeof ZongziModelRegistry.normalizeModelId === 'function'
    ? ZongziModelRegistry.normalizeModelId(id)
    : id;
}

function getCurrentModelMeta() {
  return typeof ZongziModelRegistry.getModelMeta === 'function'
    ? ZongziModelRegistry.getModelMeta(getCurrentModelId())
    : null;
}

function getModelFileKey(modelId, file) {
  return modelId + '::' + file;
}

function getStoredModelFileBytes(info) {
  if (!info) info = {};
  return Math.max(Number(info.storedBytes) || 0, Number(info.byteLength) || 0);
}

// ============================================================
// Import model folder (new functionality)
// ============================================================

function getModelSource(modelId) {
  return typeof ZongziModelRegistry.getDownloadSource === 'function'
    ? ZongziModelRegistry.getDownloadSource(modelId)
    : null;
}

function renderImportGuide(modelId) {
  const source = getModelSource(modelId);
  if (!source) return;

  // Render mirror download links
  if (summaryEls.mirrorLinksRow) {
    const mirrorUrls = source.mirrors.map(function(m) {
      return m.url;
    }).join('\n');
    summaryEls.mirrorLinksRow.innerHTML = [
      '<div class="mirror-buttons">',
      '  <button type="button" class="secondary compact copy-urls-btn" id="copyMirrorUrlsBtn" data-i18n="copyDownloadUrls">' + translate(currentLanguage, 'copyDownloadUrls') + '</button>',
      '  <a href="' + escapeHtml(source.mirrors[0].url) + '" target="_blank" rel="noopener" class="secondary compact mirror-open-link" data-i18n="openMirrorSite">' + translate(currentLanguage, 'openMirrorSite') + '</a>',
      '</div>',
      '<ul class="mirror-url-list">',
      source.mirrors.map(function(m) {
        return '<li><a href="' + escapeHtml(m.url) + '" target="_blank" rel="noopener">' + escapeHtml(m.name) + '</a></li>';
      }).join(''),
      '</ul>',
    ].join('');

    // Bind copy button
    const copyBtn = document.getElementById('copyMirrorUrlsBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        const urls = source.mirrors.map(function(m) { return m.name + ': ' + m.url; }).join('\n');
        navigator.clipboard.writeText(urls).then(function() {
          copyBtn.textContent = translate(currentLanguage, 'mirrorUrlsCopied');
          setTimeout(function() {
            copyBtn.textContent = translate(currentLanguage, 'copyDownloadUrls');
          }, 3000);
        }).catch(function() {
          copyBtn.textContent = translate(currentLanguage, 'actionFailed');
        });
      });
    }
  }

  // Render required file list
  if (summaryEls.importRequiredFiles) {
    summaryEls.importRequiredFiles.innerHTML = source.files.map(function(file) {
      return '<li><code>' + escapeHtml(file) + '</code></li>';
    }).join('');
  }
}

async function handleImportModelFolder(event) {
  const input = summaryEls.localModelFileFolderInput;
  if (!input || !input.files || input.files.length === 0) return;

  const modelId = getCurrentModelId();
  const source = getModelSource(modelId);
  if (!source) {
    if (summaryEls.inlineDownloadStatus) {
      summaryEls.inlineDownloadStatus.textContent = translate(currentLanguage, 'importLocalModelNoModel');
    }
    input.value = '';
    return;
  }

  const files = Array.from(input.files);
  const result = await importModelFolder(modelId, source, files);
  renderImportResult(result);

  input.value = '';
  await checkModelCacheStatus();
}

async function importModelFolder(modelId, source, files) {
  const lang = currentLanguage;
  const imported = [];
  const missing = [];
  const errors = [];

  // Build a lookup map: filename (last path component) -> registry path
  const registryLookup = new Map();
  for (const rp of source.files) {
    const base = rp.split(/[\\/]/).pop();
    registryLookup.set(base, rp);
    // Also check full path
    registryLookup.set(rp, rp);
    // Check path without onnx/ prefix
    if (rp.startsWith('onnx/')) {
      registryLookup.set(rp.replace('onnx/', ''), rp);
    }
  }

  // Build a lookup from input files: filename -> File object
  const inputLookup = new Map();
  for (const file of files) {
    // Preserve relative path from webkitdirectory
    const relativePath = file.webkitRelativePath || file.name;
    inputLookup.set(relativePath, file);
    inputLookup.set(file.name, file);
  }

  for (const expectedFile of source.files) {
    let matchedFile = null;

    // Try exact relative path match first
    if (inputLookup.has(expectedFile)) {
      matchedFile = inputLookup.get(expectedFile);
    } else {
      // Try matching by filename
      const expectedBasename = expectedFile.split(/[\\/]/).pop();
      for (const [path, file] of inputLookup) {
        const fileBasename = file.name;
        if (fileBasename === expectedBasename) {
          matchedFile = file;
          break;
        }
        // Also check if path ends with expectedFile
        if (path.endsWith(expectedFile) || path.endsWith(expectedFile.replace(/\//g, '\\'))) {
          matchedFile = file;
          break;
        }
      }
    }

    if (!matchedFile) {
      missing.push(expectedFile);
      continue;
    }

    try {
      const key = getModelFileKey(modelId, expectedFile);
      const buffer = await matchedFile.arrayBuffer();
      await saveModelFile(key, buffer);
      await saveModelFileMeta(key, {
        status: 'complete',
        storedBytes: buffer.byteLength,
        expectedSize: buffer.byteLength,
        mirrorKey: 'localImport',
        lastError: '',
        updatedAt: new Date().toISOString(),
      });
      imported.push({
        file: expectedFile,
        size: buffer.byteLength,
      });
    } catch (err) {
      errors.push({
        file: expectedFile,
        error: err.message || 'Unknown error',
      });
    }
  }

  return { imported, missing, errors };
}

function renderImportResult(result) {
  if (!summaryEls.importResult || !result) return;

  const lang = currentLanguage;
  const { imported, missing, errors } = result;

  if (imported.length === 0 && errors.length === 0) {
    summaryEls.importResult.hidden = true;
    if (summaryEls.inlineDownloadStatus) {
      summaryEls.inlineDownloadStatus.textContent = translate(lang, 'importLocalModelNoneMatch');
    }
    return;
  }

  summaryEls.importResult.hidden = false;

  // Determine status
  const source = getModelSource(getCurrentModelId());
  const totalRequired = source ? source.files.length : 0;

  if (imported.length === totalRequired) {
    summaryEls.importResult.className = 'import-result import-result-success';
    summaryEls.importResultTitle.textContent = translate(lang, 'importSuccess');
  } else if (imported.length > 0) {
    summaryEls.importResult.className = 'import-result import-result-partial';
    summaryEls.importResultTitle.textContent = translate(lang, 'importPartial')
      .replace('{imported}', imported.length)
      .replace('{missing}', missing.length);
  } else {
    summaryEls.importResult.className = 'import-result import-result-error';
    summaryEls.importResultTitle.textContent = translate(lang, 'importError');
  }

  // Render file list
  const fileRows = [];
  for (const item of imported) {
    fileRows.push('<li class="import-result-item import-success">' + escapeHtml('✅ ' + item.file) + ' ' + formatBytes(item.size) + '</li>');
  }
  for (const item of missing) {
    fileRows.push('<li class="import-result-item import-missing">' + escapeHtml('❌ ' + item) + '</li>');
  }
  for (const item of errors) {
    fileRows.push('<li class="import-result-item import-error">' + escapeHtml('⚠ ' + item.file + ': ' + item.error) + '</li>');
  }
  summaryEls.importResultList.innerHTML = fileRows.join('');

  // Update status message
  if (summaryEls.inlineDownloadStatus) {
    if (imported.length === totalRequired) {
      summaryEls.inlineDownloadStatus.textContent = translate(lang, 'importSuccess');
    } else {
      summaryEls.inlineDownloadStatus.textContent = translate(lang, 'importPartial')
        .replace('{imported}', imported.length)
        .replace('{missing}', missing.length);
    }
  }
}

async function checkModelCacheStatus() {
  const modelId = getCurrentModelId();
  const meta = getCurrentModelMeta();
  if (!meta) return;

  let importedCount = 0;
  let totalStoredBytes = 0;
  const totalRequired = meta.files.length;
  const fileStates = [];

  for (const file of meta.files) {
    const key = getModelFileKey(modelId, file);
    const info = await getModelFileInfo(key);
    const storedBytes = getStoredModelFileBytes(info);
    const fileExists = info.exists || storedBytes > 0;
    fileStates.push({
      file: file,
      exists: fileExists,
      storedBytes: storedBytes,
    });
    if (fileExists) {
      importedCount++;
      totalStoredBytes += storedBytes;
    }
  }

  const allImported = importedCount === totalRequired;
  const hasAny = importedCount > 0;

  // Render import result area if already imported
  if (hasAny && allImported) {
    if (summaryEls.importResult) {
      summaryEls.importResult.hidden = false;
      summaryEls.importResult.className = 'import-result import-result-success';
      summaryEls.importResultTitle.textContent = translate(currentLanguage, 'importSuccess');
      summaryEls.importResultList.innerHTML = fileStates.map(function(s) {
        return '<li class="import-result-item import-success">' + escapeHtml('✅ ' + s.file) + ' ' + formatBytes(s.storedBytes) + '</li>';
      }).join('');
    }
  } else if (hasAny) {
    if (summaryEls.importResult) {
      summaryEls.importResult.hidden = false;
      summaryEls.importResult.className = 'import-result import-result-partial';
      summaryEls.importResultTitle.textContent = translate(currentLanguage, 'importPartial')
        .replace('{imported}', importedCount)
        .replace('{missing}', totalRequired - importedCount);
      summaryEls.importResultList.innerHTML = fileStates.map(function(s) {
        if (s.exists) {
          return '<li class="import-result-item import-success">' + escapeHtml('✅ ' + s.file) + ' ' + formatBytes(s.storedBytes) + '</li>';
        }
        return '<li class="import-result-item import-missing">' + escapeHtml('❌ ' + s.file) + '</li>';
      }).join('');
    }
  } else {
    if (summaryEls.importResult) {
      summaryEls.importResult.hidden = true;
    }
  }

  // Show/hide delete button
  if (summaryEls.deleteModelActions) {
    summaryEls.deleteModelActions.hidden = !hasAny;
  }

  // Update status badge and text
  const badgeEl = document.getElementById('modelCacheStatusBadge');
  const dotEl = document.getElementById('modelCacheStatusDot');
  const badgeTextEl = document.getElementById('modelCacheStatusText');
  
  if (allImported) {
    if (dotEl) { dotEl.className = 'cache-status-dot ready'; }
    if (badgeTextEl) { badgeTextEl.textContent = translate(currentLanguage, 'modelCacheReady', { size: (totalStoredBytes / (1024 * 1024)).toFixed(0) }); }
    if (badgeEl) { badgeEl.hidden = false; }
    if (summaryEls.inlineDownloadStatus) { summaryEls.inlineDownloadStatus.innerHTML = '<span style="color:#22c55e;">●</span> ' + translate(currentLanguage, 'modelCacheReady', { size: (totalStoredBytes / (1024 * 1024)).toFixed(0) }); }
  } else if (hasAny) {
    if (dotEl) { dotEl.className = 'cache-status-dot partial'; }
    if (badgeTextEl) { badgeTextEl.textContent = translate(currentLanguage, 'modelCachePartial').replace('{imported}', importedCount).replace('{total}', totalRequired); }
    if (badgeEl) { badgeEl.hidden = false; }
    if (summaryEls.inlineDownloadStatus) { summaryEls.inlineDownloadStatus.innerHTML = '<span style="color:#f59e0b;">●</span> ' + translate(currentLanguage, 'modelCachePartial').replace('{imported}', importedCount).replace('{total}', totalRequired); }
  } else {
    if (dotEl) { dotEl.className = 'cache-status-dot none'; }
    if (badgeTextEl) { badgeTextEl.textContent = translate(currentLanguage, 'noModelCache'); }
    if (badgeEl) { badgeEl.hidden = false; }
    if (summaryEls.inlineDownloadStatus) { summaryEls.inlineDownloadStatus.innerHTML = '<span style="color:#94a3b8;">●</span> ' + translate(currentLanguage, 'noModelCache'); }
  }

  renderImportGuide(modelId);
}

async function handleDeleteModel() {
  const modelId = getCurrentModelId();
  const confirmed = confirm(translate(currentLanguage, 'deleteModelCacheConfirm'));
  if (!confirmed) return;

  const deleted = await deleteModelFiles(modelId);

  if (summaryEls.inlineDownloadStatus) {
    summaryEls.inlineDownloadStatus.textContent = translate(currentLanguage, 'deleteModelDone').replace('{n}', deleted);
  }

  if (summaryEls.importResult) {
    summaryEls.importResult.hidden = true;
  }

  const badgeEl = document.getElementById('modelCacheStatusBadge');
  const dotEl = document.getElementById('modelCacheStatusDot');
  const badgeTextEl = document.getElementById('modelCacheStatusText');
  if (dotEl) { dotEl.className = 'cache-status-dot none'; }
  if (badgeTextEl) { badgeTextEl.textContent = translate(currentLanguage, 'noModelCache'); }
  if (badgeEl) { badgeEl.hidden = false; }

  await checkModelCacheStatus();
  await chrome.runtime.sendMessage({ type: 'DELETE_MODEL_FILES', modelId });
}

// ============================================================
// Utility functions
// ============================================================

function formatBytes(bytes) {
  const safeBytes = Number(bytes) || 0;
  if (safeBytes < 1024) return safeBytes + ' B';
  if (safeBytes < 1048576) return (safeBytes / 1024).toFixed(1) + ' KB';
  if (safeBytes < 1073741824) return (safeBytes / 1048576).toFixed(1) + ' MB';
  return (safeBytes / 1073741824).toFixed(2) + ' GB';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// normalizeLanguage / normalizeDownloadMode 由 app-config.js 统一提供，不再在这里重复定义
