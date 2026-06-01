const summarySearchInput = document.querySelector('#summarySearchInput');
const summaryFilterTags = Array.from(document.querySelectorAll('.summary-filter-tag'));
const summarySearchButton = document.querySelector('#summarySearchButton');
const refreshSummaryRecordsBtn = document.querySelector('#refreshSummaryRecords');
const summaryPageStatus = document.querySelector('#summaryPageStatus');
const summaryRecordList = document.querySelector('#summaryRecordList');
const summaryRecordCount = document.querySelector('#summaryRecordCount');
const summaryPrevPage = document.querySelector('#summaryPrevPage');
const summaryNextPage = document.querySelector('#summaryNextPage');
const summaryPageInfo = document.querySelector('#summaryPageInfo');
const summaryPageTotal = document.querySelector('#summaryPageTotal');
const summaryPageAi = document.querySelector('#summaryPageAi');
const summaryPageUnprocessed = document.querySelector('#summaryPageUnprocessed');
const summarySelectAll = document.querySelector('#summarySelectAll');
const summaryDeselectAll = document.querySelector('#summaryDeselectAll');
const summaryBatchOffline = document.querySelector('#summaryBatchOffline');
const summaryBatchRegenerateAi = document.querySelector('#summaryBatchRegenerateAi');
const summaryEditModal = document.querySelector('#summaryEditModal');
const summaryEditCategory = document.querySelector('#summaryEditCategory');
const summaryEditKeywords = document.querySelector('#summaryEditKeywords');
const summaryEditSave = document.querySelector('#summaryEditSave');
const summaryEditCancel = document.querySelector('#summaryEditCancel');

let currentLanguage = 'zh';
let currentPage = 1;
let totalPages = 1;
let currentQuery = '';
let activeFilters = new Set(['all']);
let selectedIds = new Set();
let editingRecordId = null;
let currentRecords = [];
let aiConfigured = false;

initSummaryPage();

async function initSummaryPage() {
  const status = await sendMessage({ type: 'GET_STATUS' });
  currentLanguage = normalizeLanguage(status.settings?.language);
  applyLanguage(currentLanguage);
  summarySearchButton.addEventListener('click', () => loadSummaryRecords(1));
  summarySearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadSummaryRecords(1);
  });
  refreshSummaryRecordsBtn.addEventListener('click', () => {
    selectedIds = new Set();
    loadSummaryRecords(currentPage);
  });
  summaryRecordList.addEventListener('click', handleRecordAction);
  summaryPrevPage.addEventListener('click', () => {
    selectedIds = new Set();
    loadSummaryRecords(Math.max(1, currentPage - 1));
  });
  summaryNextPage.addEventListener('click', () => {
    selectedIds = new Set();
    loadSummaryRecords(Math.min(totalPages, currentPage + 1));
  });
  summarySelectAll.addEventListener('click', () => {
    currentRecords.forEach((r) => selectedIds.add(String(r.id)));
    renderRecords(currentRecords);
  });
  summaryDeselectAll.addEventListener('click', () => {
    selectedIds = new Set();
    renderRecords(currentRecords);
  });
  summaryBatchOffline.addEventListener('click', handleBatchOffline);
  summaryBatchRegenerateAi.addEventListener('click', handleBatchRegenerateAi);
  summaryEditSave.addEventListener('click', handleEditSave);
  summaryEditCancel.addEventListener('click', closeEditModal);
  summaryEditModal.querySelector('.summary-edit-modal-backdrop').addEventListener('click', closeEditModal);
  initFilterTags();
  await loadSummaryRecords(1);
}

function initFilterTags() {
  summaryFilterTags.forEach((tag) => {
    tag.addEventListener('click', () => {
      const filter = tag.dataset.summaryFilter;
      if (filter === 'all') {
        if (activeFilters.has('all')) return;
        summaryFilterTags.forEach((t) => { t.classList.remove('active'); });
        tag.classList.add('active');
        activeFilters = new Set(['all']);
      } else {
        const allTag = summaryFilterTags.find((t) => t.dataset.summaryFilter === 'all');
        if (allTag) allTag.classList.remove('active');
        activeFilters.delete('all');
        tag.classList.toggle('active');
        if (tag.classList.contains('active')) {
          activeFilters.add(filter);
        } else {
          activeFilters.delete(filter);
        }
        const anyActive = summaryFilterTags.some((t) => t.dataset.summaryFilter !== 'all' && t.classList.contains('active'));
        if (!anyActive) {
          if (allTag) {
            allTag.classList.add('active');
            activeFilters = new Set(['all']);
          }
        }
      }
      loadSummaryRecords(1);
    });
  });
}

function buildFilterParam() {
  if (activeFilters.has('all') || !activeFilters.size) return 'all';
  return [...activeFilters].join(',');
}

