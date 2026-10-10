#!/usr/bin/env python3
"""Add proven AR table member facts to supported collectors, without credentials.

Run only after the AR member-facts migration and the compatible ar-order-ingest
Edge Function are deployed. This tool edits the
chosen existing file locally; it neither reads private configuration nor sends
network requests. Existing source credentials are never printed or copied into
this repository. Missing or malformed source fields stay unknown.
"""
from __future__ import annotations

import argparse
import ast
import os
from pathlib import Path
import re
import tempfile
import unicodedata

MARKER = "# AR_MEMBER_FACTS_V1"
OPTIONAL_FIELDS = ("member_level", "recharge_count")


def _ar_member_value(value, *, level=False):
    if type(value) is int:
        result = value
    elif isinstance(value, str):
        text = value.strip()
        pattern = r"(?:L(?:V)?)?([0-9]{1,4})" if level else r"([0-9]{1,9})"
        match = re.fullmatch(pattern, text, re.IGNORECASE)
        if not match:
            return None
        result = int(match[1])
    else:
        return None
    return result if 0 <= result <= (9999 if level else 999999999) else None


def _ar_member_facts(record):
    """Only screenshot-proven Chinese headers; no inferred history or grade."""
    wanted = {"会员等级": ("member_level", True), "充值次数": ("recharge_count", False)}
    values = {field: [] for field in OPTIONAL_FIELDS}
    for key, value in record.items():
        if not isinstance(key, str):
            continue
        header = re.sub(r"[\s\u200b\ufeff]+", "", unicodedata.normalize("NFKC", key))
        if header in wanted:
            field, level = wanted[header]
            values[field].append(_ar_member_value(value, level=level))
    return {field: items[0] if items and all(item == items[0] for item in items) else None
            for field, items in values.items()}


def _snippet():
    # Ship the same tested pure functions inside the user's existing one file.
    source = Path(__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    parts = [ast.get_source_segment(source, node) for node in tree.body
             if isinstance(node, ast.FunctionDef) and node.name in ("_ar_member_value", "_ar_member_facts")]
    return (MARKER + '\nimport unicodedata\nOPTIONAL_FIELDS = ("member_level", "recharge_count")\n'
            + "\n\n".join(parts) + "\n")


def _replace_nodes(source, replacements):
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    # AST columns use UTF-8 byte offsets; source replacements use characters.
    def position(line, col):
        return offsets[line - 1] + len(lines[line - 1].encode("utf-8")[:col].decode("utf-8"))
    for node, replacement in sorted(replacements, key=lambda item: (item[0].lineno, item[0].col_offset), reverse=True):
        start = position(node.lineno, node.col_offset)
        end = position(node.end_lineno, node.end_col_offset)
        source = source[:start] + replacement + source[end:]
    return source


def _patch_module(source, embedded=False):
    if MARKER in source:
        ast.parse(source)
        return source, False
    tree = ast.parse(source)
    field_name = "ROW_FIELDS" if embedded else "FIELDS"
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == field_name for target in node.targets)]
    normalizers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "normalize_record"]
    if len(assignments) != 1 or len(normalizers) != 1:
        raise ValueError("UNSUPPORTED_AR_COLLECTOR")
    fields = ast.literal_eval(assignments[0].value)
    if not isinstance(fields, tuple) or len(fields) != 12 or "member_id" not in fields:
        raise ValueError("UNSUPPORTED_AR_COLLECTOR_FIELDS")
    replacements = [(assignments[0].value, repr(fields + OPTIONAL_FIELDS))]
    function = normalizers[0]
    if embedded:
        returns = [node for node in function.body if isinstance(node, ast.Return)]
        if len(returns) != 1 or not isinstance(returns[0].value, ast.Tuple):
            raise ValueError("UNSUPPORTED_AR_NORMALIZER")
        # No generic ALIASES are added: only these two exact proven headers.
        original = ast.get_source_segment(source, returns[0])
        replacements.append((returns[0], 'row.update(_ar_member_facts(record))\n    ' + original))
    else:
        returns = [node for node in function.body if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict)]
        validators = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_validate_order"]
        if len(returns) != 1 or len(validators) != 1:
            raise ValueError("UNSUPPORTED_AR_NORMALIZER")
        original = ast.get_source_segment(source, returns[0].value)
        replacements.append((returns[0].value, '{**_ar_member_facts(record), ' + original[1:]))
        validator = validators[0]
        original = ast.get_source_segment(source, validator)
        old = "set(row) != set(FIELDS)"
        if original.count(old) != 1:
            raise ValueError("UNSUPPORTED_AR_VALIDATOR")
        original = original.replace(old, "(set(row) - set(OPTIONAL_FIELDS) != set(FIELDS) - set(OPTIONAL_FIELDS) or not set(row) <= set(FIELDS))")
        original += '\n    for field, maximum in (("member_level", 9999), ("recharge_count", 999999999)):\n        value = row.get(field)\n        if value is not None and (type(value) is not int or not 0 <= value <= maximum):\n            raise ARV1Error("invalid_member_fact")'
        replacements.append((validator, original))
    result = _replace_nodes(source, replacements) + "\n\n" + _snippet()
    # Insert helpers before execution reaches a __main__ block.
    result_tree = ast.parse(result)
    mains = [node for node in result_tree.body if isinstance(node, ast.If)
             and "__name__" in ast.unparse(node.test) and "__main__" in ast.unparse(node.test)]
    if mains:
        helper = "\n\n" + _snippet()
        result = result[:-len(helper)]
        index = sum(len(line) for line in result.splitlines(keepends=True)[:mains[0].lineno - 1])
        result = result[:index] + _snippet() + "\n" + result[index:]
    ast.parse(result)
    return result, True


