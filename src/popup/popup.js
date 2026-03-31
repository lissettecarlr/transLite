const $ = (id) => document.getElementById(id);

let currentTab = null;
let settings = {};
let currentStatus = { isTranslating: false, isTranslated: false, count: 0 };

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  settings = await loadSettings();
  applySettings();
  await refreshStatus();
  bindEvents();
}

function applySettings() {
  $('target-lang').value = settings.targetLang || 'zh-CN';

  const serviceName = { google: 'Google', openai: settings.model || 'OpenAI' };
  $('service-badge').textContent = serviceName[settings.service] || 'Google';

  const shortcut = settings.shortcut || LT_DEFAULTS.shortcut;
  $('shortcut-hint').textContent = `${shortcut} 快速切换`;
}

async function refreshStatus() {
  if (!currentTab?.id) return;

  try {
    const res = await chrome.tabs.sendMessage(currentTab.id, { type: 'GET_STATUS' });
    updateUI(res);
  } catch {
    // content script 未注入（如 chrome:// 页面）
    setStatus('idle', '当前页面不支持翻译');
    $('btn-translate').disabled = true;
  }
}

// SVG 图标
const ICON_TRANSLATE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>`;
const ICON_STOP = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;
const ICON_CLEAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>`;

function updateUI({ isTranslating, isTranslated, count } = {}) {
  currentStatus = { isTranslating: !!isTranslating, isTranslated: !!isTranslated, count: count ?? 0 };
  const btn = $('btn-translate');

  if (isTranslating) {
    setStatus('loading', `翻译中… 已完成 ${count ?? 0} 段`);
    btn.disabled = false;
    btn.className = 'btn-stop';
    $('btn-icon').innerHTML = ICON_STOP;
    $('btn-text').textContent = '停止翻译';
    $('count-badge').classList.add('hidden');
  } else if (isTranslated) {
    setStatus('done', `翻译完成，共 ${count ?? 0} 段`);
    btn.disabled = false;
    btn.className = 'btn-secondary';
    $('btn-icon').innerHTML = ICON_CLEAR;
    $('btn-text').textContent = '取消翻译';
    $('count-badge').classList.remove('hidden');
    $('count-badge').textContent = `${count ?? 0} 段`;
  } else {
    setStatus('idle', '准备就绪');
    btn.disabled = false;
    btn.className = 'btn-primary';
    $('btn-icon').innerHTML = ICON_TRANSLATE;
    $('btn-text').textContent = '翻译此页面';
    $('count-badge').classList.add('hidden');
  }
}

function setStatus(type, text) {
  $('status-dot').className = `status-dot ${type}`;
  $('status-text').textContent = text;
}

function bindEvents() {
  $('btn-translate').addEventListener('click', async () => {
    if (!currentTab?.id) return;

    if (currentStatus.isTranslating) {
      // 停止翻译（保留已翻译内容）
      await chrome.tabs.sendMessage(currentTab.id, { type: 'STOP_TRANSLATION' }).catch(() => {});
      return;
    }

    if (currentStatus.isTranslated) {
      // 取消翻译（清除所有译文）
      await chrome.tabs.sendMessage(currentTab.id, { type: 'REMOVE_TRANSLATION' }).catch(() => {});
      updateUI({ isTranslating: false, isTranslated: false, count: 0 });
      return;
    }

    // 开始翻译
    const lang = $('target-lang').value;
    if (lang !== settings.targetLang) {
      settings.targetLang = lang;
      await chrome.storage.sync.set({ targetLang: lang });
      await chrome.tabs.sendMessage(currentTab.id, {
        type: 'SETTINGS_UPDATED',
        settings,
      }).catch(() => {});
    }

    updateUI({ isTranslating: true, isTranslated: false, count: 0 });

    try {
      await chrome.tabs.sendMessage(currentTab.id, { type: 'START_TRANSLATION' });
    } catch {
      setStatus('error', '无法连接到页面，请刷新后重试');
      updateUI({ isTranslating: false, isTranslated: false, count: 0 });
    }
  });

  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  $('target-lang').addEventListener('change', (e) => {
    settings.targetLang = e.target.value;
    const serviceName = { google: 'Google', openai: settings.model || 'OpenAI' };
    $('service-badge').textContent = serviceName[settings.service] || 'Google';
  });

  // content → SW 写入 session，popup 监听（content 的 sendMessage 进不了 popup）
  chrome.storage.session.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !currentTab?.id) return;
    const key = `ltStatus_${currentTab.id}`;
    if (changes[key]?.newValue != null) {
      updateUI(changes[key].newValue);
    }
  });
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(LT_DEFAULTS, resolve);
  });
}

init();
