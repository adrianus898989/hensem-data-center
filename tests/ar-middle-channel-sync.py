#!/usr/bin/env python3
"""Offline invariants for the read-only AR middle channel collector."""
import contextlib
from decimal import Decimal
import importlib.util
import io
import json
import logging
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SOURCE_FILE = Path(__file__).resolve().parents[1] / "collectors" / "ar_middle_channel_sync.py"
SPEC = importlib.util.spec_from_file_location("ar_middle_channels", SOURCE_FILE)
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)


def row(identifier, tenant="1102", **fields):
    result = {"id": identifier, "tenantId": int(tenant), "customName": "Example Pay", "state": 1,
              "channelState": 0, "merchantState": 1, "sysCurrency": "INR",
              "minAmount": Decimal("100.00000001"), "maxAmount": Decimal("50000.00000000"),
              "weight": Decimal("0.125"), "thirdPayFeeRate": Decimal("0.015"),
              "thirdPayFeeAmount": Decimal("2.00"), "channelCategory": {"categoryId": 100710, "categoryName": "UPI"},
              "sysChannel": {"sysChannelId": 88, "thirdPayApiUrl": "https://private-gateway.invalid", "notifyWhiteIpList": "192.0.2.7"},
              "thirdPayMerchantId": 150, "lastUpdateTime": 1791533239385,
              "successRateInfo": "", "merchantCode": "do-not-persist-this-secret",
              "remark": "normal business note"}
    result.update(fields)
    return result


