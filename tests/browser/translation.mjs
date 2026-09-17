import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.LT_BROWSER || 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, html, settings = {}, delay = 0) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://fixture.test/');
  await page.evaluate(({ settings, delay }) => {
    window.requests = [];
    window.activeRequests = 0;
    window.peakRequests = 0;
    window.listeners = [];
    window.chrome = {
      storage: { sync: { get(defaults, cb) { cb({ ...defaults, ...settings }); } } },
      runtime: {
        id: 'fixture', lastError: null,
        onMessage: { addListener(fn) { window.listeners.push(fn); } },
        sendMessage(message, cb) {
          cb?.({ ok: true });
          if (message.type === 'GET_PAGE_SETTINGS') return Promise.resolve({success:true,settings:{...LT_DEFAULTS,...settings}});
          if (message.type !== 'TRANSLATE') return Promise.resolve({ success:true, ok: true });
          window.requests.push(message.texts);
          window.peakRequests = Math.max(window.peakRequests, ++window.activeRequests);
          return new Promise(resolve => setTimeout(() => {
            window.activeRequests--;
            resolve({ success: true, translations: message.texts.map(text => `译文：${text}`) });
          }, delay));
        },
      },
    };
    window.send = type => new Promise(resolve => {
      const keep = window.listeners[0]({ type }, {}, resolve);
      if (!keep) resolve();
    });
  }, { settings, delay });
  await page.addStyleTag({ path: path.join(root, 'src/content.css') });
  for (const file of ['defaults.js', 'adapters/litellm.js', 'adapters/linear.js', 'dom.js', 'content.js']) {
    await page.addScriptTag({ path: path.join(root, 'src', file) });
  }
  await page.waitForFunction(() => window.listeners.length > 0);
  return page;
}

test('inline formatting remains one sentence; original nodes never get reparented', async t => {
  const page = await fixture(t, '<main><p id="text">Read the <strong>complete documentation</strong> before <a href="#read">installing the package</a>.</p></main>', { aggressiveMode: true });
  const result = await page.evaluate(async () => {
    const paragraph = document.querySelector('#text');
    const nodes = [...paragraph.childNodes];
    const original = paragraph.innerHTML;
    await window.send('START_TRANSLATION');
    await new Promise(resolve => setTimeout(resolve, 60));
    const requests = window.requests.flat();
    const preserved = nodes.every(node => node.parentNode === paragraph);
    const nestedResults = paragraph.querySelectorAll('strong .lt-result, a .lt-result').length;
    await window.send('REMOVE_TRANSLATION');
    return { requests, preserved, nestedResults, restored: paragraph.innerHTML === original };
  });
  assert.deepEqual(result.requests, ['Read the complete documentation before installing the package.']);
  assert.equal(result.preserved, true);
  assert.equal(result.nestedResults, 0);
  assert.equal(result.restored, true);
});

test('flex controls keep child count, height and listeners; removal restores labels', async t => {
  const page = await fixture(t, '<button style="display:flex;align-items:center;gap:8px;height:32px"><svg width="16" height="16"></svg><span>Open project settings</span></button>', { aggressiveMode: true });
  const result = await page.evaluate(async () => {
    const button = document.querySelector('button');
    const count = button.childNodes.length;
    const height = button.getBoundingClientRect().height;
    const label = button.querySelector('span');
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    await window.send('START_TRANSLATION');
    await new Promise(resolve => setTimeout(resolve, 60));
    button.click();
    const result = { extraBlocks: button.querySelectorAll('.lt-result').length, count: button.childNodes.length === count, height: button.getBoundingClientRect().height === height, clicks, translated: label.textContent.startsWith('译文：') };
    await window.send('REMOVE_TRANSLATION');
    return { ...result, restored: label.textContent === 'Open project settings' };
  });
  assert.deepEqual(result, { extraBlocks: 0, count: true, height: true, clicks: 1, translated: true, restored: true });
});

test('excluded descendants and editable areas are not sent for translation', async t => {
  const page = await fixture(t, '<p>Public description <span translate="no">Private secret</span><span class="exclude">Hidden secret</span><code>SECRET_CODE</code></p><div contenteditable><p>Unsaved user input</p></div>', { excludeSelectors: '.exclude' });
  await page.evaluate(() => window.send('START_TRANSLATION'));
  await page.waitForTimeout(60);
  const texts = await page.evaluate(() => window.requests.flat());
  assert.ok(texts.length > 0);
  assert.equal(texts.some(text => /secret|SECRET|Unsaved/.test(text)), false);
});

