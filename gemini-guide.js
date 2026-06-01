let currentLanguage = 'zh';

initGeminiGuide();

async function initGeminiGuide() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    currentLanguage = normalizeLanguage(status.settings?.language);
  } catch (error) {
    currentLanguage = 'zh';
  }
  applyGuideLanguage(currentLanguage);

  document.querySelector('#openOptimizationFlag')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://flags/#optimization-guide-on-device-model' });
  });
  document.querySelector('#openPromptApiFlag')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://flags/#prompt-api-for-gemini-nano' });
  });
  document.querySelector('#openLanguagePage')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/languages' });
  });
  document.querySelector('#openComponentsPage')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://components' });
  });
  document.querySelector('#verifyGeminiNano')?.addEventListener('click', verifyGeminiNanoByPrompt);
}

async function verifyGeminiNanoByPrompt() {
  const resultEl = document.querySelector('#geminiVerifyResult');
  const button = document.querySelector('#verifyGeminiNano');
  if (!resultEl) return;
  resultEl.textContent = translate(currentLanguage, 'aiValidationChecking');
  if (button) button.disabled = true;
  try {
    const result = await runGeminiNanoProbe();
    resultEl.textContent = result.ok
      ? translate(currentLanguage, 'geminiNanoPromptOk')
      : translate(currentLanguage, result.reasonKey || 'geminiNanoPromptFailed');
  } catch (error) {
    resultEl.textContent = `${translate(currentLanguage, 'geminiNanoPromptFailed')} ${error.message || ''}`.trim();
  } finally {
    if (button) button.disabled = false;
  }
}

async function runGeminiNanoProbe() {
  const api = getGeminiNanoApi();
  if (!api) return { ok: false, reasonKey: 'geminiNanoApiMissing' };
  if (typeof api.availability === 'function') {
    try {
      const availability = await api.availability();
      if (availability && !['available', 'readily'].includes(String(availability).toLowerCase())) {
        return { ok: false, reasonKey: 'geminiNanoModelNotReady' };
      }
    } catch (_error) {
      // Some Chrome builds expose availability but still require a create call to know the final state.
    }
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
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
    ]);
    return String(output || '').trim() ? { ok: true } : { ok: false, reasonKey: 'geminiNanoPromptFailed' };
  } finally {
    try {
      if (session?.destroy) session.destroy();
    } catch (_error) {}
  }
}

function getGeminiNanoApi() {
  return globalThis.LanguageModel || globalThis.ai || globalThis.ai?.languageModel || null;
}

function applyGuideLanguage(language) {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = translate(language, 'geminiGuidePageTitle');
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = translate(language, node.dataset.i18n);
  });
}
