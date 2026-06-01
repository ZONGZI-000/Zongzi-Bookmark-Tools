const timeoutInput = document.querySelector('#timeoutSeconds');
const timeoutControlEl = document.querySelector('#timeoutControl');
const scanBtn = document.querySelector('#scanInvalidBookmarks');
const selectAllBtn = document.querySelector('#selectAllInvalid');
const clearSelectionBtn = document.querySelector('#clearInvalidSelection');
const deleteSelectedBtn = document.querySelector('#deleteSelectedInvalid');
const statusEl = document.querySelector('#invalidStatus');
const statusTextEl = document.querySelector('#invalidStatusText');
const scanProgressEl = document.querySelector('#scanProgress');
const scanProgressBarEl = document.querySelector('#scanProgressBar');
const scanProgressValueEl = document.querySelector('#scanProgressValue');
const scanProgressTextEl = document.querySelector('#scanProgressText');
const scanStatsEl = document.querySelector('#scanStats');
const scanStatTotalEl = document.querySelector('#scanStatTotal');
const scanStatCheckedEl = document.querySelector('#scanStatChecked');
const scanStatInvalidEl = document.querySelector('#scanStatInvalid');
const scanStatTimeoutEl = document.querySelector('#scanStatTimeout');
const summaryEl = document.querySelector('#invalidSummary');
const kindSelectorsEl = document.querySelector('#invalidKindSelectors');
const resultsSection = document.querySelector('#invalidResultsSection');
const resultsEl = document.querySelector('#invalidResults');
const carryCredentialsInput = document.querySelector('#carryCredentialsForInvalid');
const invalidCleanerPanel = document.querySelector('#invalidCleanerPanel');
const cleanRecordsPanel = document.querySelector('#cleanRecordsPanel');
const cleanRecordsListEl = document.querySelector('#cleanRecordsList');
const cleanRecordRetentionInput = document.querySelector('#cleanRecordRetentionDays');
const cleanTabButtons = [...document.querySelectorAll('.clean-tab')];

let currentLanguage = 'zh';
let currentSettings = null;
let currentCleanTab = 'invalid';
let invalidItems = [];
let selectedIds = new Set();
let autoSelectKinds = new Set();
let manualDeselectedIds = new Set();
let pinnedSelectedIds = new Set();
let deletedInvalidIds = new Set();
let progressTimer = null;
let isScanPaused = false;
let pendingControlAction = null;
let currentScanSessionId = null;
let pendingScanSessionId = null;
let currentProgressSnapshot = { current: 0, total: 0, issueCount: 0 };
let cleanRecords = [];
let floatingTooltipEl = null;
let activeTooltipTarget = null;

const INVALID_KIND_ORDER = [
  'not_found',
  'server_error',
  'bad_gateway',
  'service_unavailable',
  'gateway_timeout',
  'timeout',
  'network_error',
  'rate_limited',
  'forbidden',
  'certificate_error',
  'unsupported_protocol',
  'failed',
];

const INVALID_KIND_META = {
  not_found: { labelKey: 'kindNotFound', className: 'reason-high-confidence', confidenceKey: 'confidenceHigh', confidenceClass: 'confidence-high' },
  server_error: { labelKey: 'kindServerError', className: 'reason-medium-confidence', confidenceKey: 'confidenceMedium', confidenceClass: 'confidence-medium' },
  bad_gateway: { labelKey: 'kindBadGateway', className: 'reason-medium-confidence', confidenceKey: 'confidenceMedium', confidenceClass: 'confidence-medium' },
  service_unavailable: { labelKey: 'kindServiceUnavailable', className: 'reason-medium-confidence', confidenceKey: 'confidenceMedium', confidenceClass: 'confidence-medium' },
  gateway_timeout: { labelKey: 'kindGatewayTimeout', className: 'reason-medium-confidence', confidenceKey: 'confidenceMedium', confidenceClass: 'confidence-medium' },
  timeout: { labelKey: 'kindTimeout', className: 'reason-medium-confidence', confidenceKey: 'confidenceMedium', confidenceClass: 'confidence-medium' },
  network_error: { labelKey: 'kindNetworkError', className: 'reason-medium-confidence', confidenceKey: 'confidenceMedium', confidenceClass: 'confidence-medium' },
  rate_limited: { labelKey: 'kindRateLimited', className: 'reason-low-confidence', confidenceKey: 'confidenceLow', confidenceClass: 'confidence-low' },
  forbidden: { labelKey: 'kindForbidden', className: 'reason-low-confidence', confidenceKey: 'confidenceLow', confidenceClass: 'confidence-low' },
  certificate_error: { labelKey: 'kindCertificateError', className: 'reason-low-confidence', confidenceKey: 'confidenceLow', confidenceClass: 'confidence-low' },
  unsupported_protocol: { labelKey: 'kindUnsupportedProtocol', className: 'reason-low-confidence', confidenceKey: 'confidenceLow', confidenceClass: 'confidence-low' },
  failed: { labelKey: 'kindOtherError', className: 'reason-low-confidence', confidenceKey: 'confidenceLow', confidenceClass: 'confidence-low' },
};

