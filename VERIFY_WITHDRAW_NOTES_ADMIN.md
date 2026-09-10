# 每日备注、昨日对比与紧凑账号列表

## 行为

- 账号列表默认一行一个账号；点击设置展开权限/停用/重置/删除。新建与 IP 控制默认收起。
- 自动出款单日汇总保留 API 已计算的前一自然日用时与变化百分比。旧聚合代码清空了这两列，导致界面显示 `-`。
- 跨月/跨年读取前一天，仅用于比较，不加入查询期间笔数。多日汇总不冒充单日昨日比较。
- 原因备注按日期、国家、盘口保存到独立 `auto_withdraw_notes` 表，不随自动同步重建。
- 单日直接编辑；多日选择有日表数据的具体日期。清空并保存即清除内容。列表显示原因摘要，点击查看完整内容和最后编辑人/时间。
- 有自动出款权限的用户可读；启用的 Owner/Admin 且具有模块权限才能写。作者和更新时间由数据库触发器填写，不能信任浏览器传值。
- 历史快照日表也可填写备注。数据库不对日表创建外键，避免日表同步/替换删除人工备注。
- 展示样本是虚构演示，不会写入正式数据库。

## 验证

```sh
node --test tests/auto-withdraw-comparison.test.cjs tests/auto-withdraw-notes-client.test.cjs
```

15 项测试全部通过：昨日/跨月/跨年、区间排除比较日、平台国家隔离、日期校验、分页完整性、清空、保存目标、401/403/500 与异常响应。`next build --no-lint` 成功（沿用项目已有跳过全仓类型校验配置）。

页面测试需独立本地服务，不能指向正式网站：

```sh
NEXT_PUBLIC_DASHBOARD_AUTH_ENABLED=true NEXT_PUBLIC_SUPABASE_URL=https://ui-test.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=ui-test-only node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 -p 3100
# 在另一个终端运行，运行环境须提供 playwright + 浏览器；可设 NODE_PATH、CHROME_PATH。
UI_TEST_URL=http://127.0.0.1:3100 node tests/admin-layout-ui.cjs
UI_TEST_ORIGIN=http://127.0.0.1:3100 node tests/withdraw-notes-ui.cjs
```

两套页面测试通过。账号测试使用 9 个虚构账号，检查保护/搜索/自动保存/展开/默认值与桌面、小屏布局（1728、1366、390 像素宽）。备注测试使用虚构盘口和原因，检查保存、重读、清空、日期隔离、错误保留、只读及样本。

Supabase 已在回滚事务中验证 Owner 插入/更新（含历史日期）、Viewer 读取与拒绝写入；回滚后演示备注为 0。新表已启用 RLS，anon 无读写权限。

## 已有项目限制（非本次引入）

- 全仓 TypeScript 检查包含历史 Deno 代码及 WorkOrderDashboard、Dashboard 已有类型错误；本次新增文件无类型错误。现有 Next 配置跳过完整类型校验，不能用构建成功替代全仓类型清理。
- 当前 Next 14.2.16 安装时提示存在安全更新；建议后续单独做框架安全升级和兼容回归，不与本次 UI/备注混改。
- 原 `pnpm-lock.yaml` 有解析问题，本地依赖验证使用 `pnpm install --lockfile=false --ignore-scripts`，未重写原锁文件。
