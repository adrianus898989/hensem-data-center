"""Read only three pure time functions via AST; never import the collector.

Run under both Python 3.9 and the current Python. All times are synthetic.
"""
import ast
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = Path(os.environ.get('LG_REFRESH_DELIVERY', str(ROOT.parent / 'deliveries/lg-business-notes-v8.3-candidate-20261012/lgwithdraw_to_sheet.py')))


class SyncError(RuntimeError):
    pass


def pure_functions(path):
    tree = ast.parse(path.read_text(encoding='utf-8'))
    names = {'lgd_string', 'lgd_parse_time', 'ack_time'}
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    if len(nodes) != len(names) or {node.name for node in nodes} != names:
        raise AssertionError('Required pure time functions changed')
    # Python 3.9 cannot evaluate a datetime | None annotation. Removing only
    # annotations leaves the actual function bodies intact for this test.
    for node in nodes:
        node.returns = None
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
            arg.annotation = None
    env = {'re': re, 'datetime': datetime, 'timedelta': timedelta,
           'Decimal': Decimal, 'InvalidOperation': InvalidOperation,
           'lgd_UTC': timezone.utc, 'lgd_SyncError': SyncError}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<pure-time-functions-only>', 'exec'), env)
    return env, tree


class AckTimeCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env, cls.tree = pure_functions(DELIVERY)

    def parse(self, value, whole=True):
        return self.env['ack_time'](value, whole=whole)

    def test_postgres_fraction_lengths_preserve_the_exact_utc_instant(self):
        for fraction in ['1', '12', '123', '1234', '12345', '123456', '123450', '00120']:
            for suffix in ['Z', '+00:00']:
                with self.subTest(digits=len(fraction), suffix=suffix):
                    result = self.parse('2026-10-12T14:01:02.' + fraction + suffix, whole=False)
                    expected = datetime(2026, 10, 12, 14, 1, 2, int(fraction.ljust(6, '0')), tzinfo=timezone.utc)
                    self.assertEqual(result, expected)

    def test_whole_second_cursor_accepts_only_zero_fraction(self):
        for suffix in ['Z', '+00:00']:
            self.assertEqual(self.parse('2026-10-12T14:01:02' + suffix), datetime(2026, 10, 12, 14, 1, 2, tzinfo=timezone.utc))
            for length in range(1, 7):
                self.assertEqual(self.parse('2026-10-12T14:01:02.' + '0' * length + suffix).microsecond, 0)
                with self.assertRaisesRegex(SyncError, '^LG_WINDOW_INVALID_ACK_TIME$'):
                    self.parse('2026-10-12T14:01:02.' + '0' * (length - 1) + '1' + suffix)

    def test_invalid_format_date_offset_and_excess_precision_still_reject(self):
        invalid = [None, 123, '', '2026-10-12 14:01:02Z', '2026-10-12T14:01:02',
                   '2026-10-12T14:01:02+08:00', '2026-10-12T14:01:02+0000',
                   '2026-10-12T14:01:02.1234567Z', '2026-10-12T14:01:02.Z',
                   '2026-10-12T14:01:02,123Z', '2026-02-30T14:01:02.12Z',
                   '2026-10-12T24:01:02.12Z', '2026-10-12T14:01:60Z',
                   ' 2026-10-12T14:01:02.12Z', '2026-10-12T14:01:02.12Z\n']
        for value in invalid:
            for whole in [True, False]:
                with self.subTest(case=invalid.index(value), whole=whole):
                    with self.assertRaisesRegex(SyncError, '^LG_WINDOW_INVALID_ACK_TIME$'):
                        self.parse(value, whole=whole)

    def test_expired_synthetic_lease_is_parsed_not_changed_to_the_current_time(self):
        parsed = self.parse('2020-01-02T03:04:05.12Z', whole=False)
        self.assertEqual(parsed, datetime(2020, 1, 2, 3, 4, 5, 120000, tzinfo=timezone.utc))
        self.assertLess(parsed, datetime(2026, 10, 12, tzinfo=timezone.utc))

    def test_generic_order_parser_and_string_function_are_not_modified(self):
        original = ast.parse((ROOT / 'collectors/lg-business-notes-upgrade/lg_withdraw_to_sheet.py').read_text(encoding='utf-8'))
        for name in ['lgd_parse_time', 'lgd_string']:
            old = next(node for node in original.body if isinstance(node, ast.FunctionDef) and node.name == name)
            new = next(node for node in ast.parse(DELIVERY.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef) and node.name == name)
            self.assertEqual(ast.dump(old, include_attributes=False), ast.dump(new, include_attributes=False), name)


if __name__ == '__main__':
    unittest.main()
