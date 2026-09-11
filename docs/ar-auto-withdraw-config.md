# AR 自动出款配置

入口：提现/自动出款统计 → 自动出款配置（自动出款旁边）。

这里只展示 AR 配置的只读快照，不修改任何上游配置。每天一次按平台当地实际日期采集，不使用 Google 报表日期或历史补录日期。刷新页面只重新读取 Supabase，并不会重新采集 AR。

## 数据与权限

- 配置 GET 来源路径：/Admin_UERP/System/AutoWithdrawConfig。不得调用 SetAutoWithdrawConfig。
- Supabase 入口：auto-withdraw-config-ingest；独立、可撤销、有期限且限制 41 个 AR 平台的 X-Config-Key。密钥仅放用户的采集程序，不放网站代码、公开资源或本文档。
- ar_config_targets 保存源代码中的 8 国家、41 平台与时区。
- ar_config_daily 保存每个当地自然日最后一次成功读取；ar_config_latest 是 security_invoker 视图。
- 原子 RPC + 不可变 ar_config_receipts 防止旧重试覆盖新记录及快照 ID 内容变更。
- 匿名不可读；已有 auto_withdraw 权限的活跃账号可读；浏览器无新增写权限。
- ar_config_credentials 和 ar_config_receipts 没有 authenticated RLS policy 是有意的服务端独占设计。

## 展示语义

27 个实际字段、2 组多选按原始页面顺序排列。金额保留字符串精度；同名的 autoWithdraw/isAutoPayment 按不同 id 区分。关闭开关的隐藏保存值仍显示并标记不生效；禁用的 Bank 开关保留真实值并标记来源锁定。仅被脚本引用、没有实际 DOM 的字段 available=false，不能解释为关闭。用户分组为允许选项；游戏类型为禁止选项。比较符与原说明不改写为新的风控判断。

未收到数据时显示“尚未同步”；过去日期显示“历史配置 · 待更新”。不把用户提供的样本植入生产数据。

## 验证

- Next production build。
- tests/ar-config-security.test.cjs：95 项隔离数据库、RLS、契约、Edge mock 检查。
  需要提供本机 PGlite 路径：PGLITE_PATH=/path/to/@electric-sql/pglite node tests/ar-config-security.test.cjs。
- 本地浏览器验证 27 字段、2 组、选中状态、桌面/窄屏不横向截断、空状态、错误状态及重试。
- 采集代码独立交付，不提交业务登录信息和配置密钥到仓库。
