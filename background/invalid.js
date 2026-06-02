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

