import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listeners = [];
let observerCallback = null;
let menuMounted = false;
const attributes = new Map([["aria-label", "Send a message to Linear AI"]]);
const editor = {
  isContentEditable: true,
  isConnected: true,
  closest(selector) {
    if (selector.includes('[role="menuitem"]')) return this;
    if (selector.includes("[data-lt-done]") && menuAttributes.has("data-lt-done")) return this;
    return null;
  },
  hasAttribute: (name) => attributes.has(name),
  getAttribute: (name) => attributes.get(name) ?? null,
  setAttribute: (name, value) => attributes.set(name, value),
};

const menuAttributes = new Map([["role", "menuitem"]]);
const menuItem = {
  nodeType: 1,
  tagName: "DIV",
  childNodes: [],
  parentElement: null,
  offsetParent: {},
  classList: { contains: () => false },
  hasAttribute: (name) => menuAttributes.has(name),
  getAttribute: (name) => menuAttributes.get(name) ?? null,
  setAttribute: (name, value) => menuAttributes.set(name, value),
  removeAttribute: (name) => menuAttributes.delete(name),
  closest: () => null,
};
const menuTextNode = {
  nodeType: 3,
  nodeValue: "Copy",
  textContent: "Copy",
  parentElement: menuItem,
  isConnected: true,
};
menuItem.childNodes.push(menuTextNode);

const attributeSelector = "[title],[aria-label],[placeholder]";
const document = {
  title: "New chat",
  body: { innerText: "Linear Agent", querySelector: () => null },
  documentElement: { lang: "zh-CN" },
  querySelectorAll: (selector) => {
    if (selector === attributeSelector) return [editor];
    if (selector === "[data-lt-done]") {
      return menuAttributes.has("data-lt-done") ? [menuItem] : [];
    }
    if (selector === "[data-lt-pending]") {
      return menuAttributes.has("data-lt-pending") ? [menuItem] : [];
    }
    if (menuMounted && selector.includes('[role="menuitem"]')) return [menuItem];
    return [];
  },
  createTreeWalker: () => {
    let emitted = false;
    return {
      nextNode() {
        if (emitted) return null;
        emitted = true;
        return menuTextNode;
      },
    };
  },
  addEventListener: () => {},
};

class FakeMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
  disconnect() {}
}

const location = {
  href: "https://linear.app/acme/agent",
  hostname: "linear.app",
  pathname: "/acme/agent",
};

const context = vm.createContext({
  crypto: webcrypto,
  console,
  URL,
  setTimeout,
  clearTimeout,
  document,
  location,
  window: { addEventListener() {}, getComputedStyle: () => ({}) },
  MutationObserver: FakeMutationObserver,
  NodeFilter: { SHOW_TEXT: 4 },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  chrome: {
    storage: {
      sync: { get(defaults, callback) { callback(defaults); } },
    },
    runtime: {
      id: "test-extension",
      lastError: null,
      onMessage: { addListener(listener) { listeners.push(listener); } },
      sendMessage(message, callback) {
        if (typeof callback === "function") callback({ ok: true });
        if (message.type === "TRANSLATE") {
          return Promise.resolve({
            success: true,
            translations: message.texts.map((text) => (
              text === "Open integration audit" ? "打开集成审计" : text
            )),
          });
        }
        if (message.type === 'GET_PAGE_SETTINGS') return Promise.resolve({success:true, settings:{...context.LT_DEFAULTS}});
        return Promise.resolve({ success:true, ok: true });
      },
    },
  },
});

for (const file of ["defaults.js", "adapters/linear.js", "dom.js", "content.js"]) {
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
assert.equal(attributes.get("aria-label"), "向 Linear AI 发送消息");

location.href = "https://linear.app/acme/settings/initiatives";
location.pathname = "/acme/settings/initiatives";
attributes.set("aria-label", "Search...");
observerCallback([{
  type: "attributes",
  target: editor,
  attributeName: "aria-label",
}]);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(
  attributes.get("aria-label"),
  "搜索...",
  "Linear settings labels should be translated after SPA navigation",
);

location.href = "https://linear.app/acme/project/example/overview";
location.pathname = "/acme/project/example/overview";
menuMounted = true;
observerCallback([{
  type: "childList",
  addedNodes: [menuItem],
}]);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(
  menuTextNode.nodeValue,
  "复制",
  "Linear menu items should be translated when a portal is mounted",
);

listeners[0]({ type: "REMOVE_TRANSLATION" }, {}, () => {});
assert.equal(attributes.get("aria-label"), "Search...");
assert.equal(menuTextNode.nodeValue, "Copy");

menuTextNode.nodeValue = "Open integration audit";
menuTextNode.textContent = "Open integration audit";
const fallbackResponse = await new Promise((resolve, reject) => {
  listeners[0]({ type: "START_TRANSLATION" }, {}, resolve);
  setTimeout(() => reject(new Error("Linear fallback translation did not finish")), 200);
});
assert.equal(fallbackResponse.ok, true);
assert.equal(
  menuTextNode.nodeValue,
  "打开集成审计",
  "Unknown command-like labels in Linear menus should use the remote fallback",
);

listeners[0]({ type: "REMOVE_TRANSLATION" }, {}, () => {});
assert.equal(menuTextNode.nodeValue, "Open integration audit");

console.log("Linear Agent 内容脚本集成测试通过");
