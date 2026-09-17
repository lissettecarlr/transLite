import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterSource = fs.readFileSync(path.join(root, "src", "adapters", "linear.js"), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(adapterSource, context, { filename: "linear.js" });

const adapter = context.LT_SITE_ADAPTERS?.linear;
assert.ok(adapter, "Linear adapter should be registered");
assert.equal(adapter.matches(new URL("https://linear.app/acme/agent")), true);
assert.equal(adapter.matches(new URL("https://linear.app/acme/agent/chat-123")), true);
assert.equal(
  adapter.matches(new URL("https://linear.app/acme/settings/initiatives")),
  true,
  "Linear adapter must remain active after navigating from Agent to Initiatives settings",
);
assert.equal(
  adapter.matches(new URL("https://linear.app/acme/project/example/overview")),
  true,
  "Linear adapter must remain active on project pages",
);
assert.equal(adapter.matches(new URL("https://linear.app/acme/my-issues/assigned")), true);
assert.equal(adapter.matches(new URL("https://linear.app/acme/documents")), true);
assert.equal(adapter.matches(new URL("https://linear.app/acme/customer-requests")), true);
assert.equal(adapter.matches(new URL("https://linear.app/acme/releases")), true);
assert.equal(adapter.matches(new URL("https://linear.app/acme/pulse")), true);
assert.equal(adapter.matches(new URL("https://linear.app/acme/asks")), true);
assert.equal(adapter.matches(new URL("https://linear.app/acme/welcome-message")), true);
assert.equal(adapter.matches(new URL("https://linear.app/")), false);
assert.equal(adapter.matches(new URL("https://linear.app.example/acme/agent")), false);
assert.equal(adapter.allowInteractiveUi, true);
assert.equal(adapter.localOnly, true, "Linear should remain local by default");
assert.equal(adapter.replaceText, true, "Linear labels should be replaced in place");
assert.equal(
  adapter.translateContentEditableAttributes,
  true,
  "Linear should translate the chat editor's aria-label",
);
assert.equal(adapter.selectors.includes("div"), false, "Linear adapter must not scan every div");
assert.equal(adapter.selectors.includes("a div"), true, "Linear should cover leaf labels nested in links");
assert.equal(adapter.selectors.includes('[role="menuitem"]'), true, "Linear should scan dynamic menu items");
assert.equal(
  adapter.selectors.includes('[role="menuitemcheckbox"]'),
  true,
  "Linear should scan toggleable dynamic menu items",
);
assert.equal(adapter.selectors.includes('[role="option"]'), true, "Linear should scan listbox options");
assert.equal(adapter.selectors.includes('[role="tooltip"]'), true, "Linear should scan mounted tooltips");
assert.ok(adapter.mutationDebounceMs <= 100, "Linear SPA updates should be rescanned quickly");

const menuItem = {
  getAttribute: (name) => (name === "role" ? "menuitem" : null),
  closest: () => menuItem,
};
assert.equal(
  adapter.allowRemoteTranslation("Open integration audit", menuItem),
  true,
  "unrecognized command-like menu labels should use the constrained fallback",
);
assert.equal(adapter.allowRemoteTranslation("Marketing", menuItem), false, "user labels must be retained");
assert.equal(
  adapter.allowRemoteTranslation("Open integration audit", null),
  false,
  "command-like user content outside UI overlays must be retained",
);
assert.equal(adapter.allowRemoteTranslation("Open VEN-123", menuItem), false, "issue identifiers must be retained");

const expected = new Map([
  ["Inbox", "收件箱"],
  ["My issues", "我的问题"],
  ["Agent", "智能体"],
  ["Workspace", "工作区"],
  ["Your teams", "你的团队"],
  ["What’s new", "最新动态"],
  ["New chat", "新对话"],
  ["Skills", "技能"],
  ["Create a new project", "创建新项目"],
  ["Research a topic across the issue backlog", "在问题待办中调研一个主题"],
  ["Create automated loop", "创建自动化循环"],
  ["Search skills…", "搜索技能…"],
  ["Create skill", "创建技能"],
  ["Search workspace", "搜索工作区"],
  ["Send a message to Linear AI", "向 Linear AI 发送消息"],
  ["Attach images, files, or videos", "添加图片、文件或视频"],
  ["Chat history", "对话历史"],
  ["Back to app", "返回应用"],
  ["Search...", "搜索..."],
  ["Code & reviews", "代码与评审"],
  ["Security & access", "安全与访问"],
  ["Connected accounts", "已连接的账户"],
  ["Agent personalization", "智能体个性化"],
  ["AI & Agents", "AI 与智能体"],
  ["Enable Initiatives", "启用计划"],
  ["Visible to all non-guest workspace members", "对所有非访客工作区成员可见"],
  ["Initiative updates", "计划更新"],
  [
    "Initiatives group multiple projects that contribute toward the same strategic effort. Use initiatives to plan and coordinate larger streams of work and monitor their progress at scale.",
    "计划将多个服务于同一战略目标的项目归为一组。使用计划来规划和协调更大规模的工作，并全面监控其进度。",
  ],
  ["Update schedule", "更新频率"],
  [
    "Configure how often updates are expected on initiatives. Initiative owners will receive reminders to post updates.",
    "配置计划的预期更新频率。计划负责人会收到发布更新的提醒。",
  ],
  ["No expectation for updates", "不要求定期更新"],
  ["Slack notifications", "Slack 通知"],
  [
    "Updates are only posted to Slack for workspace-level initiatives or initiatives led by a public team",
    "只有工作区级计划或由公开团队负责的计划更新才会发布到 Slack",
  ],
  ["Send initiative updates to a Slack channel", "将计划更新发送到 Slack 频道"],
  ["Connect", "连接"],
  ["Overview", "概览"],
  ["Activity", "活动"],
  ["Copy", "复制"],
  ["Favorite", "收藏"],
  ["Subscribe", "订阅"],
  ["Remind me", "提醒我"],
  ["Change update schedule...", "更改更新频率..."],
  ["Configure Slack notifications...", "配置 Slack 通知..."],
  ["Show author names", "显示作者姓名"],
  ["Show description history", "显示描述历史"],
  ["Show updates and activity", "显示更新和活动"],
  ["Hide comments", "隐藏评论"],
  ["Delete", "删除"],
  ["27d", "27 天"],
  ["1 unread notification", "1 条未读通知"],
  ["2 drafts", "2 个草稿"],
]);

for (const [source, translation] of expected) {
  assert.equal(adapter.translate(source), translation, `translation mismatch for ${source}`);
  assert.equal(adapter.shouldTranslate(source), true, `${source} should be translated locally`);
}

assert.equal(adapter.translate("Qimingdaren"), null, "workspace names must be retained");
assert.equal(adapter.translate("VEN-123"), null, "issue identifiers must be retained");
assert.equal(adapter.translate("A user-authored issue title"), null, "user content must be retained");

console.log("Linear Agent 专项适配测试通过");