test('removing translations while a request is pending prevents late DOM writes', async t => {
  const page = await fixture(t, '<p>A paragraph that translates slowly.</p>', {}, 100);
  await page.evaluate(() => { void window.send('START_TRANSLATION'); });
  await page.waitForFunction(() => window.requests.length > 0);
  await page.evaluate(() => window.send('REMOVE_TRANSLATION'));
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.lt-result, [data-lt-pending], [data-lt-done]').count(), 0);
  assert.deepEqual(await page.evaluate(() => new Promise(resolve => window.listeners[0]({ type: 'GET_STATUS' }, {}, resolve))), { phase:'idle',error:'',isTranslating: false, isTranslated: false, count: 0 });
});

test('page batches run with bounded parallelism', async t => {
  const html = '<main>' + Array.from({ length: 30 }, (_, i) => `<p>A sample paragraph for the translation queue number ${i}.</p>`).join('') + '</main>';
  const page = await fixture(t, html, {}, 100);
  await page.evaluate(() => window.send('START_TRANSLATION'));
  await page.waitForTimeout(380);
  const peak = await page.evaluate(() => window.peakRequests);
  assert.ok(peak >= 2 && peak <= 3, `expected 2–3 simultaneous batches, got ${peak}`);
});

test('source changes during a request and nested changes after it are translated once', async t => {
  const page = await fixture(t, '<p id="article">The <strong>original sentence</strong> is here.</p>', {}, 100);
  await page.evaluate(() => { void window.send('START_TRANSLATION'); });
  await page.waitForFunction(() => window.requests.length > 0);
  await page.evaluate(() => { document.querySelector('strong').firstChild.nodeValue = 'updated sentence'; });
  await page.waitForFunction(() => document.querySelector('.lt-result')?.textContent === '译文：The updated sentence is here.');
  await page.evaluate(() => { document.querySelector('strong').firstChild.nodeValue = 'latest sentence'; });
  await page.waitForFunction(() => document.querySelector('.lt-result')?.textContent === '译文：The latest sentence is here.');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.lt-result').count(), 1);
  assert.equal(await page.evaluate(() => window.requests.length), 3, 'extension writes must not trigger a translation loop');
});

test('remove cancels a scheduled rescan, and preserves new SPA text over old originals', async t => {
  const page = await fixture(t, '<button>Open project settings</button><p>Initial paragraph content.</p>', { aggressiveMode: true });
  await page.evaluate(() => window.send('START_TRANSLATION'));
  await page.evaluate(() => {
    document.querySelector('button').firstChild.nodeValue = 'Application updated this label';
    const p = document.createElement('p');
    p.textContent = 'A dynamically appended paragraph.';
    document.body.append(p);
  });
  await page.evaluate(() => window.send('REMOVE_TRANSLATION'));
  const requests = await page.evaluate(() => window.requests.length);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.requests.length), requests);
  assert.equal(await page.locator('button').textContent(), 'Application updated this label');
  assert.equal(await page.locator('.lt-result').count(), 0);
});

test('inline text inserted during a request invalidates the whole sentence', async t => {
  const page = await fixture(t, '<p>This sentence is still being written.</p>', {}, 100);
  await page.evaluate(() => { void window.send('START_TRANSLATION'); });
  await page.waitForFunction(() => window.requests.length > 0);
  await page.evaluate(() => {
    const strong = document.createElement('strong');
    strong.textContent = ' Additional source text.';
    document.querySelector('p').append(strong);
  });
  await page.waitForFunction(() => document.querySelector('.lt-result')?.textContent === '译文：This sentence is still being written. Additional source text.');
  assert.equal(await page.locator('.lt-result').count(), 1);
});

test('failed requests leave retryable content and do not mark an untranslated page complete', async t => {
  const page = await fixture(t, '<p>A paragraph that should be retryable.</p>');
  const result = await page.evaluate(async () => {
    const originalSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message, cb) => message.type === 'TRANSLATE'
      ? Promise.resolve({ success: false, error: 'Temporary failure' }) : originalSend(message, cb);
    await window.send('START_TRANSLATION');
    const status = await new Promise(resolve => window.listeners[0]({ type: 'GET_STATUS' }, {}, resolve));
    chrome.runtime.sendMessage = originalSend;
    await window.send('START_TRANSLATION');
    return { status, count: document.querySelectorAll('.lt-result').length };
  });
  assert.equal(result.status.phase, 'error');
  assert.equal(result.status.count, 0);
  assert.equal(result.count, 1);
});

