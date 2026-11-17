// 顶层包一层：某个被导入的文件在老内核上解析失败时，Service Worker 会整体注册失败，
// 浏览器只丢一句 "Service worker registration failed"，所以先把原因落到存储里。
try {
  importScripts('defaults.js', 'config.js', 'vault.js', 'model-policy.js', 'translation.js');
} catch (error) {
  try { chrome.storage.local.set({ltBootError: `importScripts 失败：${error?.message || error}`}); } catch (_) {}
  throw error;
}

// 老内核兼容：CEF 类浏览器（Steam 内置浏览器等）常常既没有 storage.session.setAccessLevel，
// 也可能整个 storage.session 都不存在。缺什么补什么，Chrome 120 上行为完全不变。
function memorySession() {
  const data = new Map();
  const read = keys => (Array.isArray(keys) ? keys : [keys]).filter(key => data.has(key)).map(key => [key, data.get(key)]);
  return {
    async get(keys) { return Object.fromEntries(read(keys)); },
    async set(values) { for (const [key, value] of Object.entries(values)) data.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) data.delete(key); },
    async clear() { data.clear(); },
  };
}
const SESSION = chrome.storage.session || memorySession();
// crypto.randomUUID 同样是 Chromium 92+ 才有。
const newId = () => crypto.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
// setAccessLevel 是 Chrome 102 才有的，老内核上直接跳过：此时扩展存储默认就只对扩展自身可见。
const ready = Promise.all(['local', 'sync', 'session']
  .map(name => chrome.storage[name])
  .filter(area => typeof area?.setAccessLevel === 'function')
  .map(area => area.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})));
