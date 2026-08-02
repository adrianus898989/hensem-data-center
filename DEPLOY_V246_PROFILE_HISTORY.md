# V246 部署说明：默认昨天 / Profile / 历史数据自动补齐

## 本版改动

### 前台
- 三方量页面首次打开默认显示“昨天”。
- 页面只查询当前选择日期/月份对应的 Supabase 数据，不打开就下载整个数据库。
- 某日期 Supabase 暂无数据时显示中性“暂无数据”提示，不整页报错。
- 移除首页 Supabase 调试状态卡。
- 移除三方量页面右上角“读取页签 / 数据行数 / 数据来源 / 数据更新”技术框。
- 登录 UI 进一步专业化。
- 右上角新增标准用户 Profile 菜单；不再把退出按钮固定在页面底部。
- Profile 中用户可以查看角色/权限并修改自己的密码（修改前验证当前密码）。

### 管理后台
- 保留 Admin 创建 Viewer、停用/启用、权限选择、重置 Viewer 密码、操作记录、手动刷新最新数据。
- “数据刷新”增加历史数据库补齐进度与“立即补下一项”。

### Supabase 数据
- 今天/昨天：继续使用原来的 4 个每小时 Cron 自动更新。
- 2026-04-01 至上个月月底：新增历史补齐队列。
- 历史任务每 5 分钟触发；一次最多读取同方向连续 3 天，降低重复 Google Sheet 扫描。
- 历史全部成功后自动停止 history Cron，不长期空跑。
- 费率/盘口状态新增每 6 小时自动同步。

## 部署顺序

### A. GitHub / Netlify 前台
把本 ZIP 解压后的内容覆盖上传到现有 GitHub 仓库 `hensem-data-center`，Commit 后 Netlify 会自动部署。

现有 4 个 Netlify 环境变量不变：
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_DASHBOARD_AUTH_ENABLED=true
- NEXT_PUBLIC_DASHBOARD_USER_FUNCTION=dashboard-user-admin

### B. 更新 bright-responder
Supabase → Edge Functions → bright-responder → Code
用 `supabase/bright-responder-v7-history-auto.ts` 全部覆盖 index.ts → Deploy updates。
Verify JWT with legacy secret 继续 OFF。

### C. 更新 dashboard-user-admin
Supabase → Edge Functions → dashboard-user-admin → Code
用 `supabase/dashboard-user-admin.ts` 全部覆盖 index.ts → Deploy updates。
Verify JWT with legacy secret 继续 OFF。

### D. SQL 建立历史自动补齐
Supabase → SQL Editor → New query
标题：`08_历史数据自动补齐_费率自动更新_待执行`
复制 `supabase/history-backfill-and-rates-cron.sql` → Run。
成功后改名：`08_历史数据自动补齐_费率自动更新_已启用`

### E. 查看历史进度
新建 Query 标题：`09_检查_历史数据补齐进度_只读`
复制 `supabase/check-history-progress.sql`。
这份可随时 Run，不修改数据。

### F. 查看数据库 MB
新建 Query 标题：`10_检查_Supabase数据库占用_只读`
复制 `supabase/check-database-size.sql`。
这份可随时 Run，不修改数据。
