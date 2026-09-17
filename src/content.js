(() => {
if (globalThis.__LT_INSTALLED) return;
globalThis.__LT_INSTALLED = true;
// Content Script - 核心翻译逻辑

const LT = {
  RESULT_CLASS: 'lt-result',
  DONE_ATTR: 'data-lt-done',
  PENDING_ATTR: 'data-lt-pending',
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

function getSiteAdapter() {
  if (state.settings?.targetLang && !['zh', 'zh-CN'].includes(state.settings.targetLang)) return null;
  const adapters = globalThis.LT_SITE_ADAPTERS || {};
  const currentUrl = new URL(location.href);
  return Object.values(adapters).find((adapter) => {
    try {
      return adapter.matches(currentUrl, document, state.settings);
    } catch (_) {
      return false;
    }
  }) || null;
}

function getTranslateSelectors() {
  const aggressive = !!state.settings?.aggressiveMode;
  const adapter = getSiteAdapter();
  const base = aggressive
    ? [...TRANSLATE_SELECTORS_BASE, ...TRANSLATE_SELECTORS_AGGRESSIVE]
    : [...TRANSLATE_SELECTORS_BASE];

  if (adapter?.selectors) {
    adapter.selectors.forEach((selector) => {
      if (!base.includes(selector)) base.push(selector);
    });
  }

  const custom = validCustomSelector(state.settings?.includeSelectors);
  if (custom) {
    base.push(custom);
  }

  return base.join(',');
}

const selectorValidity = new Map();
function validCustomSelector(value) {
  const selector = value?.trim();
  if (!selector) return '';
  if (selectorValidity.has(selector)) return selectorValidity.get(selector) ? selector : '';
  try {
    document.querySelectorAll(selector);
    if (selectorValidity.size >= 20) selectorValidity.clear();
    selectorValidity.set(selector, true);
    return selector;
  } catch (_) {
    selectorValidity.set(selector, false);
    return '';
  }
}

/**
 * 非激进模式下，判断元素是否"可点击"：原生交互标签、href/onclick、交互 ARIA 角色、
 * tabindex>=0、或 cursor:pointer。满足任一条件则跳过翻译，避免破坏按钮/链接布局。
 */
function isClickable(el) {
  if (getSiteAdapter()?.allowInteractiveUi) return false;

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
  // 容器型标签：内部交互元素文字占比 > 50% 时视为"本质上是个按钮/链接"，跳过翻译
  // 避免误杀正文（如 GitHub release notes 里的 @mention/#issue 只占少数）
  const CONTAINER_TAGS = ['td', 'th', 'li', 'dt', 'dd', 'summary'];
  if (CONTAINER_TAGS.includes(tag)) {
    const fullText = getCleanText(el).trim();
    if (fullText.length > 0) {
      let interactiveLen = 0;
      for (const node of el.querySelectorAll('a[href], button')) {
        interactiveLen += getCleanText(node).length;
      }
      if (interactiveLen / fullText.length > 0.5) return true;
    }
  }
  return false;
}

/**
 * 非激进模式下，跳过导航/页眉/页脚里的 UI 元素，以及链接密度 > 50% 的导航型段落。
 * 链接密度是沉浸式翻译等工具的核心保护手段：菜单/面包屑/标签云里的 p/li 大部分文字
 * 都在 <a> 里，通过这个比例可以可靠地区分"正文段落"和"导航链接列表"。
 */
function shouldSkipNonAggressiveUiChrome(el) {
  if (state.settings?.aggressiveMode) return false;
  if (getSiteAdapter()?.allowInteractiveUi) return false;

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
  '[contenteditable]:not([contenteditable="false"])', 'input', 'textarea', 'select',
  '[translate="no"]', '.notranslate', '[hidden]', '[aria-hidden="true"]',
  '#lt-selection-popup', '#lt-error-toast',
].join(',');

let state = {
  phase: 'idle',
  error: '',
  taskId: null,
  pendingUnits: new Map(),
  dirtyRoots: new Set(),
  isTranslating: false,
  isTranslated: false,
  translatedCount: 0,
  rescanRequested: false,
  enabled: false,
  generation: 0,
  outputUnits: new Set(),
  completedNodes: new Set(),
  queuedUnits: new Set(),
  settings: null,
  translatedAttributes: new Map(),
  replacedTextNodes: new Map(),
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
  setupMutationObserver();
  window.addEventListener('scroll', scheduleRescan, {passive:true, capture:true});
  window.addEventListener('resize', scheduleRescan, {passive:true});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRescan(); });
  window.addEventListener('pagehide', stopTranslation);
  if (state.settings.siteRule === 'always' && shouldAutoTranslate()) autoStartTimer = setTimeout(() => void startTranslation(), 300);
}

// ---- Dynamic pages: ignore our own writes; invalidate only changed content. ----
let rescanTimer = null;
let autoStartTimer = null;
function scheduleRescan() {
  if (!state.enabled || document.hidden) return;
  if (state.isTranslating) { state.rescanRequested = true; return; }
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    if (state.enabled) void startTranslation();
  }, getSiteAdapter()?.mutationDebounceMs ?? 120);
}

