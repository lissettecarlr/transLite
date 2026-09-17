import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/translation.js', import.meta.url), 'utf8');
function harness(responder) {
  const calls = [];
  const event = { addListener() {} };
  const context = vm.createContext({
    console, URL, DOMException, AbortController, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
    importScripts(name) {
      vm.runInContext(fs.readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'), context, { filename: name });
    },
    chrome: { runtime: { onInstalled: event, onStartup: event, onMessage: event }, commands: { onCommand: event }, contextMenus: { onClicked: event }, storage: { session: { get: async () => ({}) } } },
    fetch: async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      calls.push({ url, body, options });
      if (responder) return responder({ url, body, options });
      const texts = JSON.parse(body.messages[1].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(texts.map(text => `译文：${text}`)) } }] }) };
    },
  });
  vm.runInContext(fs.readFileSync(new URL('../src/model-policy.js', import.meta.url),'utf8'),context);
  vm.runInContext(source, context);
  return { calls, translate: (texts, settings = {}) => context.handleTranslation(texts, { service: 'openai', apiKey: 'fixture-key', model: 'qwen3.5-flash', ...settings }) };
}

test('Qwen requests explicitly disable thinking by default', async () => {
  const h = harness();
  await h.translate(['A short paragraph.']);
  assert.equal(h.calls[0].body.enable_thinking, false);
});

test('duplicate and overlapping requests share work; completed translations are cached', async () => {
  const h = harness();
  const [first, second] = await Promise.all([h.translate(['Shared text', 'Shared text']), h.translate(['Shared text'])]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(first.translations)), ['译文：Shared text', '译文：Shared text']);
  assert.equal(second.translations[0], '译文：Shared text');
  await h.translate(['Shared text']);
  assert.equal(h.calls.length, 1);
  await h.translate(['Shared text'], { targetLang: 'ja' });
  await h.translate(['Shared text'], { systemPrompt: 'Translate formally.' });
  assert.equal(h.calls.length, 3, 'language and prompt must isolate the cache');
});

test('malformed or mismatched model output is rejected instead of mapped to wrong paragraphs', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '["Only one result"]' } }] }) }));
  await assert.rejects(() => h.translate(['Paragraph one', 'Paragraph two']), /格式|数量|JSON/);
});

test('provider defaults and thinking-only / unrelated models do not receive a Qwen toggle', async () => {
  const h = harness();
  await h.translate(['A'], { thinkingMode: 'default' });
  await h.translate(['B'], { model: 'qwen3-235b-a22b-thinking-2507' });
  await h.translate(['C'], { model: 'other-model' });
  for (const call of h.calls) assert.equal(call.body.enable_thinking, undefined);
});

test('Google bounds URL sizes and fallback concurrency without losing text order', async () => {
  let active = 0, peak = 0;
  const h = harness(async ({ url }) => {
    peak = Math.max(peak, ++active);
    assert.ok(url.length < 6000, `oversized Google URL: ${url.length}`);
    const source = new URL(url).searchParams.get('q');
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    const result = source.includes('⟦LT⟧') ? 'Separator was destroyed' : `结果：${source.trim()}`;
    return { ok: true, json: async () => [[[result]]] };
  });
  const texts = Array.from({ length: 18 }, (_, i) => `This is source paragraph ${i}.`);
  const translated = await h.translate(texts, { service: 'google' });
  assert.deepEqual(Array.from(translated.translations), texts.map(text => `结果：${text}`));
  const long = await h.translate(['界'.repeat(2400) + '🙂'.repeat(10)], { service: 'google' });
  assert.ok(long.translations[0].includes('🙂'));
  assert.equal(long.translations[0].match(/界/g).length, 2400);
  assert.ok(peak <= 3 && peak > 1, `unbounded or serial requests: ${peak}`);
});

test('a failed request is retried next time and is never cached', async () => {
  let attempt = 0;
  const h = harness(async () => {
    if (++attempt === 1) return { ok: false, status: 401 };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '["恢复后的译文"]' } }] }) };
  });
  await assert.rejects(() => h.translate(['Try this again.']), /401/);
  assert.equal((await h.translate(['Try this again.'])).translations[0], '恢复后的译文');
  assert.equal(h.calls.length, 2);
});

test('template thinking mode uses the configured gateway protocol', async () => {
  const h = harness();
  await h.translate(['Test gateway'], { provider: 'local' });
  assert.deepEqual(h.calls[0].body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(h.calls[0].body.enable_thinking, undefined);
  assert.ok(h.calls[0].options.signal instanceof AbortSignal);
});

test('model families automatically select compatible reasoning parameters', async () => {
  const cases = [
    ['qwen3.8-flash', { enable_thinking: false }, 0.1],
    ['Qwen/Qwen3.8-Flash', { enable_thinking: false }, 0.1],
    ['qwen2.5-72b-instruct', {}, 0.1],
    ['qwen3.8-2.4t-a95b', {}, 0.1],
    ['openai/gpt-5.4-nano', { reasoning_effort: 'none' }, undefined],
    ['gpt-5.1', { reasoning_effort: 'none' }, undefined],
    ['gpt-5.2-2025-12-11', { reasoning_effort: 'none' }, undefined],
    ['gpt-5-mini', { reasoning_effort: 'minimal' }, undefined],
    ['gpt-5-pro', {}, undefined],
    ['gpt-4o', {}, 0.1],
    ['gpt-4.1-mini', {}, 0.1],
    ['deepseek-v4-flash', { thinking: { type: 'disabled' } }, 0.1],
    ['deepseek-reasoner', {}, 0.1],
    ['unknown-model', {}, 0.1],
  ];
  for (const [model, expected, temperature] of cases) {
    const h = harness();
    await h.translate(['A paragraph to translate.'], { model, thinkingMode: 'off' });
    const { model: sentModel, messages, temperature: sentTemperature, ...options } = h.calls[0].body;
    assert.equal(sentModel, model, 'do not rewrite the configured model or alias');
    assert.deepEqual(options, expected, model);
    assert.equal(sentTemperature, temperature, model);
  }
});

test('legacy Qwen overrides never contaminate a request after switching to GPT', async () => {
  for (const thinkingMode of ['auto', 'qwen', 'template']) {
    const h = harness();
    await h.translate(['Switch models'], { model: 'gpt-5.4-nano', thinkingMode });
    assert.equal(h.calls[0].body.reasoning_effort, 'none');
    assert.equal(h.calls[0].body.enable_thinking, undefined);
    assert.equal(h.calls[0].body.chat_template_kwargs, undefined);
  }
});

test('model default mode omits reasoning overrides and has its own cache', async () => {
  const h = harness();
  await h.translate(['Same paragraph'], { model: 'gpt-5.4-nano', thinkingMode: 'off' });
  await h.translate(['Same paragraph'], { model: 'gpt-5.4-nano', thinkingMode: 'default' });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].body.reasoning_effort, undefined);
  assert.equal(h.calls[1].body.temperature, undefined);
});
