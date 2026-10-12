"""Build the one-file LG delivery from the user's unchanged private original.

The original contains an upload credential. It is never copied into Git or
printed. Only the explicitly selected local delivery retains that credential.
This builder parses source; it never imports or executes the collector.
"""
import argparse
import ast
import hashlib
from pathlib import Path

BASELINE_SHA256 = '67a922a1b2bdba77be7b31275a3fa78d53812d30d2a580e6d67e7e424a05e782'


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('LG_BUILD_BASELINE_SHAPE_CHANGED')
    return source.replace(old, new, 1)


def build(source):
    if hashlib.sha256(source.encode('utf-8')).hexdigest() != BASELINE_SHA256:
        raise ValueError('LG_BUILD_BASELINE_HASH_MISMATCH')
    tree = ast.parse(source)
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'lgd_sanitize_raw')
    lines = source.splitlines(keepends=True)
    original = ''.join(lines[node.lineno - 1:node.end_lineno])
    legacy = original.replace('def lgd_sanitize_raw(', 'def lgd_legacy_sanitize_raw(', 1)
    helpers = Path(__file__).with_name('business_fields.py.part').read_text(encoding='utf-8')
    source = source.replace(original, legacy + '\n\n' + helpers.rstrip() + '\n', 1)
    source = replace_once(source,
        '    return {"order_no": order_no, "member_id": None,',
        '    order = {"order_no": order_no, "member_id": None,')
    source = replace_once(source,
        '"payment_method": method, "merchant_name": merchant, "raw": lgd_sanitize_raw(row)}',
        '"payment_method": method, "merchant_name": merchant, "raw": lgd_sanitize_raw(row)}\n'
        '    return lgd_finalize_business_order(order, row)')
    source = replace_once(source,
        '    def save_snapshot(self, snapshot: dict, endpoint: str) -> None:\n',
        '    def save_snapshot(self, snapshot: dict, endpoint: str) -> None:\n'
        '        lgd_validate_business_snapshot(snapshot)\n')
    source = replace_once(source,
        '    def upload(self, snapshot: dict) -> dict:\n',
        '    def upload(self, snapshot: dict) -> dict:\n'
        '        lgd_validate_business_snapshot(snapshot)\n')
    source = replace_once(source,
        "        cursor = instant(lease['cursor_at'])\n",
        "        for order in orders:\n"
        "            lgd_validate_business_order(order)\n"
        "        cursor = instant(lease['cursor_at'])\n")
    source = replace_once(source,
        "VERSION = 'LG_RT_R8_1_20261003_PY39_COMPAT'",
        "VERSION = 'LG_RT_R8_2_20261012_BUSINESS_NOTES_PY39'")
    ast.parse(source, feature_version=(3, 9))
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error('Source and output must be different files')
    result = build(args.source.read_text(encoding='utf-8'))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf-8')
    args.output.chmod(0o600)
    print('LG single-file delivery built; private configuration preserved locally.')


if __name__ == '__main__':
    main()
