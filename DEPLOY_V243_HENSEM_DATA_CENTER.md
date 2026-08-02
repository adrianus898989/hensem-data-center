# V243 Hensem Data Center

推荐 Netlify Site name：`hensem-data-center`
备用：`hensem-control-center`

## 新版新增
- 专业账号密码登录 UI
- Admin / Viewer 权限隔离
- Admin 建立 Viewer
- Admin 可选择 Viewer 可看的模块
- Admin 可停用 / 启用 Viewer
- Admin 可重置 Viewer 密码
- Admin 可查看后台操作记录
- Admin 首页可一键“刷新最新数据”
- Admin 管理后台可分别刷新：今日代收、今日代付、昨日代收、昨日代付、费率/盘口
- Viewer 只有查看权限，不能调用刷新或账号管理接口

## Supabase 顺序
1. 已执行旧版 `dashboard-auth-setup.sql` 的项目：再执行 `supabase/dashboard-permissions-upgrade.sql`。
2. `dashboard-user-admin` Edge Function 用新版 `supabase/dashboard-user-admin.ts` 覆盖后 Deploy。
3. Verify JWT with legacy secret 保持 OFF。
4. 第一次才执行 `bootstrap-admin`。

## Netlify 环境变量
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_DASHBOARD_AUTH_ENABLED=true`
- `NEXT_PUBLIC_DASHBOARD_USER_FUNCTION=dashboard-user-admin`

Netlify 不需要 Python，也不要放 Supabase Service Role Key。
