const MODULE_NAMES = ['search', 'summary', 'sync', 'clean'];
const statusEl = document.querySelector('#status');
const syncNowBtn = document.querySelector('#syncNow');
const uploadNowBtn = document.querySelector('#uploadNow');
const downloadNowBtn = document.querySelector('#downloadNow');
const exportLocalFileBtn = document.querySelector('#exportLocalFile');
const importLocalFileBtn = document.querySelector('#importLocalFile');
const localFileInput = document.querySelector('#localFileInput');
const cleanDuplicatesNowBtn = document.querySelector('#cleanDuplicatesNow');
const cleanEmptyFoldersNowBtn = document.querySelector('#cleanEmptyFoldersNow');
const cleanAllNowBtn = document.querySelector('#cleanAllNow');
const openInvalidCleanerBtn = document.querySelector('#openInvalidCleaner');
const downloadModeSelect = document.querySelector('#downloadMode');
const syncIntervalInput = document.querySelector('#syncIntervalMinutes');
const cleanIntervalInput = document.querySelector('#cleanIntervalMinutes');
const syncIntervalControl = document.querySelector('#syncIntervalControl');
const cleanIntervalControl = document.querySelector('#cleanIntervalControl');
const autoCleanEmptyFoldersControl = document.querySelector('#autoCleanEmptyFoldersControl');
const autoSyncCheckbox = document.querySelector('#autoSync');
const autoCleanDuplicatesCheckbox = document.querySelector('#autoCleanDuplicates');
const autoCleanEmptyFoldersCheckbox = document.querySelector('#autoCleanEmptyFolders');
const languageToggleBtn = document.querySelector('#languageToggle');
const languageToggleText = document.querySelector('#languageToggleText');
const openSettingsLink = document.querySelector('#openSettingsLink');
const moduleTabs = Array.from(document.querySelectorAll('.module-tab'));
const syncModule = document.querySelector('#syncModule');
const cleanModule = document.querySelector('#cleanModule');
const searchModule = document.querySelector('#searchModule');
const summaryModule = document.querySelector('#summaryModule');
const modulePanels = { sync: syncModule, clean: cleanModule, search: searchModule, summary: summaryModule };
const bookmarkSearchInput = document.querySelector('#bookmarkSearchInput');
const bookmarkSearchButton = document.querySelector('#bookmarkSearchButton');
const bookmarkSearchResults = document.querySelector('#bookmarkSearchResults');
const bookmarkSearchCount = document.querySelector('#bookmarkSearchCount');
const bookmarkSummaryAutoCheckbox = document.querySelector('#bookmarkSummaryAuto');
const openSummarySettingsBtn = document.querySelector('#openSummarySettings');
const openSummaryPageBtn = document.querySelector('#openSummaryPage');
const bookmarkSummaryRunning = document.querySelector('#bookmarkSummaryRunning');
const summaryEngine = document.querySelector('#summaryEngine');
const summaryUpdatedAt = document.querySelector('#summaryUpdatedAt');
const webdavNotice = document.querySelector('#webdavNotice');
const syncVersionList = document.querySelector('#syncVersionList');
const syncVersionCount = document.querySelector('#syncVersionCount');

let currentLanguage = 'zh';
let currentSettings = createFallbackSettings();
let floatingTooltipEl = null;
let activeTooltipTarget = null;
let searchBootstrapItems = [];
let searchBootstrapReady = false;
let searchBootstrapError = '';
let syncVersionItems = [];

init();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.settings?.newValue) return;
  // Stored settings omit encrypted WebDAV fields, so always reload decrypted settings.
  refreshStatus().catch(() => {});
});

async function init() {
  bindStaticEventListeners();
  renderSearchBootstrapState();
  applyLanguage(currentLanguage);
  bindCursorFollowTooltips();
  switchModule('search');
  await refreshStatus();
  await Promise.all([
    preloadBookmarkSearchItems().catch(() => {}),
    refreshBookmarkSummaryStatus().catch(() => {}),
  ]);
}

