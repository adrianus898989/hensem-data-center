NEWAR 出款分类采集补丁（无账号、密码、token或接收配置）

本补丁修复锁单人/最后修改人覆盖原生 operator 的问题。原生 operator=system 时保留自动；只给锁单人或修改人时保留未知。不会通过空备注、支付结果、支付方式或 lastUpdateTime 推断自动/人工。提交时间和处理时间分别保存，处理时间没有提供时仍为空。

只支持已核对的 helper 旧版本 SHA256：
7cf152886bdccdf3f19e3e63e2fc17782c702adfc52478e7ba08ce987aff8421
其他版本会停止，不会强行覆盖。重复运行已安装版本会安全跳过。

先关闭当前采集进程。按自己的实际脚本路径选择命令；下列路径仅为占位，不会搜索电脑目录。

单文件版：
python3 upgrade.py --script "/实际目录/newarsystem.py"
python3 upgrade.py --script "/实际目录/newarsystem.py" --apply

外部 helpers 版：
python3 upgrade.py --helpers-dir "/实际目录/helpers"
python3 upgrade.py --helpers-dir "/实际目录/helpers" --apply

若两者都有，可在同一命令同时传 --script 和 --helpers-dir。默认只检查；--apply 才修改文件。升级器只替换匹配版本的一个业务 helper，保留其它模块和凭据配置。原文件备份为同目录 *.pre-newar-method-fix.bak，权限0600；备份可能包含原脚本私有配置，不要上传或分享。

升级后按原来的启动命令重启。升级器不执行旧脚本、不登录源站、不启动采集、不修改采集范围、不自动重采历史。只有缺处理时间的订单，不会因此获得虚构时长。

已确认的三笔历史订单由后台独立审计更正保护，旧客户端重传也不会覆盖该确认。其他缺说明记录没有批量改成自动。要补充其他历史订单的真实方式，仍需源站明确字段或逐笔可追溯确认；不要把空备注当作自动依据。
