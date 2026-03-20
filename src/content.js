// Content Script - 核心翻译逻辑

const LT = {
  PREFIX: 'lt',
  RESULT_CLASS: 'lt-result',
  DONE_ATTR: 'data-lt-done',
  PENDING_ATTR: 'data-lt-pending',
  WRAP_CLASS: 'lt-wrap',
  POPUP_ID: 'lt-selection-popup',
};

// 需要翻译的元素选择器（取文章正文级别的块级元素）
const TRANSLATE_SELECTORS_BASE = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'dt', 'dd',
  'td', 'th', 'caption',
  'blockquote', 'figcaption',
  'summary',
];

const TRANSLATE_SELECTORS_AGGRESSIVE = [
  'button', 'a', 'label', 'span', 'div',
];

function getTranslateSelectors() {
  if (state.settings?.aggressiveMode) {
    return [...TRANSLATE_SELECTORS_BASE, ...TRANSLATE_SELECTORS_AGGRESSIVE].join(',');
  }
  return TRANSLATE_SELECTORS_BASE.join(',');
}

// 排除的父级容器（这些内部不翻译）
const EXCLUDE_PARENTS = [
  'script', 'style', 'noscript', 'iframe',
  'code', 'pre', 'kbd', 'samp', 'var', 'math', 'svg',
  '.lt-result', '[data-lt-done]',
].join(',');

let state = {
  isTranslating: false,
  isTranslated: false,
  settings: null,
};

// ---- 初始化 ----
async function init() {
  state.settings = await loadSettings();
  setupMessageListener();
  setupKeyboardShortcut();

  if (state.settings.autoTranslate && shouldAutoTranslate()) {
    // 延迟一点，等页面渲染完成
    setTimeout(() => startTranslation(), 1500);
  }
}

function shouldAutoTranslate() {
  const lang = document.documentElement.lang?.toLowerCase() || '';
  const targetBase = (state.settings.targetLang || 'zh-CN').split('-')[0].toLowerCase();
  // 如果页面已经是目标语言就不翻译
  if (lang && lang.startsWith(targetBase)) return false;
  // 抽样检测中文比例
  if (targetBase === 'zh') {
    const sample = document.body?.innerText?.slice(0, 500) || '';
    const ratio = (sample.match(/[\u4e00-\u9fff]/g) || []).length / (sample.length || 1);
    if (ratio > 0.2) return false;
  }
  return true;
}

// ---- 消息监听 ----
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'TOGGLE_TRANSLATION':
        if (state.isTranslated) removeTranslations();
        else startTranslation();
        break;

      case 'START_TRANSLATION':
        startTranslation().then(() => sendResponse({ ok: true }));
        return true;

      case 'REMOVE_TRANSLATION':
        removeTranslations();
        sendResponse({ ok: true });
        break;

      case 'GET_STATUS':
        sendResponse({
          isTranslating: state.isTranslating,
          isTranslated: state.isTranslated,
          count: document.querySelectorAll(`[${LT.DONE_ATTR}]`).length,
        });
        break;

      case 'TRANSLATE_SELECTION':
        showSelectionPopup(msg.text);
        break;

      case 'SETTINGS_UPDATED':
        state.settings = msg.settings;
        break;
    }
  });
}

// 本地键盘快捷键监听，读取用户自定义设置
function setupKeyboardShortcut() {
  document.addEventListener('keydown', (e) => {
    if (!matchesShortcut(e, state.settings?.shortcut || 'Alt+T')) return;
    e.preventDefault();
    if (state.isTranslated) removeTranslations();
    else startTranslation();
  });
}

function matchesShortcut(e, shortcut) {
  // shortcut 格式如 "Alt+T" / "Ctrl+Shift+J"
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const needCtrl  = parts.includes('ctrl');
  const needAlt   = parts.includes('alt');
  const needShift = parts.includes('shift');
  const needMeta  = parts.includes('meta');
  return (
    e.ctrlKey  === needCtrl  &&
    e.altKey   === needAlt   &&
    e.shiftKey === needShift &&
    e.metaKey  === needMeta  &&
    e.key.toLowerCase() === key
  );
}