function bindStaticEventListeners() {
  safeAddEventListener(languageToggleBtn, 'click', handleLanguageToggle);
  for (const tab of moduleTabs) {
    safeAddEventListener(tab, 'click', () => switchModule(tab.dataset.moduleTab));
  }
  safeAddEventListener(autoSyncCheckbox, 'change', handleAutoSyncChange);
  safeAddEventListener(autoCleanDuplicatesCheckbox, 'change', handleAutoCleanDuplicatesChange);
  safeAddEventListener(autoCleanEmptyFoldersCheckbox, 'change', handleAutoCleanEmptyFoldersChange);
  safeAddEventListener(bookmarkSummaryAutoCheckbox, 'change', handleBookmarkSummaryAutoChange);
  safeAddEventListener(syncIntervalInput, 'change', handleSyncIntervalChange);
  safeAddEventListener(cleanIntervalInput, 'change', handleCleanIntervalChange);
  safeAddEventListener(downloadModeSelect, 'change', handleDownloadModeChange);
  safeAddEventListener(syncNowBtn, 'click', () => runAction('SYNC_NOW'));
  safeAddEventListener(uploadNowBtn, 'click', () => runAction('UPLOAD_NOW'));
  safeAddEventListener(downloadNowBtn, 'click', () => runAction('DOWNLOAD_NOW'));
  safeAddEventListener(exportLocalFileBtn, 'click', handleExportLocalFile);
  safeAddEventListener(importLocalFileBtn, 'click', () => localFileInput?.click());
  safeAddEventListener(localFileInput, 'change', handleImportLocalFile);
  safeAddEventListener(cleanAllNowBtn, 'click', () => runAction('CLEAN_ALL_NOW'));
  safeAddEventListener(cleanDuplicatesNowBtn, 'click', () => runAction('CLEAN_DUPLICATES_NOW'));
  safeAddEventListener(cleanEmptyFoldersNowBtn, 'click', () => runAction('CLEAN_EMPTY_FOLDERS_NOW'));
  safeAddEventListener(openInvalidCleanerBtn, 'click', () => chrome.tabs.create({ url: chrome.runtime.getURL('invalid.html') }));
  safeAddEventListener(bookmarkSearchButton, 'click', handleBookmarkSearch);
  safeAddEventListener(bookmarkSearchInput, 'keydown', (event) => {
    if (event.key === 'Enter') handleBookmarkSearch();
  });
  safeAddEventListener(openSummaryPageBtn, 'click', () => chrome.tabs.create({ url: chrome.runtime.getURL('summary.html') }));
  safeAddEventListener(openSummarySettingsBtn, 'click', () => openSettingsPage('summary'));
  safeAddEventListener(openSettingsLink, 'click', (event) => {
    event.preventDefault();
    openSettingsPage('sync');
  });

  const webdavNoticeLink = document.querySelector('#webdavNotice .button-link');
  safeAddEventListener(webdavNoticeLink, 'click', (event) => {
    event.preventDefault();
    openSettingsPage('sync');
  });
}

async function refreshStatus(temporaryMessage = '') {
  try {
    const status = await sendMessage({ type: 'GET_STATUS' });
    if (!status?.settings) {
      throw new Error(status?.error || translate(currentLanguage, 'loadingStatus'));
    }

    currentSettings = sanitizePopupSettings(status.settings);
    currentLanguage = normalizePopupLanguage(currentSettings.language);

    setValue(syncIntervalInput, currentSettings.syncIntervalMinutes);
    setValue(cleanIntervalInput, currentSettings.cleanIntervalMinutes);
    setChecked(autoSyncCheckbox, currentSettings.autoSync);
    setChecked(autoCleanDuplicatesCheckbox, currentSettings.autoCleanDuplicates);
    setChecked(autoCleanEmptyFoldersCheckbox, currentSettings.autoCleanEmptyFolders);
    setChecked(bookmarkSummaryAutoCheckbox, currentSettings.bookmarkSummaryAutoEnabled);
    setValue(downloadModeSelect, currentSettings.downloadMode);

    updateAutoSyncVisibility();
    updateSyncAvailability();
    applyLanguage(currentLanguage);
    renderSyncVersions(status.syncVersions || []);

    const lastSync = status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : translate(currentLanguage, 'never');
    renderStatus(status.lastSyncStatus || '-', lastSync, temporaryMessage);
  } catch (error) {
    currentSettings = sanitizePopupSettings(currentSettings);
    currentLanguage = normalizePopupLanguage(currentSettings.language);
    updateAutoSyncVisibility();
    updateSyncAvailability();
    applyLanguage(currentLanguage);
    renderSyncVersions([]);
    renderStatus('-', translate(currentLanguage, 'never'), error.message || translate(currentLanguage, 'actionFailed'));
  }
}

async function handleLanguageToggle() {
  currentLanguage = currentLanguage === 'zh' ? 'en' : 'zh';
  applyLanguage(currentLanguage);
  await saveSettings({ language: currentLanguage });
}

async function handleAutoSyncChange() {
  const canAutoSync = isAutoSyncCapable(currentSettings?.syncProvider || 'localFile');
  if (autoSyncCheckbox?.checked && (!canAutoSync || !hasConfiguredSyncProvider(currentSettings))) {
    setChecked(autoSyncCheckbox, false);
    await saveSettings({ autoSync: false });
    await refreshStatus(translate(currentLanguage, getSyncProviderRequiredKey(currentSettings)));
    return;
  }
  updateAutoSyncVisibility();
  await saveSettings({ autoSync: Boolean(autoSyncCheckbox?.checked) });
}

