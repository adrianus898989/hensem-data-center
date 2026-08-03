# V252 部署

本版仅前端体验修复，无需新增 SQL、无需修改 Edge Function。

1. 覆盖 GitHub hensem-data-center 全部文件。
2. Commit 到 main，等待 Netlify Published。
3. 浏览器 Command + Shift + R。
4. 测试：已有 0 行结果时再次选择日期并点“查询”，页面不应空白；旧结果/页面结构保留，顶部显示“正在查询 Supabase”，完成后原地更新。