function isExtensionNode(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return !!el?.closest?.(`.${LT.RESULT_CLASS}, #${LT.POPUP_ID}, #lt-error-toast`);
}

function hasExternalMutation(mutation) {
  if (isExtensionNode(mutation.target)) return false;
  if (mutation.type === 'characterData') {
    const tracked = state.replacedTextNodes.get(mutation.target);
    return !tracked || mutation.target.nodeValue !== tracked.translated;
  }
  if (mutation.type === 'attributes') {
    const tracked = state.translatedAttributes.get(mutation.target)?.[mutation.attributeName];
    return !tracked || mutation.target.getAttribute(mutation.attributeName) !== tracked.translated;
  }
  return [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])].some(node =>
    !isExtensionNode(node) && (node.nodeType === Node.ELEMENT_NODE || !!node.textContent?.trim()));
}

let observer;
function setupMutationObserver() {
  observer = new MutationObserver(mutations => {
    if (!state.enabled) return;
    const external = mutations.filter(hasExternalMutation);
    if (!external.length) return;
    for (const mutation of external) {
      const target = mutation.target?.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target?.parentElement;
      if (!target) continue;
      if (target === document.body) {
        for (const node of mutation.addedNodes || []) if (node.nodeType === Node.ELEMENT_NODE) state.dirtyRoots.add(node);
        if ([...(mutation.addedNodes || [])].some(node => node.nodeType === Node.TEXT_NODE)) state.dirtyRoots.add(target);
      } else state.dirtyRoots.add(LT_DOM.scanRoot(target));
    }
    for (const unit of state.queuedUnits) {
      if (external.some(m => {
        const target = m.target?.nodeType === Node.ELEMENT_NODE ? m.target : m.target?.parentElement;
        return target && (unit.el.contains?.(target) || target.contains?.(unit.el));
      })) unit.invalidated = true;
    }
    for (const unit of state.outputUnits) {
      const affected = (unit.span && !unit.span.isConnected) || !LT_DOM.isCurrent(unit) || external.some(m => {
        const target = m.target?.nodeType === Node.ELEMENT_NODE ? m.target : m.target?.parentElement;
        return target && unit.el.contains(target);
      });
      if (!affected) continue;
      if (unit.el.isConnected) state.dirtyRoots.add(unit.el);
      unit.span?.remove();
      unit.sources.forEach(source => state.completedNodes.delete(source.node));
      state.outputUnits.delete(unit);
      state.translatedCount = Math.max(0, state.translatedCount - 1);
    }
    state.replacedTextNodes.forEach((record, node) => {
      if (node.isConnected && node.nodeValue === record.translated) return;
      state.replacedTextNodes.delete(node);
      state.completedNodes.delete(node);
      node.parentElement?.closest?.(`[${LT.DONE_ATTR}]`)?.removeAttribute(LT.DONE_ATTR);
      state.translatedCount = Math.max(0, state.translatedCount - 1);
    });
    // Adapter markers belong to elements; frameworks can replace their text
    // children without replacing those elements.
    for (const mutation of external) {
      const el = mutation.target?.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target?.parentElement;
      el?.closest?.(`[${LT.DONE_ATTR}]`)?.removeAttribute(LT.DONE_ATTR);
    }
    scheduleRescan();
  });
}
function observePage() {
  if (document.body) observer.observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['title','aria-label','placeholder','hidden','aria-hidden','translate','contenteditable'],
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
      case 'PING':
        initialization.then(() => sendResponse({ok:true}), () => sendResponse({ok:false}));
        return true;
      case 'SITE_RULE_UPDATED':
        state.settings.siteRule = msg.rule;
        if (msg.rule !== 'always') stopTranslation();
        else if (!state.enabled && shouldAutoTranslate()) void startTranslation();
        sendResponse({ok:true});
        break;
      case 'TOGGLE_TRANSLATION':
        if (state.isTranslating) stopTranslation();
        else if (state.phase === 'watching') removeTranslations();
        else startTranslation();
        break;

      case 'STOP_TRANSLATION':
        stopTranslation();
        sendResponse({ ok: true });
        break;

      case 'START_TRANSLATION':
        initialization.then(() => startTranslation())
          .then(() => sendResponse({ ok: true, status: getTranslationStatus() }))
          .catch((error) => sendResponse({
            ok: false,
            error: error?.message || '翻译失败',
            status: getTranslationStatus(),
          }));
        return true;

      case 'REMOVE_TRANSLATION':
        removeTranslations();
        sendResponse({ ok: true });
        break;

      case 'GET_STATUS':
        sendResponse(getTranslationStatus());
        break;

      case 'TRANSLATE_SELECTION':
        showSelectionPopup(msg.text);
        break;

      case 'SETTINGS_UPDATED':
        {
          removeTranslations();
          state.settings = msg.settings;
          sendResponse({ ok: true });
        }
        break;
    }
  });
}