async function handleAutoCleanDuplicatesChange() {
  updateAutoSyncVisibility();
  await saveSettings({ autoCleanDuplicates: Boolean(autoCleanDuplicatesCheckbox?.checked) });
}

async function handleAutoCleanEmptyFoldersChange() {
  updateAutoSyncVisibility();
  await saveSettings({ autoCleanEmptyFolders: Boolean(autoCleanEmptyFoldersCheckbox?.checked) });
}

async function handleBookmarkSummaryAutoChange() {
  const enabled = Boolean(bookmarkSummaryAutoCheckbox?.checked);
  await saveSettings({
    bookmarkSummaryAutoEnabled: enabled,
    shadowIndexEnabled: enabled,
    bookmarkSummaryAutoAi: enabled,
    bookmarkSummaryAutoOffline: enabled,
  });
  await refreshBookmarkSummaryStatus();
}

async function handleSyncIntervalChange() {
  const minutes = Math.max(5, Number(syncIntervalInput?.value || 5));
  setValue(syncIntervalInput, minutes);
  await saveSettings({ syncIntervalMinutes: minutes });
}

async function handleCleanIntervalChange() {
  const minutes = Math.max(5, Number(cleanIntervalInput?.value || 5));
  setValue(cleanIntervalInput, minutes);
  await saveSettings({ cleanIntervalMinutes: minutes });
}

async function handleDownloadModeChange() {
  if (!hasConfiguredSyncProvider(currentSettings)) {
    setValue(downloadModeSelect, currentSettings?.downloadMode || 'safe');
    await refreshStatus(translate(currentLanguage, getSyncProviderRequiredKey(currentSettings)));
    return;
  }
  await saveSettings({ downloadMode: downloadModeSelect?.value || 'safe' });
}

async function saveSettings(patch) {
  try {
    await sendMessage({ type: 'SAVE_SETTINGS', settings: patch });
    await refreshStatus(translate(currentLanguage, 'settingsUpdated'));
    return true;
  } catch (error) {
    await refreshStatus(error.message || translate(currentLanguage, 'actionFailed'));
    return false;
  }
}

async function handleExportLocalFile() {
  await runAction('UPLOAD_NOW', { syncProvider: 'localFile' });
}

async function handleImportLocalFile(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  setBusy(true);
  setText(statusEl, translate(currentLanguage, 'importingLocalFile'));
  try {
    const text = await file.text();
    const snapshot = JSON.parse(text);
    const result = await sendMessage({
      type: 'IMPORT_LOCAL_FILE_SNAPSHOT',
      snapshot,
      downloadMode: downloadModeSelect?.value || currentSettings?.downloadMode || 'safe',
    });
    await refreshStatus(formatActionResult(result));
  } catch (error) {
    await refreshStatus(error.message || translate(currentLanguage, 'localFileImportFailed'));
  } finally {
    if (localFileInput) localFileInput.value = '';
    setBusy(false);
  }
}

async function runAction(type, overrideSettings = null) {
  if (isSyncAction(type) && !hasActiveSyncProvider(type, overrideSettings)) {
    await refreshStatus(translate(currentLanguage, getSyncProviderRequiredKey(currentSettings)));
    return;
  }

  setBusy(true);
  setText(statusEl, translate(currentLanguage, 'running'));
  try {
    const message = type === 'DOWNLOAD_NOW'
      ? { type, downloadMode: downloadModeSelect?.value || currentSettings?.downloadMode || 'safe' }
      : { type };
    if (overrideSettings) message.settings = overrideSettings;
    const result = await sendMessage(message);
    await refreshStatus(formatActionResult(result));
  } catch (error) {
    await refreshStatus(error.message || translate(currentLanguage, 'actionFailed'));
  } finally {
    setBusy(false);
  }
}

function applyLanguage(language) {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = translate(language, 'appTitle');

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = translate(language, element.dataset.i18n);
  }

  for (const element of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of element.dataset.i18nAttr.split(';')) {
      const [attribute, key] = pair.split(':');
      if (attribute && key) element.setAttribute(attribute, translate(language, key));
    }
  }

  if (languageToggleBtn) languageToggleBtn.setAttribute('aria-label', translate(language, 'switchLanguage'));
  if (languageToggleText) languageToggleText.textContent = language === 'zh' ? 'EN' : '中文';
  if (openSettingsLink) {
    openSettingsLink.setAttribute('aria-label', translate(language, 'openSettings'));
    openSettingsLink.setAttribute('title', translate(language, 'openSettings'));
  }

  renderSearchBootstrapState();
  renderSyncVersions();
  bindCursorFollowTooltips();
}

