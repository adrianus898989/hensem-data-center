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

    def test_explicit_zero_is_a_complete_snapshot(self):
        empty = page("withdrawal", 1, 0, [], pages=0)
        result = C.collect_direction(SequenceSource([empty, empty]), "1102", "withdrawal", 2)
        self.assertEqual(result["records"], [])
        self.assertEqual(result["source_count"], 0)
        self.assertTrue(result["complete"])

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
        self.assertEqual(config["interval_seconds"], 600)
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
        self.assertEqual(C.cycle_delay(1000, 1060), 540)
        self.assertEqual(C.cycle_delay(1000, 1700), 0)

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
