# V250：Supabase 高速查询 + Owner/Admin/Viewer + 1小时无操作自动退出

## 本版重点

1. 三方量查询改为 PostgreSQL RPC 单请求。
   - 旧版按 1000 行 REST 分页，4 月 47046 行会产生几十次请求。
   - V250 日期/国家过滤在数据库执行，一次返回当前国家切片。
   - 保留开始日期前 1 天，继续兼容 v239 昨日对比。
2. 查询按钮模式保留：先选条件，点击「查询」后应用。
3. 管理权限：唯一 Owner > Admin > Viewer。
   - 只有 Owner 可以建立、修改、删除 Admin。
   - Admin 的查看模块、Viewer 管理、数据刷新、操作记录权限由 Owner 独立分配。
4. 管理后台使用正式工作区，不再使用居中弹窗。
5. 登录账号连续 1 小时没有点击/键盘/触摸/滚动操作，会自动退出并要求重新登录。

## 部署顺序

### 1. SQL
Supabase → SQL Editor → New query
标题：`20_V250_高速查询_总管理员权限_待执行`
复制：`supabase/dashboard-v250-owner-fast-query.sql`
Run 成功后改名：`20_V250_高速查询_总管理员权限_已完成`

### 2. dashboard-user-admin
Supabase → Edge Functions → dashboard-user-admin → Code
用 `supabase/dashboard-user-admin.ts` 全部覆盖 → Deploy updates。
Verify JWT with legacy secret 保持 OFF。

### 3. GitHub / Netlify
把本 ZIP 解压后全部覆盖 GitHub `hensem-data-center` 仓库 → Commit main。
Netlify 自动部署。

### 4. 测试
- 强制刷新：Command + Shift + R
- 登录 admin，应显示 Owner / 总管理员。
- 三方量：选择 4 月 + 印度 → 查询。
- 管理后台：Owner 可以建立 Admin；Admin 不能建立 Admin。
- 1 小时无操作后自动回到登录页。

## 不需要改
- bright-responder V7
- 已建立的三方量/历史/费率 Cron
- Google Sheet
- Python 采集代码