test('visible paragraphs have priority even when a long page is scrolled midway', async t => {
  const html = '<style>p{height:120px;margin:0}</style>' + Array.from({ length: 35 }, (_, i) => `<p id="p${i}">A paragraph for viewport priority number ${i}.</p>`).join('');
  const page = await fixture(t, html, {}, 40);
  await page.locator('#p20').scrollIntoViewIfNeeded();
  const visible = await page.evaluate(() => [...document.querySelectorAll('p')].filter(p => {
    const r = p.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight;
  }).map(p => p.textContent));
  await page.evaluate(() => window.send('START_TRANSLATION'));
  const first = await page.evaluate(() => window.requests[0]);
  assert.ok(first.some(text => visible.includes(text)));
  assert.equal(first.includes('A paragraph for viewport priority number 0.'), false);
});

test('partial failure has a distinct status and retry preserves completed paragraphs', async t => {
  const page = await fixture(t, '<style>p{margin:0}</style>' + Array.from({length: 12}, (_, i) => `<p>Retryable paragraph number ${i}.</p>`).join(''));
  const result = await page.evaluate(async () => {
    const original = chrome.runtime.sendMessage;
    let batch = 0;
    chrome.runtime.sendMessage = (msg, cb) => msg.type === 'TRANSLATE' && ++batch === 2
      ? Promise.resolve({success: false, error: 'Temporary failure'}) : original(msg, cb);
    await window.send('START_TRANSLATION');
    const status = await window.send('GET_STATUS');
    const first = document.querySelector('.lt-result');
    chrome.runtime.sendMessage = original;
    await window.send('START_TRANSLATION');
    return {status, preserved: first?.isConnected, count: document.querySelectorAll('.lt-result').length};
  });
  assert.equal(result.status.phase, 'partial');
  assert.equal(result.preserved, true);
  assert.equal(result.count, 12);
});

test('table, grid, fixed-height widgets, long prose and excluded ancestors keep valid structure', async t => {
  const page = await fixture(t, `<style>
    body{font:16px/1.6 Arial;margin:24px;background:#f6f7fb;color:#273248} main{max-width:900px;margin:auto}
    article,.grid,table{background:white;padding:20px;margin:16px 0;border-radius:10px} .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    table{width:100%;border-collapse:collapse} td,th{border:1px solid #dde2e8;padding:8px;text-align:left}
    .clipped{height:24px;overflow:hidden;white-space:nowrap}
  </style><main><h1>Translation layout preview</h1><article><p id="prose">Read the <strong>complete documentation</strong> before <a href="#">installing the package</a>.</p>
  <ul><li id="mixed">Read this parent text first.<p>Then read this nested paragraph.</p>And finish with this final text.</li></ul></article>
  <div class="grid" id="grid"><div>Project overview</div><div>Team notifications</div></div>
  <table><tr><th>Project name</th><th>Current status</th></tr><tr><td>Customer workspace</td><td>Ready for review</td></tr></table>
  <div class="clipped">A constrained notification should stay one line tall.</div>
  <section hidden><p>Never send this hidden text.</p></section>
  <p id="long">${'A long article remains readable and must be translated. '.repeat(35)}</p></main>`, { aggressiveMode: true });
  await page.setViewportSize({width:1200,height:1800});
  const original = await page.locator('main').innerHTML();
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/layout-before.png'), fullPage: true });
  await page.evaluate(() => window.send('START_TRANSLATION'));
  assert.equal(await page.locator('td .lt-result, th .lt-result, .clipped .lt-result, #grid > .lt-result').count(), 0);
  assert.equal(await page.locator('#grid > div').count(), 2);
  assert.equal(await page.locator('#mixed .lt-wrap').count(), 0);
  assert.equal(await page.locator('#mixed .lt-result').count(), 3);
  assert.equal(await page.locator('#long > .lt-result').count(), 1);
  assert.equal(await page.evaluate(() => window.requests.flat().some(text => text.includes('hidden text'))), false);
  await page.screenshot({ path: path.join(root, 'test-results/layout-after.png'), fullPage: true });
  await page.evaluate(() => window.send('REMOVE_TRANSLATION'));
  assert.equal(await page.locator('main').innerHTML(), original);
});

test('offscreen paragraphs wait until scrolling and stopped pages stay stopped', async t => {
  const page=await fixture(t,'<style>p{height:180px;margin:0}</style>'+Array.from({length:30},(_,i)=>`<p id="p${i}">Lazy translation paragraph ${i}.</p>`).join(''));
  await page.evaluate(()=>window.send('START_TRANSLATION'));
  assert.ok(await page.evaluate(()=>requests.flat().length)<10);
  assert.equal(await page.locator('#p29 .lt-result').count(),0);
  await page.locator('#p20').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('#p20 .lt-result'));
  await page.evaluate(()=>window.send('STOP_TRANSLATION'));
  const count=await page.evaluate(()=>requests.length);
  await page.locator('#p29').scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>requests.length),count);
});