init();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.settings?.newValue) {
    currentSettings = changes.settings.newValue;
    currentLanguage = normalizeLanguage(currentSettings.language);
    timeoutInput.value = currentSettings.invalidTimeoutSeconds;
    carryCredentialsInput.checked = Boolean(currentSettings.carryCredentialsForInvalid);
    applyLanguage(currentLanguage);
    bindCursorFollowTooltips();
    setStatusMessage('invalidReady');
    renderResults();
  }

  if (changes.cleanRecords?.newValue) {
    cleanRecords = Array.isArray(changes.cleanRecords.newValue) ? changes.cleanRecords.newValue : [];
    renderCleanRecords();
  }
});

async function init() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    currentSettings = status.settings;
    currentLanguage = normalizeLanguage(currentSettings.language);
    timeoutInput.value = currentSettings.invalidTimeoutSeconds;
    carryCredentialsInput.checked = Boolean(currentSettings.carryCredentialsForInvalid);
    cleanRecordRetentionInput.value = currentSettings.cleanRecordRetentionDays;
    applyLanguage(currentLanguage);
    bindCursorFollowTooltips();
    await loadCleanRecords();
  } catch (error) {
    setStatusMessage(error.message || 'Failed to load settings.', { isRaw: true });
  }

  scanBtn.addEventListener('click', handleScanButtonClick);
  selectAllBtn.addEventListener('click', handleSelectAll);
  clearSelectionBtn.addEventListener('click', handleClearSelection);
  deleteSelectedBtn.addEventListener('click', () => deleteByMode('selected'));
  timeoutInput.addEventListener('change', handleTimeoutChange);
  carryCredentialsInput.addEventListener('change', handleCarryCredentialsChange);
  cleanRecordRetentionInput.addEventListener('change', handleCleanRecordRetentionChange);
  for (const button of cleanTabButtons) {
    button.addEventListener('click', () => switchCleanTab(button.dataset.cleanTab));
  }
}

async function switchCleanTab(tab) {
  currentCleanTab = tab === 'records' ? 'records' : 'invalid';
  for (const button of cleanTabButtons) {
    const isActive = button.dataset.cleanTab === currentCleanTab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }

  invalidCleanerPanel.hidden = currentCleanTab !== 'invalid';
  cleanRecordsPanel.hidden = currentCleanTab !== 'records';
  resultsSection.hidden = currentCleanTab !== 'invalid' || !invalidItems.length;

  if (currentCleanTab === 'records') {
    await loadCleanRecords();
    renderCleanRecords();
  }
}

async function handleCarryCredentialsChange() {
  await saveSettings({ carryCredentialsForInvalid: carryCredentialsInput.checked });
}

async function handleTimeoutChange() {
  const timeout = normalizeTimeout(timeoutInput.value);
  timeoutInput.value = timeout;
  await saveSettings({ invalidTimeoutSeconds: timeout });
}

async function handleCleanRecordRetentionChange() {
  const days = normalizeRetentionDays(cleanRecordRetentionInput.value);
  cleanRecordRetentionInput.value = days;
  await saveSettings({ cleanRecordRetentionDays: days });
  await loadCleanRecords();
  renderCleanRecords();
}

