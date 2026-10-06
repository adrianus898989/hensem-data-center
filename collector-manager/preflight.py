#!/usr/bin/env python3
"""Read-only Mac preparation check. No network, installs, files or signals."""
from __future__ import annotations

import os
import platform
import re
import subprocess
import sys


READ_COMMANDS = {
    "memory": ("/usr/sbin/sysctl", "-n", "hw.memsize"),
    "processes": ("/bin/ps", "-axo", "pid=,rss=,comm="),
}


def read_command(name):
    try:
        result = subprocess.run(READ_COMMANDS[name], capture_output=True,
                                text=True, timeout=10, check=True)
        return result.stdout
    except (OSError, subprocess.SubprocessError, UnicodeError):
        return None


def summarize_processes(output):
    """Never return command names, paths, arguments, or unrelated processes."""
    groups = {"Python": {"count": 0, "rss_kib": 0},
              "Chrome": {"count": 0, "rss_kib": 0}}
    if output is None:
        return None
    for line in output.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) != 3 or not fields[0].isdigit() or not fields[1].isdigit():
            continue
        name = os.path.basename(fields[2])
        if re.fullmatch(r"python(?:\d+(?:\.\d+)*)?", name, re.IGNORECASE):
            group = "Python"
        elif re.fullmatch(r"(?:Google Chrome(?: for Testing)?|Chromium)"
                          r"(?: Helper(?: \([A-Za-z ]+\))?)?", name):
            group = "Chrome"
        else:
            continue
        groups[group]["count"] += 1
        groups[group]["rss_kib"] += int(fields[1])
    return groups


def render_report(memory_text, process_text, *, executable, version, system, machine):
    lines = ["电脑准备检查（只读）", "=" * 34,
             "Python 版本：" + version,
             "Python 路径：" + executable,
             "系统：" + system,
             "当前 Python 架构：" + machine]
    try:
        memory_bytes = int(memory_text.strip())
        if memory_bytes <= 0:
            raise ValueError()
        memory = "%.1f GiB" % (memory_bytes / (1024 ** 3))
    except (ValueError, TypeError, AttributeError):
        memory = "未知（未能读取，不代表为零）"
    lines.append("物理内存：" + memory)
    groups = summarize_processes(process_text)
    if groups is None:
        lines.append("进程占用：未知（无法读取进程列表，不代表没有任务）")
    else:
        for name, info in groups.items():
            lines.append("%s 进程：%d 个；RSS 合计约 %.2f GiB" %
                         (name, info["count"], info["rss_kib"] / (1024 ** 2)))
        lines.append("Python 数量包括本次检查程序，不等于采集任务数量。")
        lines.append("RSS 是驻留内存之和，共享页可能重复计算，不是独占内存或峰值。")
    lines.extend([
        "", "本次只检查运行环境与进程占用，未验证后台连接或订单采集。",
        "未连接网络、未安装软件、未创建配置，未启动或停止原有采集。",
        "未读取浏览器 Cookie、账号密码、订单文件或进程启动参数。",
        "报告只显示在本窗口，没有自动上传或保存。",
        "", "下一步：把本窗口检查结果截图发来；原来的 PY 和浏览器继续运行。",
        "报告包含本机 Python 路径；如不想显示用户名，可遮住该段。",
    ])
    return "\n".join(lines)


def main():
    if sys.version_info < (3, 9):
        print("需要 Python 3.9 或以上。先不要安装或升级原环境，把此提示发来即可。")
        return 1
    if platform.system() != "Darwin":
        print("此准备检查仅适用于 Mac。未执行检查、未修改任何内容。")
        return 1
    print(render_report(read_command("memory"), read_command("processes"),
                        executable=sys.executable, version=platform.python_version(),
                        system=platform.system(), machine=platform.machine()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
