# V247 部署：Supabase 稳定读取 / Profile 顶部 UI

这次只需要更新 GitHub / Netlify 前台代码。

不需要再改 Supabase SQL，不需要再改 bright-responder，不需要新增 Python，也不要停止现在正在运行的历史补齐 Cron。

## 部署
1. 解压本 ZIP。
2. 用里面全部文件覆盖 GitHub 仓库 `hensem-data-center`。
3. Commit 到 main。
4. Netlify 自动部署完成后，打开新站并强制刷新一次。

## V247 核心
- 网页查询只读 Supabase，不现场读取 Google。
- 数据库已有数据时，偶发 API/网络错误绝不会把页面覆盖成 0 行。
- Supabase 返回异常空结果会自动重试一次；仍异常就继续显示上一份成功数据。
- 只有真实非空数据才写入浏览器 last-good cache。
- Supabase 分页并发读取，减少等待时间。
- Profile 固定右上角。

## 不需要动
- bright-responder V7
- dashboard-user-admin
- 08~18 已建立的 SQL / Cron
- Google Sheet
