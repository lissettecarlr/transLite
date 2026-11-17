import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

function harness(responder, legacy = false) {
  const data={local:{},sync:{},session:{}}, levels={}, sent=[], calls=[], opened=[], scripts={}, injected=[];
  const event={addListener(){}};
  const area=name=>({
    ...(legacy?{}:{async setAccessLevel(value){levels[name]=value.accessLevel;}}),
    async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in data[name]).map(key=>[key,structuredClone(data[name][key])]));},
    async set(values){Object.assign(data[name],structuredClone(values));},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[name][key];},
  });
  const context=vm.createContext({console,URL,DOMException,AbortController,AbortSignal,setTimeout,clearTimeout,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,
    importScripts(...files){for(const file of files)vm.runInContext(fs.readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8'),context);},
    chrome:{runtime:{id:'fixture',getURL:path=>`chrome-extension://fixture/${path}`,onMessage:event,onInstalled:event,onStartup:event,openOptionsPage:async()=>{opened.push(true);},getManifest:()=>({})},
      storage:{local:area('local'),sync:area('sync'),...(legacy?{}:{session:area('session')})},
      scripting:{
        getRegisteredContentScripts:async({ids=[]}={})=>(scripts.registered||[]).filter(item=>!ids.length||ids.includes(item.id)),
        registerContentScripts:async list=>{scripts.registered=[...(scripts.registered||[]),...structuredClone(list)];},
        updateContentScripts:async list=>{scripts.registered=(scripts.registered||[]).map(item=>structuredClone(list.find(next=>next.id===item.id)||item));},
        unregisterContentScripts:async({ids=[]}={})=>{scripts.registered=(scripts.registered||[]).filter(item=>!ids.includes(item.id));},
        insertCSS:async()=>{injected.push('css');},
        executeScript:async target=>{injected.push(target.files.join(','));},
      },
      permissions:{contains:async()=>true,request:async()=>true,onRemoved:event,onAdded:event},commands:{onCommand:event},contextMenus:{onClicked:event},
      tabs:{onRemoved:event,onUpdated:event,get:async id=>({id,url:'https://page.test/'}),query:async()=>[{id:1,url:'https://page.test/'}],sendMessage:async(id,message)=>{sent.push(message);return {};}},
      action:{setBadgeText:async()=>{},setTitle:async()=>{}},
    },
    fetch:async(url,options)=>{calls.push({url,options});if(responder)return responder(url,options);return {ok:true,json:async()=>({choices:[{message:{content:'["测试译文"]'}}]})};},
  });
  vm.runInContext(fs.readFileSync(new URL('../src/background.js',import.meta.url),'utf8'),context);
  const ui={id:'fixture',url:'chrome-extension://fixture/options/options.html'};
  const page={id:'fixture',url:'https://page.test/',tab:{id:1},frameId:0,documentId:'doc'};
  return {data,levels,sent,calls,opened,scripts,injected,context,ui,page,send:(message,sender=ui)=>context.dispatch(message,sender)};
}

test('only trusted extension UI can configure credentials; page settings and messages contain no secrets',async()=>{
  const h=harness();
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai',apiKey:'must-be-ignored'},apiKey:'fixture-secret',consent:true});
  assert.deepEqual(h.levels,{local:'TRUSTED_CONTEXTS',sync:'TRUSTED_CONTEXTS',session:'TRUSTED_CONTEXTS'});
  assert.equal(h.data.local.credential.apiKey,'fixture-secret','plain keys persist locally so a browser restart does not ask again');
  assert.equal(JSON.stringify(h.data.local.preferences).includes('fixture-secret'),false);
  assert.equal(JSON.stringify(h.data.sync).includes('fixture-secret'),false);
  assert.equal(h.data.session.credential,undefined);
  assert.equal(JSON.stringify(h.sent).includes('fixture-secret'),false);
  h.data.session={}; // browser restart clears session storage
  assert.equal((await h.send({type:'GET_SETTINGS'})).hasKey,true);
  const page=await h.send({type:'GET_PAGE_SETTINGS'},h.page);
  assert.equal('apiKey' in page.settings,false);assert.equal('apiBaseUrl' in page.settings,false);
  await assert.rejects(h.send({type:'GET_SETTINGS'},h.page),/无权/);
  await assert.rejects(h.send({type:'SAVE_SETTINGS',apiKey:'replace'},h.page),/无权/);
  await h.send({type:'BEGIN_TASK',taskId:'page1'},h.page);
  await h.send({type:'TRANSLATE',taskId:'page1',texts:['Example'],settings:{apiBaseUrl:'https://attacker.test',apiKey:'wrong'}},h.page);
  assert.match(h.calls[0].url,/dashscope.aliyuncs.com/);
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer fixture-secret');
});

test('credentials are bound to the configured endpoint and encrypted vault needs the correct password',async()=>{
  const h=harness();
  const settings={service:'openai'};
  await h.send({type:'SAVE_SETTINGS',settings,apiKey:'fixture-secret',rememberKey:true,password:'test-password-long',consent:true});
  assert.equal(JSON.stringify(h.data.local).includes('fixture-secret'),false,'password mode must not keep a plain copy');
  assert.equal(JSON.stringify(h.data.local).includes('test-password-long'),false);
  assert.equal(h.data.session.credential.apiKey,'fixture-secret');
  delete h.data.session.credential;
  assert.equal((await h.send({type:'GET_SETTINGS'})).hasKey,false);
  await assert.rejects(h.send({type:'UNLOCK_KEY',password:'wrong-password'}),/解锁失败/);
  await h.send({type:'UNLOCK_KEY',password:'test-password-long'});
  assert.equal(h.data.session.credential.apiKey,'fixture-secret');
  await h.send({type:'SAVE_SETTINGS',settings:{...settings,provider:'custom',apiBaseUrl:'https://different.test/v1'}});
  assert.equal(h.data.session.credential,undefined);assert.equal(h.data.local.vault,undefined);assert.equal(h.data.local.credential,undefined);
});

test('a plain saved key can be upgraded to the encrypted vault, and clearing removes every copy',async()=>{
  const h=harness();
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},apiKey:'fixture-secret',consent:true});
  await assert.rejects(h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},rememberKey:true,password:'short'}),/12 位/);
  assert.equal(h.data.local.credential.apiKey,'fixture-secret','a failed upgrade must not drop the saved key');
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},rememberKey:true,password:'test-password-long'});
  assert.equal(h.data.local.credential,undefined);assert.ok(h.data.local.vault);
  assert.equal(h.data.session.credential.apiKey,'fixture-secret');
  assert.equal((await h.send({type:'GET_SETTINGS'})).hasVault,true);
  await h.send({type:'CLEAR_KEY'});
  assert.deepEqual([h.data.local.credential,h.data.local.vault,h.data.session.credential],[undefined,undefined,undefined]);
  await assert.rejects(h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},rememberKey:true,password:'test-password-long'}),/请填写/);
});