function renderStatus(syncStatus, lastSync, temporaryMessage = '') {
  if (!statusEl) return;
  const parts = [];
  if (temporaryMessage) parts.push(temporaryMessage);
  parts.push(`${translate(currentLanguage, 'currentStatus')}: ${syncStatus || '-'}`);
  parts.push(`${translate(currentLanguage, 'lastSync')}: ${lastSync || translate(currentLanguage, 'never')}`);
  statusEl.textContent = parts.join('\n');
}

function renderSyncVersions(versions = syncVersionItems) {
  syncVersionItems = Array.isArray(versions) ? versions : [];
  if (syncVersionCount) syncVersionCount.textContent = String(syncVersionItems.length);
  if (!syncVersionList) return;
  syncVersionList.classList.toggle('empty-state', syncVersionItems.length === 0);
  if (!syncVersionItems.length) {
    syncVersionList.textContent = translate(currentLanguage, 'syncVersionNoRecords');
    return;
  }

  syncVersionList.replaceChildren(...syncVersionItems.slice(0, 8).map((item) => {
    const row = document.createElement('article');
    row.className = 'sync-version-item';

    const title = document.createElement('strong');
    title.textContent = getSyncProviderLabel(item.provider) + ' · ' + translate(currentLanguage, getSyncActionKey(item.action));

    const meta = document.createElement('p');
    meta.className = 'muted';
    const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString() : '-';
    const shortEtag = item.etag ? String(item.etag).slice(0, 8) : '';
    meta.textContent = [createdAt, item.exportedAt || '-', shortEtag].filter(Boolean).join(' · ');

    if (item.versionUrl) {
      const link = document.createElement('a');
      link.href = item.versionUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = translate(currentLanguage, 'syncVersionOpenRemote');
      row.append(title, meta, link);
      return row;
    }

    row.append(title, meta);
    return row;
  }));
}

function getSyncProviderLabel(provider) {
  const keyMap = {
    webdav: 'syncProviderWebdav',
    localFile: 'syncProviderLocalFile',
    github: 'syncProviderGithub',
    gitee: 'syncProviderGitee',
  };
  return translate(currentLanguage, keyMap[provider] || 'syncProviderWebdav');
}

function getSyncActionKey(action) {
  if (action === 'upload') return 'syncActionUpload';
  if (action === 'download') return 'syncActionDownload';
  if (action === 'import') return 'syncActionImport';
  return 'syncActionSync';
}

function formatActionResult(result) {
  if (!result) return translate(currentLanguage, 'actionNoResponse');
  if (result.i18nKey) return translate(currentLanguage, result.i18nKey, result.params || {});
  if (result.ok) return result.message || translate(currentLanguage, 'actionCompleted');
  return result.error || translate(currentLanguage, 'actionFailed');
}

function isAutoSyncCapable(provider) {
  return provider === 'webdav' || provider === 'github' || provider === 'gitee';
}

function getProviderActionVisibility(provider) {
  if (provider === 'localFile') {
    return { smart: false, upload: false, download: false, export: true, import: true, mode: true, auto: false };
  }
  if (provider === 'github' || provider === 'gitee') {
    return { smart: true, upload: true, download: true, export: false, import: false, mode: true, auto: true };
  }
  return { smart: true, upload: true, download: true, export: false, import: false, mode: true, auto: true };
}

function updateAutoSyncVisibility() {
  const provider = currentSettings?.syncProvider || 'localFile';
  const visibility = getProviderActionVisibility(provider);
  if (syncIntervalControl) syncIntervalControl.hidden = !visibility.auto;
  if (cleanIntervalControl) cleanIntervalControl.hidden = false;
  if (autoCleanEmptyFoldersControl) autoCleanEmptyFoldersControl.hidden = false;
  if (autoSyncCheckbox) autoSyncCheckbox.disabled = !visibility.auto || !hasConfiguredSyncProvider(currentSettings);
  if (syncIntervalInput) syncIntervalInput.disabled = !visibility.auto || !hasConfiguredSyncProvider(currentSettings) || !Boolean(autoSyncCheckbox?.checked);
  if (cleanIntervalInput) cleanIntervalInput.disabled = !Boolean(autoCleanDuplicatesCheckbox?.checked) && !Boolean(autoCleanEmptyFoldersCheckbox?.checked);
  if (downloadModeSelect) downloadModeSelect.closest('label')?.toggleAttribute('hidden', !visibility.mode);
}

