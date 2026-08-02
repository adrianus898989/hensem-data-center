# Hensem 数据后台 V234

本版在 V233 基础上做最小范围修复：

- 三方量当前月每小时更新；历史月份只读并永久锁定。
- 历史独立月快照缺失时，可从旧大快照拆出对应月份并只保存一次。
- 所有费率、单笔费和手续费计算仍以 Google 费率表为唯一来源，代码不固定费率。
- 代收、代付分别按对应方向计算百分比费率和单笔费用。
- 修复 ArbPay、VPS/PIXPAY21、SudalinkPay、STARPAGO、TodayPay 等名称匹配。
- 页面只下发选中日期范围的压缩数据，使用 CDN 缓存、ETag 和每小时静默检查，降低 Netlify 流量。

详细变更见 `CHANGELOG_V234.md`，部署核对见 `V234_DEPLOY_AND_VERIFY.md`。
