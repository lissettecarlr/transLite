const $ = id => document.getElementById(id);
let view, busy = false;
const value = name => document.querySelector(`input[name="${name}"]:checked`)?.value;
function check(name, selected) { for (const input of document.querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === selected; }
function collect() {
  return LT_CONFIG.sanitize({service:value('service'), provider:$('provider').value, apiBaseUrl:$('api-base-url').value,
    deeplPlan:$('deepl-plan').value,
    model:$('model').value, thinkingMode:$('thinking-mode').value, systemPrompt:$('system-prompt').value,
    targetLang:$('target-lang').value, aggressiveMode:$('aggressive-mode').checked, floatingButton:$('floating-button').checked,
    autoTranslate:$('auto-translate').value, theme:value('theme'),
    translationColorMode:value('translation-color-mode'), translationColor:$('translation-color').value,
    litellmBaseUrl:$('litellm-base-url').value});
}
function status(text, error = false) { $('save-status').textContent = text; $('save-status').style.opacity = '1'; $('save-status').style.color = error ? '#ffdfdf' : '#fff'; }
function updateHint() {
  const service = value('service');
  $('key-config').classList.toggle('hidden', service === 'google');
  $('openai-config').classList.toggle('hidden', service !== 'openai');
  $('deepl-config').classList.toggle('hidden', service !== 'deepl');
  $('remember-fields').classList.toggle('hidden', !$('remember-key').checked);
  $('color-picker-wrap').classList.toggle('hidden', value('translation-color-mode') !== 'custom');
  $('color-hex-label').textContent = $('translation-color').value;
  $('model-policy-hint').textContent = LT_MODEL_POLICY.describe({model:$('model').value, provider:$('provider').value, thinkingMode:$('thinking-mode').value});
  for (const button of document.querySelectorAll('.preset-btn')) button.setAttribute('aria-pressed', String(button.dataset.model === $('model').value));
  try { $('destination').textContent = `待译文字的接收方：${LT_CONFIG.destination(collect())}`; }
  catch { $('destination').textContent = '请填写有效的接口地址'; }
}
function apply(result) {
  view = result;
  const s = result.settings;
  for (const [id,key] of Object.entries({'provider':'provider','api-base-url':'apiBaseUrl','deepl-plan':'deeplPlan','model':'model','thinking-mode':'thinkingMode','system-prompt':'systemPrompt','target-lang':'targetLang','auto-translate':'autoTranslate','translation-color':'translationColor','litellm-base-url':'litellmBaseUrl'})) $(id).value = s[key];
  check('service',s.service); check('theme',s.theme); check('translation-color-mode',s.translationColorMode);
  $('aggressive-mode').checked = s.aggressiveMode;
  $('floating-button').checked = s.floatingButton !== false;
  $('api-key').value = ''; $('vault-password').value = ''; $('unlock-password').value = ''; $('remember-key').checked = false;
  $('api-key').placeholder = result.hasKey ? '已配置，留空保留当前密钥' : '输入 API Key';
  $('key-status').textContent = result.hasKey ? (result.hasVault ? '本次会话已解锁；密钥以加密形式保存在本机。' : '密钥已保存在本机，重启浏览器后无需重新输入。') : (result.hasVault ? '密钥已锁定，请解锁或输入新密钥。' : '密钥保存在本机，不会同步到其他设备。');
  $('unlock-fields').classList.toggle('hidden', !result.hasVault || result.hasKey);
  $('service-consent').checked = result.consent;
  $('site-rules').replaceChildren();
  for (const [origin,rule] of Object.entries(result.siteRules || {})) {
    const row=document.createElement('div'), label=document.createElement('span'), button=document.createElement('button');
    row.className='site-rule'; label.textContent=`${origin} · ${rule === 'always' ? '始终翻译' : '不自动翻译'}`;
    button.textContent='移除'; button.className='text-button';
    button.addEventListener('click', () => run(async () => apply(await LT_UI.request('REMOVE_SITE_RULE',{origin}))));
    row.append(label,button); $('site-rules').append(row);
  }
  if (!$('site-rules').children.length) $('site-rules').textContent='尚未设置网站偏好。在网页的扩展弹窗中添加。';
  updateHint();
  // 默认值是「开」，但没授权访问所有网站时其实注入不进去：别让开关骗人。
  void syncFloatingToggle();
}

async function syncFloatingToggle() {
  const granted = await chrome.permissions.contains({origins:['http://*/*','https://*/*']}).catch(()=>false);
  const box = $('floating-button');
  const hint = $('floating-hint');
  box.checked = view.settings.floatingButton !== false && granted;
  if (hint) hint.dataset.warn = granted ? '' : '1';
  if (hint) hint.textContent = granted
    ? '开启需授权访问所有网站；默认构建只注入这一个按钮脚本。'
    : '还没授权访问所有网站，悬浮入口不会生效。勾选时浏览器会弹授权。';
}
async function run(action) {
  if (busy) return;
  busy=true; const buttons=[...document.querySelectorAll('button,input,select,textarea')]; buttons.forEach(button => button.disabled=true);
  try { await action(); } catch(error) { status(error.message,true); $('test-result').textContent=error.message; }
  finally {busy=false; buttons.forEach(button => button.disabled=false);}
}
async function save(test = false) {
  const settings=collect();
  if (test && !$('service-consent').checked) throw new Error('请先确认待译文字的接收方');
  // Request permissions before any await, preserving the button's user gesture.
  const origins=settings.service !== 'google' || test ? [LT_CONFIG.originPattern(LT_CONFIG.destination(settings))] : [];
  const grant=origins.length ? chrome.permissions.request({origins}) : Promise.resolve(true);
  if (!await grant) throw new Error('未获得服务访问权限，设置未保存');
  const result=await LT_UI.request('SAVE_SETTINGS',{settings, apiKey:$('api-key').value, rememberKey:$('remember-key').checked, password:$('vault-password').value, consent:$('service-consent').checked});
  apply(result); status('设置已保存');
  if (test) {
    $('test-result').textContent='正在测试连接…';
    const connection=await LT_UI.request('TEST_CONNECTION');
    $('test-result').textContent=`连接成功 · ${(connection.elapsed/1000).toFixed(2)} 秒 · ${connection.destination}\n示例译文：${connection.translation}\n${connection.policy}`;
  }
}
function bind() {
  $('btn-save').addEventListener('click',()=>run(()=>save()));
  $('btn-test').addEventListener('click',()=>run(()=>save(true)));
  $('btn-unlock').addEventListener('click',()=>run(async()=>{apply(await LT_UI.request('UNLOCK_KEY',{password:$('unlock-password').value}));status('密钥已解锁');}));
  $('btn-clear-key').addEventListener('click',()=>run(async()=>{apply(await LT_UI.request('CLEAR_KEY'));status('密钥和加密副本已清除');}));
  $('btn-clear-cache').addEventListener('click',()=>run(async()=>{await LT_UI.request('CLEAR_CACHE');status('临时译文缓存已清除');}));
  $('btn-reset').addEventListener('click',()=>{apply({...view,settings:{...LT_DEFAULTS},hasKey:false,hasVault:false,consent:false});status('已填写默认值，保存后生效');});
  $('btn-shortcuts').addEventListener('click',()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'}));
  $('btn-health').addEventListener('click',()=>run(async()=>{
    const health=await LT_UI.request('HEALTH');
    const yes=value=>value?'有':'无';
    $('health-output').textContent=[
      `版本 ${health.version}｜服务 ${health.service}｜自动翻译 ${health.autoTranslate}｜悬浮按钮 ${health.floatingButton?'开':'关'}`,
      `已同意发送待译文字：${health.consent?'是':'否'}｜已存密钥：${health.hasKey?'是':'否'}${health.hasVault?'（加密）':''}`,
      `chrome.scripting ${yes(health.apis.scripting)}｜registerContentScripts ${yes(health.apis.registerScripts)}`,
      `storage.session ${yes(health.apis.storageSession)}｜setAccessLevel ${yes(health.apis.setAccessLevel)}`,
      `openOptionsPage ${yes(health.apis.openOptionsPage)}`,
      `启动错误：${health.bootError||'无'}`,
      `浏览器：${navigator.userAgent}`,
    ].join('\n');
  }));
  document.querySelector('.toggle-password').addEventListener('click',()=>{$('api-key').type=$('api-key').type==='password'?'text':'password';});
  // 悬浮入口要覆盖所有站点，勾选时立刻索要权限；拒绝就退回关闭状态。
  $('floating-button').addEventListener('change',async()=>{
    if(!$('floating-button').checked)return;
    // 必须在第一个 await 之前发起，Chrome 只在用户手势窗口内接受授权请求。
    // 全站授权版里这项权限已经是必需的，request 会直接返回 true，不会弹窗。
    const granted=await chrome.permissions.request({origins:['http://*/*','https://*/*']}).catch(()=>false);
    if(!granted){$('floating-button').checked=false;status('未获得网站访问权限，悬浮入口保持关闭',true);}
    else status('已授权访问所有网站，保存后生效');
  });
  $('provider').addEventListener('change',()=>{
    const preset=LT_CONFIG.presets[$('provider').value];
    if(preset.apiBaseUrl) {$('api-base-url').value=preset.apiBaseUrl;$('model').value=preset.model;}
    $('api-key').value=''; $('service-consent').checked=false; $('test-result').textContent=''; updateHint();
  });
  for(const button of document.querySelectorAll('.preset-btn')) button.addEventListener('click',()=>{$('model').value=button.dataset.model;updateHint();});
  for(const input of document.querySelectorAll('input,select,textarea')) input.addEventListener('input',()=>{
    if(['model','api-key','api-base-url','deepl-plan','thinking-mode','target-lang','auto-translate','system-prompt'].includes(input.id)||input.name==='service') $('test-result').textContent='';
    if(['api-base-url','deepl-plan'].includes(input.id)||input.name==='service') $('service-consent').checked=false;
    updateHint();
  });
  $('advanced-toggle').setAttribute('role','button'); $('advanced-toggle').setAttribute('aria-expanded','false'); $('advanced-toggle').tabIndex=0;
  const toggle=()=>{const hidden=$('advanced-content').classList.toggle('hidden');$('advanced-toggle').setAttribute('aria-expanded',String(!hidden));$('advanced-toggle').querySelector('.collapse-hint').textContent=hidden?'点击展开':'点击收起';};
  $('advanced-toggle').addEventListener('click',toggle);
  $('advanced-toggle').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();toggle();}});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='s'){event.preventDefault();void run(()=>save());}});
}
bind();
LT_UI.request('GET_SETTINGS').then(apply).catch(error=>status(error.message,true));
