# V251 部署顺序

1. Supabase SQL Editor 新建 Query：`21_V251_高速查询_数据完整状态_待执行`。
   - 执行 `supabase/21_V251_高速查询_数据完整状态.sql`。
   - 最后应返回两个函数：`dashboard_third_party_sync_status`、`dashboard_third_party_volume_fast_v2`。
   - 成功后改名 `_已完成`。
2. 不需要修改 `bright-responder`，不需要修改 `dashboard-user-admin`，V250 版本继续使用。
3. 把本 ZIP 全部覆盖 GitHub `hensem-data-center`，Commit main，等待 Netlify Published。
4. 浏览器 Command+Shift+R 强制刷新。
5. 三方量测试：先选国家/月份，再点“查询”。页面会显示“数据已补齐 / 补齐中”和最后写库时间。
6. 如果刚修改 Google 费率表：左侧 管理后台 → 数据同步 → `费率 / 盘口` → `立即刷新`；完成后回三方量点查询。
