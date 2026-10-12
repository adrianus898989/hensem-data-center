LG 单 PY 业务字段与备注升级

交付文件 lg_withdraw_to_sheet.py 由用户本次提供的原文件生成。它保留原上传
配置，因此被 .gitignore 排除；Git 只保存没有私密配置的构建器、补丁和测试。
构建器校验原文件 SHA-256，只解析源代码，不导入或启动采集程序。

构建：
python3 build_delivery.py --source /path/to/private-original.txt --output /path/to/lg_withdraw_to_sheet.py

本版本保留原调度、CDP 9333、租约、时区、窗口、分页、批次、断点与 ACK 逻辑。
金额按原规则精确解析。新增字段合同见 contract.json。

remark 与 appRemark 分别保留源字段含义；不推断人工拒绝或原因分类。文本先
去敏再限制长度；手机、卡号、姓名、邮箱、账户、证件、PIX 等同单已知信息及
可识别的敏感格式会被隐藏。独立手机号/账户字段与嵌套用户信息不上传。
会员 ID 仅来自 userId；与同单手机/银行卡/账户冲突时不保留，绝不由其补位。
交易流水号和精确金额保留各自业务类型，避免当作自由文本手机号处理。

旧合法午夜缓存原样重放，不补写版本或备注，不改变内容哈希、UUID 或分批。
非法缓存在上传前拒绝，原文件和未确认进度保留。不能改写旧批内容后沿用
同一 UUID 上传，否则可能与服务端已有分批哈希冲突。

新增客户端需配套接收端允许业务字段合同。已有历史订单的备注只有重新读到
源订单并成功上传后才会出现；不能从旧缓存中恢复从未保存过的备注。

离线验证：
LG_BASELINE_SOURCE=/path/to/private-original.txt python3 -B -m unittest discover -s tests/lg-business-notes -v

旧 R8 离线运行行为复用测试：
python3 -B tests/lg-business-notes/run_legacy_runtime.py --legacy-tests /path/to/old/test_runtime.py --delivery collectors/lg-business-notes-upgrade/lg_withdraw_to_sheet.py

这两类测试使用合成订单和假传输器，不执行采集主函数，不访问现场浏览器或
接收端。source_schema.json 只保存用户提供的两份响应的字段名、类型和汇总证据，
不保存原始订单或备注内容。