def patch_source(source):
    """Fail closed on unknown layouts; support Indian and original embedded AR."""
    tree = ast.parse(source)
    embedded = [node for node in tree.body if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == "_AR_ORDER_SUPPORT_SOURCE" for target in node.targets)]
    if embedded:
        if len(embedded) != 1:
            raise ValueError("UNSUPPORTED_AR_COLLECTOR")
        original = ast.literal_eval(embedded[0].value)
        if not isinstance(original, str):
            raise ValueError("UNSUPPORTED_AR_COLLECTOR")
        updated, changed = _patch_module(original, embedded=True)
        result = _replace_nodes(source, [(embedded[0].value, repr(updated))]) if changed else source
        ast.parse(result)
        return result, changed, "embedded_original"
    updated, changed = _patch_module(source)
    return updated, changed, "indian_standalone"


def patch_file(path, output=None):
    path = Path(path).expanduser()
    if path.is_symlink() or not path.is_file():
        raise ValueError("AR_FILE_REQUIRED")
    path = path.resolve(strict=True)
    source = path.read_text(encoding="utf-8")
    updated, changed, profile = patch_source(source)
    destination = Path(output).expanduser().absolute() if output else path
    if not changed and destination == path:
        return False, profile
    if output and destination.exists():
        raise ValueError("AR_OUTPUT_ALREADY_EXISTS")
    # Back up the original privately before in-place editing. Never print it.
    if not output:
        backup = path.with_name(path.name + ".member-facts-v1.bak")
        with backup.open("x", encoding="utf-8") as stream:
            os.chmod(backup, 0o600)
            stream.write(source)
            stream.flush()
            os.fsync(stream.fileno())
    fd, temporary = tempfile.mkstemp(prefix=".ar-member-facts-", dir=destination.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return changed, profile


def main(argv=None):
    parser = argparse.ArgumentParser(description="升级旧 AR 订单采集会员等级和充值次数；先由管理员部署兼容数据库迁移及 ar-order-ingest 接收端")
    parser.add_argument("script", help="正在使用的 ardpwd / AR 原版订单脚本路径")
    parser.add_argument("--output", help="另存新版单文件；默认原地修改并保存私有备份")
    args = parser.parse_args(argv)
    try:
        changed, profile = patch_file(args.script, args.output)
    except (OSError, SyntaxError, ValueError):
        print("升级未执行：文件格式不匹配、已有目标/备份或不可写；原文件保持原样。")
        return 1
    print("升级完成" if changed else "已是会员字段版本", "·", profile,
          "· 源未提供保持空值；历史等级和次数需真实补采。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