test('remote insecure endpoints, URL credentials and unsupported schemes are rejected',async()=>{
  const h=harness();
  for(const apiBaseUrl of ['http://api.test/v1','https://key:secret@api.test/v1','javascript:alert(1)','https://api.test/v1?key=secret']) {
    await assert.rejects(h.send({type:'SAVE_SETTINGS',settings:{apiBaseUrl,provider:'custom'}}));
  }
  await assert.rejects(h.send({type:'SAVE_SETTINGS',settings:{provider:'local',apiBaseUrl:'http://192.168.1.2:8000/v1'}}));
  await h.send({type:'SAVE_SETTINGS',settings:{provider:'local',apiBaseUrl:'http://localhost:8000/v1/chat/completions'}});
  assert.equal(h.data.local.preferences.apiBaseUrl,'http://localhost:8000/v1');
});

test('cancelling one task aborts its request and does not cancel another tab',async()=>{
  const h=harness((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')))));
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},apiKey:'fixture-key',consent:true});
  const second={...h.page,tab:{id:2},documentId:'doc2'};
  await h.send({type:'BEGIN_TASK',taskId:'one'},h.page);await h.send({type:'BEGIN_TASK',taskId:'two'},second);
  const firstPromise=h.send({type:'TRANSLATE',taskId:'one',texts:['Shared paragraph']},h.page);
  const secondPromise=h.send({type:'TRANSLATE',taskId:'two',texts:['Shared paragraph']},second);
  const firstAssert=assert.rejects(firstPromise,error=>error.name==='AbortError');
  const secondAssert=assert.rejects(secondPromise,error=>error.name==='AbortError');
  while(h.calls.length<2)await new Promise(resolve=>setTimeout(resolve,1));
  await h.send({type:'CANCEL_TASK',taskId:'one'},h.page);await firstAssert;
  assert.equal(h.calls[1].options.signal.aborted,false);
  await h.send({type:'CANCEL_TASK',taskId:'two'},second);await secondAssert;
});

