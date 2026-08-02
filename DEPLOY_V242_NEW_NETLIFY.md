# V242 新 Netlify 网站（Supabase only）

## 架构
Google Sheets -> Supabase Edge Function/Cron -> Supabase DB -> 新 Netlify 网站

新网站不需要 Python。旧 Netlify 网站不修改；新站三方量/费率只读 Supabase。
自动出款、工单暂时在新站显示“待迁移”，避免新站继续调用旧数据源。

## 1. Supabase 初始化登录权限
SQL Editor 执行：supabase/dashboard-auth-setup.sql

## 2. 建 dashboard-user-admin Edge Function
Supabase -> Edge Functions -> 新建 dashboard-user-admin
把 supabase/dashboard-user-admin.ts 全部复制进去。
Verify JWT 关闭，Deploy。

第一次建立 Admin：
Header: x-sync-secret = 现有 SYNC_SECRET
Body:
{
  "action": "bootstrap-admin",
  "username": "admin",
  "password": "你自己设置至少8位密码"
}
只允许第一次 bootstrap；之后 Admin 在网站右下角“账号管理”建立 Viewer。

## 3. 新建 Netlify Site
Netlify -> Add new project -> Deploy manually。
解压本 ZIP，把解压后的整个项目文件夹拖进去。
登录 Netlify 时，Netlify 会识别 Next.js 并执行 build。

## 4. 新 Netlify 环境变量
Project configuration -> Environment variables 新增：
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_DASHBOARD_AUTH_ENABLED=true
NEXT_PUBLIC_DASHBOARD_USER_FUNCTION=dashboard-user-admin

注意：Netlify 不需要 SUPABASE_SERVICE_ROLE_KEY。
环境变量加完后重新 Deploy 一次。

## 5. 登录验证
打开新的 *.netlify.app 地址。
使用 bootstrap-admin 建好的 admin + 密码登录。
首页会显示 Supabase 数据状态；三方量/费率只来自 Supabase。
Admin 有“账号管理”，可建立 Viewer；Viewer 登录后没有账号管理入口，Edge Function 也会拒绝 Viewer 建账号。

## 6. 对比旧网站
旧网址继续打开作为标准答案，新网址打开 Supabase 数据。
两边选同一天直接核对金额、笔数、国家、平台、三方、人工确认/人工充值、费率和盘口状态。
