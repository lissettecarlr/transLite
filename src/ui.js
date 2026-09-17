const LT_UI = {
  async request(type, args = {}) {
    const response = await chrome.runtime.sendMessage({type, ...args});
    if (!response?.success) throw new Error(response?.error || '扩展连接中断，请重新打开此窗口');
    return response;
  },
};