const jobs = new Map(), injections = new Map();
const files = ['defaults.js','adapters/litellm.js','adapters/linear.js','adapters/steam.js','dom.js','content.js','button.js'];
let writes = Promise.resolve();
function serialize(action) { const next = writes.then(action); writes = next.catch(() => {}); return next; }
async function preferences() {
  await ready;
  return LT_CONFIG.sanitize((await chrome.storage.local.get('preferences')).preferences);
}
async function pageSettings(url) {
  const settings = await preferences(), {siteRules = {}} = await chrome.storage.local.get('siteRules');
  return {...LT_CONFIG.publicSettings(settings), siteRule:siteRules[new URL(url).origin] || 'manual'};
}
function trusted(sender) {
  return sender.id === chrome.runtime.id && [chrome.runtime.getURL('options/options.html'), chrome.runtime.getURL('popup/popup.html')].includes(sender.url?.split('?')[0]);
}
function pageSender(sender) { return sender.tab?.id != null && sender.frameId === 0 && /^https?:\/\//.test(sender.url || ''); }
function jobKey(sender, taskId) {
  if (!pageSender(sender) || typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId)) throw new Error('翻译任务无效');
  return `${sender.tab.id}:${sender.documentId || ''}:${taskId}`;
}
function cancelJobs(tabId) {
  for (const [key, job] of jobs) if (tabId == null || job.tabId === tabId) { job.controller.abort(); jobs.delete(key); }
}
// Each keyed service owns its own slot, so switching between the AI endpoint and
// DeepL never destroys the other one's saved key.
function credentialSlots(service) {
  return service === 'deepl' ? {plain:'credentialDeepl', vault:'vaultDeepl'} : {plain:'credential', vault:'vault'};
}
// Keys saved without a password persist in local storage (never synced, trusted
// contexts only). Password-protected keys live only in the encrypted vault and,
// once unlocked, in session storage.
async function storedCredential(settings) {
  const endpoint = LT_CONFIG.credentialEndpoint(settings), slot = credentialSlots(settings.service);
  const [{[slot.plain]:local}, {[slot.plain]:session}] = await Promise.all([chrome.storage.local.get(slot.plain), SESSION.get(slot.plain)]);
  return [local, session].find(credential => credential?.endpoint === endpoint)?.apiKey || '';
}
async function credentials(settings) {
  const apiKey = await storedCredential(settings);
  if (!apiKey) throw new Error('请在设置中输入或解锁此接口的 API Key');
  return apiKey;
}
async function assertRemoteAllowed(settings) {
  const {consents = {}} = await chrome.storage.local.get('consents');
  if (!consents[LT_CONFIG.consentKey(settings)]) throw new Error('请先在扩展弹窗中确认文字发送到所选翻译服务');
  if (!await chrome.permissions.contains({origins:[LT_CONFIG.originPattern(LT_CONFIG.destination(settings))]})) throw new Error('请在扩展弹窗或设置中授权访问翻译服务');
}
async function configForRequest(settings) {
  await assertRemoteAllowed(settings);
  return {...settings, ...(settings.service === 'google' ? {} : {apiKey:await credentials(settings)})};
}
async function settingsView() {
  const settings = await preferences(), slot = credentialSlots(settings.service);
  const [{siteRules = {}, consents = {}, [slot.vault]:vault}, apiKey] = await Promise.all([
    chrome.storage.local.get(['siteRules','consents',slot.vault]), storedCredential(settings),
  ]);
  return {settings, siteRules, hasKey:!!apiKey,
    hasVault:!!vault && vault.endpoint === LT_CONFIG.credentialEndpoint(settings), destination:LT_CONFIG.destination(settings), consent:!!consents[LT_CONFIG.consentKey(settings)]};
}
async function saveSettings(message) {
  const settings = LT_CONFIG.sanitize(message.settings);
  if (message.apiKey != null && typeof message.apiKey !== 'string') throw new Error('API Key 格式无效');
  const apiKey = message.apiKey?.trim();
  if (apiKey && (apiKey.length > 2000 || /\s/.test(apiKey))) throw new Error('API Key 格式无效');
  if (settings.service !== 'google' && !await chrome.permissions.contains({origins:[LT_CONFIG.originPattern(LT_CONFIG.destination(settings))]})) throw new Error('请先授权访问所选接口');
  const previous = await preferences();
  const slot = credentialSlots(settings.service), endpoint = LT_CONFIG.credentialEndpoint(settings);
  // Ticking "encrypt with password" without retyping the key upgrades the key already saved for this endpoint.
  const key = apiKey || (endpoint === LT_CONFIG.credentialEndpoint(previous) ? await storedCredential(settings) : '');
  let vault;
  if (message.rememberKey) {
    if (!key) throw new Error('请填写要加密保存的 API Key');
    vault = await LT_VAULT.seal(key, message.password, endpoint);
  }
  cancelJobs(); translationCache.clear(); inFlightTranslations.clear();
  // Another service's slot is left alone; only this slot is reset when its own
  // endpoint changed or a new key replaces the old one.
  const endpointChanged = credentialSlots(previous.service).plain === slot.plain && endpoint !== LT_CONFIG.credentialEndpoint(previous);
  if (endpointChanged || apiKey || vault) {
    await SESSION.remove(slot.plain); await chrome.storage.local.remove([slot.plain, slot.vault]);
  }
  if (vault) { await chrome.storage.local.set({[slot.vault]:vault}); await SESSION.set({[slot.plain]:{apiKey:key, endpoint}}); }
  else if (apiKey) await chrome.storage.local.set({[slot.plain]:{apiKey, endpoint}});
  await chrome.storage.local.set({preferences:settings});
  if (message.consent === true) {
    const {consents = {}} = await chrome.storage.local.get('consents');
    consents[LT_CONFIG.consentKey(settings)] = true; await chrome.storage.local.set({consents});
  }
  await syncFloatingButton();
  await broadcastSettings();
  return settingsView();
}
async function broadcastSettings() {
  await Promise.all((await chrome.tabs.query({})).map(async tab => {
    if (!/^https?:\/\//.test(tab.url || '')) return;
    await chrome.tabs.sendMessage(tab.id, {type:'SETTINGS_UPDATED', settings:await pageSettings(tab.url)}).catch(() => {});
  }));
}
async function ensurePage(tabId) {
  if (injections.has(tabId)) return injections.get(tabId);
  const promise = (async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:\/\//.test(tab.url || '') || /^https:\/\/(chromewebstore.google.com|chrome.google.com\/webstore)/.test(tab.url)) throw new Error('当前页面不支持翻译，请打开普通网页');
    try { if ((await chrome.tabs.sendMessage(tabId, {type:'PING'}))?.ok) return; } catch {}
    try {
      await chrome.scripting.insertCSS({target:{tabId}, files:['content.css']});
      await chrome.scripting.executeScript({target:{tabId}, files});
      await chrome.tabs.sendMessage(tabId, {type:'PING'});
    } catch { throw new Error('无法访问此页面，请刷新网页后重新点击扩展'); }
  })();
  injections.set(tabId, promise);
  try { await promise; } finally { injections.delete(tabId); }
}
async function syncSiteScripts() {
  // 老内核没有运行时注册 API（Chrome 96+），此时只能靠手动翻译注入。
  if (!chrome.scripting?.registerContentScripts) return;
  const {siteRules = {}} = await chrome.storage.local.get('siteRules');
  const matches = [...new Set(Object.entries(siteRules).filter(([,rule]) => rule === 'always').map(([origin]) => LT_CONFIG.originPattern(origin)))];
  const allowed = [];
  for (const match of matches) if (await chrome.permissions.contains({origins:[match]})) allowed.push(match);
  const registered = await chrome.scripting.getRegisteredContentScripts({ids:['lt-auto']});
  if (!allowed.length) { if (registered.length) await chrome.scripting.unregisterContentScripts({ids:['lt-auto']}); return; }
  const script = {id:'lt-auto', matches:allowed, js:files, css:['content.css'], runAt:'document_idle', persistAcrossSessions:true};
  if (registered.length) await chrome.scripting.updateContentScripts([script]); else await chrome.scripting.registerContentScripts([script]);
}
// 页面右侧的悬浮设置入口。没有扩展工具栏的浏览器（Steam 内嵌 CEF 等）只能靠它进设置页，
// 所以这里用运行时注册的独立小脚本，而不是给每个页面注入整套翻译逻辑。
async function syncFloatingButton() {
  if (!chrome.scripting?.registerContentScripts) return;
  const registered = await chrome.scripting.getRegisteredContentScripts({ids:['lt-fab']});
  // 「全站授权版」把 button.js 写进了 manifest 的 content_scripts，浏览器自己会注入，不用再注册。
  const viaManifest = (chrome.runtime.getManifest?.().content_scripts || []).some(item => (item.js || []).includes('button.js'));
  const {floatingButton} = await preferences();
  const granted = !viaManifest && floatingButton && await chrome.permissions.contains({origins:['http://*/*','https://*/*']});
  if (!granted) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ids:['lt-fab']});
    return;
  }
  const script = {id:'lt-fab', matches:['http://*/*','https://*/*'], js:['button.js'], runAt:'document_idle', persistAcrossSessions:true};
  // 权限可能只授了一部分站点，这时注册会失败，按未启用处理即可。
  try {
    if (registered.length) await chrome.scripting.updateContentScripts([script]); else await chrome.scripting.registerContentScripts([script]);
  } catch { if (registered.length) await chrome.scripting.unregisterContentScripts({ids:['lt-fab']}).catch(() => {}); }
}
async function setSiteRule(tabId, rule) {
  if (!['manual','always','never'].includes(rule)) throw new Error('网站选项无效');
  const tab = await chrome.tabs.get(tabId), origin = new URL(tab.url).origin, pattern = LT_CONFIG.originPattern(tab.url);
  if (rule === 'always') {
    if (!await chrome.permissions.contains({origins:[pattern]})) throw new Error('自动翻译需要此网站的访问权限');
    await configForRequest(await preferences());
  }
  const {siteRules = {}} = await chrome.storage.local.get('siteRules');
  if (rule === 'manual') delete siteRules[origin]; else siteRules[origin] = rule;
  await chrome.storage.local.set({siteRules}); await syncSiteScripts();
  for (const item of await chrome.tabs.query({url:pattern})) {
    if (new URL(item.url).origin !== origin) continue;
    if (rule !== 'always') cancelJobs(item.id);
    await chrome.tabs.sendMessage(item.id, {type:'SITE_RULE_UPDATED', rule}).catch(() => {});
  }
  return {rule};
}

