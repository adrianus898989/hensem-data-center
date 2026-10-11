"""Offline classification regression tests; synthetic actors and order IDs only."""
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "collectors" / "newar_business_fields.py"
SPEC = importlib.util.spec_from_file_location("newar_business_fields", MODULE)
business = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(business)

SUBMITTED = 1768003200000  # 2026-01-10T00:00:00.000Z
HANDLED = SUBMITTED + 12500


class WithdrawalClassificationTests(unittest.TestCase):
    def fields(self, raw, dataset="withdraw"):
        return business.build_business_fields(raw, dataset, "INR")

    def test_explicit_system_operator_wins_over_lock_and_last_modifier(self):
        result = self.fields({"operator": "system", "lockOperator": "SyntheticLocker",
                              "lastUpdateMan": "SyntheticModifier", "remark": None})
        self.assertEqual(result["operatorType"], "auto")
        self.assertEqual(result["operatorName"], "system")
        self.assertEqual(result["operatorSourceField"], "operator")

    def test_system_literal_normalization_preserves_native_provenance(self):
        for value in (" System ", "auto", "automatic", "系统", "机器人"):
            with self.subTest(value=value):
                result = self.fields({"operator": value, "lockOperator": "SyntheticLocker"})
                self.assertEqual(result["operatorType"], "auto")
                self.assertEqual(result["operatorSourceField"], "operator")
                self.assertEqual(result["operatorName"], value.strip())

    def test_native_named_operator_keeps_existing_contract_and_wins_over_lock(self):
        result = self.fields({"operator": "SyntheticNamedActor", "lockOperator": "SyntheticLocker"})
        self.assertEqual(result["operatorType"], "manual")
        self.assertEqual(result["operatorName"], "SyntheticNamedActor")
        self.assertEqual(result["operatorSourceField"], "operator")

    def test_lock_or_last_modifier_never_decides_method_even_if_named_system(self):
        for field in ("lockOperator", "lastUpdateMan"):
            for value in ("SyntheticActor", "system"):
                with self.subTest(field=field, value=value):
                    result = self.fields({field: value, "remark": None})
                    self.assertEqual(result["operatorType"], "unknown")
                    self.assertEqual(result["operatorName"], value)
                    self.assertEqual(result["operatorSourceField"], field)

    def test_three_observed_order_structures_do_not_turn_empty_note_into_method(self):
        # These match only the observed field structures, not real actors/IDs.
        cases = (("BankCard", "Pass", 3), ("UPI", "Reject", 2), ("BankCard", "Reject", 2))
        for index, (payment_type, state, third_state) in enumerate(cases):
            raw = {"orderNo": "SyntheticOrder" + str(index), "lockOperator": "SyntheticLocker",
                   "lastUpdateMan": "SyntheticLocker", "withdrawType": payment_type,
                   "withdrawState": state, "thirdState": third_state, "remark": None,
                   "submittedTime": SUBMITTED, "lastUpdateTime": HANDLED}
            with self.subTest(index=index):
                result = self.fields(raw)
                self.assertEqual(result["operatorType"], "unknown")
                self.assertIsNone(result["automaticReasonLabel"])
                self.assertEqual(result["automaticReasonSource"], "remark")
                self.assertEqual(result["sourceSubmittedAt"], "2026-01-10T00:00:00.000Z")
                self.assertEqual(result["sourceSubmittedSourceField"], "submittedTime")
                self.assertIsNone(result["sourceHandledAt"])
                self.assertIsNone(result["sourceHandledSourceField"])
                raw["operator"] = "system"
                explicit = self.fields(raw)
                self.assertEqual(explicit["operatorType"], "auto")
                self.assertEqual(explicit["operatorSourceField"], "operator")

    def test_missing_empty_and_present_note_do_not_change_classification(self):
        for note in (None, "", "Synthetic business reason"):
            with self.subTest(note=note):
                raw = {"lockOperator": "SyntheticLocker", "remark": note}
                self.assertEqual(self.fields(raw)["operatorType"], "unknown")
                raw["operator"] = "system"
                self.assertEqual(self.fields(raw)["operatorType"], "auto")

    def test_generic_audit_event_keeps_actor_provenance_without_method_inference(self):
        result = self.fields({"auditLogs": [{"time": SUBMITTED, "operator": "system", "status": "Reviewed"}]})
        self.assertEqual(result["operatorType"], "unknown")
        self.assertEqual(result["operatorSourceField"], "auditLogs[0].operator")
        self.assertEqual(result["lastEventSource"], "auditLogs[0].time")
        self.assertEqual(result["lastEventOperator"], "system")

    def test_unsafe_operator_does_not_become_a_method_fact(self):
        for value in (False, {"name": "system"}, "password=fixture", "https://example.test/operator"):
            with self.subTest(kind=type(value).__name__):
                result = self.fields({"operator": value, "lockOperator": "SyntheticLocker"})
                self.assertEqual(result["operatorType"], "unknown")
                self.assertEqual(result["operatorSourceField"], "lockOperator")

    def test_submitted_time_is_preserved_without_handled_time(self):
        result = self.fields({"submittedTime": SUBMITTED})
        self.assertEqual(result["sourceSubmittedAt"], "2026-01-10T00:00:00.000Z")
        self.assertEqual(result["sourceSubmittedSourceField"], "submittedTime")
        self.assertIsNone(result["sourceHandledAt"])
        self.assertIsNone(result["sourceHandledSourceField"])

    def test_handled_time_is_preserved_without_submitted_time(self):
        for field in ("handledTime", "handleTime", "processedTime"):
            with self.subTest(field=field):
                result = self.fields({field: HANDLED})
                self.assertEqual(result["sourceHandledAt"], "2026-01-10T00:00:12.500Z")
                self.assertEqual(result["sourceHandledSourceField"], field)
                self.assertIsNone(result["sourceSubmittedAt"])
                self.assertIsNone(result["sourceSubmittedSourceField"])

    def test_paired_times_keep_their_distinct_native_source_fields(self):
        result = self.fields({"submittedTime": SUBMITTED, "handleTime": HANDLED})
        self.assertEqual(result["sourceSubmittedSourceField"], "submittedTime")
        self.assertEqual(result["sourceHandledSourceField"], "handleTime")
        self.assertEqual(result["sourceHandledAt"], "2026-01-10T00:00:12.500Z")

    def test_last_update_time_is_not_payout_completion(self):
        result = self.fields({"submittedTime": SUBMITTED, "lastUpdateTime": HANDLED, "thirdState": 3})
        self.assertIsNone(result["sourceHandledAt"])
        self.assertIsNone(result["sourcePaidAt"])
        self.assertIsNone(result["sourceOperatedAt"])

    def test_other_datasets_keep_the_existing_actor_contract(self):
        work = self.fields({"lastUpdateMan": "SyntheticStaff", "operator": "system"}, "workorder")
        self.assertEqual(work["operatorType"], "manual")
        self.assertEqual(work["operatorSourceField"], "lastUpdateMan")
        charge = self.fields({"lockOperator": "SyntheticStaff", "operator": "system"}, "charge")
        self.assertEqual(charge["operatorType"], "manual")
        self.assertEqual(charge["operatorSourceField"], "lockOperator")

    def test_money_and_two_note_sources_are_preserved(self):
        result = self.fields({"operator": "system", "thirdState": 3, "amount": "100.5000",
                              "actualAmount": "99.5", "remark": "Synthetic gate reason",
                              "userRemark": "Synthetic member note"})
        self.assertEqual(result["requestedAmount"], "100.5")
        self.assertEqual(result["paidAmount"], "99.5")
        self.assertEqual(result["automaticReasonSource"], "remark")
        self.assertEqual(result["memberNoteSource"], "userRemark")
        self.assertNotEqual(result["automaticReasonLabel"], result["memberNoteLabel"])


if __name__ == "__main__":
    unittest.main()
