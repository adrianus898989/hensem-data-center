# FINAL6 严格自动退出版

只修正会话 idle，不改变任何业务统计口径。

1小时无操作定义：
- 只有真实 pointerdown / keydown / touchstart / wheel 才重置计时。
- 程序自身的 scroll、页面渲染、Supabase token 自动刷新都不会重置。
- 精确按最后真实活动时间计算 60 分钟。
- 浏览器后台/电脑睡眠后回来立即校验。
- 多标签页同步退出。
