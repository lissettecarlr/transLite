// Content Script - 核心翻译逻辑

const LT = {
  PREFIX: 'lt',
  RESULT_CLASS: 'lt-result',
  DONE_ATTR: 'data-lt-done',
  PENDING_ATTR: 'data-lt-pending',
  WRAP_CLASS: 'lt-wrap',
  POPUP_ID: 'lt-selection-popup',
};

// 激进模式：全页块级文本（含导航风险，由用户显式开启）
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
  const aggressive = !!state.settings?.aggressiveMode;
  const base = aggressive
    ? [...TRANSLATE_SELECTORS_BASE, ...TRANSLATE_SELECTORS_AGGRESSIVE]
    : [...TRANSLATE_SELECTORS_BASE];

  const custom = state.settings?.includeSelectors?.trim();
  if (custom) {
    custom.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      if (!base.includes(s)) base.push(s);
    });
  }

  return base.join(',');
}

/**
 * 非激进模式下，判断元素是否"可点击"：原生交互标签、href/onclick、交互 ARIA 角色、
 * tabindex>=0、或 cursor:pointer。满足任一条件则跳过翻译，避免破坏按钮/链接布局。
 */
function isClickable(el) {
  const tag = el.tagName.toLowerCase();
  if (['button', 'a', 'select', 'textarea', 'input'].includes(tag)) return true;
  if (el.hasAttribute('href') || el.hasAttribute('onclick')) return true;
  const role = el.getAttribute('role');
  if (['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'gridcell'].includes(role)) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) >= 0) return true;
  if (window.getComputedStyle(el).cursor === 'pointer') return true;
  // 元素嵌套在可点击祖先内（如 <span> 在 <a> 里）
  if (el.closest('a[href], button, [role="button"], [role="link"], [onclick]')) return true;
  // td/th/li/dt/dd 是容器型选择器，内部任意深度含链接或按钮时视为交互容器，直接跳过
  const CONTAINER_TAGS = ['td', 'th', 'li', 'dt', 'dd', 'summary'];
  if (CONTAINER_TAGS.includes(tag) && el.querySelector('a[href], button')) return true;
  return false;
}

/**
 * 非激进模式下，跳过导航/页眉/页脚里的 UI 元素，以及链接密度 > 50% 的导航型段落。
 * 链接密度是沉浸式翻译等工具的核心保护手段：菜单/面包屑/标签云里的 p/li 大部分文字
 * 都在 <a> 里，通过这个比例可以可靠地区分"正文段落"和"导航链接列表"。
 */
function shouldSkipNonAggressiveUiChrome(el) {
  if (state.settings?.aggressiveMode) return false;

  if (el.closest('nav, [role="navigation"]')) return true;

  const hdr = el.closest('header');
  if (hdr && !hdr.closest('main, article, [role="main"], [role="article"]')) return true;

  const ftr = el.closest('footer');
  if (ftr && !ftr.closest('main, article, [role="main"], [role="article"]')) return true;

  // 链接密度检测：超过 50% 的字符在 <a> 内则视为导航型元素，跳过
  const fullText = getCleanText(el).trim();
  if (fullText.length > 0) {
    let anchorLen = 0;
    for (const a of el.querySelectorAll('a')) {
      for (const node of a.childNodes) {
        if (node.nodeType === 3) anchorLen += node.textContent.length;
      }
    }
    if (anchorLen / fullText.length > 0.5) return true;
  }

  return false;
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
  translatedCount: 0,
  settings: null,
};

function isRuntimeAvailable() {
  try {
    return !!chrome?.runtime?.id;
  } catch (_) {
    return false;
  }
}

function sendRuntimeMessageSafe(message, callback) {
  if (!isRuntimeAvailable()) return null;
  try {
    if (typeof callback === 'function') {
      chrome.runtime.sendMessage(message, callback);
      return null;
    }
    const maybePromise = chrome.runtime.sendMessage(message);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      return maybePromise.catch(() => null);
    }
    return Promise.resolve(null);
  } catch (_) {
    return Promise.resolve(null);
  }
}

// ---- 初始化 ----
async function init() {
  state.settings = await loadSettings();
  setupMessageListener();
  setupKeyboardShortcut();
  setupMutationObserver();

  if (state.settings.autoTranslate && shouldAutoTranslate()) {
    setTimeout(() => startTranslation(), 1500);
  }
}

// ---- MutationObserver：处理 SPA 动态插入/更新的内容 ----
function setupMutationObserver() {
  let debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    if (!state.isTranslated || state.isTranslating) return;

    let shouldRetranslate = false;

    for (const m of mutations) {
      if (m.type === 'characterData') {
        const parent = m.target.parentElement;
        if (parent?.hasAttribute(LT.DONE_ATTR)) {
          parent.querySelector(`.${LT.RESULT_CLASS}`)?.remove();
          parent.removeAttribute(LT.DONE_ATTR);
          state.translatedCount = Math.max(0, state.translatedCount - 1);
          shouldRetranslate = true;
        }
      } else if (m.type === 'childList') {
        const hasRealNodes = [...m.addedNodes].some(
          (n) => n.nodeType === 1 && !n.classList?.contains(LT.RESULT_CLASS)
        );
        if (hasRealNodes) shouldRetranslate = true;
      }
    }

    if (!shouldRetranslate) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => startTranslation(), 800);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,  // 监听文本节点原地更新（React reconciliation 复用节点时）
  });
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
        // 立即回复，不等翻译完成；状态通过 STATUS_UPDATE 推送给 popup
        sendResponse({ ok: true });
        startTranslation();
        break;

      case 'REMOVE_TRANSLATION':
        removeTranslations();
        sendResponse({ ok: true });
        break;

      case 'GET_STATUS':
        sendResponse({
          isTranslating: state.isTranslating,
          isTranslated: state.isTranslated,
          count: state.translatedCount,
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
    if (shouldSkipNonAggressiveUiChrome(el)) continue;
    if (!state.settings?.aggressiveMode && isClickable(el)) continue;

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

  // 正文优先：main/article 内的元素先翻译，nav/aside/header/footer 最后翻译
  // Array.sort 在 V8 中是稳定排序，同优先级内相对顺序不变
  result.sort((a, b) => contentPriority(a) - contentPriority(b));

  return result;
}

function contentPriority(el) {
  if (el.closest('main, article, [role="main"], [role="article"]')) return 0;
  if (el.closest('nav, aside, header, footer, [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"]')) return 2;
  return 1;
}

function isVisible(el) {
  const s = window.getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  // position:fixed 的元素 offsetParent 永远是 null，但它们仍然可见
  if (el.offsetParent === null && s.position !== 'fixed' && s.position !== 'sticky' && el.tagName !== 'BODY') return false;
  return true;
}

// 提取元素纯文本，忽略已插入的译文（递归遍历避免 cloneNode 开销）
function getCleanText(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      text += node.textContent;
    } else if (node.nodeType === 1 && !node.classList.contains(LT.RESULT_CLASS)) {
      text += getCleanText(node);
    }
  }
  return text;
}

