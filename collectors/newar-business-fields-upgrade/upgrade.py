"""Patch only the known business helper; never execute/read out private configuration."""
import argparse
import ast
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile

OLD_HELPER_SHA256 = "7cf152886bdccdf3f19e3e63e2fc17782c702adfc52478e7ba08ce987aff8421"
NEW_HELPER_SHA256 = "8b652852cd542b27290311225dde622b60cced74c663a099e4a41c47f564b444"
BOOTSTRAP_NAME = "_NEWAR_BUNDLE_BOOTSTRAP"


class UpgradeError(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parse(source):
    try:
        return ast.parse(source)
    except (SyntaxError, ValueError, RecursionError):
        raise UpgradeError("UNSUPPORTED_SCRIPT_FORMAT") from None


def replace_literal(source, node, value):
    # AST columns are UTF-8 byte offsets, including when the file has Chinese text.
    lines = source.encode("utf-8").splitlines(keepends=True)
    start = sum(map(len, lines[:node.lineno - 1])) + node.col_offset
    end = sum(map(len, lines[:node.end_lineno - 1])) + node.end_col_offset
    original = source.encode("utf-8")
    return (original[:start] + repr(value).encode("utf-8") + original[end:]).decode("utf-8")


def replace_embedded(source, payload, allowed_old=None):
    allowed_old = {OLD_HELPER_SHA256} if allowed_old is None else set(allowed_old)
    outer = parse(source)
    nodes = [n.value for n in outer.body if isinstance(n, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == BOOTSTRAP_NAME for t in n.targets)
             and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)]
    if len(nodes) != 1:
        raise UpgradeError("EMBEDDED_BOOTSTRAP_NOT_UNIQUE")
    bootstrap = nodes[0].value
    inner = parse(bootstrap)
    matches = []
    for node in ast.walk(inner):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value in ("newar_business_fields", "newar_business_fields.py", "helpers/newar_business_fields.py"):
                    matches.append(value)
    if len(matches) != 1 or not isinstance(matches[0], ast.Constant) or not isinstance(matches[0].value, str):
        raise UpgradeError("EMBEDDED_HELPER_NOT_UNIQUE")
    current = matches[0].value.encode("utf-8")
    if current == payload:
        return source, False
    if digest(current) not in allowed_old:
        raise UpgradeError("HELPER_VERSION_UNSUPPORTED")
    new_bootstrap = replace_literal(bootstrap, matches[0], payload.decode("utf-8"))
    parse(new_bootstrap)
    updated = replace_literal(source, nodes[0], new_bootstrap)
    parse(updated)
    return updated, True


def prepare(path, payload, embedded=False, allowed_old=None):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
        raise UpgradeError("TARGET_NOT_REGULAR_FILE")
    original = path.read_bytes()
    if embedded:
        bom = b"\xef\xbb\xbf" if original.startswith(b"\xef\xbb\xbf") else b""
        try:
            source = original[len(bom):].decode("utf-8")
        except UnicodeError:
            raise UpgradeError("UNSUPPORTED_SCRIPT_ENCODING") from None
        updated, changed = replace_embedded(source, payload, allowed_old)
        replacement = bom + updated.encode("utf-8")
    else:
        allowed = {OLD_HELPER_SHA256} if allowed_old is None else set(allowed_old)
        changed = original != payload
        if changed and digest(original) not in allowed:
            raise UpgradeError("HELPER_VERSION_UNSUPPORTED")
        replacement = payload
    return {"path": path, "original": original, "replacement": replacement,
            "mode": stat.S_IMODE(path.stat().st_mode), "changed": changed}


def atomic_write(path, data, mode):
    fd, name = tempfile.mkstemp(prefix=".newar-method-fix-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def apply(plans):
    changes = [p for p in plans if p["changed"]]
    # Validate every target and backup before making the first modification.
    for plan in changes:
        if plan["path"].is_symlink() or plan["path"].read_bytes() != plan["original"]:
            raise UpgradeError("TARGET_CHANGED_DURING_UPGRADE")
        backup = plan["path"].with_name(plan["path"].name + ".pre-newar-method-fix.bak")
        if backup.is_symlink() or (backup.exists() and backup.read_bytes() != plan["original"]):
            raise UpgradeError("BACKUP_CONFLICT")
    written = []
    try:
        for plan in changes:
            backup = plan["path"].with_name(plan["path"].name + ".pre-newar-method-fix.bak")
            if not backup.exists():
                fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(plan["original"])
                    handle.flush()
                    os.fsync(handle.fileno())
            os.chmod(backup, 0o600)
            if plan["path"].read_bytes() != plan["original"]:
                raise UpgradeError("TARGET_CHANGED_DURING_UPGRADE")
            atomic_write(plan["path"], plan["replacement"], plan["mode"])
            written.append(plan)
    except Exception:
        for plan in reversed(written):
            atomic_write(plan["path"], plan["original"], plan["mode"])
        raise
    return len(written)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Update the known NEWAR business helper without changing credentials or configuration.")
    parser.add_argument("--script", type=Path, help="Existing single-file script containing the embedded bootstrap")
    parser.add_argument("--helpers-dir", type=Path, help="Existing helpers directory containing newar_business_fields.py")
    parser.add_argument("--apply", action="store_true", help="Apply the checked patch; default only checks")
    args = parser.parse_args(argv)
    if not args.script and not args.helpers_dir:
        parser.error("Specify --script and/or --helpers-dir; no computer paths are guessed.")
    try:
        payload = Path(__file__).with_name("newar_business_fields.py").read_bytes()
        if digest(payload) != NEW_HELPER_SHA256:
            raise UpgradeError("UPGRADE_PAYLOAD_INVALID")
        plans = []
        if args.script:
            plans.append(prepare(args.script, payload, embedded=True))
        if args.helpers_dir:
            plans.append(prepare(args.helpers_dir / "newar_business_fields.py", payload))
        count = apply(plans) if args.apply else sum(p["changed"] for p in plans)
        print(("UPGRADE_APPLIED" if args.apply else "UPGRADE_CHECKED") + " targets=" + str(count))
        print("Credentials/configuration preserved. Restart with the original command to load the new helper; no collection or login was started.")
        return 0
    except UpgradeError as error:
        print(str(error), file=sys.stderr)
    except OSError:
        print("FILE_ACCESS_FAILED", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