// 自检：给「按钮变红」和设置页的诊断面板提供事实，不回传任何密钥。
async function healthReport() {
  const settings = await preferences();
  const {ltBootError, consents = {}} = await chrome.storage.local.get(['ltBootError', 'consents']);
  const slot = credentialSlots(settings.service);
  return {
    sw: true,
    version: chrome.runtime.getManifest().version,
    bootError: ltBootError || '',
    apis: {
      scripting: !!chrome.scripting?.executeScript,
      registerScripts: !!chrome.scripting?.registerContentScripts,
      storageSession: !!chrome.storage.session,
      setAccessLevel: typeof chrome.storage.local?.setAccessLevel === 'function',
      openOptionsPage: typeof chrome.runtime.openOptionsPage === 'function',
    },
    service: settings.service,
    autoTranslate: settings.autoTranslate,
    floatingButton: settings.floatingButton,
    hasKey: !!await storedCredential(settings),
    hasVault: !!(await chrome.storage.local.get(slot.vault))[slot.vault],
    consent: !!consents[LT_CONFIG.consentKey(settings)],
  };
}
async function dispatch(message, sender) {
  await ready;
  if (!message || typeof message.type !== 'string') throw new Error('消息格式无效');
  if (message.type === 'HEALTH') return healthReport();
  if (trusted(sender)) {
    switch (message.type) {
      case 'GET_SETTINGS': return settingsView();
      case 'SAVE_SETTINGS': return serialize(() => saveSettings(message));
      case 'UNLOCK_KEY': return serialize(async () => {
        const settings = await preferences(), slot = credentialSlots(settings.service), endpoint = LT_CONFIG.credentialEndpoint(settings);
        const {[slot.vault]:vault} = await chrome.storage.local.get(slot.vault);
        if (vault?.endpoint !== endpoint) throw new Error('此接口没有已保存的密钥');
        const apiKey = await LT_VAULT.open(vault, message.password);
        await SESSION.set({[slot.plain]:{apiKey, endpoint}}); return settingsView();
      });
      case 'CLEAR_KEY': return serialize(async () => {
        const slot = credentialSlots((await preferences()).service);
        cancelJobs(); translationCache.clear(); inFlightTranslations.clear();
        await SESSION.remove(slot.plain); await chrome.storage.local.remove([slot.plain, slot.vault]); return settingsView();
      });
      case 'CLEAR_CACHE': translationCache.clear(); return {};
      case 'TEST_CONNECTION': {
        const settings = await configForRequest(await preferences()), start = Date.now(), controller = new AbortController(), key = `test:${crypto.randomUUID()}`;
        jobs.set(key, {controller, tabId:sender.tab?.id, time:Date.now()});
        try {
          const translations = settings.service === 'openai'
            ? await translateWithOpenAI(['Hello, welcome to this page.'], settings, {signal:controller.signal})
            : settings.service === 'deepl'
              ? await fetchDeeplBatch(['Hello, welcome to this page.'], settings, {signal:controller.signal})
              : await fetchGoogleBatch(['Hello, welcome to this page.'], settings.targetLang, {signal:controller.signal});
          return {elapsed:Date.now()-start, translation:translations[0], destination:LT_CONFIG.destination(settings), policy:settings.service === 'openai' ? LT_MODEL_POLICY.describe(settings) : ''};
        } finally { jobs.delete(key); }
      }
      case 'CONFIRM_SERVICE': return serialize(async () => {
        const settings = await preferences();
        if (message.destination !== LT_CONFIG.destination(settings)) throw new Error('翻译服务已变化，请重新确认');
        const {consents = {}} = await chrome.storage.local.get('consents'); consents[LT_CONFIG.consentKey(settings)] = true;
        await chrome.storage.local.set({consents}); return {};
      });
      case 'SET_TARGET': return serialize(async () => {
        const settings = LT_CONFIG.sanitize({...await preferences(), targetLang:message.targetLang});
        cancelJobs(); await chrome.storage.local.set({preferences:settings}); await broadcastSettings(); return {};
      });
      case 'SET_SITE_RULE': return serialize(() => setSiteRule(message.tabId, message.rule));
      case 'REMOVE_SITE_RULE': return serialize(async () => {
        const {siteRules = {}} = await chrome.storage.local.get('siteRules'); delete siteRules[message.origin];
        await chrome.storage.local.set({siteRules}); await syncSiteScripts(); await broadcastSettings(); return settingsView();
      });
      case 'PAGE_COMMAND': {
        if (!['GET_STATUS','START_TRANSLATION','STOP_TRANSLATION','REMOVE_TRANSLATION'].includes(message.command)) throw new Error('页面操作无效');
        if (message.command === 'START_TRANSLATION') await configForRequest(await preferences());
        await ensurePage(message.tabId); return chrome.tabs.sendMessage(message.tabId, {type:message.command});
      }
      default: throw new Error('未知操作');
    }
  }
  if (!pageSender(sender)) throw new Error('此页面无权执行该操作');
  switch (message.type) {
    case 'GET_PAGE_SETTINGS': return {settings:await pageSettings(sender.url)};
    case 'AUTO_START': {
      // 无工具栏环境里唯一的自动入口。老内核可能根本没有 chrome.scripting，
      // 所以失败原因必须回给页面上的按钮，否则用户什么都看不到。
      try { await ensurePage(sender.tab.id); return {started:true}; }
      catch (error) { return {started:false, reason:error?.message || '无法注入翻译脚本'}; }
    }
    case 'OPEN_SETTINGS':
      // 悬浮按钮的落地动作：内容脚本没有 openOptionsPage，只能由后台代劳。
      await chrome.runtime.openOptionsPage(); return {};
    case 'BEGIN_TASK': {
      const key = jobKey(sender, message.taskId), settings = await configForRequest(await preferences());
      for (const [id, job] of jobs) if (Date.now()-job.time > 120000) {job.controller.abort(); jobs.delete(id);}
      if ([...jobs.values()].filter(job => job.tabId === sender.tab.id).length >= 4 || jobs.size >= 40) throw new Error('翻译任务较多，请稍后重试');
      if (jobs.has(key)) jobs.get(key).controller.abort();
      jobs.set(key, {controller:new AbortController(), tabId:sender.tab.id, settings, time:Date.now()}); return {};
    }
    case 'TRANSLATE': {
      const key = jobKey(sender, message.taskId), job = jobs.get(key);
      if (!job) throw new Error('翻译任务已结束，请重新点击翻译'); job.time = Date.now();
      return handleTranslation(message.texts, job.settings, {scope:key, signal:job.controller.signal});
    }
    case 'CANCEL_TASK': case 'END_TASK': {
      const key = jobKey(sender, message.taskId), job = jobs.get(key);
      // A failed batch can return while sibling HTTP chunks are still queued.
      // Finishing a task must release those too, not just remove its registry entry.
      job?.controller.abort(); jobs.delete(key); return {};
    }
    case 'STATUS_UPDATE': {
      const data = message.data || {};
      const status = {phase:['idle','translating','watching','partial','error','stopped'].includes(data.phase) ? data.phase : 'idle', count:Math.max(0, Math.min(100000, Number(data.count)||0)), isTranslating:!!data.isTranslating, isTranslated:!!data.isTranslated, error:typeof data.error === 'string' ? data.error.slice(0,200) : ''};
      await SESSION.set({[`ltStatus_${sender.tab.id}`]:status});
      await chrome.action.setTitle({tabId:sender.tab.id, title:'久远的翻译工具'});
      await chrome.action.setBadgeText({tabId:sender.tab.id, text:status.phase === 'translating' ? '…' : ['partial','error'].includes(status.phase) ? '!' : status.isTranslated ? '✓' : ''}); return {};
    }
    default: throw new Error('此页面无权执行该操作');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  dispatch(message, sender).then(result => respond({success:true, ...result}), error => respond({success:false, error:error.name === 'AbortError' ? '翻译已停止' : error.message || '操作失败'})); return true;
});
async function shortcut(tab, selection) {
  if (!tab?.id) return;
  try {
    await configForRequest(await preferences()); await ensurePage(tab.id);
    await chrome.tabs.sendMessage(tab.id, selection ? {type:'TRANSLATE_SELECTION', text:selection} : {type:'TOGGLE_TRANSLATION'});
  } catch {
    await chrome.action.setBadgeText({tabId:tab.id, text:'!'});
    await chrome.action.setTitle({tabId:tab.id, title:'请打开扩展弹窗，确认服务授权或配置'});
    await chrome.action.openPopup().catch(() => chrome.runtime.openOptionsPage());
  }
}
chrome.commands.onCommand.addListener(async command => { if (command === 'toggle-translation') await shortcut((await chrome.tabs.query({active:true,currentWindow:true}))[0]); });
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'lt-translate-selection' && info.selectionText) void shortcut(tab, info.selectionText); });
chrome.runtime.onInstalled.addListener(async () => {
  await ready; await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id:'lt-translate-selection', title:'翻译选中文字', contexts:['selection'], documentUrlPatterns:['http://*/*','https://*/*']});
  await syncSiteScripts(); await syncFloatingButton();
});
chrome.runtime.onStartup.addListener(() => {void ready.then(() => Promise.all([syncSiteScripts(), syncFloatingButton()]));});
chrome.permissions.onRemoved.addListener(() => {cancelJobs(); void syncSiteScripts(); void syncFloatingButton();});
chrome.permissions.onAdded.addListener(() => {void syncFloatingButton();});
chrome.tabs.onRemoved.addListener(tabId => {cancelJobs(tabId); void SESSION.remove(`ltStatus_${tabId}`);});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') {
    cancelJobs(tabId); void SESSION.remove(`ltStatus_${tabId}`);
    void chrome.action.setBadgeText({tabId, text:''}).catch(() => {});
    void chrome.action.setTitle({tabId, title:'久远的翻译工具'}).catch(() => {});
  }
});
