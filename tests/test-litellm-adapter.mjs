import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterSource = fs.readFileSync(path.join(root, "src", "adapters", "litellm.js"), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(adapterSource, context, { filename: "litellm.js" });

const adapter = context.LT_SITE_ADAPTERS?.litellm;
assert.ok(adapter, "LiteLLM adapter should be registered");
assert.equal(adapter.matches(new URL("https://litellm.example.com/ui/api-keys")), true);
assert.equal(
  adapter.matches(new URL("https://aigw.example.com/ui/api-keys"), {}, {
    litellmBaseUrl: "https://aigw.example.com/",
  }),
  true,
  "configured LiteLLM origin should be recognized",
);
assert.equal(
  adapter.matches(new URL("https://other.example.com/ui/api-keys"), {}, {
    litellmBaseUrl: "https://aigw.example.com",
  }),
  false,
  "configured LiteLLM origin should not match other origins",
);
assert.equal(
  adapter.matches(new URL("https://aigw.example.com/login"), {}, {
    litellmBaseUrl: "aigw.example.com",
  }),
  true,
  "configured LiteLLM bare domain should be accepted",
);
assert.equal(adapter.matches(new URL("https://example.com/ui/api-keys")), false);
assert.equal(adapter.matches(new URL("https://gateway.example.com/ui/api-keys"), { title: "LiteLLM Dashboard" }), true);
assert.equal(adapter.allowInteractiveUi, true);
assert.equal(adapter.minTextLength, 1);
assert.equal(adapter.localOnly, true, "LiteLLM should use the prepared dictionary only");
assert.equal(adapter.replaceText, true, "LiteLLM labels should be replaced in place");
assert.equal(adapter.selectors.includes("*"), true, "LiteLLM should deeply scan dashboard containers");
assert.ok(adapter.mutationDebounceMs <= 100, "LiteLLM SPA updates should be rescanned quickly");
assert.equal(adapter.shouldTranslate("User"), true);
assert.equal(adapter.shouldTranslate("user@example.com"), false);
assert.equal(adapter.shouldTranslate("gpt-4o-mini"), false);
assert.equal(adapter.shouldTranslate("A new natural language description"), false);
assert.equal(adapter.allowRemoteTranslation, undefined, "LiteLLM must remain local-only");

const expected = new Map([
  ["Virtual Keys", "虚拟密钥"],
  ["Every key that authenticates requests to the gateway.", "每个用于向网关进行请求身份验证的密钥。"],
  ["+ Create New Key", "+ 创建新密钥"],
  ["Search by key alias...", "按密钥别名搜索..."],
  ["Key", "密钥"],
  ["Team", "团队"],
  ["User", "用户"],
  ["Created At", "创建时间"],
  ["Last Active", "最近活跃"],
  ["Spend / Budget", "花费 / 预算"],
  ["Budget Reset", "预算重置"],
  ["All Proxy Models", "所有代理模型"],
  ["Rows per page", "每页行数"],
  ["Showing 1-3 of 3", "显示第 1-3 条，共 3 条"],
  ["Page 1 of 1", "第 1 页，共 1 页"],
  ["Active", "正常"],
  ["Unlimited", "不限"],
  ["Never", "从未"],
  ["$0.00 · Unlimited", "$0.00 · 不限"],
  ["AI Gateway", "AI 网关"],
  ["Docs", "文档"],
  ["Blog", "博客"],
  ["Columns", "列"],
  ["New", "新"],
  ["Default Proxy Admin", "默认代理管理员"],
  ["Agentic", "智能代理"],
  ["Endpoints", "端点"],
  ["Model Group Alias", "模型组别名"],
  ["Observability", "可观测性"],
  ["Access Control", "访问控制"],
  ["Developer Tools", "开发者工具"],
  ["Add Model", "添加模型"],
  ["Auto-Routers", "自动路由"],
  ["Pass-Through Endpoints", "直通端点"],
  ["Health Status", "健康状态"],
  ["Model Mappings", "模型映射"],
  ["No rows match your search or filters.", "没有符合搜索或筛选条件的行。"],
  ["Select a provider", "选择提供商"],
  ["Share Feedback", "分享反馈"],
  ["Model Management", "模型管理"],
  ["Refresh models", "刷新模型"],
  ["Upstream API Base", "上游 API 地址"],
  ["Advanced Settings", "高级设置"],
  ["Test Connect", "测试连接"],
  ["Optional", "可选"],
  ["Auto-Routers 测试版", "自动路由 测试版"],
  ["Add New Skill", "添加新技能"],
  ["Repository URL", "仓库 URL"],
  ["Subfolder path (Optional)", "子文件夹路径（可选）"],
  ["Skill Name", "技能名称"],
  ["Description (Optional)", "描述（可选）"],
  ["Category (Optional)", "类别（可选）"],
  ["Select or type a category", "选择或输入类别"],
  ["Keywords (Optional)", "关键词（可选）"],
  ["Version (Optional)", "版本（可选）"],
  ["Add Skill", "添加技能"],
]);

for (const [source, translation] of expected) {
  assert.equal(adapter.translate(source), translation, `translation mismatch for ${source}`);
}

assert.equal(adapter.translate("gpt-4o-mini"), null, "model IDs must be retained");
assert.equal(adapter.translate("Vertex AI"), null, "provider names must be retained");
assert.equal(adapter.translate("https://litellm.ai/ui"), null, "URLs must be retained");
assert.equal(adapter.translate("Every key that authenticates requests to the gateway."), expected.get("Every key that authenticates requests to the gateway."));

console.log("LiteLLM 专项适配测试通过");