function getTranslatableElements() {
  const adapter = getSiteAdapter();
  const customExclude = validCustomSelector(state.settings?.excludeSelectors);
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
    if (!text) continue;
    const localTranslation = adapter?.translate?.(text.trim()) ?? null;
    const minLength = adapter?.minTextLength ?? 4;
    if (text.trim().length < minLength && localTranslation === null) continue;
    // 跳过超长容器（说明是包含子元素的父容器，不应直接翻译）
    if (text.trim().length > 1500) continue;
    if (isTargetLang(text)) continue;
    // 跳过纯 ASCII 的"数字 + 单词"短文本（如 "2 stars"、"15 forks"），
    // 这类 UI 计数徽章由翻译服务随机决定是否翻译，容易造成不一致。
    const allowRemote = !!adapter?.allowRemoteTranslation?.(text, el);
    if (adapter?.shouldTranslate && !adapter.shouldTranslate(text) && !allowRemote) continue;
    if (isCountBadge(text) && localTranslation === null) continue;

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
// 跳过不可见/辅助元素：hidden、sr-only、popover tooltip、aria-hidden
function getCleanText(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      text += node.textContent;
    } else if (node.nodeType === 1 && !node.classList.contains(LT.RESULT_CLASS)) {
      if (shouldSkipInvisibleNode(node)) continue;
      if (node.hasAttribute(LT.DONE_ATTR)) continue;
      text += getCleanText(node);
    }
  }
  return text;
}

