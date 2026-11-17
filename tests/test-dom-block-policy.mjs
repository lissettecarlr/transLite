import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src", "dom.js"), "utf8");
const context = vm.createContext({ getComputedStyle: () => ({}) });
vm.runInContext(source, context, { filename: "dom.js" });

const dom = context.LT_DOM;
assert.ok(dom?.blockPolicy, "dom.js should expose blockPolicy");
assert.ok(dom?.canAppendBlock, "dom.js should expose canAppendBlock");

const base = { inControl: false, display: "block", cursor: "auto", position: "static", float: "none" };
const policy = (over) => dom.blockPolicy({ ...base, textLength: 120, controlRatio: 0, ...over });

// 真正的段落块：允许追加
assert.equal(policy({}), true, "a plain long paragraph block may get a translation block");
assert.equal(
  policy({ controlRatio: 0.05 }),
  true,
  "a description with one inline link is still a paragraph",
);

// 三个真实错位场景，都必须拒绝
// 1. 面包屑：文字 87% 来自 <a>
assert.equal(
  policy({ textLength: 34, controlRatio: 0.87 }),
  false,
  "breadcrumbs are navigation, not a paragraph",
);
// 2. 订阅按钮：容器在 <a onclick> 里（没有 href）
assert.equal(policy({ inControl: true }), false, "anything inside a control must not get a block");
// 3. 页头导航条：一串链接 + 中间文字
assert.equal(policy({ textLength: 28, controlRatio: 0.71 }), false, "link rows are navigation");

// 版式兜底（原本就有，防回归）
assert.equal(policy({ display: "inline" }), false, "inline elements stay untouched");
assert.equal(policy({ display: "inline-block" }), false);
assert.equal(policy({ display: "flex" }), false, "appending into a flex container adds an item");
assert.equal(policy({ display: "grid" }), false);
assert.equal(policy({ position: "absolute" }), false);
assert.equal(policy({ position: "fixed" }), false);
assert.equal(policy({ float: "left" }), false);

// 按钮类容器：靠 cursor 识别
assert.equal(policy({ cursor: "pointer" }), false, "cursor:pointer containers are controls");

// 短标签串不是段落
assert.equal(policy({ textLength: 12 }), false);
assert.equal(policy({ textLength: dom.BLOCK_MIN_CHARS }), true, "exactly at the threshold is allowed");

// 选择器必须覆盖没有 href 的 <a>
assert.ok(dom.CONTROLS.includes("a,") || dom.CONTROLS.startsWith("a,"), "control selector must match <a> without href");
assert.ok(dom.CONTROLS.includes('[onclick]'), "onclick-only buttons must count as controls");
