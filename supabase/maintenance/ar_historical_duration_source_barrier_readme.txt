历史用时维护反转barrier协议（取代旧whole-source SHARE维护模板）

新迁移042217只升级5函数的锁段及generation语义摘要，不扫描源行、不发布receipt、未修改已发布154529/162549。042245只适配最新函数hash至同一cb338主overlay，支持生产5dfb未切与全新安装已cb338重放。

3个维护入口：whole-day/hour/finalize均先postgres+RC验证，再source ACCESS SHARE NOWAIT，再pg_try_advisory_xact_lock(globalKey)独占维护barrier。try失败55P03立即回滚，绝不排队等待globalX。后续RC语句才读source/parts或写cache。source AS只冲突ACCESS EXCLUSIVE，所以正常INSERT/UPDATE/DELETE的ROW EXCLUSIVE和autovacuum SUE可以继续；该维护不会再取全表SHARE。

所有真正影响历史用时池的AFTER writer，在删除任何缓存行之前取同globalKey的SHARED事务advisory锁。writers之间兼容，不加跨row反序exclusive锁。捕获时间/status/operator-only变化先earlyreturn；非历史新单由现有WHEN/范围限制跳过。维护取X时，等待的历史writer尚未改cache，维护plainSELECT不拿source tuple锁，可以读取仍已提交源值；维护提交后writer获得S并原子删除旧/新native-day全部hour_parts和daily。因此等待writer不能使旧receipt复活，未来正常采集不暂停。

TRUNCATE本身先取source ACCESS EXCLUSIVE，再AFTER取同sharedbarrier并清两表。维护先取AS NOWAIT，确保不会在持globalX时再等待TRUNCATE的sourceX。DDL/trigger变动仍由表锁与generation元数据守卫保护：disabled/重建trigger或语义变更使旧receipt代际失效，不能混用旧hour0/1。

globalKey固定为hashtextextended('ar-historical-duration:source-barrier:v1',0)，3维护及row/TRUNCATE writer逐字相同。维护全局串行，不再需要per-day锁。私有cache owner-only写守卫、ACL/RLS、全别名证明、24hour sum和上游complete=false均保留。

根代理首先只执行91CLUB Oct9 hour0一次3s/1s，成功后按单次事务收集0..23，给线上请求留空窗；最终24current-generation receipts才finalize。新代际会令此前hour0/1自然失效，必须重建。其他小平台可逐日3s一次，某日已超时不得再次整日扫描，使用明确hour方案。任何unknown/55P03/57014停止并报告，不提高budget或无限重试。

发布day后必须再查currentgeneration/所有native别名池是否仍一致，不能只看执行成功计数。没有缓存继续旧日报口径；不自动回扫历史订单，不改订单数/分类/分母/coverage。

本地测试读取实际pg_locks验证单backend的源AS/维护X/writerS模式，并强制false模拟try忙分支；没有伪称真实多连接等待实测。并发正确性使用RC MVCC与事务锁协议推理；[PostgreSQL17 explicit-locking] https://www.postgresql.org/docs/17/explicit-locking.html 。源普通多语句自身行锁死锁并非此协议新增排队X，维护始终try不排队。