function shouldSkipInvisibleNode(node) {
  const tag = node.tagName.toLowerCase();
  // 脚本/样式/嵌套文档：文字内容不是给用户看的
  if (['script', 'style', 'noscript', 'template', 'iframe'].includes(tag)) return true;
  // DOM hidden 属性：元素不可见
  if (node.hasAttribute('hidden')) return true;
  if (node.matches?.(EXCLUDE_PARENTS)) return true;
  const custom = validCustomSelector(state.settings?.excludeSelectors);
  if (custom && node.matches?.(custom)) return true;
  // CSS sr-only / visually-hidden：仅屏幕阅读器可见，不是页面实际文字
  const cls = node.classList;
  if (cls.contains('sr-only') || cls.contains('visually-hidden') || cls.contains('screen-reader-only')) return true;
  // popover tooltip（如 GitHub <tool-tip popover="manual" class="sr-only">）
  if (node.hasAttribute('popover')) return true;
  // 自定义 tooltip 标签
  if (tag === 'tool-tip' || tag === 'tooltip') return true;
  return false;
}

function getTranslationStatus() {
  return {
    phase: state.phase,
    error: state.error,
    isTranslating: state.isTranslating,
    isTranslated: state.isTranslated,
    count: state.translatedCount,
  };
}

// Site adapters may keep visible labels in attributes rather than text nodes,
// especially search placeholders and aria-labels. Translate only entries
// covered by the adapter's local dictionary; unknown attributes stay untouched.
function translateAdapterAttributes() {
  const adapter = getSiteAdapter();
  if (!adapter?.attributes?.length) return;

  const selector = adapter.attributes.map((attribute) => `[${attribute}]`).join(',');
  document.querySelectorAll(selector).forEach((element) => {
    if (element.closest('script,style,noscript,template,svg,.lt-result,[translate="no"],.notranslate')) return;
    const excluded = validCustomSelector(state.settings?.excludeSelectors);
    if (excluded && element.closest(excluded)) return;
    if (element.isContentEditable && !adapter.translateContentEditableAttributes) return;

    const previous = state.translatedAttributes.get(element) || {};
    let changed = false;

    adapter.attributes.forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      const current = element.getAttribute(attribute) || '';
      const tracked = previous[attribute];
      const source = tracked && current === tracked.translated ? tracked.original : current;
      const translation = adapter.translate(source);
      if (!translation || translation === source) return;

      previous[attribute] = { original: source, translated: translation };
      if (current !== translation) element.setAttribute(attribute, translation);
      changed = true;
    });

    if (changed) state.translatedAttributes.set(element, previous);
  });
}

function preserveWhitespace(original, translation) {
  const source = String(original);
  const start = source.match(/^\s*/)?.[0] || '';
  const end = source.match(/\s*$/)?.[0] || '';
  return `${start}${String(translation).trim()}${end}`;
}

// Dictionary adapters replace the actual text node in place so navigation
// stays one line tall and the normal transLite bilingual <span> is not added.
function replaceAdapterText(element, translation, sourceText) {
  const nodes = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(EXCLUDE_PARENTS)) continue;
    nodes.push(node);
  }

  const source = String(sourceText || '').trim();
  const exact = nodes.filter((textNode) => textNode.nodeValue.trim() === source);
  const target = exact.length === 1 ? exact[0] : nodes.length === 1 ? nodes[0] : null;
  if (!target) return false;

  const translated = preserveWhitespace(target.nodeValue, translation);
  if (!state.replacedTextNodes.has(target)) {
    state.replacedTextNodes.set(target, { original: target.nodeValue, translated });
  } else {
    state.replacedTextNodes.get(target).translated = translated;
  }
  target.nodeValue = translated;
  return true;
}

// 常见英文功能词：出现这些词说明文本是真实句子，不应视为 UI 标签
const COUNT_BADGE_SKIP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
  'be', 'been', 'will', 'would', 'could', 'should', 'may', 'might',
  'must', 'do', 'does', 'did', 'for', 'of', 'to', 'in', 'on', 'at',
  'by', 'with', 'from', 'as', 'into', 'this', 'that', 'these', 'those',
  'it', 'its', 'and', 'or', 'but', 'not', 'if', 'any', 'all', 'both',
  'each', 'few', 'some', 'up', 'out', 'can', 'no', 'new', 'left',
]);