// ---- 收集需要翻译的元素 ----
function getTranslatableElements() {
  const customExclude = state.settings?.excludeSelectors?.trim();
  const fullExclude = customExclude
    ? `${EXCLUDE_PARENTS}, ${customExclude}`
    : EXCLUDE_PARENTS;

  // 反向遍历（内层 → 外层），内层元素优先，防止外层容器把整页文字合并翻译到底部
  const all = Array.from(document.querySelectorAll(getTranslateSelectors())).reverse();
  const dominated = new Set();
  const result = [];

  for (const el of all) {
    if (dominated.has(el)) continue;
    if (el.hasAttribute(LT.DONE_ATTR)) continue;
    if (el.closest(fullExclude)) continue;
    if (!isVisible(el)) continue;

    const text = getCleanText(el);
    if (!text || text.trim().length < 4) continue;
    // 跳过超长容器（说明是包含子元素的父容器，不应直接翻译）
    if (text.trim().length > 1500) continue;
    if (isTargetLang(text)) continue;

    // 将所有祖先标记为 dominated，确保父容器不会再被选中
    let ancestor = el.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      dominated.add(ancestor);
      ancestor = ancestor.parentElement;
    }

    result.push(el);
  }

  // 恢复文档顺序（从上到下依次翻译，视觉上更自然）
  result.reverse();
  return result;
}

function isVisible(el) {
  if (el.offsetParent === null && el.tagName !== 'BODY') return false;
  const s = window.getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
}

// 提取元素纯文本，忽略已插入的译文
function getCleanText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(`.${LT.RESULT_CLASS}`).forEach((n) => n.remove());
  return clone.textContent || '';
}

