# 蜉蝣邮 · 临时邮箱

一个简约、黑白灰视觉体系的临时邮箱 Web 客户端。取一个一次性地址，接收验证码，用完即走。

## 运行

```bash
npm install
npm run dev        # 开发（http://localhost:5173）
npm run build      # 生产构建（tsc + vite build）
npm run preview    # 预览生产构建
npm run lint       # oxlint
```

## 数据源与后端接入

应用通过 `src/lib/types.ts` 里定义的 `MailProvider` 接口对接数据源，内置两份实现：

- **`src/lib/mailtm.ts`** — 真实数据源，对接 [mail.tm](https://docs.mail.tm) 公共 API
  （创建邮箱、收件箱、邮件详情、完整原始 MIME、已读/删除）。
  mail.tm 的 CORS 白名单不允许浏览器直连，因此开发与预览由 Vite 内置代理
  （`vite.config.ts` 中 `/api → https://api.mail.tm`）转发。
- **`src/lib/demo.ts`** — 演示模式。仅当无法连接邮件服务（或访问 `?demo=1`）时启用，
  界面有明确的「演示模式」横幅与「演示」状态标记，全部为本地模拟数据，不冒充真实邮件。

部署到生产时，把环境变量 `VITE_MAIL_API_BASE` 指向自建后端或反向代理（转发到 mail.tm），
即可脱离 Vite 运行。凭据（地址/密码/token）只保存在浏览器 localStorage，不经过任何第三方。

### 已知边界

- mail.tm 建号接口限流约 1 次/分钟；被限流时会显示明确错误并可重试。
- 服务端会将地址本地部分中的点号剥离，登录一律以创建接口返回的规范地址为准。
- 收件箱分页：每次刷新最多拉取 3 页（约 90 封），超出部分不再加载（临时邮箱场景足够）。
- 邮件里的远程图片默认不加载（隐私），正文区提供「显示图片」按钮；HTML 邮件经
  DOMPurify 消毒后渲染在无脚本的 sandbox iframe 中。

## 功能

- 一键复制地址（含复制反馈）、15 秒自动轮询收件箱（页面隐藏时暂停）、手动刷新
- 更换地址（确认对话框，旧地址作废提示）、过期/限流/断网等状态的明确反馈
- 邮件列表：发件人、主题、摘要、时间、未读圆点 + 加粗（不单靠颜色区分）
- 验证码识别：4~8 位数字与字母数字混合码，带误报排除（日期/金额/电话/订单号/URL）
  与关键词上下文评分；多个候选值可展开查看；不可靠时如实显示「未识别」
- 查看原文：完整 MIME 报文（含邮件头），可复制、可下载 .eml；服务端不支持时如实标注
- 浅色 / 深色主题（跟随系统偏好，手动切换后记忆），邮件正文 iframe 同步适配
- 响应式：桌面双栏，≤900px 单栏 + 阅读层滑入，触屏设备加大触控目标
- 深链：`#/m/<邮件id>` 可直达邮件，浏览器返回键行为一致

## 结构

```
src/
  lib/        数据适配层（types / mailtm / demo）与业务逻辑（验证码识别、HTML 消毒、时间、剪贴板）
  hooks/      useTheme（主题记忆）、useMailbox（邮箱状态机：建号/恢复/轮询/开通等待/深链）
  components/ AddressPlate（地址铭牌）、MailList、Reader、CodeStrip、RawView、ConfirmDialog、Toast
  styles/     tokens.css（设计令牌：灰阶、字体、间距、双主题）+ app.css（组件样式）
```

## 设计说明

视觉方向为「精密仪表」：严格中性灰阶，唯一反色元素是邮箱地址铭牌
（浅色主题黑底白字、深色主题反转），字体为 IBM Plex Sans + IBM Plex Mono
（后者只用于地址、验证码、原文等可复制的字面量）。开发过程遵循
frontend-design / ui-ux-pro-max / web-design-guidelines 三个 Skills 的规范，
并通过 Vercel Web Interface Guidelines 做了交付前审查。
