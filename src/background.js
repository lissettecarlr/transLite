// Service Worker - 处理翻译 API 请求

// ---- 动态图标 ----
function drawIcon(size, isActive) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size * 0.12;

  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, size, size);
  if (isActive) {
    grad.addColorStop(0, '#1a73e8');
    grad.addColorStop(1, '#0d47a1');
  } else {
    grad.addColorStop(0, '#5f6368');
    grad.addColorStop(1, '#3c4043');
  }
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.55}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('译', size / 2, size * 0.54);

  return ctx.getImageData(0, 0, size, size);
}

async function setIcon(isActive = false) {
  const size = 128;
  try {
    const url = chrome.runtime.getURL('images/1.png');
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const blob = await fetch(url).then((r) => r.blob());
    const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size });
    ctx.drawImage(bmp, 0, 0, size, size);

    if (isActive) {
      // 右下角蓝色圆点表示翻译已开启
      ctx.fillStyle = '#1a73e8';
      ctx.beginPath();
      ctx.arc(size - 18, size - 18, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', size - 18, size - 17);
    }

    await chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, size, size) });
  } catch (_) {
    // 图片加载失败时回退到文字图标
    try {
      chrome.action.setIcon({ imageData: drawIcon(size, isActive) });
    } catch (_) {}
  }
}

// ---- 初始化 ----
chrome.runtime.onInstalled.addListener(() => {
  setIcon(false);
  chrome.contextMenus.create({
    id: 'lt-translate-selection',
    title: '翻译选中文字',
    contexts: ['selection'],
  });
});

chrome.runtime.onStartup.addListener(() => setIcon(false));

// ---- 快捷键 ----
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-translation') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_TRANSLATION' }).catch(() => {});
      }
    });
  }
});

// ---- 右键菜单 ----
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'lt-translate-selection' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_SELECTION',
      text: info.selectionText,
    }).catch(() => {});
  }
});

// ---- 消息处理 ----
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TRANSLATE') {
    handleTranslation(message.texts, message.settings)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SET_ICON') {
    setIcon(message.active);
    sendResponse({ ok: true });
    return false;
  }
});

// ---- 翻译入口 ----
async function handleTranslation(texts, settings = {}) {
  const { service = 'google', targetLang = 'zh-CN' } = settings;

  if (!texts || texts.length === 0) {
    return { success: true, translations: [] };
  }

  // 每 20s 做一次无害的 API 调用，防止 MV3 Service Worker 在长批次翻译期间被 Chrome 休眠
  const keepAlive = setInterval(() => {
    chrome.storage.session?.get?.('_ka').catch?.(() => {});
  }, 20_000);

  try {
    if (service === 'openai') {
      return await translateWithOpenAI(texts, settings);
    }
    return await translateWithGoogle(texts, targetLang);
  } finally {
    clearInterval(keepAlive);
  }
}

// ---- Google 免费翻译（并发 + 分隔符降级）----
async function translateWithGoogle(texts, targetLang) {
  const BATCH = 10;
  const CONCURRENCY = 3;
  const results = new Array(texts.length).fill('');

  const batches = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    batches.push({ start: i, chunk: texts.slice(i, i + BATCH) });
  }

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const responses = await Promise.all(
      group.map((b) => fetchGoogleBatch(b.chunk, targetLang))
    );
    group.forEach((b, idx) => {
      responses[idx].forEach((t, j) => {
        results[b.start + j] = t;
      });
    });

    if (i + CONCURRENCY < batches.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return { success: true, translations: results };
}

async function fetchGoogleBatch(chunk, targetLang) {
  const SEP = '\n\n⟦LT⟧\n\n';
  const joined = chunk.join(SEP);
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t` +
    `&q=${encodeURIComponent(joined)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google 翻译请求失败: HTTP ${res.status}`);

  const data = await res.json();
  const full = data[0].map((item) => item[0]).join('');
  const parts = full.split(/\s*⟦\s*LT\s*⟧\s*/);

  // 分隔符被翻译引擎破坏时，降级为逐条翻译
  if (parts.length !== chunk.length) {
    return Promise.all(chunk.map((text) => fetchGoogleSingle(text, targetLang)));
  }

  return parts.map((p) => p.trim());
}

async function fetchGoogleSingle(text, targetLang) {
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t` +
    `&q=${encodeURIComponent(text)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google 翻译请求失败: HTTP ${res.status}`);

  const data = await res.json();
  return data[0].map((item) => item[0]).join('').trim();
}

// ---- OpenAI 兼容翻译 ----
async function translateWithOpenAI(texts, settings) {
  const {
    apiKey,
    apiBaseUrl = 'https://api.openai.com/v1',
    model = 'gpt-5.4-nano',
    targetLang = 'zh-CN',
    systemPrompt = '',
  } = settings;

  if (!apiKey) throw new Error('请先在设置中填写 API Key');

  const LANG_MAP = {
    'zh-CN': '简体中文', 'zh-TW': '繁体中文',
    en: '英文', ja: '日文', ko: '韩文',
    fr: '法文', de: '德文', es: '西班牙文',
    ru: '俄文', ar: '阿拉伯文', pt: '葡萄牙文',
    it: '意大利文', vi: '越南文', th: '泰文',
  };
  const langName = LANG_MAP[targetLang] || targetLang;

  const defaultSystem = `你是专业翻译助手。将用户发送的 JSON 字符串数组翻译成${langName}，以相同长度的 JSON 字符串数组格式返回，不要解释，不要多余文字。翻译规则：1）保持原文语气和格式；2）专有名词、品牌名、人名、产品名、技术术语（如 token、API、GitHub、React 等）保留英文原文不翻译；3）代码、变量名、命令不翻译；4）若整段文字本身已是目标语言，原样返回。`;

  const BATCH = 10;
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);

    const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt || defaultSystem },
          { role: 'user', content: JSON.stringify(chunk) },
        ],
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API 错误 ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '[]';

    let parsed;
    try {
      // 有时模型返回带 markdown 代码块
      const cleaned = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) {
        // 尝试取对象的第一个数组值
        parsed = Object.values(parsed).find(Array.isArray) || [];
      }
    } catch {
      // fallback: 按换行分割
      parsed = raw.split('\n').filter(Boolean);
    }

    for (let j = 0; j < chunk.length; j++) {
      results.push(parsed[j] ?? '');
    }
  }

  return { success: true, translations: results };
}
