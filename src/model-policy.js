// Shared by the settings page and service worker so the displayed policy and
// the actual Chat Completions request always agree. Model names identify the
// model family; they do not change the user's configured API endpoint.
const LT_MODEL_POLICY = (() => {
  function resolve(settings = {}) {
    const model = String(settings.model || '').trim().toLowerCase().split('/').pop();
    let provider = '', state = 'unknown', options = {};
    const openaiReasoning = /^gpt-[5-9](?:\D|$)|^o[1-9](?:-|$)/.test(model);

    if (model.startsWith('qwen') || model.startsWith('qwq')) {
      provider = '通义千问';
      if (/thinking|^qwq|^qwen3\.8-2\.4t-a95b(?:-|$)/.test(model)) {
        state = 'required';
      } else if (/^qwen[12](?:\D|$)|^qwen3-.*-instruct(?:-|$)/.test(model)) {
        state = 'native';
      } else {
        state = 'off';
        options = { enable_thinking: false };
        if (settings.provider === 'local') options = { chat_template_kwargs: { enable_thinking: false } };
      }
    } else if (model.startsWith('gpt') || /^o[1-9](?:-|$)/.test(model)) {
      provider = 'OpenAI';
      if (/^gpt-(?:3\.5|4)(?:[.o-]|$)/.test(model)) {
        state = 'native';
      } else if (/(?:-pro|-codex|-chat)(?:-|$)/.test(model)) {
        // Specialized variants have different allowed effort values.
        state = 'unknown';
      } else if (/^gpt-5\.(?:1|2|4|5)(?:-|$)/.test(model)) {
        state = 'off';
        options = { reasoning_effort: 'none' };
      } else if (/^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
        state = 'minimum';
        options = { reasoning_effort: 'minimal' };
      } else if (/^gpt-6-astra(?:-|$)/.test(model)) {
        state = 'minimum';
        options = { reasoning_effort: 'low' };
      }
    } else if (model.startsWith('deepseek')) {
      provider = 'DeepSeek';
      if (/^deepseek-(?:r1|reasoner)(?:-|$)/.test(model)) {
        state = 'required';
      } else if (/^deepseek-(?:chat|v3\.2|v4)(?:-|$)/.test(model)) {
        state = 'off';
        options = { thinking: { type: 'disabled' } };
      }
    }

    if (settings.thinkingMode === 'default') {
      state = 'default';
      options = {};
    }
    // GPT reasoning models reject temperature in several modes. Leaving it
    // unspecified is valid both with and without reasoning enabled.
    return { provider, state, options, allowTemperature: !openaiReasoning };
  }

  function describe(settings) {
    const policy = resolve(settings);
    const prefix = policy.provider ? `已识别 ${policy.provider} · ` : '';
    const messages = {
      off: '翻译时发送关闭思考参数，具体支持取决于所选接口',
      native: '此模型无需关闭深度思考',
      minimum: '此模型无法完全关闭思考，将使用最低强度',
      required: '此模型仅支持思考，建议换用非思考模型以加快翻译',
      unknown: '暂无法确认思考开关，将保留模型默认行为',
      default: '使用模型默认的思考设置',
    };
    return prefix + messages[policy.state];
  }

  return { resolve, describe };
})();
