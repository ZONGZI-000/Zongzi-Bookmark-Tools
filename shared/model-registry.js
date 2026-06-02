(function () {
  'use strict';

  const MODEL_REGISTRY = {
    'lamini-flan-t5': {
      repo: 'Xenova/LaMini-Flan-T5-783M',
      name: 'LaMini-Flan-T5 783M',
      files: [
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx',
        'tokenizer.json',
        'config.json',
        'tokenizer_config.json',
      ],
      defaultSize: 320000000,
      fileSizeHints: {
        'tokenizer.json': 2400000,
        'config.json': 800,
        'tokenizer_config.json': 2300,
      },
    },
    'mt5-small': {
      repo: 'Xenova/mt5-small',
      name: 'mT5-small',
      files: [
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx',
        'tokenizer.json',
        'config.json',
        'tokenizer_config.json',
      ],
      defaultSize: 310000000,
      fileSizeHints: {
        'tokenizer.json': 4300000,
        'config.json': 1200,
        'tokenizer_config.json': 2300,
      },
    },
    distilbart: {
      repo: 'Xenova/distilbart-cnn-6-6',
      name: 'DistilBART CNN 6-6',
      files: [
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx',
        'tokenizer.json',
        'config.json',
        'tokenizer_config.json',
      ],
      defaultSize: 108000000,
      fileSizeHints: {
        'tokenizer.json': 1400000,
        'config.json': 800,
        'tokenizer_config.json': 1300,
      },
    },
  };

  const MODEL_KEY_ALIASES = { 'qwen3-0.6b': 'lamini-flan-t5' };

  const MODEL_DOWNLOAD_SOURCES = {
    'lamini-flan-t5': {
      name: 'LaMini-Flan-T5 783M',
      repo: 'Xenova/LaMini-Flan-T5-783M',
      files: [
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx',
        'tokenizer.json',
        'config.json',
        'tokenizer_config.json',
      ],
      mirrors: [
        { name: 'HuggingFace', url: 'https://huggingface.co/Xenova/LaMini-Flan-T5-783M/tree/main' },
        { name: 'hf-mirror', url: 'https://hf-mirror.com/Xenova/LaMini-Flan-T5-783M/tree/main' },
        { name: 'ModelScope', url: 'https://modelscope.cn/models/Xenova/LaMini-Flan-T5-783M/files' },
      ],
    },
    'mt5-small': {
      name: 'mT5-small',
      repo: 'Xenova/mt5-small',
      files: [
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx',
        'tokenizer.json',
        'config.json',
        'tokenizer_config.json',
      ],
      mirrors: [
        { name: 'HuggingFace', url: 'https://huggingface.co/Xenova/mt5-small/tree/main' },
        { name: 'hf-mirror', url: 'https://hf-mirror.com/Xenova/mt5-small/tree/main' },
        { name: 'ModelScope', url: 'https://modelscope.cn/models/Xenova/mt5-small/files' },
      ],
    },
    distilbart: {
      name: 'DistilBART CNN 6-6',
      repo: 'Xenova/distilbart-cnn-6-6',
      files: [
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx',
        'tokenizer.json',
        'config.json',
        'tokenizer_config.json',
      ],
      mirrors: [
        { name: 'HuggingFace', url: 'https://huggingface.co/Xenova/distilbart-cnn-6-6/tree/main' },
        { name: 'hf-mirror', url: 'https://hf-mirror.com/Xenova/distilbart-cnn-6-6/tree/main' },
        { name: 'ModelScope', url: 'https://modelscope.cn/models/Xenova/distilbart-cnn-6-6/files' },
      ],
    },
  };

  const REPO_TO_MODEL_ID = {};
  const MODEL_ID_TO_REPO = {};

  Object.keys(MODEL_REGISTRY).forEach(function (modelId) {
    const repo = MODEL_REGISTRY[modelId].repo;
    REPO_TO_MODEL_ID[repo] = modelId;
    MODEL_ID_TO_REPO[modelId] = repo;
  });

  Object.keys(MODEL_KEY_ALIASES).forEach(function (alias) {
    const canonical = MODEL_KEY_ALIASES[alias];
    const repo = MODEL_REGISTRY[canonical]?.repo;
    if (repo) MODEL_ID_TO_REPO[alias] = repo;
  });

  function normalizeModelId(modelId) {
    const raw = String(modelId || '');
    const mapped = MODEL_KEY_ALIASES[raw] || raw || 'distilbart';
    return MODEL_REGISTRY[mapped] ? mapped : 'distilbart';
  }

  function getModelMeta(modelId) {
    return MODEL_REGISTRY[normalizeModelId(modelId)];
  }

  function getRepo(modelId) {
    return getModelMeta(modelId)?.repo || 'Xenova/distilbart-cnn-6-6';
  }

  function getModelIdFromRepo(repo) {
    return REPO_TO_MODEL_ID[String(repo || '')] || 'distilbart';
  }

  function getDownloadSource(modelId) {
    const canonical = normalizeModelId(modelId);
    return MODEL_DOWNLOAD_SOURCES[canonical] || MODEL_DOWNLOAD_SOURCES['lamini-flan-t5'];
  }

  self.ZongziModelRegistry = {
    modelRegistry: MODEL_REGISTRY,
    modelKeyAliases: MODEL_KEY_ALIASES,
    modelDownloadSources: MODEL_DOWNLOAD_SOURCES,
    repoToModelId: REPO_TO_MODEL_ID,
    modelIdToRepo: MODEL_ID_TO_REPO,
    normalizeModelId,
    getModelMeta,
    getRepo,
    getModelIdFromRepo,
    getDownloadSource,
  };
})();