function applyLanguage(language) {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = translate(language, node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) node.setAttribute(attr, translate(language, key));
    }
  });
  document.querySelectorAll('.summary-filter-tag').forEach((tag) => {
    const key = { all: 'summaryFilterAll', ai: 'summaryFilterAi', noAi: 'summaryFilterNoAi', unprocessed: 'summaryFilterUnprocessed' }[tag.dataset.summaryFilter];
    if (key) tag.textContent = translate(language, key);
  });
}

async function loadSummaryRecords(page) {
  currentQuery = summarySearchInput.value.trim();
  currentPage = page;
  selectedIds = new Set();
  summaryPageStatus.textContent = translate(currentLanguage, 'summaryPageLoading');
  try {
    const result = await sendMessage({ type: 'GET_SUMMARY_RECORDS', query: currentQuery, filter: buildFilterParam(), page: currentPage });
    currentRecords = result.records || [];
    aiConfigured = result.aiConfigured || false;
    renderStats(result.stats || {});
    renderRecords(currentRecords);
    summaryRecordCount.textContent = String(result.total || 0);
    totalPages = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 50)));
    summaryPageInfo.textContent = `${currentPage} / ${totalPages}`;
    summaryPrevPage.disabled = currentPage <= 1;
    summaryNextPage.disabled = currentPage >= totalPages;
    summaryBatchRegenerateAi.disabled = !aiConfigured;
    if (!aiConfigured) summaryBatchRegenerateAi.title = translate(currentLanguage, 'summaryAiNotConfigured');
    else summaryBatchRegenerateAi.removeAttribute('title');
    summaryPageStatus.textContent = translate(currentLanguage, 'summaryPageStatusReady');
  } catch (error) {
    summaryPageStatus.textContent = error.message;
  }
}

function renderStats(stats) {
  summaryPageTotal.textContent = String(stats.total || 0);
  summaryPageAi.textContent = String(stats.ai || 0);
  summaryPageUnprocessed.textContent = String(stats.unprocessed || 0);
}

function renderRecords(records) {
  if (!records.length) {
    summaryRecordList.classList.add('empty-state');
    summaryRecordList.textContent = translate(currentLanguage, 'summaryNoRecords');
    return;
  }
  summaryRecordList.classList.remove('empty-state');
  const header = document.createElement('div');
  header.className = 'summary-record-row summary-record-header';

  const checkboxCell = document.createElement('span');
  checkboxCell.className = 'summary-check-cell';
  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.title = translate(currentLanguage, 'summarySelectAll');
  selectAllCheckbox.addEventListener('change', () => {
    if (selectAllCheckbox.checked) {
      records.forEach((r) => selectedIds.add(String(r.id)));
    } else {
      selectedIds = new Set();
    }
    renderRecords(records);
  });
  checkboxCell.append(selectAllCheckbox);
  header.append(checkboxCell);

  ['summaryNameAddress', 'summaryFolder', 'summarySource', 'summaryOfflineTitle', 'summaryCategory', 'summaryKeywords', 'summaryAi', 'summaryActions'].forEach((key) => {
    const cell = document.createElement('span');
    cell.textContent = translate(currentLanguage, key);
    header.append(cell);
  });
  summaryRecordList.replaceChildren(header, ...records.map((r) => createRecordRow(r)));
}

function createRecordRow(record) {
  const row = document.createElement('article');
  row.className = 'summary-record-row';
  row.dataset.id = String(record.id);
  const categoryValue = getDisplayCategory(record);
  const keywordValues = getDisplayKeywords(record);
  row.dataset.category = categoryValue === '-' ? '' : categoryValue;
  row.dataset.keywords = keywordValues.join('、');

  const checkboxCell = document.createElement('span');
  checkboxCell.className = 'summary-check-cell';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedIds.has(String(record.id));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      selectedIds.add(String(record.id));
    } else {
      selectedIds.delete(String(record.id));
    }
  });
  checkboxCell.append(checkbox);

  const nameAddress = document.createElement('div');
  nameAddress.className = 'summary-name-address';

  const title = document.createElement('strong');
  title.textContent = record.title || translate(currentLanguage, 'untitledBookmark');

  const link = document.createElement('a');
  link.href = record.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = record.url || '-';
  nameAddress.append(title, link);

  const folder = document.createElement('span');
  folder.textContent = record.folderPath || '-';

  const source = document.createElement('span');
  source.textContent = record.source || getSourceFromUrl(record.url);

  const offlineTitle = document.createElement('span');
  offlineTitle.textContent = record.offlineTitle || record.title || '-';

  const category = document.createElement('span');
  category.textContent = categoryValue;

  const keywords = document.createElement('span');
  keywords.textContent = keywordValues.join('、') || '-';

  const ai = document.createElement('span');
  ai.textContent = record.aiSummary || '-';

  const actions = document.createElement('div');
  actions.className = 'summary-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'summary-action-btn';
  editBtn.dataset.action = 'edit';
  editBtn.dataset.id = record.id;
  editBtn.textContent = translate(currentLanguage, 'summaryEditFields');
  actions.append(editBtn);

  row.append(checkboxCell, nameAddress, folder, source, offlineTitle, category, keywords, ai, actions);
  return row;
}