function switchModule(moduleName) {
  const activeModule = MODULE_NAMES.includes(moduleName) ? moduleName : 'search';
  for (const [name, panel] of Object.entries(modulePanels)) {
    if (panel) panel.hidden = name !== activeModule;
  }
  for (const tab of moduleTabs) {
    tab.classList.toggle('active', tab.dataset.moduleTab === activeModule);
  }
  if (activeModule === 'summary') refreshBookmarkSummaryStatus().catch(() => {});
}

function hasWebdavConfig(settings) {
  return Boolean(settings?.webdavUrl && settings?.remoteFile);
}

function hasGitProviderConfig(settings, provider) {
  const prefix = provider === 'gitee' ? 'gitee' : 'github';
  return Boolean(
    settings?.[`${prefix}Token`] &&
    settings?.[`${prefix}Owner`] &&
    settings?.[`${prefix}Repo`] &&
    settings?.[`${prefix}Branch`] &&
    settings?.[`${prefix}FilePath`]
  );
}

function hasConfiguredSyncProvider(settings) {
  const provider = settings?.syncProvider || 'localFile';
  if (provider === 'webdav') return hasWebdavConfig(settings);
  if (provider === 'github' || provider === 'gitee') return hasGitProviderConfig(settings, provider);
  if (provider === 'localFile') return true;
  return false;
}

function getSyncProviderRequiredKey(settings) {
  const provider = settings?.syncProvider || 'localFile';
  if (provider === 'localFile') return 'localFileManualOnly';
  if (provider === 'github') return 'gitProviderRequiredGithub';
  if (provider === 'gitee') return 'gitProviderRequiredGitee';
  return 'webdavRequiredForSync';
}

function hasActiveSyncProvider(type, overrideSettings = null) {
  const provider = overrideSettings?.syncProvider || currentSettings?.syncProvider || 'localFile';
  if (provider === 'localFile') return type === 'UPLOAD_NOW';
  if (provider === 'github' || provider === 'gitee') return hasGitProviderConfig(currentSettings, provider);
  return hasWebdavConfig(currentSettings);
}

function isSyncAction(type) {
  return ['SYNC_NOW', 'UPLOAD_NOW', 'DOWNLOAD_NOW'].includes(type);
}

function updateSyncAvailability() {
  const provider = currentSettings?.syncProvider || 'localFile';
  const visibility = getProviderActionVisibility(provider);
  const configured = hasConfiguredSyncProvider(currentSettings);
  if (webdavNotice) webdavNotice.hidden = configured;

  const actionButtons = [
    [syncNowBtn, 'smart'],
    [uploadNowBtn, 'upload'],
    [downloadNowBtn, 'download'],
    [exportLocalFileBtn, 'export'],
    [importLocalFileBtn, 'import'],
  ];

  for (const [button, key] of actionButtons) {
    if (!button) continue;
    button.hidden = !visibility[key];
    button.disabled = !configured && !['export', 'import'].includes(key);
  }

  if (autoSyncCheckbox) autoSyncCheckbox.disabled = !visibility.auto || !configured;
  if (syncIntervalInput) syncIntervalInput.disabled = !visibility.auto || !configured || !Boolean(autoSyncCheckbox?.checked);
  if (downloadModeSelect) downloadModeSelect.disabled = !visibility.mode || !configured;
}

function setBusy(isBusy) {
  const provider = currentSettings?.syncProvider || 'localFile';
  const visibility = getProviderActionVisibility(provider);
  const configured = hasConfiguredSyncProvider(currentSettings);
  const busyButtons = [cleanAllNowBtn, cleanDuplicatesNowBtn, cleanEmptyFoldersNowBtn, openInvalidCleanerBtn, languageToggleBtn, bookmarkSearchButton].filter(Boolean);
  for (const button of busyButtons) {
    button.disabled = isBusy;
  }

  const actionButtons = [
    [syncNowBtn, 'smart'],
    [uploadNowBtn, 'upload'],
    [downloadNowBtn, 'download'],
    [exportLocalFileBtn, 'export'],
    [importLocalFileBtn, 'import'],
  ];
  for (const [button, key] of actionButtons) {
    if (!button) continue;
    button.hidden = !visibility[key];
    button.disabled = isBusy || (!configured && !['export', 'import'].includes(key));
  }

  if (autoSyncCheckbox) autoSyncCheckbox.disabled = isBusy || !visibility.auto || !configured;
  if (autoCleanDuplicatesCheckbox) autoCleanDuplicatesCheckbox.disabled = isBusy;
  if (autoCleanEmptyFoldersCheckbox) autoCleanEmptyFoldersCheckbox.disabled = isBusy;
  if (bookmarkSummaryAutoCheckbox) bookmarkSummaryAutoCheckbox.disabled = isBusy;
  if (bookmarkSearchInput) bookmarkSearchInput.disabled = isBusy;
  if (syncIntervalInput) syncIntervalInput.disabled = isBusy || !visibility.auto || !configured || !Boolean(autoSyncCheckbox?.checked);
  if (cleanIntervalInput) cleanIntervalInput.disabled = isBusy;
  if (downloadModeSelect) downloadModeSelect.disabled = isBusy || !visibility.mode || !configured;
}

