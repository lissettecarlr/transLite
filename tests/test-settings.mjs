import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

function harness(responder) {
  const data={local:{},sync:{},session:{}}, levels={}, sent=[], calls=[];
  const event={addListener(){}};
  const area=name=>({
    async setAccessLevel(value){levels[name]=value.accessLevel;},
    async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in data[name]).map(key=>[key,structuredClone(data[name][key])]));},
    async set(values){Object.assign(data[name],structuredClone(values));},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[name][key];},
  });
  const context=vm.createContext({console,URL,DOMException,AbortController,AbortSignal,setTimeout,clearTimeout,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,
    importScripts(...files){for(const file of files)vm.runInContext(fs.readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8'),context);},
    chrome:{runtime:{id:'fixture',getURL:path=>`chrome-extension://fixture/${path}`,onMessage:event,onInstalled:event,onStartup:event},
      storage:{local:area('local'),sync:area('sync'),session:area('session')},
      permissions:{contains:async()=>true,onRemoved:event},commands:{onCommand:event},contextMenus:{onClicked:event},
      tabs:{onRemoved:event,onUpdated:event,query:async()=>[{id:1,url:'https://page.test/'}],sendMessage:async(id,message)=>sent.push(message)},
      action:{setBadgeText:async()=>{},setTitle:async()=>{}},
    },
    fetch:async(url,options)=>{calls.push({url,options});if(responder)return responder(url,options);return {ok:true,json:async()=>({choices:[{message:{content:'["测试译文"]'}}]})};},
  });
  vm.runInContext(fs.readFileSync(new URL('../src/background.js',import.meta.url),'utf8'),context);
  const ui={id:'fixture',url:'chrome-extension://fixture/options/options.html'};
  const page={id:'fixture',url:'https://page.test/',tab:{id:1},frameId:0,documentId:'doc'};
  return {data,levels,sent,calls,context,ui,page,send:(message,sender=ui)=>context.dispatch(message,sender)};
}

test('only trusted extension UI can configure credentials; page settings and messages contain no secrets',async()=>{
  const h=harness();
  await h.send({type:'SAVE_SETTINGS',settings:{service:'openai',apiKey:'must-be-ignored'},apiKey:'fixture-secret',consent:true});
  assert.deepEqual(h.levels,{local:'TRUSTED_CONTEXTS',sync:'TRUSTED_CONTEXTS',session:'TRUSTED_CONTEXTS'});
  assert.equal(JSON.stringify(h.data.local).includes('fixture-secret'),false);
  assert.equal(JSON.stringify(h.data.sync).includes('fixture-secret'),false);
  assert.equal(h.data.session.credential.apiKey,'fixture-secret');
  assert.equal(JSON.stringify(h.sent).includes('fixture-secret'),false);
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
  assert.equal(JSON.stringify(h.data.local).includes('fixture-secret'),false);
  assert.equal(JSON.stringify(h.data.local).includes('test-password-long'),false);
  delete h.data.session.credential;
  assert.equal((await h.send({type:'GET_SETTINGS'})).hasKey,false);
  await assert.rejects(h.send({type:'UNLOCK_KEY',password:'wrong-password'}),/解锁失败/);
  await h.send({type:'UNLOCK_KEY',password:'test-password-long'});
  assert.equal(h.data.session.credential.apiKey,'fixture-secret');
  await h.send({type:'SAVE_SETTINGS',settings:{...settings,provider:'custom',apiBaseUrl:'https://different.test/v1'}});
  assert.equal(h.data.session.credential,undefined);assert.equal(h.data.local.vault,undefined);
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