async function handleScanButtonClick() {
  if (progressTimer) {
    await handlePauseToggle();
    return;
  }
  await handleScan();
}

async function handleScan() {
  const timeout = normalizeTimeout(timeoutInput.value);
  timeoutInput.value = timeout;
  await saveSettings({
    invalidTimeoutSeconds: timeout,
    carryCredentialsForInvalid: carryCredentialsInput.checked,
  }, false);
  setBusy(true);
  updateScanStats(0, 0);
  currentProgressSnapshot = { current: 0, total: 0, issueCount: 0 };
  isScanPaused = false;
  currentScanSessionId = null;
  pendingScanSessionId = `pending-${Date.now()}`;
  updateScanButton();
  invalidItems = [];
  selectedIds = new Set();
  manualDeselectedIds = new Set();
  pinnedSelectedIds = new Set();
  deletedInvalidIds = new Set();
  renderResults();
  setStatusMessage('scanningInvalidBookmarks', { spinning: true });
  startProgressPolling();

  try {
    const result = await chrome.runtime.sendMessage({ type: 'SCAN_INVALID_BOOKMARKS', timeoutSeconds: timeout });
    if (!result?.ok) {
      setStatusMessage(result?.error || translate(currentLanguage, 'actionFailed'), { isRaw: true });
      return;
    }

    currentScanSessionId = result.sessionId || currentScanSessionId;
    pendingScanSessionId = null;
    invalidItems = result.items || [];
    applyAutoSelectionToItems(invalidItems);
    currentProgressSnapshot = {
      current: Number(result.total || 0),
      total: Number(result.total || 0),
      issueCount: invalidItems.length,
    };
    setStatusMessage('scanInvalidCompleted', {
      params: { total: result.total || 0, invalid: invalidItems.length },
    });
    renderProgress({ running: false, current: result.total || 0, total: result.total || 0, issueCount: invalidItems.length, done: true, sessionId: currentScanSessionId });
    renderResults();
  } catch (error) {
    setStatusMessage(error.message || translate(currentLanguage, 'actionFailed'), { isRaw: true });
  } finally {
    stopProgressPolling();
    setBusy(false);
    isScanPaused = false;
    pendingControlAction = null;
    currentScanSessionId = null;
    pendingScanSessionId = null;
    updateScanButton();
  }
}

async function handlePauseToggle() {
  const nextAction = isScanPaused ? 'running' : 'paused';
  pendingControlAction = nextAction;
  updateScanButton();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'SET_INVALID_SCAN_CONTROL', action: nextAction });
    if (!result?.ok) {
      pendingControlAction = null;
      updateScanButton();
      setStatusMessage(result?.error || translate(currentLanguage, 'actionFailed'), { isRaw: true });
      return;
    }
    setStatusMessage(nextAction === 'paused' ? 'scanPausedStatus' : 'scanningInvalidBookmarks', { spinning: nextAction !== 'paused' });
  } catch (error) {
    pendingControlAction = null;
    updateScanButton();
    setStatusMessage(error.message || translate(currentLanguage, 'actionFailed'), { isRaw: true });
  }
}

function updateScanButton() {
  pendingControlAction = null;
  if (progressTimer) {
    if (isScanPaused) {
      scanBtn.textContent = translate(currentLanguage, 'resumeScan');
    } else {
      scanBtn.textContent = translate(currentLanguage, pendingControlAction === 'paused' ? 'resumeScan' : 'pauseScan');
    }
    scanBtn.classList.add('secondary');
    scanBtn.disabled = Boolean(pendingControlAction);
    return;
  }

  pendingControlAction = null;
  scanBtn.textContent = translate(currentLanguage, 'scanInvalidBookmarks');
  scanBtn.classList.remove('secondary');
  scanBtn.disabled = false;
  setBusy(false);
}

function handleSelectAll() {
  for (const item of invalidItems) {
    selectedIds.add(item.id);
    pinnedSelectedIds.add(item.id);
    manualDeselectedIds.delete(item.id);
  }
  renderResults();
}

