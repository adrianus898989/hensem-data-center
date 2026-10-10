"""Offline member-field and supported one-file upgrade regressions."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import ast

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("upgrade", ROOT / "collectors/upgrade_ar_member_facts.py")
U = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(U)
FIELDS = ("order_no", "member_id", "amount", "amount_text", "status", "applied_at",
          "completed_at", "operator", "raw_channel", "channel_type", "remark", "manual_remark")


def standalone():
    facts = '{' + ','.join(repr(field) + ': record.get(' + repr(field) + ')' for field in FIELDS) + '}'
    return '''import re
from collections.abc import Mapping
from decimal import Decimal
class ARV1Error(ValueError): pass
FIELDS = ''' + repr(FIELDS) + '''
LIMITS = {}
def normalize_record(record, kind, zone_name, *, v1_compat=False):
    return ''' + facts + '''
def normalize_v1_order(row, kind, timezone):
    result = {field: row.get(field) for field in FIELDS}
    _validate_order(result)
    return result
def _validate_order(row):
    if not isinstance(row, Mapping) or set(row) != set(FIELDS):
        raise ARV1Error("invalid_order_fields")
if __name__ == "__main__":
    pass
'''


def original():
    embedded = '''import re
ROW_FIELDS = ''' + repr(FIELDS) + '''
def normalize_record(record, order_kind):
    row = {field: record.get(field) for field in ROW_FIELDS}
    return row, []
'''
    return 'SYNTHETIC_EXISTING_PASSWORD = "FAKE-LOCAL-ONLY"\n_AR_ORDER_SUPPORT_SOURCE = ' + repr(embedded) + '\n'


class MemberFacts(unittest.TestCase):
    def test_proven_grade_labels_and_numeric_values_preserve_zero(self):
        for source, expected in [("L0", 0), ("L5", 5), ("LV0", 0), ("lv5", 5), (0, 0), (5, 5), ("  5  ", 5)]:
            self.assertEqual(U._ar_member_facts({"会员等级": source, "充值次数": "0"}), {"member_level": expected, "recharge_count": 0})
        self.assertEqual(U._ar_member_facts({"会员等级": "L9999", "充值次数": 999999999}), {"member_level": 9999, "recharge_count": 999999999})

    def test_missing_invalid_and_unverified_aliases_never_infer_zero(self):
        self.assertEqual(U._ar_member_facts({"vipLevel": "L0", "memberLevel": 0, "rechargeCount": 0, "是否首单": "是"}), {"member_level": None, "recharge_count": None})
        for value in [None, "", "—", "-", True, {}, [], -1, 0.0, "1.5", "L-1", "L10000", "1 OR 1=1", "token=secret"]:
            self.assertIsNone(U._ar_member_facts({"会员等级": value})["member_level"])
        for value in [None, "", True, {}, [], -1, 0.0, "1.5", "1000000000", "L0", "secret=private"]:
            self.assertIsNone(U._ar_member_facts({"充值次数": value})["recharge_count"])

    def test_header_formatting_and_conflict_do_not_guess(self):
        self.assertEqual(U._ar_member_facts({"会员\n等级": "L1", "充值次数\ufeff": "012"}), {"member_level": 1, "recharge_count": 12})
        self.assertIsNone(U._ar_member_facts({"会员等级": "L1", "会员 等级": "L2"})["member_level"])

    def test_indian_normalizer_transports_new_fields_and_accepts_queued_old_orders(self):
        updated, changed, profile = U.patch_source(standalone())
        self.assertTrue(changed);self.assertEqual(profile, "indian_standalone")
        ns = {"__name__": "test"};exec(updated, ns)
        row = ns["normalize_record"]({"order_no": "SYNTHETIC", "会员等级": "L5", "充值次数": 0}, "recharge", "Asia/Kolkata")
        payload = ns["normalize_v1_order"](row, "recharge", "Asia/Kolkata")
        self.assertEqual(payload["member_level"], 5);self.assertEqual(payload["recharge_count"], 0)
        ns["_validate_order"]({field: None for field in FIELDS})
        for value in ["0", True, -1, 10000, 1.5]:
            with self.assertRaises(ns["ARV1Error"]):ns["_validate_order"]({**{field: None for field in FIELDS}, "member_level": value})
        self.assertLess(updated.index(U.MARKER), updated.index('if __name__ == "__main__":'))
        self.assertEqual(U.patch_source(updated), (updated, False, profile))

    def test_embedded_original_module_preserves_existing_source_and_whitelisted_fields(self):
        source = original();updated, changed, profile = U.patch_source(source)
        self.assertTrue(changed);self.assertEqual(profile, "embedded_original")
        self.assertIn('SYNTHETIC_EXISTING_PASSWORD = "FAKE-LOCAL-ONLY"', updated)
        ns = {};exec(updated, ns);module = {};exec(ns["_AR_ORDER_SUPPORT_SOURCE"], module)
        row, issues = module["normalize_record"]({"order_no": "SYNTHETIC", "会员等级": "L0", "充值次数": 12, "bankAccount": "DO-NOT-COLLECT"}, "recharge")
        self.assertEqual(row["member_level"], 0);self.assertEqual(row["recharge_count"], 12);self.assertNotIn("bankAccount", row)
        self.assertEqual(U.patch_source(updated), (updated, False, profile))
        missing, _ = module["normalize_record"]({"order_no": "SYNTHETIC"}, "recharge");self.assertIsNone(missing["member_level"])

    def test_unknown_layout_cannot_change_a_file_and_backup_is_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "collector.py";path.write_text('print("unrelated")\n')
            with self.assertRaises(ValueError):U.patch_file(path)
            self.assertEqual(path.read_text(), 'print("unrelated")\n')
            self.assertFalse(path.with_name(path.name + '.member-facts-v1.bak').exists())
            path.write_text(standalone());old = path.read_text();U.patch_file(path)
            backup = path.with_name(path.name + '.member-facts-v1.bak')
            self.assertEqual(backup.read_text(), old);self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600);self.assertFalse(U.patch_file(path)[0])

    def test_new_output_requires_unused_destination_and_does_not_edit_original(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "collector.py";path.write_text(original());old = path.read_text()
            output = Path(folder) / "updated.py";U.patch_file(path, output)
            self.assertEqual(path.read_text(), old);ast.parse(output.read_text())
            with self.assertRaises(ValueError):U.patch_file(path, output)

    def test_symlink_cannot_silently_edit_a_different_collector(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "collector.py";path.write_text(standalone());old = path.read_text()
            alias = Path(folder) / "alias.py";alias.symlink_to(path)
            with self.assertRaises(ValueError):U.patch_file(alias)
            self.assertEqual(path.read_text(), old)
            self.assertFalse(path.with_name(path.name + '.member-facts-v1.bak').exists())


if __name__ == "__main__":
    unittest.main()