test('queue cancellation removes work before it sends a request',async()=>{
  const h=harness((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')))));
  const controllers=Array.from({length:4},()=>new AbortController());
  const tasks=controllers.map((controller,i)=>h.context.handleTranslation([`Paragraph ${i}`],{service:'openai',apiKey:'test',model:'qwen3.8-flash'},{scope:String(i),signal:controller.signal}));
  const checks=tasks.map(task=>assert.rejects(task,error=>error.name==='AbortError'));
  while(h.calls.length<3)await new Promise(resolve=>setTimeout(resolve,1));
  controllers[3].abort();await checks[3];
  controllers.slice(0,3).forEach(controller=>controller.abort());await Promise.all(checks);
  assert.equal(h.calls.length,3);
});

test('transient HTTP errors retry with a bound, while authentication failures do not',async()=>{
  let calls=0;
  const h=harness(async()=>++calls<3?{ok:false,status:429,headers:{get:()=>null}}:{ok:true,json:async()=>({choices:[{message:{content:'["成功"]'}}]})});
  const result=await h.context.handleTranslation(['Retry'],{service:'openai',apiKey:'test'});
  assert.equal(result.translations[0],'成功');assert.equal(calls,3);
  const bad=harness(async()=>({ok:false,status:401}));
  await assert.rejects(bad.context.handleTranslation(['Bad key'],{service:'openai',apiKey:'bad'}),/401/);
  assert.equal(bad.calls.length,1);
});

test('DeepL keeps its own key slot, plan host and request shape', async () => {
  const h = harness((url,options)=>({ok:true,json:async()=>({translations:[{detected_source_language:'EN',text:'示例译文'}]})}));
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},apiKey:'ai-secret',consent:true});
  const deepl = await h.send({type:'SAVE_SETTINGS',settings:{service:'deepl'},apiKey:'deepl-secret:fx',consent:true});
  assert.equal(deepl.destination,'https://api-free.deepl.com');
  assert.equal(deepl.hasKey,true);
  assert.equal(h.data.local.credential.apiKey,'ai-secret','switching to DeepL must not drop the AI key');
  assert.equal(h.data.local.credentialDeepl.endpoint,'https://api-free.deepl.com');
  assert.equal(JSON.stringify(h.data.local.preferences).includes('deepl-secret'),false);

  const connection = await h.send({type:'TEST_CONNECTION'});
  assert.equal(connection.translation,'示例译文');
  assert.equal(h.calls[0].url,'https://api-free.deepl.com/v2/translate');
  assert.equal(h.calls[0].options.headers.Authorization,'DeepL-Auth-Key deepl-secret:fx');
  assert.equal(h.calls[0].options.headers['Content-Type'],'application/json');

  const back = await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'}});
  assert.equal(back.hasKey,true,'switching back finds the AI key again');

  const pro = await h.send({type:'SAVE_SETTINGS',settings:{service:'deepl',deeplPlan:'pro'}});
  assert.equal(pro.destination,'https://api.deepl.com');
  assert.equal(pro.hasKey,false,'a free key is bound to api-free and is dropped when the host changes');
});

test('the DeepL key can be encrypted with the same vault flow', async () => {
  const h = harness();
  await h.send({type:'SAVE_SETTINGS',settings:{service:'deepl'},apiKey:'deepl-secret:fx',rememberKey:true,password:'test-password-long',consent:true});
  assert.equal(JSON.stringify(h.data.local).includes('deepl-secret'),false);
  assert.ok(h.data.local.vaultDeepl);
  assert.equal(h.data.session.credentialDeepl.apiKey,'deepl-secret:fx');
  delete h.data.session.credentialDeepl;
  const locked = await h.send({type:'GET_SETTINGS'});
  assert.equal(locked.hasKey,false);assert.equal(locked.hasVault,true);
  await h.send({type:'UNLOCK_KEY',password:'test-password-long'});
  assert.equal(h.data.session.credentialDeepl.apiKey,'deepl-secret:fx');
  await h.send({type:'CLEAR_KEY'});
  assert.deepEqual([h.data.local.credentialDeepl,h.data.local.vaultDeepl,h.data.session.credentialDeepl],[undefined,undefined,undefined]);
});

test('the floating entry asks the background to open options, and only from a real page', async () => {
  const h=harness();
  await h.send({type:'OPEN_SETTINGS'},h.page);
  assert.equal(h.opened.length,1);
  await assert.rejects(h.send({type:'OPEN_SETTINGS'},{...h.page,tab:undefined}),/无权/);
  await assert.rejects(h.send({type:'OPEN_SETTINGS'},{...h.page,url:'chrome-extension://fixture/x.html'}),/无权/);
});

