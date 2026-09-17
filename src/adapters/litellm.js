// LiteLLM Dashboard site adapter.
// This file is loaded before content.js and only affects matching LiteLLM pages.
(function registerLiteLLMAdapter(root) {
  'use strict';

  const dictionary = {
    'AI Gateway': 'AI 网关',
    'Virtual Keys': '虚拟密钥',
    'Virtual Key': '虚拟密钥',
    'Every key that authenticates requests to the gateway.': '每个用于向网关进行请求身份验证的密钥。',
    'Create New Key': '创建新密钥',
    '+ Create New Key': '+ 创建新密钥',
    '+Create New Key': '+ 创建新密钥',
    'Search by key alias...': '按密钥别名搜索...',
    'Search by key alias…': '按密钥别名搜索…',
    Key: '密钥',
    Keys: '密钥',
    Team: '团队',
    Teams: '团队',
    User: '用户',
    Users: '用户',
    'Created At': '创建时间',
    'Created at': '创建时间',
    'Last Active': '最近活跃',
    'Spend / Budget': '花费 / 预算',
    'Spend /  Budget': '花费 / 预算',
    'Budget Reset': '预算重置',
    'Budget reset': '预算重置',
    Models: '模型',
    Model: '模型',
    'All Proxy Models': '所有代理模型',
    'All Proxy Model': '所有代理模型',
    'Rows per page': '每页行数',
    'Showing': '显示',
    'Page': '页',
    Active: '正常',
    Inactive: '未启用',
    Pending: '待处理',
    Unlimited: '不限',
    Never: '从未',
    Columns: '列',
    Refresh: '刷新',
    Filter: '筛选',
    Filters: '筛选条件',
    'First page': '第一页',
    'Previous page': '上一页',
    'Next page': '下一页',
    'Last page': '最后一页',
    'Go to first page': '转到第一页',
    'Go to previous page': '转到上一页',
    'Go to next page': '转到下一页',
    'Go to last page': '转到最后一页',
    Docs: '文档',
    Blog: '博客',
    Settings: '设置',
    New: '新',
    'Settings New': '设置 新',
    Admin: '管理员',
    'Default Proxy Admin': '默认代理管理员',
    Playground: '操场',
    'Models + Endpoints': '模型 + 端点',
    Endpoints: '端点',
    Endpoint: '端点',
    'Model Groups': '模型组',
    'Model Group': '模型组',
    'Model Group Alias': '模型组别名',
    'Team Models': '团队模型',
    'Team Model': '团队模型',
    'Team Group Alias': '团队组别别名',
    'Group Alias': '组别别名',
    'Price Data': '价格数据',
    Reload: '重新加载',
    Actions: '操作',
    'Team ID': '团队 ID',
    'Model Access Group': '模型访问组',
    'Add New Model': '添加新模型',
    'Add Endpoint': '添加端点',
    'Edit Model': '编辑模型',
    'Delete Model': '删除模型',
    'Save Changes': '保存更改',
    'MCP Servers': 'MCP 服务器',
    Agentic: '智能代理',
    Skills: '技能',
    Guardrails: '防护栏',
    Policies: '策略',
    Tools: '工具',
    Observability: '可观测性',
    'Access Control': '访问控制',
    'Developer Tools': '开发者工具',
    Usage: '用量',
    'Cost Optimization': '成本优化',
    Beta: '测试版',
    Logs: '日志',
    'Guardrails Monitor': '防护栏监控',
    'Internal Users': '内部用户',
    Organizations: '组织',
    'Access Groups': '访问组',
    Budgets: '预算',
    'API Reference': 'API 参考',
    'AI Hub': 'AI 中心',
    'Learning Resources': '学习资源',
    'Response Cache': '响应缓存',
    Experimental: '实验功能',
    'Switch to dark mode (beta)': '切换深色模式（测试版）',
    'Total Spend': '总花费',
    'Total Requests': '总请求数',
    'Success Rate': '成功率',
    'Recent Requests': '最近请求',
    'No data': '暂无数据',
    'No results': '无匹配结果',
    Save: '保存',
    Cancel: '取消',
    Close: '关闭',
    Delete: '删除',
    Edit: '编辑',
    Create: '创建',
    Update: '更新',
    'Help shape cost optimization': '帮助改进成本优化',
    'Model Management': '模型管理',
    'Add and manage models for the proxy': '添加和管理代理模型',
    "We're collecting suggestions for cost optimization improvements across routing, budgets, and more. Let us know what you'd like to see.": '我们正在收集路由、预算等成本优化改进建议，欢迎告诉我们你希望看到的内容。',
    'Share Feedback': '分享反馈',
    'Dismiss banner': '关闭提示',
    'Other options': '其他选项',
    'All Models': '所有模型',
    'Add Model': '添加模型',
    'Auto-Routers': '自动路由',
    'LLM Credentials': 'LLM 凭证',
    'Pass-Through Endpoints': '直通端点',
    'Health Status': '健康状态',
    'Model Retry Settings': '模型重试设置',
    'Model Group Alias': '模型组别名',
    'Price Data Reload': '价格数据重新加载',
    'Refresh models': '刷新模型',
    Provider: '提供商',
    'Select a provider': '选择提供商',
    'LiteLLM Model Name(s)': 'LiteLLM 模型名称',
    'The model name LiteLLM will send to the LLM API': 'LiteLLM 将发送给 LLM API 的模型名称',
    'Model Mappings': '模型映射',
    'Public Model Name': '公开模型名称',
    'LiteLLM Model Name': 'LiteLLM 模型名称',
    'No rows match your search or filters.': '没有符合搜索或筛选条件的行。',
    Mode: '模式',
    'Either select existing credentials OR enter new provider credentials below': '请选择已有凭证，或在下方输入新的提供商凭证',
    'Existing Credentials': '已有凭证',
    'Select or search for existing credentials': '选择或搜索已有凭证',
    Optional: '可选',
    ' - LiteLLM endpoint to use when health checking this model': ' - 对此模型进行健康检查时使用的 LiteLLM 端点',
    '- LiteLLM endpoint to use when health checking this model': '- 对此模型进行健康检查时使用的 LiteLLM 端点',
    'Upstream API Base': '上游 API 地址',
    OR: '或',
    'Additional Model Info Settings': '其他模型信息设置',
    'Team-BYOK Model': '团队 BYOK 模型',
    'Advanced Settings': '高级设置',
    'Need Help?': '需要帮助？',
    'Test Connect': '测试连接',
    'Learn more': '了解更多',
    'Add New Skill': '添加新技能',
    'Create New Skill': '创建新技能',
    'Repository URL': '仓库 URL',
    'https://github.com/org/repo or https://gitlab.com/org/repo': 'https://github.com/org/repo 或 https://gitlab.com/org/repo',
    'Subfolder path (Optional)': '子文件夹路径（可选）',
    'Skill Name': '技能名称',
    'Domain (Optional)': '领域（可选）',
    'Namespace (Optional)': '命名空间（可选）',
    Productivity: '生产力',
    'Description (Optional)': '描述（可选）',
    'A skill that helps with...': '一个可以帮助你完成以下工作的技能……',
    'Category (Optional)': '类别（可选）',
    'Select or type a category': '选择或输入类别',
    'Keywords (Optional)': '关键词（可选）',
    'Version (Optional)': '版本（可选）',
    'Add Skill': '添加技能',
    'plugins/my-skill': 'plugins/my-skill',
    'search, web, api': '搜索、网页、API',
  };

  const protectedTerms = [
    'LiteLLM', 'OpenAI', 'Anthropic', 'Gemini', 'Azure', 'Bedrock', 'Vertex AI',
    'vLLM', 'Ollama', 'DeepSeek', 'Qwen', 'Claude', 'GPT', 'Mistral', 'Llama',
    'Groq', 'Perplexity', 'Cohere', 'OpenRouter', 'Hugging Face', 'API', 'MCP',
  ];

  const exactKeys = Object.keys(dictionary);
  const escapedKeys = exactKeys
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const exactPattern = new RegExp(`^(?:${escapedKeys.join('|')})$`, 'i');

  function normalize(text) {
    return String(text || '')
      .replace(/[\u00a0\t\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isMostlyChinese(text) {
    const value = normalize(text);
    const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    return cjk > 0 && cjk >= latin;
  }

  function isProtected(text) {
    const value = normalize(text);
    if (!value) return true;
    if (protectedTerms.some((term) => term.toLowerCase() === value.toLowerCase())) return true;
    if (/^(?:https?|wss?):\/\//i.test(value)) return true;
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(value)) return true;
    if (/^(?:sk|pk)-[A-Za-z0-9_.-]+$/i.test(value)) return true;
    if (/^[A-Za-z0-9_./:@$%+\-~]+$/.test(value) && /[\/_:@$%+\-~]/.test(value)) return true;
    if (/^[{}[\]();=<>`]+$/.test(value)) return true;
    if (/^(?:[A-Z][a-z]{2} \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})$/.test(value)) return true;
    if (/^[-–—]+$/.test(value)) return true;
    if (/^\$[\d,.]+$/.test(value)) return true;
    return false;
  }

  function lookupExact(value) {
    if (!exactPattern.test(value)) return null;
    const key = exactKeys.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
    return key ? dictionary[key] : null;
  }

  function translate(value) {
    const original = String(value || '');
    const text = normalize(original);
    if (!text || isMostlyChinese(text)) return null;

    const exact = lookupExact(text);
    if (exact) return exact;

    if (isProtected(text)) return null;

    let match = text.match(/^Showing\s+([\d,]+)\s*[-–]\s*([\d,]+)\s+of\s+([\d,]+)$/i);
    if (match) return `显示第 ${match[1]}-${match[2]} 条，共 ${match[3]} 条`;

    match = text.match(/^Page\s+(\d+)\s+of\s+(\d+)$/i);
    if (match) return `第 ${match[1]} 页，共 ${match[2]} 页`;

    match = text.match(/^Showing\s+([\d,]+)\s*[-–]\s*([\d,]+)\s+of\s+([\d,]+)\s+Page\s+(\d+)\s+of\s+(\d+)$/i);
    if (match) return `显示第 ${match[1]}-${match[2]} 条，共 ${match[3]} 条 · 第 ${match[4]} 页，共 ${match[5]} 页`;

    match = text.match(/^Go to (first|previous|next|last) page$/i);
    if (match) return `转到${({ first: '第一', previous: '上一', next: '下一', last: '最后' })[match[1].toLowerCase()]}页`;

    match = text.match(/^\$([\d,.]+)\s*[·•]\s*Unlimited$/i);
    if (match) return `$${match[1]} · 不限`;

    match = text.match(/^Optional\s*-\s*LiteLLM endpoint to use when health checking this model(?:\s+Learn more)?$/i);
    if (match) return '可选 - 对此模型进行健康检查时使用的 LiteLLM 端点 · 了解更多';

    match = text.match(/^Auto-Routers\s+测试版$/i);
    if (match) return '自动路由 测试版';

    return null;
  }

  function shouldTranslate(text) {
    const value = normalize(text);
    if (!value || isMostlyChinese(value) || isProtected(value)) return false;
    // Prepared strings are replaced locally; unknown text stays untouched.
    return translate(value) !== null;
  }

  function getConfiguredOrigin(settings) {
    const raw = settings?.litellmBaseUrl?.trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
      return parsed.origin.toLowerCase();
    } catch (_) {
      return null;
    }
  }

  function matches(url, documentLike, settings) {
    if (!url) return false;
    const value = url instanceof URL ? url : new URL(String(url));
    const host = value.hostname.toLowerCase();
    const configuredOrigin = getConfiguredOrigin(settings);
    if (configuredOrigin && value.origin.toLowerCase() === configuredOrigin) return true;
    if (host === 'litellm.ai' || host === 'www.litellm.ai' || host.endsWith('.litellm.ai')) return true;
    if (/\blitellm\b/i.test(host)) return true;
    if (!/\/(?:ui|playground)(?:\/|$)/i.test(value.pathname)) return false;
    const marker = `${documentLike?.title || ''} ${documentLike?.body?.innerText || ''}`;
    return /\blitellm\b/i.test(marker);
  }

  const adapters = root.LT_SITE_ADAPTERS || {};
  adapters.litellm = {
    id: 'litellm',
    label: 'LiteLLM',
    matches,
    translate,
    shouldTranslate,
    allowInteractiveUi: true,
    localOnly: true,
    replaceText: true,
    mutationDebounceMs: 80,
    minTextLength: 1,
    // LiteLLM renders labels across deeply nested div/section/custom
    // components. Every candidate is limited to the prepared local dictionary.
    selectors: ['*'],
    attributes: ['title', 'aria-label', 'placeholder'],
  };
  root.LT_SITE_ADAPTERS = adapters;
}(typeof globalThis !== 'undefined' ? globalThis : window));
