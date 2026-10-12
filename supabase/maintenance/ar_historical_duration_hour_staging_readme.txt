历史 AR 用时：小时维护补充协议

20261011162549 在已发布059d代际对象上升级，旧154529/155300文件没有修改。保留原whole-day refresh函数供小分区使用；大分区仅改用小时维护，不要求18个平台全都24次扫描。

生产先安装162549。主函数当前5dfb时，应使用162550新前置hash适配迁移切到原cb338主体，不再直接应用155300旧前置hash；从头安装若155300已先得到cb338，162550会核验新前置并保持cb338，允许重放。主查询逻辑、权限、时间覆盖与订单counts完全不变。

每次one_hour.sql仅postgres、READ COMMITTED、statement_timeout=3s、lock_timeout=1s、原生平台和原生day/hour0..23。函数先取全source表SHARE NOWAIT，再用原生timestamp小时半开窗聚合。每次事务结束后给在线请求留空窗；不要自动循环、加限时、或在未知/超时后盲重试。同日空小时也必须成功扫描后写receipt，不造空证据。

源历史记录insert/delete、country/platform/source/kind/applied/completed改变，在同一个源事务里删除旧/新native-day的全部hour_parts及dailycache，不仅删除发生变化的一小时。源TRUNCATE同时清两表；捕获时间/status/operator-only变动不影响用时池，保留缓存。

全部24个成功小时收集后，另一个3s RC+SHARE NOWAIT事务运行finalize_day。固定PK+hour范围约束确保24条就是0..23各一条，并要求全部current generation。它按SUM(sourceCount)/SUM(sampleCount)/SUM(seconds)汇总，绝不平均小时均值；没有24条就回滚，不写daily。不重复扫描整日原单。

为何不同事务仍不混合源快照：source写与每小时/finalize的SHARE锁串行；任何影响该日统计的源写会原子撤销整个day的所有旧小时和daily。最终幸存的24条均在最后一次相关源变动之后建立，统计字段对应同一稳定源状态。finalize持同锁防止源先撤销之后再写旧daily。若维护期间源时间修订，已填小时消失属于正确失效，应停止并报告，不声称完整。

私有小时表同RLS无policy/应用角色无ACL，并复用postgres-only SECURITY INVOKER写守卫；误grant+BYPASSRLS也不能改receipt。触发器禁用/重建或语义漂移变代际，旧receipt不能发布。ANALYZE不会改变代际。新对象安装不聚合源行、不自动approve任何日，旧daily行保留但旧代际自然miss。

最终必须再读current generation及所有目标daily池一致性，fresh目录各native别名都要有该日的真实daily（直接日维护或24h汇总），然后才能切用native用时。证明只等价已入库源，不改变AR上游complete=false。没有缓存时继续显示旧日报口径。

本地专项7tests+原cache/main15tests，PGlite单连接模拟源变更/回滚和整日失效；没有声称生产多连接并发实测。锁协议与维护全table SHARE的短暂采集阻塞限制保持。根代理串行生产执行，任何失败立即停，不扩预算。
