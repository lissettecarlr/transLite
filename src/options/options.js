const $ = (id) => document.getElementById(id);

const DEFAULTS = {
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
};

async function init() {
  const settings = await load();
  applyToForm(settings);
  bindEvents();
}

function applyToForm(s) {
  // 翻译服务
  const radioService = document.querySelector(`input[name="service"][value="${s.service}"]`);
  if (radioService) radioService.checked = true;
  toggleOpenAISection(s.service === 'openai');

  // OpenAI 配置
  $('api-key').value = s.apiKey || '';
  $('api-base-url').value = s.apiBaseUrl || DEFAULTS.apiBaseUrl;
  $('model').value = s.model || DEFAULTS.model;
  $('system-prompt').value = s.systemPrompt || '';

  // 翻译行为
  $('target-lang').value = s.targetLang || 'zh-CN';
  $('auto-translate').checked = !!s.autoTranslate;
  $('aggressive-mode').checked = !!s.aggressiveMode;
  $('shortcut-input').value = s.shortcut || DEFAULTS.shortcut;

  // 主题
  const radioTheme = document.querySelector(`input[name="theme"][value="${s.theme || 'underline'}"]`);
  if (radioTheme) radioTheme.checked = true;

  // 译文颜色
  const colorMode = s.translationColorMode || 'inherit';
  const radioColor = document.querySelector(`input[name="translation-color-mode"][value="${colorMode}"]`);
  if (radioColor) radioColor.checked = true;
  $('translation-color').value = s.translationColor || '#1a73e8';
  $('color-hex-label').textContent = s.translationColor || '#1a73e8';
  $('color-picker-wrap').classList.toggle('hidden', colorMode !== 'custom');

  // 高级
  $('exclude-selectors').value = s.excludeSelectors || '';
}

function collectFromForm() {
  const service = document.querySelector('input[name="service"]:checked')?.value || 'google';
  const theme = document.querySelector('input[name="theme"]:checked')?.value || 'block';

  return {
    service,
    apiKey: $('api-key').value.trim(),
    apiBaseUrl: $('api-base-url').value.trim() || DEFAULTS.apiBaseUrl,
    model: $('model').value.trim() || DEFAULTS.model,
    systemPrompt: $('system-prompt').value.trim(),
    targetLang: $('target-lang').value,
    autoTranslate: $('auto-translate').checked,
    aggressiveMode: $('aggressive-mode').checked,
    shortcut: $('shortcut-input').value || DEFAULTS.shortcut,
    theme,
    translationColorMode: document.querySelector('input[name="translation-color-mode"]:checked')?.value || 'inherit',
    translationColor: $('translation-color').value,
    excludeSelectors: $('exclude-selectors').value.trim(),
  };
}

function bindEvents() {
  // 服务切换
  document.querySelectorAll('input[name="service"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      toggleOpenAISection(radio.value === 'openai');
    });
  });

  // 密码显示切换
  document.querySelector('.toggle-password').addEventListener('click', () => {
    const input = $('api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // 模型快捷选择
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('model').value = btn.dataset.model;
    });
  });

  // 译文颜色模式切换
  document.querySelectorAll('input[name="translation-color-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      $('color-picker-wrap').classList.toggle('hidden', radio.value !== 'custom');
    });
  });
  $('translation-color').addEventListener('input', (e) => {
    $('color-hex-label').textContent = e.target.value;
  });

  // 快捷键录入
  const shortcutInput = $('shortcut-input');
  shortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const parts = [];
    if (e.ctrlKey)  parts.push('Ctrl');
    if (e.altKey)   parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey)  parts.push('Meta');
    const key = e.key;
    // 忽略单独按修饰键
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
    // 必须带修饰键
    if (parts.length === 0) return;
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    shortcutInput.value = parts.join('+');
  });
  shortcutInput.addEventListener('focus', () => {
    shortcutInput.placeholder = '请按下快捷键组合…';
    shortcutInput.select();
  });
  shortcutInput.addEventListener('blur', () => {
    shortcutInput.placeholder = '点击后按下快捷键组合…';
  });
  $('shortcut-clear').addEventListener('click', () => {
    shortcutInput.value = DEFAULTS.shortcut;
  });

  // 高级设置折叠
  $('advanced-toggle').addEventListener('click', () => {
    const content = $('advanced-content');
    const isOpen = !content.classList.contains('hidden');
    content.classList.toggle('hidden', isOpen);
    $('advanced-toggle').classList.toggle('open', !isOpen);
  });

  // 保存
  $('btn-save').addEventListener('click', saveSettings);

  // 重置
  $('btn-reset').addEventListener('click', () => {
    if (confirm('确定要恢复所有默认设置吗？')) {
      applyToForm(DEFAULTS);
      showSaveStatus('已恢复默认设置', false);
    }
  });

  // Enter 保存
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSettings();
    }
  });
}

async function saveSettings() {
  const settings = collectFromForm();

  // 简单验证
  if (settings.service === 'openai' && !settings.apiKey) {
    showSaveStatus('⚠ 请填写 API Key', true);
    $('api-key').focus();
    return;
  }

  await chrome.storage.sync.set(settings);

  // 通知所有活动 tab 的 content script 更新设置
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  tabs.forEach((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings }).catch(() => {});
  });

  showSaveStatus('✓ 已保存', false);
}

function toggleOpenAISection(show) {
  $('openai-config').classList.toggle('hidden', !show);
}

let statusTimer = null;
function showSaveStatus(msg, isError) {
  const el = $('save-status');
  el.textContent = msg;
  el.style.color = isError ? '#ffcdd2' : 'rgba(255,255,255,0.95)';
  el.style.opacity = '1';
  if (statusTimer) clearTimeout(statusTimer);
  if (!isError) {
    statusTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 2500);
  }
}

function load() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, resolve));
}

init();
