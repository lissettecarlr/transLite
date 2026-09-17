import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('popup can stop a pending translation and shows partial failure distinctly',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:360,height:620}});
  await page.addInitScript(()=>{
    window.commands=[];window.storageListeners=[];
    window.chrome={
      tabs:{query:async()=>[{id:1,url:'https://article.test'}],sendMessage:async()=>({phase:'idle',count:0})},
      commands:{getAll:async()=>[{shortcut:'Alt+T'}]},permissions:{request:async()=>true},
      storage:{onChanged:{addListener:fn=>window.storageListeners.push(fn)}},
      runtime:{openOptionsPage(){},sendMessage:async message=>{
        if(message.type==='GET_SETTINGS')return {success:true,settings:{service:'google',targetLang:'zh-CN'},siteRules:{},destination:'https://translate.googleapis.com',consent:true};
        window.commands.push(message.command);
        if(message.command==='START_TRANSLATION')return new Promise(resolve=>{window.finishTranslation=()=>resolve({success:true,status:{phase:'stopped',count:0}});});
        return {success:true};
      }},
    };
  });
  await page.goto(pathToFileURL(path.join(root,'src/popup/popup.html')).href);
  await page.waitForFunction(()=>storageListeners.length>0);
  await page.locator('#btn-translate').click();
  await page.waitForFunction(()=>commands.includes('START_TRANSLATION'));
  assert.equal(await page.locator('#btn-translate').isEnabled(),true);
  await page.locator('#btn-translate').click();
  assert.equal(await page.evaluate(()=>commands.includes('STOP_TRANSLATION')),true);
  await page.evaluate(()=>{finishTranslation();});
  await page.evaluate(()=>storageListeners[0]({ltStatus_1:{newValue:{phase:'partial',count:8,error:'HTTP 429：请求过于频繁'}}},'session'));
  assert.match(await page.locator('#status-text').textContent(),/部分完成 8/);
  assert.equal(await page.locator('#btn-text').textContent(),'重试未完成内容');
  assert.equal(await page.locator('#btn-restore').isVisible(),true);
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/popup-release.png')});
});