def page(order_type, number, total, rows, page_size=2, pages=None):
    if order_type == "deposit":
        entries = [] if not rows else [{"categoryId": 100710, "customName": "UPI", "channels": rows}]
    else:
        entries = rows
    return {"code": 0, "msg": "Succeed", "data": {"pageNo": number, "totalCount": total,
            "totalPage": pages if pages is not None else (total + page_size - 1) // page_size, "list": entries}}


class SequenceSource:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def fetch(self, direction, payload):
        self.calls.append((direction, payload["pageNo"], payload["tenantId"]))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class NormalizationTests(unittest.TestCase):
    def test_signature_excludes_timestamp_and_signature_known_vector(self):
        self.assertEqual(C.source_signature({"b": 2, "a": 1, "timestamp": 1791500000, "signature": "ignore"}),
                         "608DE49A4600DBB5B173492759792E4A")
        payload = C.request_payload("1102", 1, 20)
        self.assertIs(type(payload["random"]), int)
        self.assertTrue(100_000_000_000 <= payload["random"] < 1_000_000_000_000)

    def test_native_identity_decimal_and_privacy(self):
        raw = row(303619, payCode="ArbPayINR", thirdBalance=Decimal("-0.01"), remark="normal note account=12345678 token=secretvalue admin@example.com https://secret.invalid 192.0.2.7")
        normalized = C.normalize_record(raw, "1102", 0)
        self.assertEqual(normalized["channel_id"], "303619")
        self.assertEqual(normalized["sys_channel_id"], "88")
        self.assertEqual(normalized["min_amount"], "100.00000001")
        self.assertEqual(normalized["weight"], "0.125")
        self.assertEqual(normalized["balance"], "-0.01")
        self.assertEqual(normalized["fee_rate"], "0.015")
        self.assertEqual(normalized["fee_rate_basis"], "source_raw")
        self.assertEqual(normalized["source_updated_at"], "2026-10-09T08:07:19.385Z")
        text = json.dumps(normalized)
        for private in ("merchantCode", "do-not-persist-this-secret", "private-gateway", "192.0.2.7", "12345678", "secretvalue", "admin@example.com"):
            self.assertNotIn(private, text)
        self.assertIn("normal note", normalized["notes"])
        self.assertIs(normalized["enabled"], True)
        self.assertEqual(normalized["provider"], "ArbPayINR")
        self.assertEqual(normalized["payment_method"], "UPI")
        self.assertEqual(normalized["source_state"], "1")
        self.assertEqual(normalized["source_channel_state"], "0")

    def test_core_native_ids_stay_positive_and_decimal_ids_are_exact(self):
        for value, expected in ((Decimal("303619.000"), "303619"),
                                (Decimal("3000000000000000001.0"), "3000000000000000001"),
                                (Decimal("1E+3"), "1000")):
            with self.subTest(value=value):
                self.assertEqual(C.native_id(value), expected)
        for value in (0, "0", Decimal("0"), Decimal("-0.00"), -1, Decimal("1.01"),
                      Decimal("NaN"), Decimal("Infinity"), Decimal("10000000000000000000"), 1.0, True, False, None, "", "1.5", "invalid"):
            with self.subTest(value=value), self.assertRaises(C.SyncError):
                C.native_id(value)
        normalized = C.normalize_record(row(Decimal("3000000000000000001.0"),
                                            tenantId=Decimal("1102.000")), "1102", 0)
        self.assertEqual(normalized["channel_id"], "3000000000000000001")

    def test_metadata_ids_preserve_zero_without_relaxing_invalid_values(self):
        for value in (0, "0", Decimal("0.000"), Decimal("-0.000")):
            with self.subTest(value=value):
                self.assertEqual(C.metadata_id(value), "0")
        self.assertEqual(C.metadata_id(Decimal("3000000000000000001.000")), "3000000000000000001")
        for value in (None, "", "invalid", -1, "-1", Decimal("-1"), Decimal("0.25"),
                      Decimal("NaN"), Decimal("Infinity"), 0.0, 1.0, True, False):
            with self.subTest(value=value), self.assertRaises(C.SyncError):
                C.metadata_id(value)

    def test_zero_category_sys_and_merchant_metadata_survive_normalization(self):
        normalized = C.normalize_record(row(1, channelCategory={"categoryId": 0, "categoryName": "Uncategorized"},
                                             categories=[{"tenantCategoryId": Decimal("0.0"), "categoryId": 0,
                                                          "customName": "Uncategorized", "sort": 0}],
                                             sysChannel={"sysChannelId": Decimal("0.00")},
                                             thirdPayMerchantId=0), "1102", 0, {"categoryId": 0})
        self.assertEqual(normalized["channel_id"], "1")
        self.assertEqual(normalized["category_id"], "0")
        self.assertEqual(normalized["channel_categories"], [
            {"category_id": "0", "category_name": "Uncategorized", "sort": 0}])
        self.assertEqual(normalized["sys_channel_id"], "0")
        self.assertEqual(normalized["third_pay_merchant_id"], "0")
        fallback = C.normalize_record(row(1, channelCategory={"categoryId": 0}, categories=None), "1102", 0)
        self.assertEqual(fallback["channel_categories"], [{"category_id": "0", "category_name": None, "sort": None}])
        with self.assertRaisesRegex(C.SyncError, "SOURCE_CATEGORY_MISMATCH"):
            C.normalize_record(row(1, channelCategory={"categoryId": 0}), "1102", 0, {"categoryId": 100710})

    def test_invalid_identity_errors_identify_the_field_without_leaking_values(self):
        cases = [(row(0), "SOURCE_CHANNEL_ID_INVALID"),
                 (row(1, tenantId=0), "SOURCE_TENANT_ID_INVALID"),
                 (row(1, channelCategory={"categoryId": "invalid-private-id"}), "SOURCE_CATEGORY_ID_INVALID"),
                 (row(1, categories=[{"tenantCategoryId": "invalid-private-id"}]), "SOURCE_CATEGORY_ID_INVALID"),
                 (row(1, sysChannel={"sysChannelId": "invalid-private-id"}), "SOURCE_SYS_CHANNEL_ID_INVALID"),
                 (row(1, thirdPayMerchantId="invalid-private-id"), "SOURCE_MERCHANT_ID_INVALID")]
        for raw, code in cases:
            with self.subTest(code=code), self.assertRaises(C.SyncError) as caught:
                C.normalize_record(raw, "1102", 0)
            self.assertEqual(str(caught.exception), code)
            self.assertNotIn("invalid-private-id", str(caught.exception))

    def test_rates_have_actual_windows_and_percent_units(self):
        rates = C.success_rates('{"recent15Minutes":0.95,"recent30Minutes":0.875,"recent1Hour":1,"recent24Hours":0}')
        self.assertEqual(Decimal(rates["success_rate_15m"]), Decimal("95"))
        self.assertEqual(Decimal(rates["success_rate_30m"]), Decimal("87.5"))
        self.assertEqual(Decimal(rates["success_rate_1h"]), Decimal("100"))
        self.assertEqual(Decimal(rates["success_rate_24h"]), Decimal("0"))
        self.assertNotIn("success_rate_10m", rates)
        for bad in ('{"recent30Minutes":90}', '{"10m":0.8}', '99%', '{"15m":-0.1}', '{"15m":true}'):
            with self.subTest(bad=bad): self.assertTrue(all(v is None for v in C.success_rates(bad).values()))
        self.assertEqual(C.success_rates('{"recent30Minutes":0.587,"notKnown":12}')["success_rate_30m"], "58.7")

    def test_withdrawal_metadata_preserves_source_counts_codes_and_dictionary_names(self):
        dynamic = {"code": 0, "data": {
            "sysPayChannelList": [{"sysChannelId": 88, "sysChannelName": "Native withdrawal", "inOutType": "Withdraw"},
                                  {"sysChannelId": 88, "sysChannelName": "Native deposit", "inOutType": "Recharge"}],
            "thirdPayMerchantList": [{"merchantId": 150, "customName": "Merchant nickname"}],
            "tenantList": [{"tenantId": 1102, "tenantName": "Native tenant"}]}}
        dictionaries = C.parse_dynamic_dictionary(dynamic)
        dictionaries.update(C.parse_common_dictionary({"code": 0, "data": {
            "withdrawCategoryEnumList": [{"id": 12, "name": "Built-in UPI"}]}}))
        raw = row(1, payCode="Provider code", merchantCode="1234567890" * 6 + "1234",
                  balanceUpdateTime=Decimal("1791533239385.0"), todaySubmitCount=0, recent1HourSuccessCount=197,
                  thirdChannelCode="channel-01", autoCloseBalance=Decimal("20000.0000"),
                  sysChannel={"sysChannelId": 88, "sysCategoryId": 12, "isUseChannelCode": True,
                              "isFixedChannelCode": False, "thirdPayApiUrl": "https://GATEWAY.invalid/payout?token=private#private",
                              "notifyWhiteIpList": "192.0.2.7, 2001:db8::1,192.0.2.7,198.51.100.7/24"},
                  lastUpdateMan="Native operator")
        result = C.normalize_record(raw, "1102", 0, order_type="withdrawal", dictionaries=dictionaries)
        self.assertEqual(result["source_channel_name"], "Native withdrawal")
        self.assertEqual(result["provider"], "Provider code")
        self.assertEqual(result["balance_threshold"], "20000")
        self.assertEqual(result["category_id"], "100710")
        self.assertEqual(result["withdrawal_details"], {
            "source_tenant_name": "Native tenant", "balance_updated_at": "2026-10-09T08:07:19.385Z",
            "today_submit_count": 0, "recent_1h_success_count": 197,
            "merchant_code": "1234567890" * 6 + "1234", "merchant_name": "Merchant nickname",
            "third_channel_code": "channel-01", "is_use_channel_code": True, "is_fixed_channel_code": False,
            "system_category_id": "12", "system_category_name": "Built-in UPI",
            "third_pay_api_url": "https://gateway.invalid/payout",
            "notify_white_ips": ["192.0.2.7", "2001:db8::1", "198.51.100.0/24"],
            "last_update_by": "Native operator", "last_updated_at": "2026-10-09T08:07:19.385Z"})
        self.assertNotIn("private", json.dumps(result))

    def test_withdrawal_unknowns_do_not_invent_names_codes_counts_or_times(self):
        result = C.normalize_record(row(1, merchantCode="", merchantCustomName="", balanceUpdateTime=-1,
                                        todaySubmitCount=-1, recent1HourSuccessCount=Decimal("1.5"),
                                        lastUpdateMan="token=private", sysChannel={"sysChannelId": 88}),
                                    "1102", 0, order_type="withdrawal")
        details = result["withdrawal_details"]
        self.assertEqual(len(details), 15)
        self.assertIsNone(result["source_channel_name"])
        self.assertIsNone(result["provider"])
        for key in details:
            if key != "last_updated_at":
                self.assertIsNone(details[key], key)
        self.assertEqual(details["last_updated_at"], "2026-10-09T08:07:19.385Z")
        self.assertEqual(result["source_updated_at"], "2026-10-09T08:07:19.385Z")
        named = C.normalize_record(row(1, merchantCustomName="Merchant only"), "1102", 0, order_type="withdrawal")
        self.assertEqual(named["withdrawal_details"]["merchant_name"], "Merchant only")
        self.assertIsNone(named["provider"])

    def test_withdrawal_display_metadata_filters_credentials_without_dropping_ordinary_ids(self):
        for identifier in ("0", "f" * 64, "merchant-1234", "a25fbd88-7229-4b4b-a239-122ab5303344", 0):
            self.assertEqual(C.optional_display_text(identifier), str(identifier))
        for value in ("Bearer private", "token=private", "password:private", "api_key=private", "passwd：private", "密码：private", "密钥=private", "https://secret.invalid", "<script>private</script>", "private\x00", "private\x7f"):
            with self.subTest(value=value):
                self.assertIsNone(C.optional_display_text(value))
        self.assertEqual(C.display_gateway_url("http://gateway.invalid:8080/pay?auth=private#private"), "http://gateway.invalid:8080/pay")
        for value in ("https://user:private@gateway.invalid/pay", "https://gateway.invalid/token/private", "https://gateway.invalid/pay%3Ftoken%3Dprivate", "https://gateway.invalid/<private>", "javascript:private", "https://gateway.invalid:bad/pay", "https://gateway.invalid/path with space", "https://gateway.invalid/pay%xx", "https://gateway.invalid/passwd/private", "https://gateway.invalid/pay%253Ftoken%253Dprivate"):
            with self.subTest(value=value):
                self.assertIsNone(C.display_gateway_url(value))
        self.assertEqual(C.display_white_ips("192.0.2.1,192.0.2.1;2001:0db8::1"), ["192.0.2.1", "2001:db8::1"])
        self.assertEqual(C.display_white_ips(""), [])
        for value in ("192.0.2.1,token=private", "https://secret.invalid", "999.0.2.1", ["192.0.2.1", False]):
            self.assertIsNone(C.display_white_ips(value))

    def test_realtime_weight_is_deposit_only_and_never_falls_back_to_preset(self):
        for value, expected in ((Decimal("82.810000"), "82.81"), (0, "0"), (None, None)):
            result = C.normalize_record(row(1, weight=100, realTimeWeight=value), "1102", 0, order_type="deposit")
            self.assertEqual(result["weight"], "100")
            self.assertEqual(result["real_time_weight"], expected)
            self.assertNotIn("withdrawal_details", result)
        self.assertIsNone(C.normalize_record(row(1, weight=100), "1102", 0, order_type="deposit")["real_time_weight"])
        self.assertNotIn("real_time_weight", C.normalize_record(row(1, realTimeWeight=83), "1102", 0, order_type="withdrawal"))
        self.assertNotIn("withdrawal_details", C.normalize_record(row(1), "1102", 0))

    def test_decimal_canonical_output_removes_only_insignificant_zeros(self):
        examples = {"100.0000000000": "100", "123.4500000000": "123.45",
                    "0.123456780000": "0.12345678", "1.000000010000": "1.00000001",
                    "0": "0", "0.0000000000": "0", "-0": "0", "-0.0000000000": "0"}
        for value, expected in examples.items():
            with self.subTest(value=value):
                self.assertEqual(C.decimal_text(Decimal(value)), expected)
                self.assertEqual(C.decimal_text(value, signed=True), expected)
        self.assertEqual(C.decimal_text("-123.4500000000", signed=True), "-123.45")
        for value in ("0.123456789", "100.000000001", "0.000000001", "-0.000000001"):
            with self.subTest(value=value), self.assertRaisesRegex(C.SyncError, "SOURCE_DECIMAL_PRECISION"):
                C.decimal_text(value, signed=True)

    def test_all_normalized_decimal_fields_use_canonical_strings(self):
        normalized = C.normalize_record(row(303619, minAmount=Decimal("100.0000000000"),
                                             maxAmount=Decimal("50000.1250000000"), thirdBalance=Decimal("-0.0000000000"),
                                             autoCloseBalance=Decimal("123.4500000000"), thirdPayFeeRate=Decimal("0.0150000000"),
                                             thirdPayFeeAmount=Decimal("2.0000000000"), weight=Decimal("0.1250000000"),
                                             recent15MinutesCount=Decimal("0.50000000")), "1102", 0)
        self.assertEqual({field: normalized[field] for field in ("min_amount", "max_amount", "balance", "balance_threshold", "fee_rate", "fee_amount", "weight", "success_rate_15m")},
                         {"min_amount": "100", "max_amount": "50000.125", "balance": "0", "balance_threshold": "123.45",
                          "fee_rate": "0.015", "fee_amount": "2", "weight": "0.125", "success_rate_15m": "50"})

    def test_native_rate_count_fields_are_ratios_even_when_info_is_text(self):
        rates = C.success_rates_from_row({"recent15MinutesCount": Decimal("0.587"), "recent30MinutesCount": Decimal("0.638"),
                                         "recent1HourCount": 1, "recent24HoursCount": 0,
                                         "successRateInfo": "近10分钟：58.7%; 近30分钟：63.8%"})
        self.assertEqual(Decimal(rates["success_rate_15m"]), Decimal("58.7"))
        self.assertEqual(Decimal(rates["success_rate_30m"]), Decimal("63.8"))
        self.assertEqual(Decimal(rates["success_rate_1h"]), Decimal("100"))
        self.assertEqual(Decimal(rates["success_rate_24h"]), Decimal("0"))
        self.assertNotIn("success_rate_10m", rates)

    def test_mismatched_tenant_or_category_is_not_renamed(self):
        with self.assertRaisesRegex(C.SyncError, "SOURCE_TENANT_MISMATCH"):
            C.normalize_record(row(1, tenant="1013"), "1102", 0)
        with self.assertRaisesRegex(C.SyncError, "SOURCE_CATEGORY_MISMATCH"):
            C.normalize_record(row(1), "1102", 0, {"categoryId": 99})

    def test_all_native_category_names_survive_without_urls_or_system_ids(self):
        normalized = C.normalize_record(row(1, categories=[
            {"tenantCategoryId": 100710, "customName": "UPI", "sort": 22, "sysCategoryId": 1, "iconUrl": "https://unneeded-icon.invalid"},
            {"tenantCategoryId": 100718, "customName": "Innate UPI-QR", "sort": 0, "merchantUrl": "https://private-merchant.invalid"},
        ]), "1102", 0, {"categoryId": 100710, "customName": "UPI"})
        self.assertEqual(normalized["category_id"], "100710")
        self.assertEqual(normalized["category_name"], "UPI")
        self.assertEqual(normalized["channel_categories"], [
            {"category_id": "100710", "category_name": "UPI", "sort": 22},
            {"category_id": "100718", "category_name": "Innate UPI-QR", "sort": 0},
        ])
        stored = json.dumps(normalized["channel_categories"])
        for excluded in ("iconUrl", "merchantUrl", "sysCategoryId", "https://"):
            self.assertNotIn(excluded, stored)

    def test_withdraw_without_categories_falls_back_to_its_own_category(self):
        normalized = C.normalize_record(row(1, categories=None), "1102", 0)
        self.assertEqual(normalized["channel_categories"], [{"category_id": "100710", "category_name": "UPI", "sort": None}])
        with self.assertRaises(C.SyncError):
            C.normalize_record(row(1, categories=[{"sysCategoryId": 1, "customName": "not a tenant category"}]), "1102", 0)
        with self.assertRaisesRegex(C.SyncError, "SOURCE_CATEGORY_ID_CONFLICT"):
            C.normalize_record(row(1, categories=[{"tenantCategoryId": 100710, "categoryId": 100718}]), "1102", 0)

    def test_signed_category_sort_and_optional_category_name_privacy(self):
        normalized = C.normalize_record(row(1, categories=[
            {"tenantCategoryId": 100710, "customName": "UPI", "sort": -1},
            {"tenantCategoryId": 100718, "customName": "token=private-value", "sort": 0},
        ]), "1102", 0)
        self.assertEqual(normalized["channel_categories"], [
            {"category_id": "100710", "category_name": "UPI", "sort": -1},
            {"category_id": "100718", "category_name": None, "sort": 0},
        ])
        for value in ("https://private.invalid", "javascript:alert(1)", "data:text/html,private", "<b>UPI</b>", "password=private", "Bearer private", "name\nsecret"):
            with self.subTest(value=value): self.assertIsNone(C.optional_metadata_name(value))
        with self.assertRaises(C.SyncError):
            C.normalize_record(row(1, categories=[{"tenantCategoryId": 100710, "sort": -2147483649}]), "1102", 0)

    def test_original_system_name_is_explicit_and_never_custom_or_provider(self):
        self.assertIsNone(C.normalize_record(row(1, payCode="ProviderINR"), "1102", 0)["source_channel_name"])
        for key in ("name", "channelName", "sysChannelName"):
            with self.subTest(key=key):
                normalized = C.normalize_record(row(1, sysChannel={"sysChannelId": 88, key: "System QR"}), "1102", 0)
                self.assertEqual(normalized["source_channel_name"], "System QR")
                self.assertEqual(normalized["channel_name"], "Example Pay")
        self.assertIsNone(C.source_channel_name({"customName": "Unconfirmed label", "thirdChannelCode": "Not a name"}))
        self.assertIsNone(C.source_channel_name({"name": "One name", "channelName": "Different name"}))
        self.assertIsNone(C.source_channel_name({"name": "https://private-system.invalid"}))
        self.assertIsNone(C.source_channel_name({"name": "password=private"}))


class DictionaryTests(unittest.TestCase):
    def test_native_dictionary_shapes_filter_direction_and_conflicting_or_private_labels(self):
        response = {"code": 0, "data": {"items": {
            "SysPayChannelList": [
                {"sysChannelId": Decimal("88.000"), "sysChannelName": "Withdraw system", "inOutType": "Withdraw", "password": "never persisted"},
                {"sysChannelId": 88, "sysChannelName": "Recharge system", "inOutType": "Recharge"},
                {"sysChannelId": 89, "sysChannelName": "First", "inOutType": "Withdraw"},
                {"sysChannelId": 89, "sysChannelName": "Conflicting", "inOutType": "Withdraw"},
                {"sysChannelId": 89, "sysChannelName": "First", "inOutType": "Withdraw"}],
            "thirdPayMerchantList": [{"merchantId": 0, "customName": "Zero merchant"}, {"merchantId": 1, "customName": "密码：private"}],
            "tenantList": [{"tenantId": 1102, "tenantName": "Native tenant"}, {"tenantId": 1013, "tenantName": "https://private.invalid"}]}}}
        result = C.parse_dynamic_dictionary(response)
        self.assertEqual(result, {"system_channel_names": {"deposit": {"88": "Recharge system"}, "withdrawal": {"88": "Withdraw system"}},
                                  "merchant_names": {"0": "Zero merchant"}, "tenant_names": {"1102": "Native tenant"}})
        self.assertNotIn("private", json.dumps(result))
        for bad in ({"code": 1, "data": {}}, {"code": True, "data": {}}, {"code": 0, "data": []}):
            with self.assertRaisesRegex(C.SyncError, "SOURCE_DICTIONARY_UNAVAILABLE"):
                C.parse_dynamic_dictionary(bad)

    def test_cycle_reads_each_fixed_dictionary_once_and_later_failure_discards_names(self):
        source, logger = C.Source({}), mock.Mock()
        dynamic = {"code": 0, "data": {"tenantList": [{"tenantId": 1102, "tenantName": "Current tenant"}]}}
        common = {"code": 0, "data": {"withdrawCategoryEnumList": [{"id": 1, "name": "Current category"}]}}
        with mock.patch.object(source, "fetch_readonly_path", side_effect=[dynamic, common, C.SyncError("private failure"), OSError("private failure")]) as fetch:
            source.refresh_dictionaries(logger)
            self.assertEqual(source.dictionaries["tenant_names"], {"1102": "Current tenant"})
            self.assertEqual(source.dictionaries["system_category_names"], {"1": "Current category"})
            source.refresh_dictionaries(logger)
        self.assertEqual(source.dictionaries, {})
        self.assertEqual([call.args[0] for call in fetch.call_args_list], [C.DICTIONARY_PATHS["dynamic"], C.DICTIONARY_PATHS["common"]] * 2)
        for call in fetch.call_args_list:
            payload = call.args[1]
            self.assertEqual(payload["signature"], C.source_signature(payload))
            self.assertIs(type(payload["random"]), int)
        self.assertEqual(fetch.call_args_list[0].args[1]["keys"], list(C.DYNAMIC_DICTIONARY_KEYS))
        self.assertEqual(set(fetch.call_args_list[1].args[1]), {"random", "language", "timestamp", "signature"})
        self.assertNotIn("private", str(logger.warning.call_args_list))

    def test_run_cycle_refreshes_dictionary_once_for_multiple_tenants(self):
        source, logger = mock.Mock(), mock.Mock()
        snapshot = {"directions": [{"order_type": "withdrawal", "fetched_count": 1}], "captured_at": "2026-10-09T08:00:00Z"}
        config = {"page_size": 300, "targets": [{"enabled": True, "tenant_id": "1102"}, {"enabled": True, "tenant_id": "1013"}]}
        with mock.patch.object(C, "build_snapshot", return_value=snapshot) as build:
            self.assertEqual(C.run_cycle(config, source, mock.Mock(), mock.Mock(), logger, dry_run=True), 0)
        source.refresh_dictionaries.assert_called_once_with(logger)
        self.assertEqual(build.call_count, 2)

    def test_dictionary_allowlist_never_allows_payment_routes_or_unrequested_keys(self):
        source = C.Source({"cdp_url": "http://127.0.0.1:9777"})
        with mock.patch.object(C, "http_json") as request:
            for method in (source.fetch_readonly_path, source.fetch_path_in_browser):
                with self.assertRaisesRegex(C.SyncError, "SOURCE_ROUTE_NOT_ALLOWED"):
                    method("/api/WithdrawChannel/UpdateState", {})
                with self.assertRaisesRegex(C.SyncError, "SOURCE_DICTIONARY_KEYS_NOT_ALLOWED"):
                    method(C.DICTIONARY_PATHS["dynamic"], {"keys": ["userName"]})
            request.assert_not_called()
        with self.assertRaisesRegex(C.SyncError, "SOURCE_ROUTE_NOT_ALLOWED"):
            C.dictionary_payload("payment")


class PaginationTests(unittest.TestCase):
    def test_grouped_deposit_counts_channels_and_reconfirms_anchor(self):
        first = page("deposit", 1, 3, [row(1), row(2)])
        source = SequenceSource([first, page("deposit", 2, 3, [row(3)]), first])
        snapshot = C.collect_direction(source, "1102", "deposit", 2)
        self.assertEqual(snapshot["fetched_count"], 3)
        self.assertEqual(snapshot["source_count"], 3)
        self.assertEqual(snapshot["page_count"], 2)
        self.assertEqual([r["channel_id"] for r in snapshot["records"]], ["1", "2", "3"])
        self.assertEqual(source.calls, [("deposit", 1, 1102), ("deposit", 2, 1102), ("deposit", 1, 1102)])

    def test_empty_recharge_groups_ignore_their_category_id_without_losing_channels(self):
        for empty_id in (0, None, ""):
            with self.subTest(empty_id=empty_id):
                first = page("deposit", 1, 3, [row(1), row(2)])
                first["data"]["list"].insert(0, {"categoryId": empty_id, "channels": []})
                second = page("deposit", 2, 3, [row(3)])
                second["data"]["list"].append({"categoryId": empty_id, "channels": []})
                result = C.collect_direction(SequenceSource([first, second, first]), "1102", "deposit", 2)
                self.assertEqual(result["source_count"], 3)
                self.assertEqual(result["fetched_count"], 3)
                self.assertEqual(result["page_count"], 2)
                self.assertEqual([r["channel_id"] for r in result["records"]], ["1", "2", "3"])
                self.assertTrue(result["complete"])
        short = page("deposit", 1, 2, [row(1)])
        short["data"]["list"].append({"categoryId": None, "channels": []})
        with self.assertRaisesRegex(C.SyncError, "SOURCE_PAGE_INCOMPLETE"):
            C.page_rows(short, "deposit", 1, "1102", 2)

    def test_recharge_group_shape_and_nonempty_category_ids_remain_validated(self):
        for channels in (None, {}, "", 0):
            raw = page("deposit", 1, 1, [row(1)])
            raw["data"]["list"].insert(0, {"categoryId": None, "channels": channels})
            with self.subTest(channels=channels), self.assertRaisesRegex(C.SyncError, "SOURCE_RECHARGE_GROUP_INVALID"):
                C.page_rows(raw, "deposit", 1, "1102", 2)
        raw = page("deposit", 1, 1, [row(1, channelCategory={"categoryId": 0})])
        raw["data"]["list"][0]["categoryId"] = 0
        result = C.collect_direction(SequenceSource([raw, raw]), "1102", "deposit", 2)
        self.assertEqual(result["records"][0]["category_id"], "0")
        self.assertEqual(result["fetched_count"], 1)
        missing_outer = page("deposit", 1, 1, [row(1)])
        missing_outer["data"]["list"][0]["categoryId"] = None
        own_result = C.collect_direction(SequenceSource([missing_outer, missing_outer]), "1102", "deposit", 2)
        self.assertEqual(own_result["records"][0]["category_id"], "100710")
        unknown_category = page("deposit", 1, 1, [row(1, channelCategory={})])
        unknown_category["data"]["list"][0].pop("categoryId")
        unknown_result = C.collect_direction(SequenceSource([unknown_category, unknown_category]), "1102", "deposit", 2)
        self.assertIsNone(unknown_result["records"][0]["category_id"])
        self.assertEqual(unknown_result["records"][0]["channel_categories"], [])
        self.assertEqual(unknown_result["source_count"], 1)
        self.assertEqual(unknown_result["records"][0]["channel_id"], "1")
        for value in ("", -1, Decimal("0.5"), True):
            bad = page("deposit", 1, 1, [row(1)])
            bad["data"]["list"][0]["categoryId"] = value
            with self.subTest(value=value), self.assertRaisesRegex(C.SyncError, "SOURCE_CATEGORY_ID_INVALID"):
                C.page_rows(bad, "deposit", 1, "1102", 2)

    def test_page_core_identity_errors_are_specific_and_decimal_integers_are_preserved(self):
        for field, code in (("id", "SOURCE_CHANNEL_ID_INVALID"), ("tenantId", "SOURCE_TENANT_ID_INVALID")):
            bad_row = row(1)
            bad_row[field] = 0
            with self.subTest(field=field), self.assertRaisesRegex(C.SyncError, code):
                C.page_rows(page("withdrawal", 1, 1, [bad_row]), "withdrawal", 1, "1102", 2)
        raw = page("withdrawal", 1, 1, [row(Decimal("3000000000000000001.0"), tenantId=Decimal("1102.000"))])
        total, pages, records, identifiers = C.page_rows(raw, "withdrawal", 1, "1102", 2)
        self.assertEqual((total, pages, len(records)), (1, 1, 1))
        self.assertEqual(identifiers, ("3000000000000000001",))

    def test_explicit_zero_is_a_complete_snapshot(self):
        empty_groups = page("deposit", 1, 0, [], pages=0)
        empty_groups["data"]["list"] = [{"categoryId": value, "channels": []} for value in (0, None, "")]
        for direction, empty in (("withdrawal", page("withdrawal", 1, 0, [], pages=0)),
                                 ("deposit", page("deposit", 1, 0, [], pages=0)),
                                 ("deposit", empty_groups)):
            with self.subTest(direction=direction, has_groups=bool(empty["data"]["list"])):
                source = SequenceSource([empty, empty])
                result = C.collect_direction(source, "1102", direction, 2)
                self.assertEqual(result["records"], [])
                self.assertEqual(result["source_count"], 0)
                self.assertEqual(result["fetched_count"], 0)
                self.assertTrue(result["complete"])
                self.assertEqual(len(source.calls), 2)
        contradictory = page("deposit", 1, 0, [row(1)], pages=0)
        with self.assertRaisesRegex(C.SyncError, "SOURCE_ZERO_NOT_PROVEN"):
            C.collect_direction(SequenceSource([contradictory]), "1102", "deposit", 2)

    def test_failure_cannot_become_zero(self):
        for response in ({"code": 1, "data": {"list": []}}, {"code": 0, "data": {"list": []}},
                         page("withdrawal", 1, 1, []), page("withdrawal", 2, 0, [], pages=0)):
            with self.subTest(response=response), self.assertRaises(C.SyncError):
                C.collect_direction(SequenceSource([response]), "1102", "withdrawal", 2)

    def test_duplicate_total_drift_short_page_and_wrong_echo_fail(self):
        first = page("withdrawal", 1, 4, [row(1), row(2)])
        broken = [page("withdrawal", 2, 4, [row(1), row(2)]),
                  page("withdrawal", 2, 5, [row(3), row(4)]),
                  page("withdrawal", 2, 4, [row(3)]),
                  page("withdrawal", 1, 4, [row(3), row(4)])]
        for response in broken:
            with self.subTest(response=response), self.assertRaises(C.SyncError):
                C.collect_direction(SequenceSource([first, response]), "1102", "withdrawal", 2)

    def test_first_page_ids_changed_during_pagination_fail(self):
        source = SequenceSource([page("withdrawal", 1, 3, [row(1), row(2)]),
                                 page("withdrawal", 2, 3, [row(3)]),
                                 page("withdrawal", 1, 3, [row(4), row(2)])])
        with self.assertRaisesRegex(C.SyncError, "SOURCE_FINAL_CONFIRMATION_DRIFT"):
            C.collect_direction(source, "1102", "withdrawal", 2)


class RestartAndConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.logger = logging.getLogger("offline_test_ar_middle")
        self.logger.addHandler(logging.NullHandler())

    def tearDown(self):
        self.temp.cleanup()

    def test_two_directions_atomic_and_failure_preserves_previous(self):
        store = C.StateStore(self.directory)
        previous = {"source_tenant_id": "1102", "snapshot_id": "old", "captured_at": "2026-10-09T00:00:00Z", "directions": []}
        store.save_complete(previous)
        empty = page("deposit", 1, 0, [], pages=0)
        source = SequenceSource([empty, empty, C.SyncError("NETWORK_REQUEST_FAILED")])
        upload = mock.Mock()
        upload.apply.side_effect = C.SyncError("TARGET_SNAPSHOT_NOT_ACKNOWLEDGED")
        config = {"targets": [{"tenant_id": "1102", "enabled": True}], "page_size": 2}
        self.assertEqual(C.run_cycle(config, source, upload, store, self.logger), 1)
        self.assertEqual(store.pending(), [previous])
        store.close()

    def test_failed_upload_survives_restart_and_exact_ack_releases(self):
        store = C.StateStore(self.directory)
        empty_d = page("deposit", 1, 0, [], pages=0)
        empty_w = page("withdrawal", 1, 0, [], pages=0)
        source = SequenceSource([empty_d, empty_d, empty_w, empty_w])
        payload = C.build_snapshot(source, {"tenant_id": "1102"}, 2)
        self.assertEqual([d["order_type"] for d in payload["directions"]], ["deposit", "withdrawal"])
        store.save_complete(payload)
        store.close()
        restarted = C.StateStore(self.directory)
        failed_upload = mock.Mock()
        failed_upload.apply.side_effect = C.SyncError("HTTP_STATUS_503")
        self.assertEqual(C.resume_pending(restarted, failed_upload, self.logger), 1)
        self.assertEqual(restarted.pending(), [payload])
        good_upload = mock.Mock()
        self.assertEqual(C.resume_pending(restarted, good_upload, self.logger), 0)
        self.assertEqual(restarted.pending(), [])
        retained = restarted.db.execute("SELECT payload FROM snapshots WHERE tenant_id='1102'").fetchone()
        self.assertIsNotNone(retained)
        restarted.close()

    def test_old_snapshot_false_is_not_accepted(self):
        payload = {"snapshot_id": "current", "directions": [{"fetched_count": 0}, {"fetched_count": 0}]}
        upload = C.Upload({})
        with mock.patch.object(upload, "send", return_value={"ok": True, "source": "ar_middle", "snapshot_id": "current", "accepted": 0, "source_count": 0, "snapshot_applied": False}):
            with self.assertRaisesRegex(C.SyncError, "TARGET_SNAPSHOT_NOT_ACKNOWLEDGED"): upload.apply(payload)

    def test_config_private_and_only_verified_tenants_enabled(self):
        path = self.directory / "config.json"
        C.init_config(path)
        config = C.load_config(path)
        self.assertEqual(config["interval_seconds"], 300)
        self.assertEqual(config["source_origin"], C.ORIGIN)
        self.assertTrue(all(t["verified"] for t in config["targets"] if t["enabled"]))
        self.assertEqual(len(config["targets"]), 40)
        self.assertNotIn("1040", {t["tenant_id"] for t in config["targets"]})
        self.assertNotIn("bearer", path.read_text())
        with self.assertRaises(C.SyncError): C.init_config(path)
        raw = json.loads(path.read_text())
        raw["targets"].append({"tenant_id": "9999", "platform_name": "Unverified", "enabled": True, "verified": False})
        path.write_text(json.dumps(raw))
        with self.assertRaisesRegex(C.SyncError, "CONFIG_UNVERIFIED_TENANT_DISABLED_REQUIRED"): C.load_config(path)
        if os.name != "nt":
            os.chmod(path, 0o644)
            with self.assertRaisesRegex(C.SyncError, "PRIVATE_FILE_REQUIRES_MODE_0600"): C.load_config(path)

    def test_process_lock_and_fixed_start_to_start_interval(self):
        with C.process_lock(self.directory):
            with self.assertRaisesRegex(C.SyncError, "COLLECTOR_ALREADY_RUNNING"):
                with C.process_lock(self.directory): pass
        self.assertEqual(C.cycle_delay(1000, 1060), 240)
        self.assertEqual(C.cycle_delay(1000, 1700), 200)
        self.assertEqual(C.cycle_delay(1000, 1300), 0)
        self.assertEqual(C.cycle_delay(1000, 1060, interval_seconds=600), 540)

    def test_default_five_minutes_and_legacy_ten_minutes_configuration(self):
        path = self.directory / "config.json"
        C.init_config(path)
        raw = json.loads(path.read_text())
        self.assertEqual(raw["interval_seconds"], 300)
        raw["interval_seconds"] = 600
        path.write_text(json.dumps(raw))
        self.assertEqual(C.load_config(path)["interval_seconds"], 600)
        raw.pop("interval_seconds")
        path.write_text(json.dumps(raw))
        self.assertEqual(C.load_config(path)["interval_seconds"], 300)
        for invalid in (1, 60, 299, 301, 300.0, "300", True):
            raw["interval_seconds"] = invalid
            path.write_text(json.dumps(raw))
            with self.subTest(interval=invalid), self.assertRaises(C.SyncError): C.load_config(path)

    def test_source_spacing_and_fixed_read_only_routes(self):
        source = C.Source({"min_request_interval_seconds": 1})
        with mock.patch.object(C, "source_bearer", return_value="Bearer offline-value"), mock.patch.object(C, "http_json", return_value={"code": 0}) as http, mock.patch.object(C.time, "monotonic", side_effect=[100, 100, 100.2, 101]), mock.patch.object(C.time, "sleep") as sleep:
            source.fetch("deposit", C.request_payload("1102", 1, 300))
            source.fetch("withdrawal", C.request_payload("1102", 1, 300))
            self.assertAlmostEqual(sleep.call_args.args[0], 0.8)
            self.assertEqual([call.args[0] for call in http.call_args_list], [C.ORIGIN + C.PATHS["deposit"], C.ORIGIN + C.PATHS["withdrawal"]])
            self.assertTrue(all(call.args[2]["domainurl"] == C.ORIGIN for call in http.call_args_list))
            with self.assertRaisesRegex(C.SyncError, "SOURCE_ROUTE_NOT_ALLOWED"): source.fetch("payment", {})

    def test_check_reply_contract_uses_action_scope(self):
        config_path = self.directory / "config.json"
        C.init_config(config_path)
        raw = json.loads(config_path.read_text())
        raw["targets"] = [raw["targets"][0]]
        config_path.write_text(json.dumps(raw))
        source = mock.Mock()
        source.fetch.return_value = page("deposit", 1, 0, [], pages=0)
        upload = mock.Mock()
        upload.send.return_value = {"ok": True, "source": "ar_middle", "action_scope": "channels"}
        with mock.patch.object(C, "Source", return_value=source), mock.patch.object(C, "Upload", return_value=upload), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(C.main(["--check", "--config", str(config_path)]), 0)
            upload.send.return_value = {"ok": True, "source": "ar_middle", "scope": "channels"}
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(C.main(["--check", "--config", str(config_path)]), 1)

    def test_cdp_only_returns_source_text_preserves_decimal_and_rejects_other_origins(self):
        source = C.Source({"cdp_url": "http://127.0.0.1:9777"})
        response_body = '{"code":0,"data":{"amount":100.00000001}}'
        frame = json.dumps({"id": 1, "result": {"result": {"value": response_body}}}).encode()
        websocket = mock.Mock()
        websocket.receive.return_value = frame
        with mock.patch.object(C, "http_json", return_value=[{"id": "fixture", "type": "page", "url": C.ORIGIN + "/finance/recharge", "webSocketDebuggerUrl": "ws://127.0.0.1:9777/devtools/page/fixture"}]) as listing, mock.patch.object(C, "WebSocket", return_value=websocket):
            result = source.fetch_in_browser("deposit", C.request_payload("1102", 1, 300))
        self.assertEqual(listing.call_args.kwargs, {"direct_connection": True})
        self.assertEqual(result["data"]["amount"], Decimal("100.00000001"))
        sent = json.loads(websocket.send.call_args.args[0])
        self.assertEqual(sent["method"], "Runtime.evaluate")
        expression = sent["params"]["expression"]
        self.assertIn("localStorage.getItem('ACCESS-TOKEN')", expression)
        self.assertEqual(expression.count("location.origin !== origin"), 2)
        self.assertIn("await response.text()", expression)
        self.assertIn("return text", expression)
        self.assertIn("new AbortController()", expression)
        self.assertIn("controller.abort(), 40000", expression)
        self.assertIn("signal:controller.signal", expression)
        self.assertIn("finally { clearTimeout(timer); }", expression)
        self.assertIn("'domainurl':origin", expression)
        self.assertNotIn("return session", expression)
        self.assertNotIn("return bearer", expression)
        self.assertTrue(websocket.close.called)
        with mock.patch.object(C, "http_json", return_value=[{"type": "page", "url": "https://m8-admin.payplatform-manager.com.attacker.invalid/", "webSocketDebuggerUrl": "unused"}]):
            with self.assertRaisesRegex(C.SyncError, "CDP_REQUIRES_ONE_M8_PAGE"):
                source.fetch_in_browser("deposit", C.request_payload("1102", 1, 300))

    def test_debugger_boundary_refuses_host_port_credentials_and_non_page_paths(self):
        configured = "http://127.0.0.1:9777"
        accepted = C.validate_debugger_url("ws://127.0.0.1:9777/devtools/page/fixture", configured, "fixture")
        self.assertEqual(accepted.port, 9777)
        unsafe = ["ws://other.invalid:9777/devtools/page/fixture", "ws://127.0.0.1:9778/devtools/page/fixture",
                  "ws://user:private@127.0.0.1:9777/devtools/page/fixture", "ws://127.0.0.1:9777/devtools/browser/fixture",
                  "ws://127.0.0.1:9777/devtools/page/wrong", "ws://127.0.0.1:9777/devtools/page/fixture?secret=x",
                  "ws://127.0.0.1:9777/devtools/page/fixture#fragment", "wss://127.0.0.1:9777/devtools/page/fixture"]
        with mock.patch.object(C.socket, "create_connection") as socket:
            for value in unsafe:
                with self.subTest(url=value), self.assertRaisesRegex(C.SyncError, "CDP_WEBSOCKET_BOUNDARY_MISMATCH"):
                    C.WebSocket(value, configured, "fixture")
            socket.assert_not_called()
        for invalid_cdp in ("http://remote.invalid:9777", "http://127.0.0.1:9777/path", "http://private@127.0.0.1:9777", "http://127.0.0.1:9777?key=x"):
            with self.subTest(cdp=invalid_cdp), self.assertRaises(C.SyncError): C.validate_cdp_url(invalid_cdp)

    def test_loopback_http_disables_environment_proxies(self):
        response = mock.MagicMock()
        response.read.return_value = b'{"code":0}'
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://proxy.invalid:9999", "HTTPS_PROXY": "http://proxy.invalid:9999"}), mock.patch.object(C.urllib.request, "build_opener", return_value=opener) as build:
            self.assertEqual(C.http_json("http://127.0.0.1:9777/json", context=object(), direct_connection=True), {"code": 0})
        proxy_handlers = [handler for handler in build.call_args.args if isinstance(handler, C.urllib.request.ProxyHandler)]
        self.assertEqual(len(proxy_handlers), 1)
        self.assertEqual(proxy_handlers[0].proxies, {})

    def test_macos_tls_uses_public_os_ca_when_python_store_empty(self):
        context = mock.Mock()
        context.cert_store_stats.side_effect = [{"x509_ca": 0}, {"x509_ca": 1}]
        with mock.patch.object(C.sys, "platform", "darwin"), mock.patch.dict(os.environ, {"SSL_CERT_FILE": "", "SSL_CERT_DIR": ""}), mock.patch.object(C.ssl, "create_default_context", return_value=context) as create, mock.patch.object(C.Path, "is_file", return_value=True):
            self.assertIs(C.tls_context(), context)
        create.assert_called_once_with()
        context.load_verify_locations.assert_called_once_with(cafile="/etc/ssl/cert.pem")
        real_context = C.tls_context()
        self.assertIs(real_context.check_hostname, True)
        self.assertEqual(real_context.verify_mode, C.ssl.CERT_REQUIRED)

    def test_tls_without_trust_store_refuses_instead_of_disabling_verification(self):
        context = mock.Mock()
        context.cert_store_stats.return_value = {"x509_ca": 0}
        context.load_verify_locations.side_effect = OSError("offline unavailable")
        with mock.patch.object(C.sys, "platform", "darwin"), mock.patch.dict(os.environ, {"SSL_CERT_FILE": "", "SSL_CERT_DIR": ""}), mock.patch.dict(C.sys.modules, {"certifi": None}), mock.patch.object(C.ssl, "create_default_context", return_value=context), mock.patch.object(C.ssl, "get_default_verify_paths", return_value=SimpleNamespace(capath=None)), mock.patch.object(C.Path, "is_file", return_value=True):
            with self.assertRaisesRegex(C.SyncError, "TLS_NO_TRUSTED_CA_CONFIGURE_CA_BUNDLE"): C.tls_context()
        with mock.patch.object(C.ssl, "create_default_context", side_effect=C.ssl.SSLError("offline invalid CA")):
            with self.assertRaisesRegex(C.SyncError, "TLS_TRUSTED_CA_BUNDLE_INVALID"): C.tls_context("configured-public-ca.pem")

    def test_session_file_can_be_refreshed_without_saving_to_source(self):
        session_path = self.directory / "session.json"
        session_path.write_text(json.dumps({"value": "ephemeral-test-value", "expire": 4102444800000}))
        os.chmod(session_path, 0o600)
        with mock.patch.dict(os.environ, {"AR_MIDDLE_BEARER": ""}):
            self.assertEqual(C.source_bearer({"session_file": str(session_path)}), "Bearer ephemeral-test-value")
            session_path.write_text(json.dumps({"value": "refreshed-test-value", "expire": 4102444800000}))
            self.assertEqual(C.source_bearer({"session_file": str(session_path)}), "Bearer refreshed-test-value")
        self.assertNotIn("ephemeral-test-value", SOURCE_FILE.read_text())


if __name__ == "__main__":
    unittest.main()
