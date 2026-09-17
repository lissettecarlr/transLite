import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src", "adapters", "linear.js"), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context, { filename: "linear.js" });

const adapter = context.LT_SITE_ADAPTERS?.linear;
assert.ok(adapter, "Linear adapter should be registered");

// Captured from the authenticated project/inbox UI and Linear's current public
// action modules on 2026-09-05. Keep this deterministic: network crawling is an
// audit input, not something the regular test suite should depend on.
const expected = new Map([
  ["Notification actions", "通知操作"],
  ["Show unreads only", "仅显示未读"],
  ["Add filter", "添加筛选条件"],
  ["Display options", "显示选项"],
  ["Add to favorites", "添加到收藏"],
  ["Project options", "项目选项"],
  ["Choose icon", "选择图标"],
  ["Setup project notifications", "设置项目通知"],
  ["Snooze notification", "稍后提醒"],
  ["Delete notification", "删除通知"],
  ["Properties", "属性"],
  ["In Progress", "进行中"],
  ["Urgent", "紧急"],
  ["Urgent Priority", "紧急优先级"],
  ["Change project start date", "更改项目开始日期"],
  ["Change project target date", "更改项目目标日期"],
  ["Blocking", "阻塞"],
  ["Blocked by", "被阻塞于"],
  ["Mark as blocking…", "标记为阻塞项…"],
  ["Resources", "资源"],
  ["Add document or link…", "添加文档或链接…"],
  ["Latest update", "最新更新"],
  ["Progress since", "自上次更新以来的进度"],
  ["Add reaction", "添加回应"],
  ["Description", "描述"],
  ["Milestones", "里程碑"],
  ["Milestone", "添加里程碑"],
  ["Choose date", "选择日期"],
  ["Change target date", "更改目标日期"],
  ["Open issues", "打开问题"],
  ["Open menu", "打开菜单"],
  ["Add a description…", "添加描述…"],
  ["Project name", "项目名称"],
  ["Project summary", "项目摘要"],
  ["Project update", "项目更新"],
  ["Milestone name", "里程碑名称"],
  ["Initiative description", "计划描述"],
  ["Filter…", "筛选…"],
  ["Members", "成员"],
  ["Dependencies", "依赖关系"],
  ["Connect existing Slack channel…", "连接现有 Slack 频道…"],
  ["No notification selected", "未选择通知"],
  ["Welcome to Linear", "欢迎使用 Linear"],
  ["Watch an introductory video and access a list of resources below.", "观看介绍视频并访问下方资源列表。"],
  ["assigned the issue to you", "将问题分配给了你"],
  ["Added as a project lead by", "被添加为项目负责人，操作人："],
  ["Archive issue", "归档问题"],
  ["Archive project", "归档项目"],
  ["Copy link", "复制链接"],
  ["Copy project ID", "复制项目 ID"],
  ["Duplicate…", "复制…"],
  ["Edit project…", "编辑项目…"],
  ["Move to…", "移动到…"],
  ["Remove from project", "从项目中移除"],
  ["Restore project", "恢复项目"],
  ["Configure Microsoft Teams notifications…", "配置 Microsoft Teams 通知…"],
  ["Open project updates and activity", "打开项目更新和活动"],
  ["Remove label", "移除标签"],
]);

for (const [text, translation] of expected) {
  assert.equal(adapter.translate(text), translation, `missing audited Linear translation: ${text}`);
}

assert.equal(adapter.translate("0 comments"), "0 条评论");
assert.equal(adapter.translate("1 issue"), "1 个问题");
assert.equal(adapter.translate("12 issues"), "12 个问题");
assert.equal(adapter.translate("17h ago"), "17 小时前");
assert.equal(adapter.translate("Sep 15th"), "9月15日");
assert.equal(adapter.translate("Sep 4, 17:37:47"), "9月4日 17:37:47");

console.log("Linear 深度覆盖词表测试通过");