function handleClearSelection() {
  selectedIds = new Set();
  pinnedSelectedIds = new Set();
  autoSelectKinds = new Set();
  manualDeselectedIds = new Set(invalidItems.map((item) => item.id));
  renderResults();
}

function handleKindSelect(kind) {
  const normalizedKind = getKindMeta(kind) ? kind : 'failed';
  if (autoSelectKinds.has(normalizedKind)) {
    autoSelectKinds.delete(normalizedKind);
    for (const item of invalidItems) {
      if (normalizeInvalidKind(item.kind) === normalizedKind) {
        selectedIds.delete(item.id);
        pinnedSelectedIds.delete(item.id);
      }
    }
  } else {
    autoSelectKinds.add(normalizedKind);
    for (const item of invalidItems) {
      if (normalizeInvalidKind(item.kind) === normalizedKind) {
        selectedIds.add(item.id);
        pinnedSelectedIds.add(item.id);
        manualDeselectedIds.delete(item.id);
      }
    }
  }
  renderResults();
}

function getKindMeta(kind) {
  return INVALID_KIND_META[normalizeInvalidKind(kind)] || INVALID_KIND_META.failed;
}

function normalizeInvalidKind(kind) {
  return INVALID_KIND_META[kind] ? kind : 'failed';
}

function getKindCounts() {
  const counts = Object.fromEntries(INVALID_KIND_ORDER.map((kind) => [kind, 0]));
  for (const item of invalidItems) {
    const kind = normalizeInvalidKind(item.kind);
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

function applyAutoSelectionToItems(items) {
  for (const item of items) {
    if (autoSelectKinds.has(normalizeInvalidKind(item.kind)) && !manualDeselectedIds.has(item.id)) {
      selectedIds.add(item.id);
      pinnedSelectedIds.add(item.id);
    }
  }
}

function syncCheckboxSelection(id, checked) {
  if (checked) {
    selectedIds.add(id);
    pinnedSelectedIds.add(id);
    manualDeselectedIds.delete(id);
    return;
  }

  selectedIds.delete(id);
  pinnedSelectedIds.delete(id);
  manualDeselectedIds.add(id);
}

async function deleteByMode(mode) {
  const ids = getIdsForDeleteMode(mode);
  if (!ids.length && mode === 'selected') {
    setStatusMessage(translate(currentLanguage, 'noInvalidSelected'), { isRaw: true });
    return;
  }

  if (!ids.length) return;

  if (progressTimer && !isScanPaused) {
    setStatusMessage(translate(currentLanguage, 'pauseBeforeDelete'), { isRaw: true });
    return;
  }

  const itemsToDelete = getItemsByIds(ids);
  if (mode === 'selected' && !confirmDeleteItems(itemsToDelete)) return;

  setBusy(true);
  setStatusMessage(translate(currentLanguage, 'deletingInvalidBookmarks'), { isRaw: true });
  try {
    const result = await chrome.runtime.sendMessage({ type: 'DELETE_INVALID_BOOKMARKS', ids, items: itemsToDelete });
    if (!result?.ok && !result?.removed) {
      setStatusMessage(result?.error || translate(currentLanguage, 'actionFailed'), { isRaw: true });
      return;
    }

    const removedIds = new Set((result.removedIds || []).map(String));
    for (const id of removedIds) {
      deletedInvalidIds.add(id);
    }
    removeInvalidItemsByIds(removedIds);
    await loadCleanRecords();
    renderCleanRecords();
    setStatusMessage(result.failed ? 'invalidDeletedWithFailures' : 'invalidDeleted', {
      params: {
        count: result.removed || 0,
        failed: result.failed || 0,
      },
    });
    renderResults();
  } catch (error) {
    setStatusMessage(error.message || translate(currentLanguage, 'actionFailed'), { isRaw: true });
  } finally {
    setBusy(false);
  }
}

function removeInvalidItemsByIds(ids) {
  invalidItems = invalidItems.filter((item) => !ids.has(String(item.id)));
  for (const id of ids) {
    selectedIds.delete(id);
    pinnedSelectedIds.delete(id);
    manualDeselectedIds.delete(id);
  }
  currentProgressSnapshot.issueCount = invalidItems.length;
}

function getIdsForDeleteMode(mode) {
  if (mode !== 'selected') return [];

  const existingIds = new Set(invalidItems.map((item) => item.id));
  return [...selectedIds].filter((id) => existingIds.has(id));
}

function getItemsByIds(ids) {
  const idSet = new Set(ids);
  return invalidItems.filter((item) => idSet.has(item.id));
}

function confirmDeleteItems(items) {
  const lowConfidenceCount = items.filter((item) => getKindMeta(item.kind).confidenceKey === 'confidenceLow').length;
  const messageKey = lowConfidenceCount ? 'confirmDeleteSelectedWithRisk' : 'confirmDeleteSelected';
  return window.confirm(translate(currentLanguage, messageKey, {
    count: items.length,
    low: lowConfidenceCount,
  }));
}

function startProgressPolling() {
  stopProgressPolling();
  scanProgressEl.hidden = false;
  progressTimer = setInterval(async () => {
    try {
      const progress = await chrome.runtime.sendMessage({ type: 'GET_INVALID_SCAN_PROGRESS' });
      if (!isProgressRelevant(progress)) return;
      if (Array.isArray(progress?.issueItems)) addInvalidItems(progress.issueItems);
      else if (progress?.latestItem) addInvalidItem(progress.latestItem);
      if (progress?.networkWarning) showNetworkWarning(progress);
      renderProgress(progress);
    } catch (_error) {
      // Ignore transient background wake-up errors while the scan request is active.
    }
  }, 500);
  renderProgress({ running: true, current: 0, total: 0, issueCount: 0, currentUrl: '', currentTitle: '', sessionId: pendingScanSessionId });
  updateScanButton();
}

function stopProgressPolling() {
  if (!progressTimer) return;
  clearInterval(progressTimer);
  progressTimer = null;
  updateScanButton();
}

function isProgressRelevant(progress) {
  if (!progress) return false;
  if (!progress.running && !progress.done && !progress.paused) return false;

  const progressSessionId = typeof progress.sessionId === 'string' ? progress.sessionId : '';
  if (!currentScanSessionId && progressSessionId && !progressSessionId.startsWith('pending-')) {
    currentScanSessionId = progressSessionId;
    pendingScanSessionId = null;
    currentProgressSnapshot = { current: 0, total: 0, issueCount: 0 };
  }

  if (currentScanSessionId && progressSessionId && progressSessionId !== currentScanSessionId) return false;
  if (currentScanSessionId && !progressSessionId) return false;
  if (currentScanSessionId && Number(progress.current || 0) < currentProgressSnapshot.current) return false;

  return true;
}

function renderProgress(progress) {
  const total = Number(progress?.total || 0);
  const current = Number(progress?.current || 0);
  const issueCount = Number(progress?.issueCount ?? invalidItems.length);
  const safeCurrent = Math.max(currentProgressSnapshot.current, current);
  const safeTotal = Math.max(currentProgressSnapshot.total, total, safeCurrent);
  const visibleIssueCount = invalidItems.length;
  currentProgressSnapshot = {
    current: safeCurrent,
    total: safeTotal,
    issueCount: visibleIssueCount,
  };
  const percent = safeTotal ? Math.min(100, Math.round((safeCurrent / safeTotal) * 100)) : 0;
  scanProgressEl.hidden = false;
  scanProgressBarEl.style.width = `${percent}%`;
  const progressValue = `${safeCurrent}/${safeTotal || 0} ${percent}%`;
  if (scanProgressValueEl) {
    scanProgressValueEl.textContent = progressValue;
  }
  updateScanStats(safeCurrent, safeTotal, visibleIssueCount);

  if (progress?.done) {
    pendingControlAction = null;
    scanProgressTextEl.textContent = translate(currentLanguage, 'scanProgressDone', { current: safeCurrent, total: safeTotal, progressValue });
    return;
  }

  if (progress?.paused) {
    isScanPaused = true;
    if (pendingControlAction === 'paused') pendingControlAction = null;
    updateScanButton();
    setStatusMessage(progress.networkWarning ? 'networkWarningStatus' : 'scanPausedStatus');
    setBusy(false);
    scanProgressTextEl.textContent = progress.networkWarning
      ? translate(currentLanguage, 'networkWarningProgress', { current: safeCurrent, total: safeTotal || '-', progressValue })
      : translate(currentLanguage, 'scanProgressPaused', { current: safeCurrent, total: safeTotal || '-', progressValue });
    return;
  }

  if (progress?.running) {
    isScanPaused = false;
    if (pendingControlAction === 'running') pendingControlAction = null;
    updateScanButton();
    setBusy(false);
    setStatusMessage('scanningInvalidBookmarks', { spinning: true });
  }

  const currentTitle = progress?.currentTitle || '-';
  const currentUrl = progress?.currentUrl || '-';
  const recentChecks = Array.isArray(progress?.recentChecks) ? progress.recentChecks.slice(0, 2) : [];
  const currentLine = formatBookmarkCheckLine({
    url: currentUrl,
    title: currentTitle,
    status: translate(currentLanguage, 'checkingStatus'),
  });
  const recentLines = recentChecks.length
    ? recentChecks.map((item) => formatBookmarkCheckLine({
      url: item.url || '-',
      title: item.title || item.url || '-',
      status: translate(currentLanguage, item.ok ? 'successStatus' : 'failureStatus'),
    })).join('\n')
    : translate(currentLanguage, 'noRecentChecks');
  scanProgressTextEl.textContent = translate(currentLanguage, 'scanProgressChecking', {
    progressValue,
    currentLine,
    recentLines,
  });
}

function formatBookmarkCheckLine({ url, title, status }) {
  return `${url} | ${title} | ${status}`;
}

function setStatusMessage(messageKeyOrText, options = {}) {
  const { spinning = false, params = null, isRaw = false } = options;
  const message = isRaw
    ? (messageKeyOrText || '')
    : translate(currentLanguage, messageKeyOrText, params || undefined);
  if (statusTextEl) {
    statusTextEl.textContent = message;
  } else {
    statusEl.textContent = message;
  }
  statusEl.classList.toggle('is-scanning', Boolean(spinning));
}

function updateScanStats(current, total, issueCount = invalidItems.length) {
  const selectedCount = selectedIds.size;
  scanStatTotalEl.textContent = total || 0;
  scanStatCheckedEl.textContent = current || 0;
  scanStatInvalidEl.textContent = issueCount;
  scanStatTimeoutEl.textContent = selectedCount;
}

function addInvalidItems(items) {
  const newItems = [];
  for (const item of items || []) {
    if (!item || deletedInvalidIds.has(String(item.id)) || invalidItems.some((existing) => existing.id === item.id)) continue;
    invalidItems.push(item);
    newItems.push(item);
  }
  if (!newItems.length) return;
  applyAutoSelectionToItems(newItems);
  renderResults();
}

function addInvalidItem(item) {
  addInvalidItems([item]);
}

async function showNetworkWarning(progress) {
  if (showNetworkWarning.lastWarningAt === progress.networkWarningAt) return;
  showNetworkWarning.lastWarningAt = progress.networkWarningAt;
  const shouldContinue = window.confirm(translate(currentLanguage, 'networkWarningConfirm'));
  if (!shouldContinue) return;
  isScanPaused = false;
  await chrome.runtime.sendMessage({ type: 'SET_INVALID_SCAN_CONTROL', action: 'running' });
  setStatusMessage('scanningInvalidBookmarks', { spinning: true });
  updateScanButton();
}

function renderResults() {
  resultsSection.hidden = currentCleanTab !== 'invalid' || invalidItems.length === 0;
  resultsEl.textContent = '';
  const selectedCount = [...selectedIds].filter((id) => invalidItems.some((item) => item.id === id)).length;
  summaryEl.textContent = invalidItems.length
    ? translate(currentLanguage, 'invalidSummary', { total: invalidItems.length, selected: selectedCount })
    : '';
  renderKindSelectors();
  updateScanStats(currentProgressSnapshot.current, currentProgressSnapshot.total, currentProgressSnapshot.issueCount);

  const renderItems = [...invalidItems].sort((a, b) => {
    const aPinned = pinnedSelectedIds.has(a.id) ? 1 : 0;
    const bPinned = pinnedSelectedIds.has(b.id) ? 1 : 0;
    return bPinned - aPinned;
  });

  for (const item of renderItems) {
    const kind = normalizeInvalidKind(item.kind);
    const meta = getKindMeta(kind);
    const row = document.createElement('label');
    row.className = 'invalid-result-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = item.id;
    checkbox.checked = selectedIds.has(item.id);
    checkbox.addEventListener('change', () => syncCheckboxSelection(item.id, checkbox.checked));

    const title = document.createElement('strong');
    title.className = 'invalid-title';
    title.textContent = item.title || item.url;

    const url = document.createElement('a');
    url.className = 'invalid-url';
    url.href = item.url;
    url.target = '_blank';
    url.rel = 'noreferrer';
    url.textContent = item.url;

    const reason = document.createElement('span');
    reason.className = `invalid-reason ${meta.className}`;
    reason.textContent = `${translate(currentLanguage, meta.labelKey)}: ${item.reason}`;

    row.append(checkbox, title, url, reason);
    resultsEl.append(row);
  }
}

function renderKindSelectors() {
  kindSelectorsEl.textContent = '';
  const counts = getKindCounts();
  renderConfidenceLegend();
  for (const kind of INVALID_KIND_ORDER) {
    const count = counts[kind] || 0;
    if (!count) continue;
    const meta = getKindMeta(kind);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `kind-selector-button ${meta.className} ${autoSelectKinds.has(kind) ? 'active' : ''}`;
    button.setAttribute('aria-pressed', String(autoSelectKinds.has(kind)));
    button.textContent = `${translate(currentLanguage, meta.labelKey)} ${count}`;
    button.addEventListener('click', () => handleKindSelect(kind));
    kindSelectorsEl.append(button);
  }
}

function renderConfidenceLegend() {
  const legend = document.createElement('div');
  legend.className = 'confidence-legend';
  const items = [
    { key: 'confidenceHigh', className: 'confidence-high' },
    { key: 'confidenceMedium', className: 'confidence-medium' },
    { key: 'confidenceLow', className: 'confidence-low' },
  ];
  for (const item of items) {
    const label = document.createElement('span');
    label.className = `confidence-legend-item ${item.className}`;
    label.textContent = translate(currentLanguage, item.key);
    legend.append(label);
  }
  kindSelectorsEl.append(legend);
}

async function saveSettings(patch, showMessage = true) {
  const settings = {
    ...(currentSettings || {}),
    ...patch,
  };
  const result = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  currentSettings = settings;
  if (showMessage) {
    setStatusMessage(result.ok ? translate(currentLanguage, 'settingsUpdated') : result.error, { isRaw: true });
  }
}

function applyLanguage(language) {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = translate(language, 'cleanBookmarksTitle');
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = translate(language, element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-tooltip]')) {
    element.dataset.tooltip = translate(language, element.dataset.i18nTooltip);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria]')) {
    element.setAttribute('aria-label', translate(language, element.dataset.i18nAria));
  }
  renderKindSelectors();
  renderCleanRecords();
  updateScanButton();
}

