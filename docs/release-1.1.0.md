# 1.1.0 发布说明

此版本采用新的配置结构，不迁移旧版设置。源码及发布包均需重新配置翻译服务。

## 已实现

- API Key 与偏好分离：默认会话保存；可选密码加密记住；浏览器重启后解锁。内容脚本不能读取密钥存储，翻译请求由后台读取可信配置。
- 默认无全站访问权限。手动翻译按需注入，服务访问和选定网站自动翻译按需授权。
- 千问、OpenAI、其他兼容接口和本机 vLLM 预设；保存并测试连接；地址验证与规范化；默认关闭思考，接口参数由模型家族及服务配置共同决定。
- 任务状态区分进行中、附近内容已处理、部分失败、失败、停止；可重试未完成内容并恢复原文。
- 停止取消排队和在途请求；不同标签页独立取消；临时 429/5xx 最多重试两次，处理 Retry-After。
- 仅翻译视口附近内容，滚动继续；动态变更优先扫描局部区域；停止时解除 DOM 监听。
- 普通设置、网站偏好均保存在本机；页面与设置页明确展示文字接收方；更新隐私说明和可重复打包脚本。

## 验证方式与边界

`npm test` 包括模型参数、密钥隔离、AES-GCM 加密与解锁、URL 校验、取消、重试、DOM 恢复与增量翻译、弹窗停止按钮以及安装后的 MV3 扩展测试。

安装测试使用真实 Chromium、真实 service worker、真实扩展隔离环境、真实扩展存储及本机 HTTP 模拟服务；覆盖配置、连接测试、翻译、自动站点注册/移除、强制后台终止后唤醒、浏览器重启后解锁。无头浏览器不能操作原生权限确认，因此仅在临时测试 Manifest 中预授予 `http://127.0.0.1/*`；产品 Manifest 不包含该预授权，打包时会检查。Chrome 原生授权弹窗的同意/拒绝仍属于人工验收项。

没有调用真实付费模型，也没有测量真实 Google/Qwen 网络下的延迟与成功率。初次识别仍遍历普通 DOM；Shadow DOM、跨域 iframe 和内置 PDF 尚不属于完整支持范围。商店发布仍需核对线上版本、开发者后台隐私填报和公开隐私页面地址。

## 发布前手工验收

1. 使用 `npm run package` 生成的 ZIP 解压安装，选择 Google，拒绝服务授权后确认无请求；再次点击后允许授权并翻译。
2. 使用实际 Qwen 账号的 API 地址和密钥测试连接；检查关闭思考参数被所用平台支持。无需将密钥或原文发给开发者。
3. 在实际浏览网页开启“此网站始终翻译”，确认权限弹窗仅涉及所选站点及服务；撤销权限后不再远程自动翻译。
4. 更新商店说明与公开隐私地址，上传新版本 ZIP，并在开发者后台核对审核与发布状态。

## 参考

- [Chrome 存储与访问级别](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome 临时页面权限](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome 后台生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [阿里云兼容接口及思考参数](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)
- [vLLM 推理输出](https://docs.vllm.ai/en/latest/features/reasoning_outputs/)
- [Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)
