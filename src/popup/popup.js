const $=id=>document.getElementById(id);
let currentTab, view, currentStatus={phase:'idle',count:0}, busy=false;
function status(text,error=false){$('status-text').textContent=text;$('status-dot').className=`status-dot ${error?'error':'idle'}`;}
function updateUI(state={phase:'idle',count:0}) {
  currentStatus=state;
  const phase=state.phase||'idle', count=state.count||0;
  const labels={idle:'准备就绪',translating:`翻译中，已完成 ${count} 段`,watching:`附近内容已处理 · ${count} 段 · 滚动继续`,partial:`部分完成 ${count} 段：${state.error||'请重试'}`,error:state.error||'翻译失败，请重试',stopped:`已停止，保留 ${count} 段译文`};
  status(labels[phase],['partial','error'].includes(phase));
  $('btn-text').textContent={idle:'翻译此页面',translating:'停止翻译',watching:'暂停自动续译',partial:'重试未完成内容',error:'重试翻译',stopped:'继续翻译'}[phase];
  $('btn-translate').className=['translating','watching'].includes(phase)?'btn-stop':'btn-primary';
  $('btn-restore').classList.toggle('hidden',count===0);
  $('count-badge').textContent=`${count} 段`;$('count-badge').classList.toggle('hidden',count===0);
}
async function refresh(){
  try{updateUI(await chrome.tabs.sendMessage(currentTab.id,{type:'GET_STATUS'}));}catch{updateUI();}
}
async function run(action){
  if(busy)return;busy=true;
  $('btn-translate').disabled=true;$('site-rule').disabled=true;
  try{await action();}catch(error){status(error.message,true);}
  finally{busy=false;$('btn-translate').disabled=false;$('site-rule').disabled=false;}
}
async function authorize(site=false){
  if(!view.consent&&!$('consent').checked)throw new Error('请先确认文字发送至以上翻译服务');
  if(view.settings.service==='openai'&&!view.hasKey)throw new Error('请打开设置，输入或解锁 API Key');
  const origins=[LT_CONFIG.originPattern(view.destination)];
  if(site)origins.push(LT_CONFIG.originPattern(currentTab.url));
  // Must remain before the first await so Chrome recognizes the user gesture.
  if(!await chrome.permissions.request({origins:[...new Set(origins)]}))throw new Error('未获得访问权限，翻译尚未启动');
  if(!view.consent){await LT_UI.request('CONFIRM_SERVICE',{destination:view.destination});view.consent=true;$('consent-row').classList.add('hidden');}
}
async function command(command){return LT_UI.request('PAGE_COMMAND',{tabId:currentTab.id,command});}
async function init(){
  [currentTab]=await chrome.tabs.query({active:true,currentWindow:true});
  view=await LT_UI.request('GET_SETTINGS');
  const settings=view.settings;
  $('target-lang').value=settings.targetLang;
  $('service-badge').textContent=settings.service==='google'?'Google':settings.model;
  $('destination').textContent=`待译文字发送至 ${view.destination}${settings.service==='openai'?'，可能产生服务商费用。':'。'}`;
  $('consent').checked=view.consent;$('consent-row').classList.toggle('hidden',view.consent);
  $('key-warning').classList.toggle('hidden',settings.service!=='openai'||view.hasKey);
  const [shortcut]=await chrome.commands.getAll();if(shortcut?.shortcut)$('shortcut-hint').textContent=`${shortcut.shortcut} 快速切换`;
  if(!/^https?:\/\//.test(currentTab?.url||'')||/^https:\/\/(chromewebstore.google.com|chrome.google.com\/webstore)/.test(currentTab.url)) {
    status('当前页面不支持翻译，请打开普通网页');$('btn-translate').disabled=true;$('site-rule').disabled=true;return;
  }
  $('site-rule').value=view.siteRules[new URL(currentTab.url).origin]||'manual';
  await refresh();
  $('btn-translate').addEventListener('click',()=>run(async()=>{
    if(['translating','watching'].includes(currentStatus.phase)){await command('STOP_TRANSLATION');await refresh();return;}
    await authorize();
    if($('target-lang').value!==view.settings.targetLang){await LT_UI.request('SET_TARGET',{targetLang:$('target-lang').value});view.settings.targetLang=$('target-lang').value;}
    updateUI({...currentStatus,phase:'translating'});
    // Keep Stop usable while the page's long-running response is pending.
    void command('START_TRANSLATION').then(async result=>{if(result.status)updateUI(result.status);else await refresh();}).catch(error=>status(error.message,true));
  }));
  $('btn-restore').addEventListener('click',()=>run(async()=>{await command('REMOVE_TRANSLATION');await refresh();}));
  $('site-rule').addEventListener('change',()=>run(async()=>{
    const rule=$('site-rule').value, origin=new URL(currentTab.url).origin;
    try{
      if(rule==='always')await authorize(true);
      await LT_UI.request('SET_SITE_RULE',{tabId:currentTab.id,rule});view.siteRules[origin]=rule;
      if(rule==='always')void command('START_TRANSLATION').then(refresh).catch(error=>status(error.message,true));
      await refresh();
    }catch(error){$('site-rule').value=view.siteRules[origin]||'manual';throw error;}
  }));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='session'&&changes[`ltStatus_${currentTab.id}`]?.newValue)updateUI(changes[`ltStatus_${currentTab.id}`].newValue);
  });
}
$('btn-settings').addEventListener('click',event=>{event.preventDefault();chrome.runtime.openOptionsPage();});
init().catch(error=>status(error.message,true));