function renderCleanRecords() {
  if (!cleanRecordsListEl) return;
  cleanRecordsListEl.textContent = '';
  const rows = getCleanRecordRows();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = translate(currentLanguage, 'noCleanRecords');
    cleanRecordsListEl.append(empty);
    return;
  }

  const table = document.createElement('div');
  table.className = 'clean-record-table';
  const header = document.createElement('div');
  header.className = 'clean-record-row clean-record-header';
  for (const key of ['bookmarkName', 'bookmarkUrl', 'cleanRecordConfidence', 'cleanRecordTime']) {
    const cell = document.createElement('span');
    cell.textContent = translate(currentLanguage, key);
    header.append(cell);
  }
  table.append(header);

  for (const row of rows) {
    table.append(createCleanRecordRow(row));
  }
  cleanRecordsListEl.append(table);
}

function getCleanRecordRows() {
  const rows = [];
  for (const record of cleanRecords) {
    const deletedAt = record.deletedAt || new Date().toISOString();
    const items = Array.isArray(record.items) ? record.items : [];
    for (const item of items) {
      rows.push({ ...item, deletedAt });
    }
  }
  return rows.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
}

function createCleanRecordRow(item) {
  const row = document.createElement('div');
  row.className = 'clean-record-row';

  const title = document.createElement('strong');
  title.className = 'clean-record-title';
  title.textContent = item.title || item.url || '-';

  const url = document.createElement('a');
  url.className = 'clean-record-url';
  url.href = item.url || '#';
  url.target = '_blank';
  url.rel = 'noreferrer';
  url.textContent = item.url || '-';
  if (!item.url) url.removeAttribute('href');

  const confidence = document.createElement('span');
  const kind = normalizeInvalidKind(item.kind);
  const meta = getKindMeta(kind);
  confidence.className = `clean-record-confidence ${meta.confidenceClass}`;
  confidence.textContent = formatCleanRecordConfidence(item, meta);

  const time = document.createElement('span');
  time.className = 'clean-record-time';
  time.textContent = new Date(item.deletedAt || Date.now()).toLocaleString();

  row.append(title, url, confidence, time);
  return row;
}