async function handleBookmarkSearch() {
  const query = String(bookmarkSearchInput?.value || '').trim();
  if (!query) {
    renderSearchBootstrapState();
    return;
  }

  if (bookmarkSearchButton) bookmarkSearchButton.disabled = true;
  if (bookmarkSearchResults) {
    bookmarkSearchResults.classList.add('empty-state');
    bookmarkSearchResults.textContent = translate(currentLanguage, 'bookmarkSearchRunning');
  }
  try {
    const bootstrapResults = searchBootstrapReady ? buildBootstrapSearchResults(query) : [];
    if (bootstrapResults.length) {
      renderBookmarkSearchResults(bootstrapResults);
      return;
    }
    const result = await sendMessage({ type: 'SEARCH_BOOKMARKS', query });
    renderBookmarkSearchResults(result.results || []);
  } catch (error) {
    if (bookmarkSearchResults) bookmarkSearchResults.textContent = error.message || translate(currentLanguage, 'actionFailed');
  } finally {
    if (bookmarkSearchButton) bookmarkSearchButton.disabled = false;
  }
}

function renderBookmarkSearchResults(results) {
  if (bookmarkSearchCount) bookmarkSearchCount.textContent = String(results.length);
  if (!bookmarkSearchResults) return;
  bookmarkSearchResults.classList.toggle('empty-state', results.length === 0);
  if (!results.length) {
    bookmarkSearchResults.textContent = translate(currentLanguage, 'bookmarkSearchNoResults');
    return;
  }

  bookmarkSearchResults.replaceChildren(...results.map((item) => {
    const row = document.createElement('article');
    row.className = 'bookmark-search-item';

    const title = document.createElement('strong');
    title.textContent = item.title || translate(currentLanguage, 'untitledBookmark');

    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = item.url;

    const matchedLines = createBookmarkSearchMatchLines(item);
    const related = Array.isArray(item.matchedTerms) ? item.matchedTerms.filter((term) => Array.isArray(item.expandedTerms) && item.expandedTerms.includes(term)) : [];
    if (related.length) {
      const chips = document.createElement('div');
      chips.className = 'semantic-chip-row';
      for (const term of related.slice(0, 6)) {
        const chip = document.createElement('span');
        chip.className = 'semantic-chip';
        chip.textContent = term;
        chips.append(chip);
      }
      row.append(title, link, matchedLines, chips);
      return row;
    }

    row.append(title, link, matchedLines);
    return row;
  }));
}

function createBookmarkSearchMatchLines(item) {
  const box = document.createElement('div');
  box.className = 'bookmark-search-match-lines';
  const lines = Array.isArray(item.matchLines) ? item.matchLines : [];
  const fallbackLines = [
    item.folderPath ? { label: translate(currentLanguage, 'summaryFolder'), text: item.folderPath } : null,
    item.matchExcerpt ? { label: translate(currentLanguage, 'searchMatchedContent'), text: item.matchExcerpt } : null,
  ].filter(Boolean);

  for (const line of (lines.length ? lines : fallbackLines).slice(0, 4)) {
    const row = document.createElement('p');
    row.className = 'bookmark-search-match-line';
    const label = document.createElement('span');
    label.className = 'bookmark-search-match-label';
    label.textContent = line.label || '';
    const text = document.createElement('span');
    text.className = 'bookmark-search-match-text';
    text.textContent = line.text || '';
    row.append(label, text);
    box.append(row);
  }

  if (!box.children.length) {
    const row = document.createElement('p');
    row.className = 'bookmark-search-match-line';
    const label = document.createElement('span');
    label.className = 'bookmark-search-match-label';
    label.textContent = translate(currentLanguage, 'searchMatchedContent');
    const text = document.createElement('span');
    text.className = 'bookmark-search-match-text';
    text.textContent = item.summary || item.category || '';
    row.append(label, text);
    box.append(row);
  }

  return box;
}

async function refreshBookmarkSummaryStatus() {
  try {
    const result = await sendMessage({ type: 'GET_BOOKMARK_SUMMARY_STATUS' });
    renderBookmarkSummaryStatus(result);
  } catch (_error) {
    // Summary status is optional for the popup; keep existing modules usable if it fails.
  }
}