// 判断文本是否已经是目标语言（支持中/日/韩/阿/泰/俄等独立书写系统）
function isTargetLang(text) {
  const targetBase = (state.settings?.targetLang || 'zh-CN').split('-')[0].toLowerCase();
  const t = text.trim();
  if (!t) return true;

  const detectors = {
    zh: { regex: /[\u4e00-\u9fff\u3400-\u4dbf]/g, threshold: 0.4 },
    ja: { regex: /[\u3040-\u309f\u30a0-\u30ff]/g, threshold: 0.15 },
    ko: { regex: /[\uac00-\ud7af\u3130-\u318f]/g, threshold: 0.3 },
    ar: { regex: /[\u0600-\u06ff]/g, threshold: 0.3 },
    th: { regex: /[\u0e00-\u0e7f]/g, threshold: 0.3 },
    ru: { regex: /[\u0400-\u04ff]/g, threshold: 0.3 },
  };

  const detector = detectors[targetBase];
  if (!detector) return false;

  const matchCount = (t.match(detector.regex) || []).length;
  return matchCount / t.length > detector.threshold;
}

// ---- 主翻译流程 ----
async function startTranslation() {
  if (state.isTranslating) return;
  state.isTranslating = true;
  notifyPopup();

  // 更新图标为激活状态
  sendRuntimeMessageSafe({ type: 'SET_ICON', active: true });

  try {
    const elements = getTranslatableElements();
    if (elements.length === 0) {
      state.isTranslated = true;
      return;
    }

    const BATCH = 10;

    for (let i = 0; i < elements.length; i += BATCH) {
      if (!state.isTranslating) break;

      const batch = elements.slice(i, i + BATCH);
      const pending = batch.filter((el) => !el.hasAttribute(LT.DONE_ATTR));
      if (pending.length === 0) continue;

      const texts = pending.map((el) => getCleanText(el).trim());
      pending.forEach((el) => el.setAttribute(LT.PENDING_ATTR, ''));

      try {
        const res = await sendTranslateMessage(texts);

        if (res?.success && res.translations) {
          pending.forEach((el, idx) => {
            const tr = res.translations[idx];
            if (tr) insertTranslation(el, tr);
            el.removeAttribute(LT.PENDING_ATTR);
            el.setAttribute(LT.DONE_ATTR, '');
            state.translatedCount++;
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
  state.translatedCount = 0;

  sendRuntimeMessageSafe({ type: 'SET_ICON', active: false });
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
    const res = await sendTranslateMessage([text]);
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
// 必须用回调并读取 lastError，否则控制台会标黄 "Unchecked runtime.lastError"（Promise 的 catch 消不掉）
function notifyPopup() {
  const data = {
    isTranslating: state.isTranslating,
    isTranslated: state.isTranslated,
    count: state.translatedCount,
  };
  sendRuntimeMessageSafe({ type: 'STATUS_UPDATE', data }, () => {
    if (!isRuntimeAvailable()) return;
    void chrome.runtime.lastError;
  });
}

// ---- 加载设置 ----
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(LT_DEFAULTS, resolve);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- 发送翻译请求（带一次重试，应对 Service Worker 被 Chrome 休眠后重唤的情况）----
async function sendTranslateMessage(texts) {
  try {
    return await chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      texts,
      settings: state.settings,
    });
  } catch (err) {
    // SW 被休眠时会抛 "Could not establish connection"，等一小会重试一次
    if (err?.message?.includes('Could not establish connection') ||
        err?.message?.includes('message channel closed')) {
      await new Promise((r) => setTimeout(r, 600));
      return chrome.runtime.sendMessage({
        type: 'TRANSLATE',
        texts,
        settings: state.settings,
      });
    }
    throw err;
  }
}

// ---- 启动 ----
init();