function getDisplayCategory(record) {
  return record.manualCategory || record.aiCategory || record.category || '-';
}

function getDisplayKeywords(record) {
  if (Array.isArray(record.manualKeywords) && record.manualKeywords.length) return record.manualKeywords;
  if (Array.isArray(record.aiKeywords) && record.aiKeywords.length) return record.aiKeywords;
  if (Array.isArray(record.keywords)) return record.keywords;
  return [];
}

function getSourceFromUrl(url) {
  try {
    return `来自 ${new URL(url).hostname.replace(/^www\./, '')}`;
  } catch (_error) {
    return '-';
  }
}

async function handleBatchOffline() {
  if (!selectedIds.size) {
    summaryPageStatus.textContent = translate(currentLanguage, 'summaryNoSelection');
    return;
  }
  summaryBatchOffline.disabled = true;
  summaryPageStatus.textContent = translate(currentLanguage, 'summaryBatchOfflineRunning');
  try {
    const result = await sendMessage({ type: 'BATCH_OFFLINE_SUMMARY', ids: [...selectedIds] });
    summaryPageStatus.textContent = translate(currentLanguage, 'summaryBatchOfflineDone').replace('{count}', result.updated || 0);
    await refreshRecordsInPlace();
  } catch (error) {
    summaryPageStatus.textContent = error.message;
  } finally {
    summaryBatchOffline.disabled = false;
  }
}

async function handleBatchRegenerateAi() {
  if (!selectedIds.size) {
    summaryPageStatus.textContent = translate(currentLanguage, 'summaryNoSelection');
    return;
  }
  if (!aiConfigured) {
    summaryPageStatus.textContent = translate(currentLanguage, 'summaryAiNotConfigured');
    return;
  }
  summaryBatchRegenerateAi.disabled = true;
  summaryPageStatus.textContent = translate(currentLanguage, 'summaryAiReindexing');
  try {
    const result = await sendMessage({ type: 'BATCH_REGENERATE_AI_SUMMARY', ids: [...selectedIds] });
    summaryPageStatus.textContent = translate(currentLanguage, 'summaryAiReindexDone').replace('{count}', result.updated || 0);
    await refreshRecordsInPlace();
  } catch (error) {
    summaryPageStatus.textContent = error.message;
  } finally {
    summaryBatchRegenerateAi.disabled = false;
  }
}

async function refreshRecordsInPlace() {
  await loadSummaryRecords(currentPage);
}

async function handleRecordAction(event) {
  const button = event.target.closest('button[data-action][data-id]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  button.disabled = true;
  try {
    if (action === 'edit') {
      await openEditModal(id);
    }
  } catch (error) {
    summaryPageStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function openEditModal(id) {
  const record = currentRecords.find((r) => String(r.id) === String(id));
  if (!record) return;
  editingRecordId = id;
  summaryEditCategory.value = getDisplayCategory(record);
  summaryEditKeywords.value = getDisplayKeywords(record).join('、');
  summaryEditModal.hidden = false;
  summaryEditCategory.focus();
}

function closeEditModal() {
  summaryEditModal.hidden = true;
  editingRecordId = null;
}

async function handleEditSave() {
  if (!editingRecordId) return;
  const category = summaryEditCategory.value.trim();
  const keywords = summaryEditKeywords.value.trim();
  summaryEditSave.disabled = true;
  try {
    const result = await sendMessage({ type: 'UPDATE_SUMMARY_RECORD_FIELDS', id: editingRecordId, category, keywords });
    if (result.ok && result.record) {
      updateRecordInPlace(result.record);
    }
    summaryPageStatus.textContent = translate(currentLanguage, 'summaryFieldsSaved');
    closeEditModal();
  } catch (error) {
    summaryPageStatus.textContent = error.message;
  } finally {
    summaryEditSave.disabled = false;
  }
}

function updateRecordInPlace(updatedRecord) {
  const id = String(updatedRecord.id);
  const index = currentRecords.findIndex((r) => String(r.id) === id);
  if (index === -1) return;
  currentRecords[index] = { ...currentRecords[index], ...updatedRecord };
  const row = summaryRecordList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const newRow = createRecordRow(currentRecords[index]);
  row.replaceWith(newRow);
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}