function renderBookmarkSummaryStatus(status) {
  if (!status?.ok) return;
  setChecked(bookmarkSummaryAutoCheckbox, Boolean(status.autoEnabled));
  if (summaryEngine) summaryEngine.textContent = getSummaryEngineLabel(status.engine || 'textrank');
  const shadow = status.shadowIndex;
  const isRunning = Boolean(status.running || shadow?.running || shadow?.pending > 0);
  if (bookmarkSummaryRunning) {
    bookmarkSummaryRunning.textContent = translate(currentLanguage, isRunning ? 'bookmarkSummaryRunning' : 'bookmarkSummaryIdle');
    bookmarkSummaryRunning.classList.toggle('is-running', isRunning);
  }
  if (summaryUpdatedAt) {
    summaryUpdatedAt.textContent = status.latestUpdatedAt
      ? `${translate(currentLanguage, 'summaryLastUpdated')}: ${new Date(status.latestUpdatedAt).toLocaleString()}`
      : translate(currentLanguage, 'summaryNeverUpdated');
  }
}

function getSummaryEngineLabel(engine) {
  const normalized = String(engine || 'textrank');
  if (normalized.includes('customOpenai')) return translate(currentLanguage, 'summaryModeCustomOpenaiActive');
  if (normalized.includes('customAnthropic')) return translate(currentLanguage, 'summaryModeCustomAnthropicActive');
  if (normalized.includes('geminiNano')) return translate(currentLanguage, 'summaryModeGeminiNanoActive');
  if (normalized.includes('transformer')) return translate(currentLanguage, 'summaryModeTransformerActive');
  if (normalized.includes('pending')) return translate(currentLanguage, 'summaryModeTextRankFallback');
  if (normalized === 'textrank' || normalized === 'offline') return translate(currentLanguage, 'summaryModeTextRank');
  return normalized;
}

function bindCursorFollowTooltips() {
  const targets = Array.from(document.querySelectorAll('[data-tooltip]'));
  if (!floatingTooltipEl) {
    floatingTooltipEl = document.querySelector('.cursor-follow-tooltip');
    if (!floatingTooltipEl) {
      floatingTooltipEl = document.createElement('div');
      floatingTooltipEl.className = 'cursor-follow-tooltip';
      floatingTooltipEl.hidden = true;
      document.body.append(floatingTooltipEl);
    }
  }

  for (const target of targets) {
    if (target.dataset.tooltipBound === 'true') continue;
    target.addEventListener('mouseenter', (event) => showFloatingTooltip(target, event));
    target.addEventListener('mousemove', (event) => updateFloatingTooltipPosition(event));
    target.addEventListener('mouseleave', hideFloatingTooltip);
    target.addEventListener('focus', () => showFloatingTooltip(target));
    target.addEventListener('blur', hideFloatingTooltip);
    target.dataset.tooltipBound = 'true';
  }
}

function showFloatingTooltip(target, event) {
  const text = target?.dataset?.tooltip;
  if (!floatingTooltipEl || !text) {
    hideFloatingTooltip();
    return;
  }
  activeTooltipTarget = target;
  floatingTooltipEl.textContent = text;
  floatingTooltipEl.hidden = false;
  requestAnimationFrame(() => {
    if (!floatingTooltipEl || activeTooltipTarget !== target) return;
    floatingTooltipEl.classList.add('is-visible');
    if (event) {
      updateFloatingTooltipPosition(event);
      return;
    }
    const rect = target.getBoundingClientRect();
    updateFloatingTooltipPosition({ clientX: rect.right + 8, clientY: rect.top + rect.height / 2 });
  });
}

function hideFloatingTooltip() {
  activeTooltipTarget = null;
  if (!floatingTooltipEl) return;
  floatingTooltipEl.classList.remove('is-visible');
  floatingTooltipEl.hidden = true;
}

function updateFloatingTooltipPosition(event) {
  if (!floatingTooltipEl || floatingTooltipEl.hidden || !event) return;
  const offsetX = 14;
  const offsetY = 16;
  const padding = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const tooltipRect = floatingTooltipEl.getBoundingClientRect();

  let left = event.clientX + offsetX;
  let top = event.clientY + offsetY;

  if (left + tooltipRect.width + padding > viewportWidth) {
    left = Math.max(padding, event.clientX - tooltipRect.width - offsetX);
  }
  if (top + tooltipRect.height + padding > viewportHeight) {
    top = Math.max(padding, event.clientY - tooltipRect.height - offsetY);
  }

  floatingTooltipEl.style.left = `${left}px`;
  floatingTooltipEl.style.top = `${top}px`;
}

