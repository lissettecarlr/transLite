import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('installed MV3 extension configures, translates, protects storage and restores page', {timeout:120000}, async t=>{
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/v1/chat/completions'){
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests.push(body);
      const texts=JSON.parse(body.messages[1].content);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(texts.map(text=>`译文：${text}`))}}]}));return;
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html lang="en"><body><main><p id="article">Read the <strong>complete documentation</strong> before installing this tool.</p><button id="action">Original action</button></main></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'translite-test-'));
  let context;
  t.after(async()=>{
    await context?.close();
    assert.equal(path.dirname(path.resolve(profile)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('translite-test-'));
    await fs.rm(profile,{recursive:true,force:true});
  });
  // Native permission prompts require manual QA. Grant only the local fixture
  // host in this temporary test manifest; all extension APIs remain real.
  const extension=path.join(profile,'test-extension');
  await fs.cp(path.join(root,'src'),extension,{recursive:true,filter:source=>!source.includes('冲突文件')});
  const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.content_scripts,undefined);
  manifest.host_permissions=['http://127.0.0.1/*'];
  await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const options=await context.newPage(), errors=[];
  options.on('pageerror',error=>errors.push(error.message));
  await options.goto(`chrome-extension://${id}/options/options.html`);
  await options.waitForFunction(()=>document.querySelector('#model').value==='qwen3.8-flash');
  await options.locator('input[name=service][value=openai]').check();
  await options.locator('#provider').selectOption('local');
  await options.locator('#api-base-url').fill(`${base}/v1`);
  await options.locator('#api-key').fill('fixture-key');
  await options.locator('#remember-key').check();
  await options.locator('#vault-password').fill('a-long-test-password');
  await options.locator('#service-consent').check();
  await options.locator('#btn-test').click();
  await options.waitForFunction(()=>document.querySelector('#test-result').textContent.includes('连接成功')).catch(async error=>{
    const diagnostic=await options.evaluate(()=>({status:document.querySelector('#save-status').textContent,result:document.querySelector('#test-result').textContent,busy:document.querySelector('#btn-test').disabled}));
    throw new Error(`${error.message} ${JSON.stringify({diagnostic,errors,requests:requests.length})}`);
  });
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].chat_template_kwargs,{enable_thinking:false});
  assert.equal(requests[0].enable_thinking,undefined);
  const storage=await worker.evaluate(async()=>({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null),session:await chrome.storage.session.get(null)}));
  assert.equal(JSON.stringify(storage.local).includes('fixture-key'),false);
  assert.equal(JSON.stringify(storage.sync).includes('fixture-key'),false);
  assert.equal(storage.session.credential.apiKey,'fixture-key');
  const page=await context.newPage();await page.goto(`${base}/article`);
  const tabId=await worker.evaluate(async base=>(await chrome.tabs.query({})).find(tab=>tab.url===`${base}/article`).id,base);
  const command=command=>options.evaluate(async({tabId,command})=>chrome.runtime.sendMessage({type:'PAGE_COMMAND',tabId,command}),{tabId,command});
  await page.evaluate(()=>{window.original=document.querySelector('main').innerHTML;window.clicks=0;document.querySelector('#action').onclick=()=>window.clicks++;});
  const start=await command('START_TRANSLATION');assert.equal(start.success,true,JSON.stringify(start));
  assert.equal(start.status.phase,'watching');
  assert.equal(await page.locator('#article .lt-result').count(),1);
  const isolated=await worker.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:async()=>{
    let storageDenied=false;try{await chrome.storage.session.get('credential');}catch{storageDenied=true;}
    const settings=await chrome.runtime.sendMessage({type:'GET_PAGE_SETTINGS'});
    const denied=await chrome.runtime.sendMessage({type:'GET_SETTINGS'});
    return {storageDenied,settings,denied};
  }}))[0].result,tabId);
  assert.equal(isolated.storageDenied,true);assert.equal(isolated.denied.success,false);
  assert.equal('apiKey' in isolated.settings.settings,false);
  await page.locator('#action').click();assert.equal(await page.evaluate(()=>clicks),1);
  await command('REMOVE_TRANSLATION');
  assert.equal(await page.evaluate(()=>document.querySelector('main').innerHTML===original),true);
  const rule=await options.evaluate(async tabId=>chrome.runtime.sendMessage({type:'SET_SITE_RULE',tabId,rule:'always'}),tabId);
  assert.equal(rule.success,true,JSON.stringify(rule));
  assert.equal((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).length,1);
  const automatic=await context.newPage();await automatic.goto(`${base}/automatic`);
  await automatic.waitForFunction(()=>document.querySelector('.lt-result'));
  const stopped=await options.evaluate(async tabId=>chrome.runtime.sendMessage({type:'SET_SITE_RULE',tabId,rule:'never'}),tabId);
  assert.equal(stopped.success,true);
  assert.equal((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).length,0);
  const requestCount=requests.length;
  const excluded=await context.newPage();await excluded.goto(`${base}/excluded`);await excluded.waitForTimeout(200);
  assert.equal(await excluded.locator('.lt-result').count(),0);assert.equal(requests.length,requestCount);
  // Force a real worker shutdown and verify a message wakes it with session key intact.
  const cdp=await context.newCDPSession(options);
  let versions=[];cdp.on('ServiceWorker.workerVersionUpdated',event=>{versions=event.versions;});
  await cdp.send('ServiceWorker.enable');
  await options.waitForTimeout(100);
  const version=versions.find(version=>version.scriptURL===worker.url());assert.ok(version);
  await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});
  const revived=await options.evaluate(()=>chrome.runtime.sendMessage({type:'GET_SETTINGS'}));assert.equal(revived.hasKey,true);
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await options.evaluate(()=>scrollTo(0,0));
  await options.screenshot({path:path.join(root,'test-results/settings-release.png'),fullPage:true});
  await options.emulateMedia({colorScheme:'dark'});
  await options.screenshot({path:path.join(root,'test-results/settings-release-dark.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await context.close();
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const reopened=await context.newPage();await reopened.goto(`chrome-extension://${id}/options/options.html`);
  await reopened.locator('#unlock-password').waitFor({state:'visible'});
  assert.match(await reopened.locator('#key-status').textContent(),/锁定/);
  await reopened.locator('#unlock-password').fill('a-long-test-password');await reopened.locator('#btn-unlock').click();
  await reopened.waitForFunction(()=>document.querySelector('#key-status').textContent.includes('已解锁'));
});
