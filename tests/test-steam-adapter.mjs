import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src", "adapters", "steam.js"), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context, { filename: "steam.js" });

const adapter = context.LT_SITE_ADAPTERS?.steam;
assert.ok(adapter, "Steam adapter should be registered");

// 工坊列表页和详情页都要命中
assert.equal(adapter.matches(new URL("https://steamcommunity.com/workshop/browse/?appid=550&section=readytouseitems&days=7")), true);
assert.equal(adapter.matches(new URL("https://steamcommunity.com/sharedfiles/filedetails/?id=3838067801")), true);
assert.equal(adapter.matches(new URL("https://steamcommunity.com/app/550/workshop/")), true);
assert.equal(adapter.matches(new URL("https://store.steampowered.com/app/550/")), true);
// 不能误伤别的站点
assert.equal(adapter.matches(new URL("https://notsteamcommunity.com/workshop/")), false, "lookalike host must not match");
assert.equal(adapter.matches(new URL("https://example.com/workshop/browse/")), false);

// 工坊标题/简介是 div，必须显式选中，否则默认选择器（p/h*/li）永远够不到
for (const selector of [".workshopItemTitle", ".workshopItemShortDesc", ".workshopItemDescription"]) {
  assert.ok(adapter.selectors.includes(selector), `missing selector ${selector}`);
}

// 工坊卡片整体是 <a>，不放开交互元素限制会被 isClickable 全部跳过
assert.equal(adapter.allowInteractiveUi, true, "workshop cards are links, so interactive elements must be allowed");

// 适配器只加选择器，不该接管本地词典（否则会把页面文字换成写死的译文）
assert.equal(adapter.translate, undefined, "no local dictionary: Steam content must go through the translator");
