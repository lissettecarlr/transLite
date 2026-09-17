// Shared validation; credentials never belong in the public settings object.
const LT_CONFIG = (() => {
  const presets = {
    qwen: { label: '通义千问 · 阿里云中国内地', apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash' },
    openai: { label: 'OpenAI 官方', apiBaseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-nano' },
    custom: { label: '其他兼容接口' },
    local: { label: '本机 vLLM 服务', apiBaseUrl: 'http://localhost:8000/v1', model: 'Qwen/Qwen3.8-Flash' },
  };
  function endpoint(value, provider = 'custom') {
    let url;
    try { url = new URL(value); } catch { throw new Error('请输入完整的接口地址，例如 https://api.example.com/v1'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(provider === 'local' && loopback && url.protocol === 'http:'))) {
      throw new Error('远程接口必须使用 HTTPS，地址不能包含密码、查询参数或片段；HTTP 仅用于本机服务');
    }
    if (provider === 'local' && !loopback) throw new Error('本机服务只允许 localhost、127.0.0.1 或 ::1');
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    return url.href.replace(/\/+$/, '');
  }
  function sanitize(input = {}) {
    const result = {};
    for (const [key, fallback] of Object.entries(LT_DEFAULTS)) {
      const value = input[key] ?? fallback;
      if (typeof value !== typeof fallback) throw new Error('设置格式无效');
      result[key] = typeof value === 'string' ? value.trim() : value;
    }
    if (!['google', 'openai'].includes(result.service) || !presets[result.provider] ||
        !['off', 'default'].includes(result.thinkingMode) || !['underline', 'block', 'highlight'].includes(result.theme) ||
        !['inherit', 'custom'].includes(result.translationColorMode) || !/^#[\da-f]{6}$/i.test(result.translationColor) ||
        !['zh-CN','zh-TW','en','ja','ko','fr','de','es','ru','ar','pt','it','vi','th'].includes(result.targetLang)) {
      throw new Error('设置选项无效');
    }
    result.apiBaseUrl = endpoint(result.apiBaseUrl, result.provider);
    if (!result.model || result.model.length > 150 || result.systemPrompt.length > 4000) throw new Error('模型名称或提示词长度无效');
    if (result.litellmBaseUrl) result.litellmBaseUrl = endpoint(result.litellmBaseUrl, 'custom');
    return result;
  }
  function publicSettings(settings) {
    return Object.fromEntries(['service','targetLang','aggressiveMode','theme','translationColorMode','translationColor','litellmBaseUrl'].map(key => [key, settings[key]]));
  }
  function originPattern(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('当前页面不支持翻译');
    // Chrome match patterns cover every port on the selected host.
    return `${url.protocol}//${url.hostname}/*`;
  }
  function destination(settings) { return settings.service === 'google' ? 'https://translate.googleapis.com' : new URL(settings.apiBaseUrl).origin; }
  function consentKey(settings) { return `${settings.service}:${destination(settings)}`; }
  return { presets, endpoint, sanitize, publicSettings, originPattern, destination, consentKey };
})();
