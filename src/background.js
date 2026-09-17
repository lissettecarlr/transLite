importScripts('defaults.js', 'config.js', 'vault.js', 'model-policy.js', 'translation.js');

const ready = Promise.all(['local', 'sync', 'session'].map(area => chrome.storage[area].setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})));
const jobs = new Map(), injections = new Map();
const files = ['defaults.js','adapters/litellm.js','adapters/linear.js','dom.js','content.js'];
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
async function credentials(settings) {
  const {credential} = await chrome.storage.session.get('credential');
  if (!credential || credential.endpoint !== settings.apiBaseUrl) throw new Error('请在设置中输入或解锁此接口的 API Key');
  return credential.apiKey;
}
async function assertRemoteAllowed(settings) {
  const {consents = {}} = await chrome.storage.local.get('consents');
  if (!consents[LT_CONFIG.consentKey(settings)]) throw new Error('请先在扩展弹窗中确认文字发送到所选翻译服务');
  if (!await chrome.permissions.contains({origins:[LT_CONFIG.originPattern(LT_CONFIG.destination(settings))]})) throw new Error('请在扩展弹窗或设置中授权访问翻译服务');
}
async function configForRequest(settings) {
  await assertRemoteAllowed(settings);
  return {...settings, ...(settings.service === 'openai' ? {apiKey:await credentials(settings)} : {})};
}
async function settingsView() {
  const settings = await preferences();
  const [{vault, siteRules = {}, consents = {}}, {credential}] = await Promise.all([
    chrome.storage.local.get(['vault','siteRules','consents']), chrome.storage.session.get('credential'),
  ]);
  return {settings, siteRules, hasKey:!!credential && credential.endpoint === settings.apiBaseUrl,
    hasVault:!!vault && vault.endpoint === settings.apiBaseUrl, destination:LT_CONFIG.destination(settings), consent:!!consents[LT_CONFIG.consentKey(settings)]};
}
async function saveSettings(message) {
  const settings = LT_CONFIG.sanitize(message.settings);
  if (message.apiKey != null && typeof message.apiKey !== 'string') throw new Error('API Key 格式无效');
  const apiKey = message.apiKey?.trim();
  if (apiKey && (apiKey.length > 2000 || /\s/.test(apiKey))) throw new Error('API Key 格式无效');
  if (settings.service === 'openai' && !await chrome.permissions.contains({origins:[LT_CONFIG.originPattern(settings.apiBaseUrl)]})) throw new Error('请先授权访问所选接口');
  let vault;
  if (message.rememberKey) {
    if (!apiKey) throw new Error('请填写要加密保存的 API Key');
    vault = await LT_VAULT.seal(apiKey, message.password, settings.apiBaseUrl);
  }
  cancelJobs(); translationCache.clear(); inFlightTranslations.clear();
  const previous = await preferences();
  if (previous.apiBaseUrl !== settings.apiBaseUrl || apiKey) {
    await chrome.storage.session.remove('credential'); await chrome.storage.local.remove('vault');
  }
  if (apiKey) await chrome.storage.session.set({credential:{apiKey, endpoint:settings.apiBaseUrl}});
  if (vault) await chrome.storage.local.set({vault});
  await chrome.storage.local.set({preferences:settings});
  if (message.consent === true) {
    const {consents = {}} = await chrome.storage.local.get('consents');
    consents[LT_CONFIG.consentKey(settings)] = true; await chrome.storage.local.set({consents});
  }
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
  const {siteRules = {}} = await chrome.storage.local.get('siteRules');
  const matches = [...new Set(Object.entries(siteRules).filter(([,rule]) => rule === 'always').map(([origin]) => LT_CONFIG.originPattern(origin)))];
  const allowed = [];
  for (const match of matches) if (await chrome.permissions.contains({origins:[match]})) allowed.push(match);
  const registered = await chrome.scripting.getRegisteredContentScripts({ids:['lt-auto']});
  if (!allowed.length) { if (registered.length) await chrome.scripting.unregisterContentScripts({ids:['lt-auto']}); return; }
  const script = {id:'lt-auto', matches:allowed, js:files, css:['content.css'], runAt:'document_idle', persistAcrossSessions:true};
  if (registered.length) await chrome.scripting.updateContentScripts([script]); else await chrome.scripting.registerContentScripts([script]);
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

async function dispatch(message, sender) {
  await ready;
  if (!message || typeof message.type !== 'string') throw new Error('消息格式无效');
  if (trusted(sender)) {
    switch (message.type) {
      case 'GET_SETTINGS': return settingsView();
      case 'SAVE_SETTINGS': return serialize(() => saveSettings(message));
      case 'UNLOCK_KEY': return serialize(async () => {
        const settings = await preferences(), {vault} = await chrome.storage.local.get('vault');
        if (vault?.endpoint !== settings.apiBaseUrl) throw new Error('此接口没有已保存的密钥');
        const apiKey = await LT_VAULT.open(vault, message.password);
        await chrome.storage.session.set({credential:{apiKey, endpoint:settings.apiBaseUrl}}); return settingsView();
      });
      case 'CLEAR_KEY': return serialize(async () => {
        cancelJobs(); translationCache.clear(); inFlightTranslations.clear();
        await chrome.storage.session.remove('credential'); await chrome.storage.local.remove('vault'); return settingsView();
      });
      case 'CLEAR_CACHE': translationCache.clear(); return {};
      case 'TEST_CONNECTION': {
        const settings = await configForRequest(await preferences()), start = Date.now(), controller = new AbortController(), key = `test:${crypto.randomUUID()}`;
        jobs.set(key, {controller, tabId:sender.tab?.id, time:Date.now()});
        try {
          const translations = settings.service === 'openai'
            ? await translateWithOpenAI(['Hello, welcome to this page.'], settings, {signal:controller.signal})
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
      await chrome.storage.session.set({[`ltStatus_${sender.tab.id}`]:status});
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
  chrome.contextMenus.create({id:'lt-translate-selection', title:'翻译选中文字', contexts:['selection'], documentUrlPatterns:['http://*/*','https://*/*']}); await syncSiteScripts();
});
chrome.runtime.onStartup.addListener(() => {void ready.then(syncSiteScripts);});
chrome.permissions.onRemoved.addListener(() => {cancelJobs(); void syncSiteScripts();});
chrome.tabs.onRemoved.addListener(tabId => {cancelJobs(tabId); void chrome.storage.session.remove(`ltStatus_${tabId}`);});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') {
    cancelJobs(tabId); void chrome.storage.session.remove(`ltStatus_${tabId}`);
    void chrome.action.setBadgeText({tabId, text:''}).catch(() => {});
    void chrome.action.setTitle({tabId, title:'久远的翻译工具'}).catch(() => {});
  }
});
