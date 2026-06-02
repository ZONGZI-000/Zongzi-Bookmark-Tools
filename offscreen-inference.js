(function () {
  'use strict';

  const DB_NAME = 'zongzi_model_store';
  const DB_VERSION = 3;
  const STORE_NAME = 'modelFiles';

  const ModelRegistry = self.ZongziModelRegistry || {};

  let pipePromise = null;
  let currentModelKey = '';
  let ready = false;

  /* ---------- IndexedDB helpers ---------- */
  function openZongziDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCachedModelFile(key) {
    const db = await openZongziDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function hasCachedModelFiles(modelId) {
    const db = await openZongziDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => {
        const count = req.result.filter(function (k) { return String(k).startsWith(modelId + '::'); }).length;
        db.close();
        resolve(count);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  /* ---------- Fetch interception ---------- */
  // Intercept HuggingFace fetches to serve from our IndexedDB cache
  function interceptFetch(modelId) {
    const normalizedModelId = typeof ModelRegistry.normalizeModelId === 'function'
      ? ModelRegistry.normalizeModelId(modelId)
      : modelId;
    const originalFetch = window.fetch.bind(window);
    const repoToModelId = ModelRegistry.repoToModelId || {};

    window.fetch = async function (url, options) {
      const urlStr = String(url);

      // Check if this is a HuggingFace model file URL
      for (var repo in repoToModelId) {
        if (!repoToModelId.hasOwnProperty(repo)) continue;
        var repoModelId = repoToModelId[repo];
        var prefix = 'https://huggingface.co/' + repo + '/resolve/';
        if (urlStr.startsWith(prefix)) {
          var filePath = urlStr.substring(prefix.length);
          // Strip branch prefix (e.g. "main/onnx/encoder.onnx" → "onnx/encoder.onnx")
          var filePathNoBranch = filePath.replace(/^[a-zA-Z0-9_.-]+\//, '');
          // Try with and without branch prefix; modelId then repoModelId
          var keys = [
            normalizedModelId + '::' + filePathNoBranch,
            normalizedModelId + '::' + filePath,
            repoModelId + '::' + filePathNoBranch,
            repoModelId + '::' + filePath,
          ];
          for (var i = 0; i < keys.length; i++) {
            try {
              var cached = await getCachedModelFile(keys[i]);
              if (cached) {
                console.log('[offscreen-inference] Serving from cache:', keys[i]);
                return new Response(cached instanceof ArrayBuffer ? cached : cached.buffer || cached, {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': String(cached.byteLength || cached.length || 0),
                  },
                });
              }
            } catch (_) { /* continue */ }
          }
          break;
        }
      }

      // Fall back to original fetch
      return originalFetch(url, options);
    };
  }

  /* ---------- Transformer.js pipeline ---------- */
  async function getPipeline(modelId) {
    var repo = typeof ModelRegistry.getRepo === 'function'
      ? ModelRegistry.getRepo(modelId)
      : 'Xenova/distilbart-cnn-6-6';
    var key = repo;

    if (pipePromise && currentModelKey === key) {
      return pipePromise;
    }

    // Enable fetch interception to serve from our IndexedDB
    interceptFetch(modelId);

    currentModelKey = key;
    pipePromise = (async () => {
      try {
        // Use self.Transformers (global from the bundled script)
        var Transformers = self.Transformers;
        if (!Transformers) {
          throw new Error('Transformer.js failed to load');
        }

        var pipe = await Transformers.pipeline('summarization', repo, {
          quantized: true,
        });
        console.log('[offscreen-inference] Pipeline ready for', repo);
        return pipe;
      } catch (err) {
        console.error('[offscreen-inference] Pipeline load failed:', err.message);
        pipePromise = null;
        currentModelKey = '';
        throw err;
      }
    })();

    return pipePromise;
  }

  /* ---------- Message handler ---------- */
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.target !== 'offscreen-inference') return false;

    if (message.type === 'RUN_SUMMARIZE') {
      handleSummarize(message.modelId, message.text, message.maxLength || 50).then(sendResponse).catch(function (err) {
        sendResponse({ ok: false, error: err.message || 'Inference failed' });
      });
      return true; // async response
    }

    if (message.type === 'CHECK_MODEL_READY') {
      handleCheckReady(message.modelId).then(sendResponse).catch(function (err) {
        sendResponse({ ok: false, ready: false, error: err.message });
      });
      return true;
    }

    if (message.type === 'PRELOAD_MODEL') {
      handlePreload(message.modelId).then(sendResponse).catch(function (err) {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    sendResponse({ ok: false, error: 'Unknown message type' });
    return false;
  });

  async function handleSummarize(modelId, text, maxLength) {
    if (!text || !text.trim()) {
      return { ok: true, summary: '', engine: 'transformer' };
    }

    try {
      var pipe = await getPipeline(modelId);
      var result = await pipe(text.trim(), {
        max_length: Math.min(maxLength + 20, 150),
        min_length: Math.max(Math.floor(maxLength / 3), 5),
      });

      var summary = result && result[0] ? result[0].summary_text || result[0].generated_text || '' : '';
      // Truncate to requested max length
      if (summary.length > maxLength) {
        summary = summary.substring(0, maxLength).replace(/\s+\S*$/, '');
      }

      return { ok: true, summary: summary, engine: 'transformer', model: modelId };
    } catch (err) {
      return { ok: false, error: err.message || 'Summarization failed', engine: 'transformer' };
    }
  }

  async function handleCheckReady(modelId) {
    var fileCount = await hasCachedModelFiles(modelId).catch(function () { return 0; });
    if (fileCount >= 5) {
      return { ok: true, ready: true, fileCount: fileCount, source: 'indexeddb' };
    }

    // Try to preload the pipeline to trigger download
    try {
      await getPipeline(modelId);
      return { ok: true, ready: true, fileCount: fileCount, source: 'pipeline' };
    } catch (err) {
      return { ok: true, ready: false, fileCount: fileCount, error: err.message };
    }
  }

  async function handlePreload(modelId) {
    try {
      await getPipeline(modelId);
      return { ok: true, ready: true };
    } catch (err) {
      return { ok: false, ready: false, error: err.message };
    }
  }
})();