function formatCleanRecordConfidence(item, meta) {
  const reason = item.reason ? ` ${item.reason}` : '';
  return `${translate(currentLanguage, meta.confidenceKey)}${reason}`;
}

function bindCursorFollowTooltips() {
  const targets = Array.from(document.querySelectorAll('[data-tooltip]'));
  if (!targets.length) return;

  if (!floatingTooltipEl) {
    floatingTooltipEl = document.createElement('div');
    floatingTooltipEl.className = 'cursor-follow-tooltip';
    floatingTooltipEl.hidden = true;
    document.body.append(floatingTooltipEl);
  }

  for (const target of targets) {
    if (target.dataset.tooltipBound === 'true') continue;
    target.dataset.tooltipBound = 'true';
    target.addEventListener('mouseenter', (event) => showFloatingTooltip(target, event));
    target.addEventListener('mousemove', (event) => updateFloatingTooltipPosition(event));
    target.addEventListener('mouseleave', hideFloatingTooltip);
    target.addEventListener('focus', () => showFloatingTooltip(target));
    target.addEventListener('blur', hideFloatingTooltip);
  }
}

function showFloatingTooltip(target, event) {
  const text = target.dataset.tooltip;
  if (!floatingTooltipEl || !text) return;
  activeTooltipTarget = target;
  floatingTooltipEl.textContent = text;
  floatingTooltipEl.hidden = false;
  requestAnimationFrame(() => {
    if (!floatingTooltipEl || activeTooltipTarget !== target) return;
    floatingTooltipEl.classList.add('is-visible');
    if (event) {
      updateFloatingTooltipPosition(event);
    } else {
      const rect = target.getBoundingClientRect();
      updateFloatingTooltipPosition({ clientX: rect.right + 8, clientY: rect.top + rect.height / 2 });
    }
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

async function loadCleanRecords() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_CLEAN_RECORDS' });
    cleanRecords = Array.isArray(result?.records) ? result.records : [];
  } catch (_error) {
    cleanRecords = [];
  }
}

function normalizeTimeout(value) {
  return Math.max(3, Number(value || 15));
}

function normalizeRetentionDays(value) {
  return Math.min(365, Math.max(1, Number(value || 30)));
}

function setBusy(isBusy) {
  const isActivelyScanning = Boolean(progressTimer && !isScanPaused);
  deleteSelectedBtn.disabled = isBusy || isActivelyScanning;
  scanBtn.disabled = false;
  selectAllBtn.disabled = false;
  clearSelectionBtn.disabled = false;
  const disableRuntimeSettings = isBusy || isActivelyScanning;
  timeoutInput.disabled = disableRuntimeSettings;
  carryCredentialsInput.disabled = disableRuntimeSettings;
  timeoutControlEl.classList.toggle('disabled-control', disableRuntimeSettings);
  carryCredentialsInput.closest('.switch-control')?.classList.toggle('disabled-control', disableRuntimeSettings);
}