// 判断文本是否已经是目标语言（当前只处理中文目标）
function isTargetLang(text) {
  const targetBase = (state.settings?.targetLang || 'zh-CN').split('-')[0].toLowerCase();
  if (targetBase !== 'zh') return false;
  const t = text.trim();
  if (!t) return true;
  const zhCount = (t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  return zhCount / t.length > 0.25;
}

// ---- 主翻译流程 ----
async function startTranslation() {
  if (state.isTranslating) return;
  state.isTranslating = true;
  notifyPopup();

  // 更新图标为激活状态
  chrome.runtime.sendMessage({ type: 'SET_ICON', active: true }).catch(() => {});

  try {
    const elements = getTranslatableElements();
    if (elements.length === 0) {
      state.isTranslated = true;
      return;
    }

    const BATCH = state.settings?.service === 'openai' ? 10 : 15;

    for (let i = 0; i < elements.length; i += BATCH) {
      if (!state.isTranslating) break; // 被中止

      const batch = elements.slice(i, i + BATCH);
      // 跳过已经被翻译（可能前一批改了 DOM）
      const pending = batch.filter((el) => !el.hasAttribute(LT.DONE_ATTR));
      if (pending.length === 0) continue;

      const texts = pending.map((el) => getCleanText(el).trim());
      pending.forEach((el) => el.setAttribute(LT.PENDING_ATTR, ''));

      try {
        const res = await chrome.runtime.sendMessage({
          type: 'TRANSLATE',
          texts,
          settings: state.settings,
        });

        if (res?.success && res.translations) {
          pending.forEach((el, idx) => {
            const tr = res.translations[idx];
            if (tr) insertTranslation(el, tr);
            el.removeAttribute(LT.PENDING_ATTR);
            el.setAttribute(LT.DONE_ATTR, '');
          });
        } else {
          pending.forEach((el) => el.removeAttribute(LT.PENDING_ATTR));
          if (res?.error) showError(res.error);
        }
      } catch (err) {
        pending.forEach((el) => el.removeAttribute(LT.PENDING_ATTR));
        showError(err.message || '翻译失败');
        break;
      }

      notifyPopup();
    }

    state.isTranslated = true;
  } finally {
    state.isTranslating = false;
    notifyPopup();
  }
}

// ---- 插入译文 ----
function insertTranslation(el, translation) {
  // 防止重复插入
  const existing = el.querySelector(`.${LT.RESULT_CLASS}`);
  if (existing) {
    existing.textContent = translation;
    return;
  }

  const span = document.createElement('span');
  span.className = LT.RESULT_CLASS;
  span.textContent = translation;

  const theme = state.settings?.theme || 'underline';
  span.dataset.theme = theme;

  const colorMode = state.settings?.translationColorMode || 'inherit';
  if (colorMode === 'custom' && state.settings?.translationColor) {
    span.style.setProperty('--lt-color', state.settings.translationColor);
  }

  el.appendChild(span);
}

// ---- 移除所有译文 ----
function removeTranslations() {
  document.querySelectorAll(`.${LT.RESULT_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`[${LT.DONE_ATTR}]`).forEach((el) => {
    el.removeAttribute(LT.DONE_ATTR);
  });
  document.querySelectorAll(`[${LT.PENDING_ATTR}]`).forEach((el) => {
    el.removeAttribute(LT.PENDING_ATTR);
  });
  state.isTranslated = false;
  state.isTranslating = false;

  chrome.runtime.sendMessage({ type: 'SET_ICON', active: false }).catch(() => {});
  notifyPopup();
}

// ---- 选中文字翻译浮窗 ----
async function showSelectionPopup(text) {
  if (!document.body) return;
  removeSelectionPopup();

  const popup = document.createElement('div');
  popup.id = LT.POPUP_ID;
  popup.innerHTML = `
    <div class="lt-popup-header">
      <span class="lt-popup-title">翻译</span>
      <button class="lt-popup-close" title="关闭">✕</button>
    </div>
    <div class="lt-popup-original">${escapeHtml(text)}</div>
    <div class="lt-popup-result lt-loading">翻译中…</div>
  `;
  document.body.appendChild(popup);

  // 定位到选中文字附近
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const x = Math.min(rect.left + window.scrollX, window.innerWidth - 320 - 20);
    const y = rect.bottom + window.scrollY + 8;
    popup.style.left = `${Math.max(8, x)}px`;
    popup.style.top = `${y}px`;
  }

  popup.querySelector('.lt-popup-close').addEventListener('click', removeSelectionPopup);
  // 点击外部关闭
  setTimeout(() => {
    document.addEventListener('click', onOutsideClick, { once: true });
  }, 100);

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      texts: [text],
      settings: state.settings,
    });
    const resultEl = popup.querySelector('.lt-popup-result');
    resultEl.classList.remove('lt-loading');
    if (res?.success) {
      resultEl.textContent = res.translations[0] || '（无结果）';
    } else {
      resultEl.classList.add('lt-error');
      resultEl.textContent = res?.error || '翻译失败';
    }
  } catch (err) {
    const resultEl = popup.querySelector('.lt-popup-result');
    resultEl.classList.remove('lt-loading');
    resultEl.classList.add('lt-error');
    resultEl.textContent = err.message || '翻译失败';
  }
}

function removeSelectionPopup() {
  document.getElementById(LT.POPUP_ID)?.remove();
}

function onOutsideClick(e) {
  const popup = document.getElementById(LT.POPUP_ID);
  if (popup && !popup.contains(e.target)) removeSelectionPopup();
}

// ---- 错误提示 ----
let errorTimer = null;
function showError(msg) {
  if (!document.body) return;

  const existing = document.getElementById('lt-error-toast');
  if (existing) existing.remove();
  if (errorTimer) clearTimeout(errorTimer);

  const toast = document.createElement('div');
  toast.id = 'lt-error-toast';
  toast.textContent = `翻译出错：${msg}`;
  document.body.appendChild(toast);

  errorTimer = setTimeout(() => toast.remove(), 5000);
}

// ---- 通知 popup 状态更新 ----
function notifyPopup() {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    data: {
      isTranslating: state.isTranslating,
      isTranslated: state.isTranslated,
      count: document.querySelectorAll(`[${LT.DONE_ATTR}]`).length,
    },
  }).catch(() => {});
}

// ---- 加载设置 ----
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        service: 'google',
        apiKey: '',
        apiBaseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-nano',
        targetLang: 'zh-CN',
        autoTranslate: false,
        aggressiveMode: false,
        shortcut: 'Alt+T',
        theme: 'underline',
        translationColorMode: 'inherit',
        translationColor: '#1a73e8',
        systemPrompt: '',
        excludeSelectors: '',
      },
      resolve
    );
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- 启动 ----
init();
