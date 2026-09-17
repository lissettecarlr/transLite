import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listeners = [];
const runtimeMessages = [];
const sessionValues = {};
let observerCallback = null;
const document = {
  title: "LiteLLM Dashboard",
  body: { innerText: "LiteLLM Dashboard", querySelector: () => null },
  documentElement: { lang: "en" },
  querySelectorAll: () => [],
  addEventListener: () => {},
};

class FakeMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
  disconnect() {}
}

const context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  document,
  location: {
    href: "https://litellm.example.com/ui/api-keys",
    origin: "https://litellm.example.com",
    hostname: "litellm.example.com",
    pathname: "/ui/api-keys",
  },
  window: { addEventListener() {}, getComputedStyle: () => ({}) },
  MutationObserver: FakeMutationObserver,
  NodeFilter: { SHOW_TEXT: 4 },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  chrome: {
    storage: {
      sync: { get(defaults, callback) { callback(defaults); } },
      local: {
        get(keys, callback) {
          const values = {};
          for (const key of keys) if (sessionValues[key] !== undefined) values[key] = sessionValues[key];
          callback(values);
        },
        set(values) { Object.assign(sessionValues, values); return Promise.resolve(); },
      },
      session: {
        get(keys, callback) {
          const values = {};
          for (const key of keys) if (sessionValues[key] !== undefined) values[key] = sessionValues[key];
          callback(values);
        },
        set(values) { Object.assign(sessionValues, values); return Promise.resolve(); },
      },
    },
    runtime: {
      id: "test-extension",
      lastError: null,
      onMessage: { addListener(listener) { listeners.push(listener); } },
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        if (typeof callback === "function") callback({ ok: true });
        if (message.type === 'GET_PAGE_SETTINGS') return Promise.resolve({success:true, settings:{...context.LT_DEFAULTS}});
        return Promise.resolve({ success:true, ok: true });
      },
    },
  },
});

for (const file of ["defaults.js", "adapters/litellm.js", "dom.js", "content.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "src", file), "utf8"), context, { filename: file });
}

await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(listeners.length, 1, "content script should register one message listener");

const response = await new Promise((resolve, reject) => {
  const keepAlive = listeners[0]({ type: "START_TRANSLATION" }, {}, resolve);
  assert.equal(keepAlive, true, "START_TRANSLATION must keep the response channel open");
  setTimeout(() => reject(new Error("START_TRANSLATION did not return a final status")), 200);
});

assert.equal(response.ok, true);
assert.equal(
  JSON.stringify(response.status),
  JSON.stringify({phase:"watching",error:"",isTranslating:false,isTranslated:false,count:0}),
);
runtimeMessages.length = 0;
observerCallback([{
  type: "childList",
  addedNodes: [{ nodeType: 3, textContent: "Virtual Keys" }],
}]);
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(
  runtimeMessages.some((message) => message.type === "STATUS_UPDATE"),
  true,
  "a React text-node update should trigger a fast LiteLLM rescan",
);

listeners[0]({ type: "REMOVE_TRANSLATION" }, {}, () => {});
console.log("内容脚本状态收敛测试通过");
