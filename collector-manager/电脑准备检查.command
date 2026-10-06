#!/bin/bash
# Only run the adjacent read-only preparation check. Never install dependencies.
collector_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)" || exit 1
collector_python="$(command -v python3 2>/dev/null)"
collector_result=1

if [ -z "$collector_python" ]; then
  echo '没有找到 python3。先不要安装或升级，把此提示发来即可。'
elif [ "$collector_python" = '/usr/bin/python3' ] && ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
  echo '系统 Python 可能尚未安装，已停止检查，避免触发开发工具安装。'
  echo '先不要更改原采集环境，把此提示发来即可。'
elif ! "$collector_python" -B -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
  echo '当前 Python 无法使用，或版本低于 3.9。先不要安装或升级，把此提示发来即可。'
else
  "$collector_python" -B "$collector_dir/preflight.py"
  collector_result=$?
fi

echo
if [ -t 0 ]; then
  read -r -p '检查结束，截图后按回车关闭本窗口。' collector_reply
fi
exit "$collector_result"
