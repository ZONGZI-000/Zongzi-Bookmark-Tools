function resolveRemoteUrl(settings, useFolder = false) {
  const base = settings.webdavUrl.endsWith('/') ? settings.webdavUrl : `${settings.webdavUrl}/`;
  return useFolder ? base : new URL(settings.remoteFile, base).toString();
}

function webdavRequest(settings, method, init = {}, useFolder = false) {
  const headers = new Headers(init.headers || {});
  if (settings.username || settings.password) {
    headers.set('Authorization', `Basic ${btoa(`${settings.username}:${settings.password}`)}`);
  }

  const timeoutSeconds = normalizeRequestTimeout(init.timeoutSeconds || settings.requestTimeoutSeconds);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const { timeoutSeconds: _timeoutSeconds, ...fetchInit } = init;

  return fetch(resolveRemoteUrl(settings, useFolder), {
    ...fetchInit,
    method,
    headers,
    cache: 'no-store',
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === 'AbortError') {
      throw new Error(`WebDAV request timed out after ${timeoutSeconds}s. If you use a proxy, check that Chrome can access it and increase the timeout.`);
    }
    throw new Error(sanitizeErrorMessage(error.message, settings));
  }).finally(() => clearTimeout(timer));
}

