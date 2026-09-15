# 每日代收成功率（独立提交日快照）

现有三方量表只增加一列「代收成功率」。原金额、代收笔数、手续费、费率读取及排序不变；新增统计不得用旧 `volume.successCount` 或 `collectCount` 推算。

## 口径

- 每个平台后台业务日：该日提交订单中成功笔数 ÷ 该日提交总笔数。
- 多平台/三方/日期合并：先相加分子、分母，再相除，不平均百分比。
- 单日对比前一天，显示百分点；多日对比等长前一期，显示「较上期」。
- 缺平台日、未采集、来源不完整、类型无法确认：不伪造成功率。无提交显示 `—`，有提交但零成功显示 `0.00%`。
- 按原「展开」查看平台成功/提交笔数。只有提交而没有成功跑量的三方可以显示零跑量行，但不会污染原量的汇总。
- 这是采集时的提交日快照，不承诺未完成订单后续状态永远不变；需要修正历史日期时重新补采整天。

## 数据链路与权限

用户现有 Python 完整日统计 → 专用 `collection-success-ingest` Edge Function → `collection_success_daily` → 同一登录用户 JWT 调用 `dashboard_collection_success` → 原三方量页面。

Python 是私有单文件交付，不放入 Git（原文件含用户 TG 凭证）。沿用原依赖；新增队列/时区模块为 Python 标准库。专用写入凭据仅存私有交付和数据库哈希，不能读取仪表盘或修改三方量、费率表；不要替换成 `service_role`。

`collection_success_credentials.allowed_scopes` 精确限定来源、国家、平台、IANA 时区。`check` 仅验证连接；`ingest` 才写入完整快照。Edge 与数据库双重校验；过期、撤销、范围不符均拒绝。完整日原子替换，旧快照不覆盖新快照，相同 UUID 重试不重复累计。

读表先执行模块权限及账号国家/盘口范围 RLS，再聚合。凭据、回执表不给 `anon`/`authenticated` 权限且 RLS 默认拒绝，相关「RLS enabled/no policy」提示为刻意的服务端隔离。新增接口不读取 Google，也不改变费率同步。

## 调度与交付边界

后台跨过 00:00 后下一轮复用昨日整天结果；首次启用同时排队前天供对比。失败进入独立持久队列，不能因 TG 已发送而跳过；上传线程与 TG 发送状态独立。正常循环的补采有数量限制，避免连续补完所有平台拖住原任务。

本次来源文件配置 41 个平台（印度 15 个）。三方量中另有 DHANIWIN，但该 Python 无其来源配置；不能虚构它的数据。需补充对应采集来源后再纳入。

## 验证

新增测试覆盖 Edge 认证/校验、Postgres 权限和原子替换、失败/零订单/加权/别名/昨日差值、同 JWT 读取与错误隔离。`tests/collection-success-current-table.ui.cjs` 用真正 React 表格组件和合成数据校验原 18 列及数值不变、仅新增一列、展开与窄屏容器滚动。

迁移：`supabase/migrations/20260914140223_collection_success_daily.sql`。Edge 源码：`BACKEND_CURRENT/collection-success-ingest.ts`。部署 `verify_jwt=false` 是为了使用每次必验的专用 `X-Collection-Key`，不是匿名允许写入。
