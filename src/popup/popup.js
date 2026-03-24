const $ = (id) => document.getElementById(id);

let currentTab = null;
let settings = {};

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

function updateUI({ isTranslating, isTranslated, count } = {}) {
  if (isTranslating) {
    setStatus('loading', `翻译中… 已完成 ${count ?? 0} 段`);
    $('btn-translate').disabled = true;
    $('btn-text').textContent = '翻译中…';
    $('btn-clear').classList.add('hidden');
    $('count-badge').classList.add('hidden');
  } else if (isTranslated) {
    setStatus('done', `翻译完成`);
    $('btn-translate').disabled = false;
    $('btn-text').textContent = '重新翻译';
    $('btn-clear').classList.remove('hidden');
    $('count-badge').classList.remove('hidden');
    $('count-badge').textContent = `${count ?? 0} 段`;
  } else {
    setStatus('idle', '准备就绪');
    $('btn-translate').disabled = false;
    $('btn-text').textContent = '翻译此页面';
    $('btn-clear').classList.add('hidden');
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

    // 先保存当前选择的目标语言
    const lang = $('target-lang').value;
    if (lang !== settings.targetLang) {
      settings.targetLang = lang;
      await chrome.storage.sync.set({ targetLang: lang });
      // 通知 content script 更新设置
      await chrome.tabs.sendMessage(currentTab.id, {
        type: 'SETTINGS_UPDATED',
        settings,
      }).catch(() => {});
    }

    setStatus('loading', '翻译中…');
    $('btn-translate').disabled = true;
    $('btn-text').textContent = '翻译中…';

    try {
      await chrome.tabs.sendMessage(currentTab.id, { type: 'START_TRANSLATION' });
    } catch {
      setStatus('error', '无法连接到页面，请刷新后重试');
      $('btn-translate').disabled = false;
      $('btn-text').textContent = '翻译此页面';
    }
  });

  $('btn-clear').addEventListener('click', async () => {
    if (!currentTab?.id) return;
    await chrome.tabs.sendMessage(currentTab.id, { type: 'REMOVE_TRANSLATION' }).catch(() => {});
    updateUI({ isTranslating: false, isTranslated: false, count: 0 });
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
