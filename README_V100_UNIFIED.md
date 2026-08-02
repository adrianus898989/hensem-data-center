# V100 统一修复版

本版在 V99 基础上统一处理你前面连续反馈的问题，重点不再乱猜费率，改成更严格的 Google 三方费率表匹配。

## 三方量 / 三方费率

1. 费率解析规则增强：
   - Google 表里 `0.70` 会按 `0.70%` 处理，不会再算成 70%。
   - `0.019` 这种小数率保留为 1.9%。
   - 超过 50% 的异常误读费率自动忽略，避免 301%、791% 这类错误。
2. 三方名称统一：
   - 巴西：TOD / TODPay / TDPay / TodayPay 合并为 TodayPay。
   - 巴西 TOD：代收、代付统一按单笔 0.1 计算，不再误读成百分比。
   - 越南：TopPay 永远归 TopPay，不再被错配到 OpPay；FASTPAY / TPAY / TRUEPAY 归 FASTPay。
   - 印尼：PayIngPayI / PayIngPayl / SecPay / SECPAY-PAYING 统一为 PayIngPay。
   - 印尼：SAFEPAY / SafePay2 统一为 SafePay。
   - 印尼：YerePay / yerePay 统一为 YerePay。
   - 巴基斯坦：OkPay / OpenPay / OpPay / P777Pay / 777Pay / DeePay 等补强别名。
3. 费率匹配规则：
   - 按 国家 + 平台 + 统一三方 + 钱包/通道类型 精准匹配。
   - 盘口级费率优先，其次国家级费率兜底。
   - 匹配不到不会乱显示别人的费率，只显示 `-`。
4. 页面结构：
   - 总览不再放异常提醒。
   - 三方结构统计只放在页面底部，不放异常提醒、不抢顶部主表位置。

## 工单统计

1. 工单主导航保持：工单统计 / 工单日表 / 操作人统计。
2. 工单统计子页只保留：工单看板 / 各平台类型统计。
3. 工单日表不显示国家下拉，按盘口按钮切换。
4. 工单日表补当前页面国家占比，采用紧凑显示。
5. 工单名称合并：
   - Withdraw Problem / Withdrawal problem / Withdrawal Problem 统一为 Withdraw Problem。
   - Bonus Black Scatter / Bonus Super Scatter / Bonus Slot 20% / Bonus Spin 20% / WinStreak / Winning Streak 统一为 WinStreak Bonus。
   - Deposit Not Receive / Deposit Not Received 统一。
   - Game Problem / Game Problems 统一。
6. 日表点查看时，优先弹出子工单类型汇总，不再只显示同一条日汇总。
7. 日表读取不再因为国家列识别不到就直接丢行，避免 FB999 / 尼日利亚等国家数据被隐藏。

## 部署

覆盖 GitHub 整个项目后提交，Netlify 自动部署即可。环境变量不需要改。
