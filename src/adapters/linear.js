// Linear workspace site adapter.
// This file is loaded before content.js and affects Agent and settings pages.
(function registerLinearAdapter(root) {
  'use strict';

  const dictionary = {
    'Skip to content': '跳转到内容',
    Inbox: '收件箱',
    'My issues': '我的问题',
    Agent: '智能体',
    Drafts: '草稿',
    Workspace: '工作区',
    Projects: '项目',
    Views: '视图',
    Loops: '循环',
    More: '更多',
    'Your teams': '你的团队',
    Home: '首页',
    Issues: '问题',
    Cycles: '周期',
    Current: '当前',
    Upcoming: '即将开始',
    Try: '试用',
    Initiatives: '计划',
    'Connect Cursor': '连接 Cursor',
    'Connect Codex': '连接 Codex',
    'What\u2019s new': '最新动态',
    "What's new": '最新动态',
    'Priority inbox': '优先收件箱',
    'Business trial ends': '商业版试用即将到期',
    'New chat': '新对话',
    Skills: '技能',
    'Get started with some examples': '从示例开始',
    'Create a new project': '创建新项目',
    'Turn an idea into a well-scoped project': '将想法转化为范围清晰的项目',
    'Research a topic': '调研主题',
    'Research a topic across the issue backlog': '在问题待办中调研一个主题',
    'Create automated loop': '创建自动化循环',
    'Learn what loops can do and create your first one': '了解循环功能并创建第一个循环',
    'Showing all items': '显示所有项目',
    'Search skills...': '搜索技能...',
    'Search skills\u2026': '搜索技能\u2026',
    'Create skill': '创建技能',
    Overview: '概览',
    Activity: '活动',
    'Notification actions': '通知操作',
    'Show unreads only': '仅显示未读',
    'Add filter': '添加筛选条件',
    'Display options': '显示选项',
    'Add to favorites': '添加到收藏',
    'Project options': '项目选项',
    'Choose icon': '选择图标',
    'Setup project notifications': '设置项目通知',
    'Snooze notification': '稍后提醒',
    'Delete notification': '删除通知',
    Properties: '属性',
    'In Progress': '进行中',
    Urgent: '紧急',
    'Urgent Priority': '紧急优先级',
    'Change project start date': '更改项目开始日期',
    'Change project target date': '更改项目目标日期',
    Blocking: '阻塞',
    'Blocked by': '被阻塞于',
    'Mark as blocking…': '标记为阻塞项…',
    Resources: '资源',
    'Add document or link…': '添加文档或链接…',
    'Latest update': '最新更新',
    'Progress since': '自上次更新以来的进度',
    'Add reaction': '添加回应',
    Description: '描述',
    Milestones: '里程碑',
    Milestone: '添加里程碑',
    'Choose date': '选择日期',
    'Change target date': '更改目标日期',
    'Open issues': '打开问题',
    'Open menu': '打开菜单',
    'Add a description…': '添加描述…',
    'Project name': '项目名称',
    'Project summary': '项目摘要',
    'Project update': '项目更新',
    'Milestone name': '里程碑名称',
    'Initiative description': '计划描述',
    'Filter…': '筛选…',
    Members: '成员',
    Dependencies: '依赖关系',
    'Connect existing Slack channel…': '连接现有 Slack 频道…',
    'No notification selected': '未选择通知',
    'Welcome to Linear': '欢迎使用 Linear',
    'Watch an introductory video and access a list of resources below.': '观看介绍视频并访问下方资源列表。',
    'assigned the issue to you': '将问题分配给了你',
    'Added as a project lead by': '被添加为项目负责人，操作人：',
    'Archive issue': '归档问题',
    'Archive project': '归档项目',
    'Copy link': '复制链接',
    'Copy project ID': '复制项目 ID',
    'Duplicate…': '复制…',
    'Edit project…': '编辑项目…',
    'Move to…': '移动到…',
    'Remove from project': '从项目中移除',
    'Restore project': '恢复项目',
    'Configure Microsoft Teams notifications…': '配置 Microsoft Teams 通知…',
    'Open project updates and activity': '打开项目更新和活动',
    'Remove label': '移除标签',
    Status: '状态',
    Priority: '优先级',
    Assignee: '负责人',
    'Project lead': '项目负责人',
    'Start date': '开始日期',
    'Target date': '目标日期',
    'All projects': '所有项目',
    'Your projects': '你的项目',
    'Other projects': '其他项目',
    'No project': '无项目',
    'No assignee': '未分配负责人',
    'No priority': '无优先级',
    'No labels': '无标签',
    'Create project': '创建项目',
    'Create issue': '创建问题',
    'New issue': '新建问题',
    'New project': '新建项目',
    Backlog: '待办',
    Triage: '待分类',
    Todo: '待处理',
    Done: '已完成',
    Cancel: '取消',
    Save: '保存',
    Create: '创建',
    Add: '添加',
    Remove: '移除',
    Archive: '归档',
    Restore: '恢复',
    Duplicate: '复制',
    Move: '移动',
    Share: '分享',
    'Search workspace': '搜索工作区',
    'Create new issue': '新建问题',
    'Show more links': '显示更多链接',
    'Join a team': '加入团队',
    'Team menu': '团队菜单',
    'View changelog': '查看更新日志',
    'Collapse into help menu': '收起到帮助菜单',
    'Switch agent chat': '切换智能体对话',
    'Send a message to Linear AI': '向 Linear AI 发送消息',
    'Attach images, files, or videos': '添加图片、文件或视频',
    'Send message': '发送消息',
    Dismiss: '关闭',
    'Chat history': '对话历史',
    Notifications: '通知',
    'Back to app': '返回应用',
    'Search...': '搜索...',
    'Search\u2026': '搜索\u2026',
    'Code & reviews': '代码与评审',
    'Security & access': '安全与访问',
    'Connected accounts': '已连接的账户',
    'Agent personalization': '智能体个性化',
    Labels: '标签',
    Templates: '模板',
    SLAs: '服务等级协议',
    Statuses: '状态',
    Updates: '更新',
    Features: '功能',
    'AI & Agents': 'AI 与智能体',
    Documents: '文档',
    'Customer requests': '客户请求',
    Releases: '发布',
    Pulse: '动态',
    Asks: '问询',
    Emojis: '表情符号',
    Integrations: '集成',
    Administration: '管理',
    Docs: '文档',
    'Enable Initiatives': '启用计划',
    'Visible to all non-guest workspace members': '对所有非访客工作区成员可见',
    'Initiative updates': '计划更新',
    'Initiatives group multiple projects that contribute toward the same strategic effort. Use initiatives to plan and coordinate larger streams of work and monitor their progress at scale.': '计划将多个服务于同一战略目标的项目归为一组。使用计划来规划和协调更大规模的工作，并全面监控其进度。',
    'Short status reports about the progress and health of your initiative. Updates are ideally written regularly by the owner of the initiative. Subscribers receive these updates directly in their inbox. You can also configure a Slack channel where all initiative updates are posted.': '简短的状态报告用于说明计划的进度和健康状况。更新最好由计划负责人定期撰写。订阅者会直接在收件箱中收到这些更新。你也可以配置一个 Slack 频道来发布所有计划更新。',
    'Update schedule': '更新频率',
    'Configure how often updates are expected on initiatives. Initiative owners will receive reminders to post updates.': '配置计划的预期更新频率。计划负责人会收到发布更新的提醒。',
    'No expectation for updates': '不要求定期更新',
    Edit: '编辑',
    'Slack notifications': 'Slack 通知',
    'Updates are only posted to Slack for workspace-level initiatives or initiatives led by a public team': '只有工作区级计划或由公开团队负责的计划更新才会发布到 Slack',
    'Send initiative updates to a Slack channel': '将计划更新发送到 Slack 频道',
    'Connect a channel to send all initiative updates to': '连接频道以发送所有计划更新',
    Connect: '连接',
    Copy: '复制',
    Favorite: '收藏',
    Subscribe: '订阅',
    'Remind me': '提醒我',
    'Change update schedule...': '更改更新频率...',
    'Change update schedule\u2026': '更改更新频率\u2026',
    'Configure Slack notifications...': '配置 Slack 通知...',
    'Configure Slack notifications\u2026': '配置 Slack 通知\u2026',
    'Show author names': '显示作者姓名',
    'Show description history': '显示描述历史',
    'Show updates and activity': '显示更新和活动',
    'Hide comments': '隐藏评论',
    Delete: '删除',
    'On track': '正常推进',
    'At risk': '存在风险',
    'Off track': '偏离计划',
    Paused: '已暂停',
    Completed: '已完成',
    Canceled: '已取消',
    Update: '更新',
    Collapse: '收起',
    Expand: '展开',
  };

  const dictionaryByLowerCase = new Map(
    Object.entries(dictionary).map(([source, translation]) => [source.toLowerCase(), translation])
  );

  const monthNumbers = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };

  const remoteCommandPattern = /^(?:add|apply|archive|assign|cancel|change|clear|close|configure|connect|copy|create|delete|discard|display|duplicate|edit|enable|export|hide|mark|move|open|pin|remove|rename|reset|restore|save|select|set|share|show|snooze|subscribe|switch|unpin|unsubscribe|update|view)\b/i;
  const remoteUiRoles = new Set([
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'tooltip',
  ]);

  function normalize(text) {
    return String(text || '')
      .replace(/[\u00a0\t\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function translate(value) {
    const text = normalize(value);
    if (!text) return null;

    const exact = dictionaryByLowerCase.get(text.toLowerCase());
    if (exact) return exact;

    let match = text.match(/^(\d+)d$/i);
    if (match) return `${match[1]} 天`;

    match = text.match(/^(\d+) unread notifications?$/i);
    if (match) return `${match[1]} 条未读通知`;

    match = text.match(/^(\d+) drafts?$/i);
    if (match) return `${match[1]} 个草稿`;

    match = text.match(/^drafts?\s+(\d+)$/i);
    if (match) return `草稿 ${match[1]}`;

    match = text.match(/^(\d+) comments?$/i);
    if (match) return `${match[1]} 条评论`;

    match = text.match(/^(\d+) issues?$/i);
    if (match) return `${match[1]} 个问题`;

    match = text.match(/^(\d+) issues?\s*\u00b7\s*(\d+)%$/i);
    if (match) return `${match[1]} 个问题 \u00b7 ${match[2]}%`;

    match = text.match(/^(\d+)(m|h|d|w|mo|y) ago$/i);
    if (match) {
      const units = { m: '分钟', h: '小时', d: '天', w: '周', mo: '个月', y: '年' };
      return `${match[1]} ${units[match[2].toLowerCase()]}前`;
    }

    match = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})(?:st|nd|rd|th)?(?:, (\d{1,2}:\d{2}(?::\d{2})?))?$/i);
    if (match) {
      const monthKey = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`;
      const time = match[3] ? ` ${match[3]}` : '';
      return `${monthNumbers[monthKey]}月${Number(match[2])}日${time}`;
    }

    return null;
  }

  function shouldTranslate(text) {
    return translate(text) !== null;
  }

  function hasRemoteUiContext(element) {
    if (!element) return false;
    const role = element.getAttribute?.('role')?.toLowerCase();
    if (remoteUiRoles.has(role)) return true;
    try {
      return !!element.closest?.(
        '[role="menu"], [role="menuitem"], [role="menuitemcheckbox"], '
        + '[role="menuitemradio"], [role="dialog"], [role="listbox"], [role="tooltip"]'
      );
    } catch (_) {
      return false;
    }
  }

  function allowRemoteTranslation(value, element) {
    const text = normalize(value);
    if (!text || text.length > 100 || !/[A-Za-z]/.test(text)) return false;
    if (/https?:\/\/|\S+@\S+|\b[A-Z]{2,10}-\d+\b/.test(text)) return false;
    if (text.split(/\s+/).length > 12) return false;
    return hasRemoteUiContext(element) && remoteCommandPattern.test(text);
  }

  function matches(url) {
    if (!url) return false;
    const value = url instanceof URL ? url : new URL(String(url));
    if (value.hostname.toLowerCase() !== 'linear.app') return false;
    return /^\/[^/]+\/(?:agent|settings|projects?|issues?|inbox|my-issues|drafts|views|loops|teams?|cycles?|initiatives?|documents?|customer-requests?|customers?|releases?|pulse|asks|profiles|welcome-message)(?:\/|$)/i.test(value.pathname);
  }

  const adapters = root.LT_SITE_ADAPTERS || {};
  adapters.linear = {
    id: 'linear',
    label: 'Linear',
    matches,
    translate,
    shouldTranslate,
    allowRemoteTranslation,
    allowInteractiveUi: true,
    localOnly: true,
    replaceText: true,
    translateContentEditableAttributes: true,
    mutationDebounceMs: 80,
    minTextLength: 1,
    selectors: [
      'button', 'a', 'a div', 'label', 'span',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
      '[role="option"]', '[role="tooltip"]',
    ],
    attributes: ['title', 'aria-label', 'placeholder'],
  };
  root.LT_SITE_ADAPTERS = adapters;
}(typeof globalThis !== 'undefined' ? globalThis : window));
