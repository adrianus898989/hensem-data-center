#!/usr/bin/env python3
"""Offline local YASH upgrade; never execute the existing script or read config."""
from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

sys.dont_write_bytecode = True
EXPECTED_URL = "https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/yash-order-ingest"
TEMPLATE_SHA256 = "ea58742ec68f7f69366b8c7537da8770becf09398930b536745f8763c570df3d"
MAX_SCRIPT_BYTES = 5 * 1024 * 1024
KEYS = ("YASH_UPLOAD_URL", "YASH_UPLOAD_TOKEN")


class UpgradeError(Exception):
    pass


def parse_script(source):
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError, RecursionError):
        raise UpgradeError("脚本语法无法安全解析，未替换原文件。") from None
    assignments = {}
    for key in KEYS:
        nodes = [node for node in tree.body if isinstance(node, ast.Assign)
                 and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                 and node.targets[0].id == key]
        writes = [node for node in ast.walk(tree) if isinstance(node, ast.Name)
                  and isinstance(node.ctx, ast.Store) and node.id == key]
        if len(nodes) != 1 or len(writes) != 1 or not isinstance(nodes[0].value, ast.Constant) or type(nodes[0].value.value) is not str:
            raise UpgradeError("激活常量必须是唯一的顶层字符串，未替换原文件。")
        assignments[key] = nodes[0].value
    functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
    classes = {node.name for node in tree.body if isinstance(node, ast.ClassDef)}
    if not {"main", "parse_page", "run_cycle"} <= functions or not {"Config", "State", "SourceClient", "UploadClient"} <= classes:
        raise UpgradeError("目标不是支持的 YASH 采集脚本，未替换原文件。")
    return assignments


def activation_values(assignments):
    url, token = (assignments[key].value for key in KEYS)
    if url != EXPECTED_URL:
        raise UpgradeError("原脚本上传地址不是固定正式地址，未替换原文件。")
    if not token or token.startswith("__") or token.endswith("__") or "PLACEHOLDER" in token.upper() or not 8 <= len(token) <= 4096 or any(not 33 <= ord(char) <= 126 for char in token):
        raise UpgradeError("原脚本尚未激活或激活常量格式不支持，未替换原文件。")
    return {"YASH_UPLOAD_URL": url, "YASH_UPLOAD_TOKEN": token}


def apply_constants(template, assignments, values):
    lines = template.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    def position(line, column):
        return offsets[line - 1] + len(lines[line - 1].encode("utf-8")[:column].decode("utf-8"))
    result = template
    for key, node in sorted(assignments.items(), key=lambda item: (item[1].lineno, item[1].col_offset), reverse=True):
        start, end = position(node.lineno, node.col_offset), position(node.end_lineno, node.end_col_offset)
        result = result[:start] + json.dumps(values[key], ensure_ascii=True) + result[end:]
    verified = activation_values(parse_script(result))
    if verified != values:
        raise UpgradeError("升级脚本激活校验失败，未替换原文件。")
    return result


def read_regular(path):
    if path.is_symlink():
        raise UpgradeError("不支持符号链接，请指定真实采集脚本文件。")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SCRIPT_BYTES:
            raise UpgradeError("脚本文件类型或大小不支持，未替换原文件。")
        data = stream.read(MAX_SCRIPT_BYTES + 1)
    if len(data) > MAX_SCRIPT_BYTES:
        raise UpgradeError("脚本文件过大，未替换原文件。")
    return data, (info.st_dev, info.st_ino)


def backup_original(target, original):
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = target.with_name(target.name + ".before-notes-" + timestamp + ".bak")
    descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        os.chmod(backup, 0o600)
        stream.write(original); stream.flush(); os.fsync(stream.fileno())
    return backup


def upgrade(target, template_path=None):
    target = Path(target).expanduser().absolute()
    template_path = Path(template_path) if template_path is not None else Path(__file__).resolve().with_name("yash_cdp.py.template")
    original, identity = read_regular(target)
    template_bytes, _ = read_regular(template_path)
    if hashlib.sha256(template_bytes).hexdigest() != TEMPLATE_SHA256:
        raise UpgradeError("公开模板校验失败，请重新下载完整升级包；原文件未替换。")
    try:
        source, template = original.decode("utf-8"), template_bytes.decode("utf-8")
    except UnicodeError:
        raise UpgradeError("脚本编码不是 UTF-8，未替换原文件。") from None
    values = activation_values(parse_script(source))
    template_assignments = parse_script(template)
    if template_assignments["YASH_UPLOAD_URL"].value != EXPECTED_URL or template_assignments["YASH_UPLOAD_TOKEN"].value != "__YASH_UPLOAD_TOKEN__":
        raise UpgradeError("公开模板激活占位符不正确，未替换原文件。")
    updated = apply_constants(template, template_assignments, values).encode("utf-8")
    if updated == original:
        return None
    backup = backup_original(target, original)
    descriptor, temporary = tempfile.mkstemp(prefix=".yash-notes-upgrade-", dir=target.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(updated); stream.flush(); os.fsync(stream.fileno())
        current, current_identity = read_regular(target)
        if current != original or current_identity != identity:
            raise UpgradeError("原脚本在升级期间发生变化，已保留新变化；未替换。")
        os.replace(temporary, target)
        if os.name != "nt":
            directory = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return backup


def main(argv=None):
    parser = argparse.ArgumentParser(description="本地安全升级 YASH 备注采集；请先 Ctrl+C 停止原采集器。")
    parser.add_argument("--target", required=True, help="原激活版 yash_cdp.py 文件路径")
    args = parser.parse_args(argv)
    try:
        backup = upgrade(args.target)
    except UpgradeError as error:
        print("升级未完成：" + str(error), file=sys.stderr)
        return 1
    except (OSError, RuntimeError):
        print("升级未完成：文件读取、备份或原子写入失败，请检查路径和权限。未显示任何激活信息。", file=sys.stderr)
        return 1
    print("已是本升级包版本，无需重复替换。" if backup is None else "升级完成：原脚本已私密备份，激活信息已本地保留。")
    print("原配置、状态、订单和通道断点均未改动。请按 README 补采备注，再恢复 --loop。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
