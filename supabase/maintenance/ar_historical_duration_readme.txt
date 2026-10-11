历史 AR 提现用时缓存：显式维护流程

安装迁移不扫描历史订单，不生成缓存。主页面只读缓存；未填、过期、缺少任一原生别名时保留原日报用时及其 source_reported_processing 口径，不回扫订单，不声明上游完整。

1. 确认两个迁移已安装、函数元数据守卫通过。先用 one_partition_explain.sql 对精确原生平台/日期做 EXPLAIN（没有 ANALYZE），不能仅凭估计承诺3秒内完成。
2. one_partition.sql 每次仅一个原生平台和一天，postgres、READ COMMITTED、statement_timeout=3s、lock_timeout=1s。refresh函数先获取 ar_collected_orders 的 SHARE NOWAIT 锁，阻止源写入在聚合期间提交；这会短暂挡住全表采集写入，务必单分区事务、提交后给在线请求留空窗。遇 NOWAIT/超时/其它错误立即停止，不提高限时或循环重试；页面仍能显示旧报告口径。
3. 每次成功记录 sourceCount、durationSampleCount、durationTotalSeconds、generation、generatedAt；sample=0时avg=NULL，不伪造零秒。计算原生 applied_at 半开日窗，不再次转换时区；秒数是 trunc(completed_at-applied_at)，仅大于0的秒数计样本。
4. 所有目标分区维护完后必须再次读取 current generation，并逐项确认全部原生别名缓存仍存在且generation一致。源历史 applied/completed/身份变化、插入、删除和TRUNCATE会原子撤销相应池；某个池在维护间隙失效时不能宣布整个平台原生口径就绪。零行别名也必须经过该日精确维护，不能借另一天的零行证据。
5. fresh目录与授权过滤仍由读取函数执行。缓存核验仅证明与当前已入库源行一致；durationCacheVerified=true，durationCompletenessVerified=false，AR总coverage仍未核验。正常ANALYZE不影响代际；源失效触发器或缓存写入守卫的禁用/重建、函数语义和权限/RLS漂移会fail closed。后续修复元数据也必须重新核对generation及池，不仅查看种子计数。

源写入失效函数是postgres SECURITY DEFINER，缓存维护是postgres-only invoker。缓存表的invoker写入守卫拒绝其它CURRENT_USER，包括误授写权限和BYPASSRLS的service_role；表ACL/RLS检查同时使读取fail closed。主RPC无历史原单回扫，读取未获授权的国家/平台不会返回池。

本地测试为PGlite单连接；覆盖回滚、维护隔离级别、角色拒绝、业务写入失效、代际漂移和完整JSON差分。跨连接锁交错未在此环境实测，锁协议依据PostgreSQL冲突关系及事务内源写入/失效的一致性；不要将本地测试报告写成生产并发实测。

Oct9 M8/IN先前元数据目录：15个canonical平台，共18个原生别名：
51GAME,55CLUB,6CLUB,82LOTTERY,91CLUB,BIGMUMBAI,IN999,JAICLUB,JALWA,
LOTTERY7,LOTTERY77,OKWIN,RAJA,SHREEWIN,Shree.Win,TPPLAY,VEERGAME,Veer.Game。
这是之前的目录证据，执行前应确认fresh目录别名没有变化；不将其它日期ready列表中的别名自动视作Oct9证据。
