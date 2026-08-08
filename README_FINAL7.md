# FINAL7 — 菲律宾 DyPay 前端统一修复

后台 V7F 已经把菲律宾：
- roroPay -> PAYRORO
- DyPayV2 -> DyPay
- Nova -> PinoyPay

本版同步修正前端 thirdPartyNameMap，避免旧的全局规则再次把菲律宾 DyPay 改回 DyPayV2。
这样费率匹配也会以 DyPay 为 canonical 名称。

无需重新改 Supabase Edge Function，也无需重新跑 SQL。
如果 V7F + 8/6 代收/代付 + sync-rates 已经执行过，只需部署本前端版本并重新查询 2026-08-06 菲律宾。
