// 页面右侧的悬浮设置入口。
// 目的是给没有扩展工具栏的浏览器（例如 Steam 内嵌的 CEF 浏览器）留一个进设置页的地方，
// 这里只做「打开设置」一件事，不参与翻译流程，可独立注入。
(() => {
  if (globalThis.__LT_SETTINGS_BUTTON__) return;
  globalThis.__LT_SETTINGS_BUTTON__ = true;

  const HOST_ID = 'lt-settings-fab';
  const TITLE = '久远的翻译工具 · 设置';
  let mounted = null;

  const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  const STYLE = `
    :host { all: initial; }
    .fab {
      all: initial;
      display: flex; align-items: center; justify-content: center;
      box-sizing: border-box; width: 40px; height: 40px; padding: 0;
      border: 0; border-radius: 50%;
      background: #1a73e8; color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,.28);
      cursor: pointer; opacity: .8;
      transition: opacity .15s ease, transform .15s ease;
    }
    .fab { position: relative; }
    .badge {
      display: none; position: absolute; top: -3px; right: -3px;
      width: 15px; height: 15px; border-radius: 50%;
      background: #fff; color: #d32f2f;
      font: 700 11px/15px system-ui, sans-serif; text-align: center;
    }
    .fab.error { background: #d32f2f; opacity: 1; }
    .fab.error .badge { display: block; }
    .hint {
      all: initial;
      display: none; position: absolute; right: 50px; top: 50%; transform: translateY(-50%);
      max-width: 220px; padding: 7px 10px;
      border-radius: 8px; background: #d32f2f; color: #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,.3);
      font: 400 12px/1.5 system-ui, sans-serif;
      cursor: pointer; white-space: normal;
    }
    :host([data-state="error"]) .hint { display: block; }
    .fab.muted { opacity: .42; filter: grayscale(1); }
    .fab.busy { animation: lt-pulse 1.2s ease-in-out infinite; }
    @keyframes lt-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .fab.busy { animation: none; } }
    .fab:hover, .fab:focus-visible { opacity: 1; transform: scale(1.06); }
    .fab:focus-visible { outline: 2px solid #1a73e8; outline-offset: 3px; }
    .fab:active { transform: scale(.96); }
    @media (prefers-color-scheme: dark) {
      .fab { background: #3b82f6; box-shadow: 0 2px 10px rgba(0,0,0,.55); }
    }
    @media (prefers-reduced-motion: reduce) { .fab { transition: none; } }
    @media print { :host { display: none !important; } }
  `;

  // 没有工具栏时，这个按钮是唯一的反馈面：翻译中脉动、失败变红并在提示里写原因。
  function setState(state, detail) {
    const button = mounted?.shadowRoot?.querySelector('.fab');
    if (!button) return;
    button.classList.toggle('error', state === 'error');
    button.classList.toggle('busy', state === 'busy');
    button.classList.toggle('muted', state === 'muted');
    button.title = state === 'error'
      ? `自动翻译未开始：${detail || '未知原因'}（点击打开设置）`
      : state === 'muted'
        ? `没有翻译：${detail || '没有可翻译的内容'}（点击可改设置）`
        : detail ? `${TITLE}｜${detail}` : TITLE;
    // 提示气泡：没有工具栏时，光靠 hover 的 tooltip 太隐蔽。
    mounted?.setAttribute('data-state', state === 'error' ? 'error' : 'ok');
    const hint = mounted?.shadowRoot?.querySelector('.hint');
    if (hint) hint.textContent = state === 'error' ? `翻译没开始：${detail || '未知原因'}｜点此设置` : '';
  }

  function openSettings() {
    if (!chrome?.runtime?.id) return;
    try {
      // 必须走后台：内容脚本没有 openOptionsPage。
      chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }, () => void chrome.runtime.lastError);
    } catch (_) {}
  }

  function build() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('translate', 'no');
    host.setAttribute('data-lt-skip', '');
    // 关键样式走内联，避免被站点 CSS 的 :host 低特异性覆盖。
    // 离右边留 12px，避开浏览器滚动条，避免挡住拖动。
    host.style.cssText = 'position:fixed;top:46%;right:12px;z-index:2147483644;display:block;margin:0;padding:0;border:0;';
    const root = host.attachShadow({ mode: 'open' });
    const hint = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = STYLE;
    const button = document.createElement('button');
    button.className = 'fab';
    button.type = 'button';
    button.title = TITLE;
    button.setAttribute('aria-label', '打开扩展设置');
    button.innerHTML = `${ICON}<span class="badge">!</span>`;
    hint.className = 'hint';
    hint.addEventListener('click', openSettings);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openSettings();
    });
    hint.title = '点击打开设置';
    root.append(style, button, hint);
    return host;
  }

  function mount(attempt = 0) {
    if (mounted?.isConnected) return mounted;
    const target = document.body || document.documentElement;
    if (!target) {
      // 有些页面 document_idle 时还没 body，最多等 5 秒。
      if (attempt < 25) setTimeout(() => mount(attempt + 1), 200);
      return null;
    }
    mounted = build();
    target.appendChild(mounted);
    watchHost();
    return mounted;
  }

  // 页面把 body 整个换掉（或某个框架重绘）时，按钮会被一起删掉，这里补回来。
  // 只观察「直接子节点」：既能看到 body 被替换，也能看到自己从 body 里被摘掉，不会跟着整页改动空转。
  const watched = new WeakSet();
  function watchHost() {
    if (typeof MutationObserver !== 'function') return;
    const restore = () => {
      if (!mounted || mounted.isConnected) return;
      mounted = null;
      mount();
    };
    for (const target of [document.documentElement, document.body]) {
      if (!target || watched.has(target)) continue;
      watched.add(target);
      new MutationObserver(restore).observe(target, { childList: true });
    }
  }

  function unmount() {
    mounted?.remove();
    document.getElementById(HOST_ID)?.remove();
    mounted = null;
  }

  // Service Worker 注册失败时页面侧完全无感，这里主动问一次，问不到就把按钮变红。
  function checkBackground(settings) {
    try {
      const pending = chrome.runtime.sendMessage({ type: 'HEALTH' }, health => {
        const failed = chrome.runtime.lastError;
        if (failed || !health?.sw) return setState('error', '后台没有响应（Service Worker 未启动）');
        if (health.bootError) return setState('error', health.bootError);
        if (autoWanted(settings) && !health.consent) return setState('error', '还没同意发送待译文字，点按钮进设置勾选');
      });
      // 少数环境里 sendMessage 直接抛/返回被拒的 Promise，别让它变成未捕获异常。
      pending?.catch?.(() => setState('error', '后台没有响应（Service Worker 未启动）'));
    } catch (_) {}
  }

  // 与 content.js 里的同名判断保持一致：「跟随环境」只对拿不到工具栏的地方生效。
  function autoWanted(settings) {
    const mode = settings?.autoTranslate || 'auto';
    if (mode === 'always') return true;
    if (mode !== 'auto') return false;
    try {
      if ((chrome.runtime.getManifest?.().content_scripts || []).some(item => (item.js || []).includes('button.js'))) return true;
    } catch (_) {}
    // 用 globalThis，避免在没有 navigator 的测试环境里直接抛 ReferenceError。
  return (globalThis.navigator?.userAgent || '').includes('Valve Steam');
  }

  // 已经是目标语言的页面直接跳过，中文页不要自动翻译。
  function alreadyTargetLanguage(settings) {
    const targetBase = (settings?.targetLang || 'zh-CN').split('-')[0].toLowerCase();
    const lang = document.documentElement.lang?.toLowerCase() || '';
    if (lang && lang.startsWith(targetBase)) return true;
    if (targetBase !== 'zh') return false;
    const sample = (document.body?.innerText ?? document.body?.textContent ?? '').slice(0, 500);
    const ratio = (sample.match(/[\u4e00-\u9fff]/g) || []).length / (sample.length || 1);
    return ratio > 0.2;
  }

  async function start() {
    // Steam 客户端自己的界面页不出按钮。
    if (/(^|\.)steamloopback\.host$/i.test(globalThis.location?.hostname || '')) return;
    let settings = null;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_SETTINGS' });
      settings = response?.settings || null;
    } catch (_) {
      // 后台暂时失联时按默认值显示，比什么都不显示更可用。
    }
    if (settings?.floatingButton === false) unmount(); else mount();
    checkBackground(settings);
    // 没有工具栏就没有别的启动方式：由这个常驻注入的小脚本把翻译脚本拉起来。
    if (!settings || !autoWanted(settings) || alreadyTargetLanguage(settings)) return;
    try {
      chrome.runtime.sendMessage({ type: 'AUTO_START' }, response => {
        if (response && response.started === false) return setState('error', response.reason);
        // 注入成功不等于脚本跑起来了：解析失败时 content.js 会整块作废，页面侧毫无痕迹。
        setTimeout(() => {
          if (!globalThis.__LT_INSTALLED) setState('error', '页面脚本没有加载（content.js 未能运行）');
        }, 2000);
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  }

  document.addEventListener('lt-status', event => {
    const { phase, error, skipped, count } = event.detail || {};
    if (phase === 'error') setState('error', error);
    else if (phase === 'partial') setState('error', error || '部分内容未能翻译');
    else if (phase === 'translating') setState('busy');
    else if (skipped === 'target-language') setState('muted', '页面已经是中文，按设置跳过');
    else if (!count) setState('muted', '这个页面没找到可翻译的正文');
    else setState('idle', `已翻译 ${count} 段`);
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type !== 'SETTINGS_UPDATED') return;
    // 不调用 sendResponse：同页的 content.js 才是这条广播的应答方。
    if (msg.settings?.floatingButton === false) unmount();
    else mount();
  });

  start();
})();