async function preloadBookmarkSearchItems() {
  try {
    const result = await sendMessage({ type: 'GET_BOOKMARK_SEARCH_BOOTSTRAP' });
    searchBootstrapItems = Array.isArray(result?.items) ? result.items : [];
    searchBootstrapReady = true;
    searchBootstrapError = '';
  } catch (error) {
    searchBootstrapItems = [];
    searchBootstrapReady = false;
    searchBootstrapError = error.message || '';
  }
  renderSearchBootstrapState();
}

function renderSearchBootstrapState() {
  const currentQuery = String(bookmarkSearchInput?.value || '').trim();
  if (currentQuery) return;
  if (bookmarkSearchCount) bookmarkSearchCount.textContent = String(searchBootstrapItems.length || 0);
  if (!bookmarkSearchResults) return;
  bookmarkSearchResults.classList.add('empty-state');
  if (searchBootstrapReady) {
    bookmarkSearchResults.textContent = translate(currentLanguage, 'bookmarkSearchReady', {
      count: String(searchBootstrapItems.length || 0),
    });
    return;
  }
  bookmarkSearchResults.textContent = searchBootstrapError || translate(currentLanguage, 'bookmarkSearchLoadingAll');
}

function buildBootstrapSearchResults(query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  return searchBootstrapItems
    .map((item) => {
      const title = String(item.title || '');
      const url = String(item.url || '');
      const folderPath = String(item.folderPath || '');
      const address = [title, url, folderPath].join(' ');
      const normalizedAddress = normalizeSearchText(address);
      if (!normalizedAddress.includes(normalizedQuery)) return null;
      return {
        id: item.id,
        title: title || translate(currentLanguage, 'untitledBookmark'),
        url,
        folderPath,
        summary: '',
        matchLines: [
          folderPath ? { label: translate(currentLanguage, 'summaryFolder'), text: folderPath } : null,
          { label: translate(currentLanguage, 'searchMatchedContent'), text: buildSearchMatchExcerpt(address, normalizedQuery) },
        ].filter(Boolean),
        matchedTerms: [normalizedQuery],
        expandedTerms: [],
        score: title && normalizeSearchText(title).includes(normalizedQuery) ? 100 : 60,
        dateAdded: item.dateAdded || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || ((Number(b.dateAdded) || 0) - (Number(a.dateAdded) || 0)))
    .slice(0, 50);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function buildSearchMatchExcerpt(text, normalizedQuery) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const normalizedSource = normalizeSearchText(source);
  const index = normalizedSource.indexOf(normalizedQuery);
  if (index < 0) return source.slice(0, 160);
  const start = Math.max(0, index - 52);
  const end = Math.min(source.length, index + 108);
  return `${start > 0 ? '...' : ''}${source.slice(start, end)}${end < source.length ? '...' : ''}`;
}

function openSettingsPage(tab) {
  const suffix = tab ? `#${tab}` : '';
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${suffix}`) });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || translate(currentLanguage, 'actionFailed')));
        return;
      }
      if (response?.ok === false && response.error) {
        reject(new Error(response.error));
        return;
      }
      if (typeof response === 'undefined') {
        reject(new Error(translate(currentLanguage, 'actionNoResponse')));
        return;
      }
      resolve(response);
    });
  });
}

function createFallbackSettings() {
  if (typeof sanitizeSettings === 'function' && typeof DEFAULT_SETTINGS !== 'undefined') {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
  if (typeof DEFAULT_SETTINGS !== 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    syncProvider: 'localFile',
    language: 'zh',
    syncIntervalMinutes: 30,
    cleanIntervalMinutes: 30,
    autoSync: false,
    autoCleanDuplicates: false,
    autoCleanEmptyFolders: false,
    bookmarkSummaryAutoEnabled: false,
    downloadMode: 'safe',
    webdavUrl: '',
    remoteFile: 'chrome-bookmarks.json',
  };
}

function sanitizePopupSettings(settings) {
  if (typeof sanitizeSettings === 'function') {
    return sanitizeSettings(settings || createFallbackSettings());
  }
  return { ...createFallbackSettings(), ...(settings || {}) };
}

function normalizePopupLanguage(language) {
  if (typeof normalizeLanguage === 'function') {
    return normalizeLanguage(language);
  }
  return language === 'en' ? 'en' : 'zh';
}

function safeAddEventListener(element, eventName, handler) {
  if (element) element.addEventListener(eventName, handler);
}

function setValue(element, value) {
  if (element) element.value = value;
}

function setChecked(element, checked) {
  if (element) element.checked = Boolean(checked);
}

function setText(element, value) {
  if (element) element.textContent = value;
}