test('the floating entry injects only button.js, is on by default and can be switched off', async () => {
  const h=harness(), fab=()=>(h.scripts.registered||[]).find(item=>item.id==='lt-fab');
  assert.equal((await h.send({type:'GET_SETTINGS'})).settings.floatingButton,true);
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},consent:true});
  assert.deepEqual(fab().js,['button.js'],'the all-site script carries the button only, never the translation bundle');
  assert.deepEqual([...fab().matches].sort(),['http://*/*','https://*/*']);
  assert.equal(fab().runAt,'document_idle');
  assert.equal((await h.send({type:'GET_PAGE_SETTINGS'},h.page)).settings.floatingButton,true,'the page learns whether to render it');

  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai',floatingButton:false}});
  assert.equal(fab(),undefined,'switching it off removes the injection');
  assert.equal((await h.send({type:'GET_PAGE_SETTINGS'},h.page)).settings.floatingButton,false);
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai',floatingButton:true}});
  assert.ok(fab(),'switching it back on registers again');
});

test('the all-sites build relies on the manifest injection instead of registering it twice', async () => {
  const h=harness(), fab=()=>(h.scripts.registered||[]).find(item=>item.id==='lt-fab');
  h.context.chrome.runtime.getManifest=()=>({content_scripts:[{matches:['http://*/*'],js:['button.js']}]});
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},consent:true});
  assert.equal(fab(),undefined,'button.js already ships in manifest content_scripts');
});

test('an engine without storage.session or setAccessLevel still boots and keeps the key', async () => {
  const h=harness(undefined,true);
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},apiKey:'legacy-secret',consent:true});
  assert.deepEqual(h.levels,{},'setAccessLevel is skipped instead of throwing');
  assert.equal(h.data.local.credential.apiKey,'legacy-secret');
  const view=await h.send({type:'GET_SETTINGS'});
  assert.equal(view.hasKey,true,'the missing session area falls back to in-memory');
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},rememberKey:true,password:'test-password-long'});
  assert.ok(h.data.local.vault);
  await assert.rejects(h.send({type:'UNLOCK_KEY',password:'wrong-password'}),/解锁失败/);
});

test('auto translate defaults to environment detection and rejects unknown modes', async () => {
  const h=harness();
  assert.equal((await h.send({type:'GET_SETTINGS'})).settings.autoTranslate,'auto');
  assert.equal((await h.send({type:'GET_PAGE_SETTINGS'},h.page)).settings.autoTranslate,'auto');
  for (const autoTranslate of ['always','off','auto']) {
    await h.send({type:'SAVE_SETTINGS',settings:{service:'openai',autoTranslate}});
    assert.equal((await h.send({type:'GET_SETTINGS'})).settings.autoTranslate,autoTranslate);
  }
  await assert.rejects(h.send({type:'SAVE_SETTINGS',settings:{autoTranslate:'sometimes'}}),/设置选项无效/);
});

test('the bootstrapping button can wake the page without a toolbar, but the UI cannot', async () => {
  const h=harness();
  await h.send({type:'AUTO_START'},h.page);
  assert.deepEqual(h.injected,['css','defaults.js,adapters/litellm.js,adapters/linear.js,adapters/steam.js,dom.js,content.js,button.js'],'injects the page bundle');
  await assert.rejects(h.send({type:'AUTO_START'}),/未知操作/,'extension pages cannot smuggle the command');
});

test('a failed bootstrap reports the reason instead of failing silently', async () => {
  const h=harness();
  h.context.chrome.scripting.executeScript=async()=>{throw new Error('chrome.scripting is not a function');};
  const response=await h.send({type:'AUTO_START'},h.page);
  assert.equal(response.started,false,'the page must learn that nothing was injected');
  assert.match(response.reason,/无法访问此页面/,'and it must carry a human readable reason');
});

test('the self-check reports capabilities without leaking the key', async () => {
  const h=harness();
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai'},apiKey:'health-secret',consent:true});
  const health=await h.send({type:'HEALTH'});
  assert.equal(health.sw,true);
  assert.equal(health.consent,true);
  assert.equal(health.hasKey,true);
  assert.deepEqual(JSON.parse(JSON.stringify(health.apis)),{scripting:true,registerScripts:true,storageSession:true,setAccessLevel:true,openOptionsPage:true});
  assert.equal(JSON.stringify(health).includes('health-secret'),false,'never echo the credential');
  assert.equal((await h.send({type:'HEALTH'},h.page)).sw,true,'pages may ask too, for the floating button state');
});