// 判断是否是 UI 计数徽章/栏目标签，这类文本翻译后容易产生不一致，直接跳过。
// 逻辑：纯 ASCII + 无英文功能词 + 所有 token ≤ 10 字符 + 含数字（或单个短词）
function isCountBadge(text) {
  const t = text.trim().replace(/\s+/g, ' ');  // 折叠空白
  if (/[^\x00-\x7f]/.test(t)) return false;    // 含非 ASCII → 不是徽章
  if (t.length > 80) return false;
  const tokens = t.split(' ');
  // 含英文功能词 → 真实句子，不跳过（如 "2 pages left to read"）
  if (tokens.some((tok) => COUNT_BADGE_SKIP_WORDS.has(tok.toLowerCase()))) return false;
  // 所有 token 必须是短词（≤ 10 字符），排除真实内容长词
  if (!tokens.every((tok) => tok.length <= 10)) return false;
  // 含数字 token → 计数徽章（"2 stars"、"Starred 2 Lists Star 2 Lists"）
  if (tokens.some((tok) => /^[\d,.]+[kmb]?$/i.test(tok))) return true;
  // 单个纯字母短词 → UI 栏目标签（"Stars"、"Forks"、"Watching"）
  if (tokens.length === 1 && /^[A-Za-z]{2,10}$/.test(tokens[0])) return true;
  return false;
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

// ---- Translation queue: viewport first, bounded concurrent batches. ----
function collectUnits(adapter, root = document.body) {
  if (adapter) {
    return getTranslatableElements().map(el => ({ el, text: getCleanText(el).trim(), mode: 'adapter' }));
  }
  return LT_DOM.collect(state.settings, state.completedNodes, root).filter(unit => !isTargetLang(unit.text));
}

function unitIsCurrent(unit) {
  if (unit.invalidated) return false;
  if (unit.mode === 'adapter') return unit.el.isConnected !== false && getCleanText(unit.el).trim() === unit.text;
  return LT_DOM.isCurrent(unit);
}

function applyTranslation(unit, translation, adapter) {
  state.queuedUnits.delete(unit);
  state.pendingUnits.delete(unit.node || unit.sources?.[0]?.node || unit.el);
  if (!unitIsCurrent(unit)) { state.rescanRequested = true; if (unit.el.isConnected) state.dirtyRoots.add(unit.el); return; }
  if (unit.mode === 'adapter') {
    if (!replaceAdapterText(unit.el, translation, unit.text)) return;
    unit.el.setAttribute(LT.DONE_ATTR, '');
  } else {
    if (unit.mode === 'replace') {
      const value = preserveWhitespace(unit.node.nodeValue, translation);
      state.replacedTextNodes.set(unit.node, { original: unit.node.nodeValue, translated: value });
      unit.node.nodeValue = value;
    } else {
      if (translation.trim() !== unit.text) unit.span = insertTranslation(unit, translation);
      state.outputUnits.add(unit);
    }
    unit.sources.forEach(source => state.completedNodes.add(source.node));
  }
  state.translatedCount++;
}

function batchUnits(units) {
  const batches = [];
  let chunk = [], size = 0;
  for (const unit of units) {
    if (chunk.length && (chunk.length >= 8 || size + unit.text.length > 3000)) {
      batches.push(chunk); chunk = []; size = 0;
    }
    chunk.push(unit); size += unit.text.length;
  }
  if (chunk.length) batches.push(chunk);
  return batches;
}

function nearby(unit) {
  const r = unit.el.getBoundingClientRect?.();
  return !r || (r.bottom >= -innerHeight * 0.5 && r.top <= innerHeight * 1.5 && r.right >= 0 && r.left <= innerWidth);
}
async function startTranslation() {
  if (state.isTranslating || document.hidden) return;
  const generation = ++state.generation;
  if (!state.enabled) { state.dirtyRoots.add(document.body); state.pendingUnits.clear(); }
  state.enabled = true;
  observePage();
  state.rescanRequested = false;
  state.isTranslating = true;
  state.phase = 'translating'; state.error = '';
  notifyPopup();
  let failed = false, taskId = null;
  try {
    translateAdapterAttributes();
    const adapter = getSiteAdapter();
    const roots = adapter ? [document.body] : [...state.dirtyRoots].filter(root => root.isConnected);
    state.dirtyRoots.clear();
    const minimalRoots = roots.filter(root => !roots.some(other => other !== root && other.contains(root)));
    for (const root of minimalRoots) for (const unit of collectUnits(adapter, root)) {
      state.pendingUnits.set(unit.node || unit.sources?.[0]?.node || unit.el, unit);
    }
    for (const [key, unit] of state.pendingUnits) if (!unitIsCurrent(unit)) state.pendingUnits.delete(key);
    const units = [...state.pendingUnits.values()].filter(nearby);
    state.queuedUnits = new Set(units);
    const priority = unit => {
      const r = unit.el.getBoundingClientRect?.();
      return (r && (r.bottom < 0 || r.top > innerHeight) ? 10 : 0) + contentPriority(unit.el);
    };
    units.sort((a,b) => priority(a)-priority(b));
    const remote = [];
    for (const unit of units) {
      const local = adapter?.translate?.(unit.text) ?? null;
      if (local !== null) applyTranslation(unit, local, adapter);
      else if (!adapter?.localOnly || adapter.allowRemoteTranslation?.(unit.text, unit.el)) remote.push(unit);
      else state.pendingUnits.delete(unit.node || unit.sources?.[0]?.node || unit.el);
    }
    const batches = batchUnits(remote);
    if (batches.length) {
      taskId = crypto.randomUUID(); state.taskId = taskId;
      await taskMessage({type:'BEGIN_TASK', taskId});
      if (generation !== state.generation) { await taskMessage({type:'CANCEL_TASK', taskId}); return; }
    }
    let next = 0;
    const worker = async () => {
      while (generation === state.generation && !failed && !document.hidden && next < batches.length) {
        const batch = batches[next++].filter(unitIsCurrent);
        if (!batch.length) continue;
        batch.forEach(unit => unit.el.setAttribute(LT.PENDING_ATTR, ''));
        try {
          const response = await sendTranslateMessage(batch.map(unit => unit.text), taskId);
          if (generation !== state.generation) return;
          if (!Array.isArray(response.translations) || response.translations.length !== batch.length || response.translations.some(text => typeof text !== 'string' || !text.trim())) throw new Error('译文数量或格式不匹配，请重试');
          batch.forEach((unit,index) => applyTranslation(unit,response.translations[index],adapter));
        } catch(error) {
          if (generation !== state.generation) return;
          failed = true; state.error = error.message || '翻译失败';
        } finally {
          if (generation === state.generation) batch.forEach(unit => unit.el.removeAttribute(LT.PENDING_ATTR));
        }
        if (generation === state.generation) notifyPopup();
      }
    };
    await Promise.all(Array.from({length:state.settings.service === 'openai' ? 2 : 3},worker));
  } catch(error) {
    if (generation === state.generation) { failed = true; state.error = error.message || '翻译失败'; }
  } finally {
    if (taskId) sendRuntimeMessageSafe({type:'END_TASK',taskId});
    if (generation === state.generation) {
      state.taskId = null; state.queuedUnits.clear(); state.isTranslating = false;
      state.isTranslated = state.translatedCount > 0;
      state.phase = failed ? (state.isTranslated ? 'partial' : 'error') : 'watching';
      if (failed) {state.enabled = false; observer.disconnect(); showError(state.error);}
      notifyPopup();
      if (state.rescanRequested && !failed) scheduleRescan();
    }
  }
}

function insertTranslation(unit, translation) {
  const span = document.createElement('span');
  span.className = LT.RESULT_CLASS;
  span.textContent = translation;
  span.lang = state.settings.targetLang;
  span.dir = 'auto';
  span.dataset.theme = state.settings.theme || 'underline';
  if (state.settings.translationColorMode === 'custom' && state.settings.translationColor) {
    span.style.setProperty('--lt-color', state.settings.translationColor);
  }
  // Insert at the text run's boundary, keeping nested blocks and every
  // original node (including React-owned text nodes) in their original place.
  unit.anchor.after(span);
  return span;
}

function stopTranslation() {
  ++state.generation;
  if (state.taskId) sendRuntimeMessageSafe({type:'CANCEL_TASK', taskId:state.taskId});
  state.taskId = null; state.phase = 'stopped'; state.error = '';
  observer?.disconnect();
  state.enabled = false;
  state.rescanRequested = false;
  state.queuedUnits.clear();
  clearTimeout(rescanTimer);
  clearTimeout(autoStartTimer);
  state.isTranslating = false;
  state.isTranslated = state.translatedCount > 0;
  document.querySelectorAll(`[${LT.PENDING_ATTR}]`).forEach(el => el.removeAttribute(LT.PENDING_ATTR));

  notifyPopup();
}

function removeTranslations() {
  stopTranslation();
  document.querySelectorAll(`.${LT.RESULT_CLASS}`).forEach(el => el.remove());
  document.querySelectorAll(`[${LT.DONE_ATTR}]`).forEach(el => el.removeAttribute(LT.DONE_ATTR));
  state.replacedTextNodes.forEach((record, node) => {
    // A SPA may have reused this node for new source content. Never restore
    // obsolete text over a change made by the application.
    if (node.isConnected && node.nodeValue === record.translated) node.nodeValue = record.original;
  });
  state.replacedTextNodes.clear();
  state.translatedAttributes.forEach((attributes, el) => {
    for (const [name, record] of Object.entries(attributes)) {
      if (el.isConnected && el.getAttribute(name) === record.translated) el.setAttribute(name, record.original);
    }
  });
  state.translatedAttributes.clear();
  state.outputUnits.clear();
  state.completedNodes.clear();
  state.isTranslated = false;
  state.translatedCount = 0; state.phase = 'idle';
  state.pendingUnits.clear(); state.dirtyRoots.clear();
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
    const resultEl = popup.querySelector('.lt-popup-result');
    resultEl.classList.remove('lt-loading');
    const adapter = getSiteAdapter();
    const localTranslation = adapter?.translate?.(text) ?? null;
    if (localTranslation !== null) {
      resultEl.textContent = localTranslation;
      return;
    }
    const selectionElement = window.getSelection?.()?.anchorNode?.parentElement || null;
    if (adapter?.localOnly && !adapter?.allowRemoteTranslation?.(text, selectionElement)) {
      resultEl.textContent = '该词条暂未收录';
      return;
    }

    const taskId = crypto.randomUUID();
    selectionTask = taskId;
    await taskMessage({type:'BEGIN_TASK', taskId});
    if (selectionTask !== taskId) { await taskMessage({type:'CANCEL_TASK',taskId}); return; }
    let res;
    try {res = await sendTranslateMessage([text], taskId);} finally {sendRuntimeMessageSafe({type:'END_TASK',taskId});}
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

let selectionTask = null;
function removeSelectionPopup() {
  if (selectionTask) sendRuntimeMessageSafe({type:'CANCEL_TASK', taskId:selectionTask});
  selectionTask = null;
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
  const data = getTranslationStatus();
  sendRuntimeMessageSafe({ type: 'STATUS_UPDATE', data }, () => {
    if (!isRuntimeAvailable()) return;
    void chrome.runtime.lastError;
  });
}

// The background sends only page-rendering preferences, never credentials.
async function loadSettings() {
  return (await taskMessage({type:'GET_PAGE_SETTINGS'})).settings;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function taskMessage(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.success) throw new Error(result?.error || '扩展连接中断，请重新点击翻译');
  return result;
}
function sendTranslateMessage(texts, taskId) { return taskMessage({type:'TRANSLATE', texts, taskId}); }

const initialization = init();
setupMessageListener();
initialization.catch(error => {state.phase='error'; state.error=error.message; notifyPopup();});

})();
