"""Offline collector contract tests. Synthetic data; every network call is mocked."""
import contextlib
import base64
import hashlib
from datetime import datetime, timedelta, timezone
from html import escape
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("yash_collector", ROOT / "collectors/yash_sync.py")
S = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = S
spec.loader.exec_module(S)
UTC = timezone.utc
NOW = datetime(2030, 2, 1, 12, tzinfo=UTC)
START = NOW - timedelta(hours=1)


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


def source_row(kind="deposit", **changes):
    row = {"UID": "synthetic-member", "订单号": "synthetic-001", "子订单号": "child-001", "三方订单号": "supplier-001",
        "供应商商户": "SyntheticPay", "支付通道": "SyntheticChannel", "支付方式": "UPI", "是否首单": "否",
        "下单时间": "2030-02-01 11:30:00.123456", "申请时间": "2030-02-01 11:30:00.123456", "完成时间": "-",
        "充值金额": "123.45", "提现金额": "123.45", "手续费": "0.00", "充值前余额": "0.00", "提现后余额": "0.00",
        "充值总金额": "123.45", "优惠比例": "0%", "充值类型": "三方充值", "提现类型": "申请提现",
        "订单状态": "处理中", "提现状态": "提现中", "最后操作人": "operator-A",
        "备注": "private-note", "订单备注": "private-note", "风控备注": "private-risk", "站内信内容": "private-message",
        "提现账户名": "Private Person", "提现账号": "1234567890123456", "银行/钱包": "Private Bank",
        "附件": "https://private.example/proof.pdf", "图片": "https://private.example/proof.png", "视频": "https://private.example/proof.mp4",
        "操作": "must-not-be-stored"}
    row.update(changes)
    return row


def html(rows=None, total=None, pages=1):
    rows = [source_row()] if rows is None else rows
    headers = list(rows[0]) if rows else list(source_row())
    total = len(rows) if total is None else total
    result = '<script>throw new Error("must-not-execute")</script><table><thead><tr>'
    result += ''.join('<th>' + escape(key) + '</th>' for key in headers) + '</tr></thead>'
    for row in rows:
        result += '<tr>' + ''.join('<td>' + escape(str(row.get(key, '-'))) + '</td>' for key in headers) + '</tr>'
    return result + '</table><div class="pager-analysis">总计 ' + str(total) + ' 条，共 ' + str(pages) + ' 页</div>'


def record(number=1, kind="deposit", created_at=None, completed_at=None):
    return {"source_site": "yash", "order_type": kind, "order_no": "synthetic-" + str(number), "status": "处理中",
        "created_at": (created_at or START + timedelta(minutes=5)).isoformat(),
        "completed_at": completed_at.isoformat() if completed_at else None}


def cfg(directory, **changes):
    values = {"base_url": "https://yash.y-o-admin.com", "site_timezone": "UTC", "backfill_start": START.isoformat(),
        "headers_file": "config.json", "window_seconds": 3600, "overlap_seconds": 3600, "settle_seconds": 0,
        "request_delay_seconds": 0, "pending_checks_per_cycle": 20, "batch_size": 2, "reconcile_days": 7}
    values.update(changes)
    return S.Config(values, Path(directory))


class ParseTests(unittest.TestCase):
    def parse(self, values=None, kind="deposit", zone="UTC"):
        return S.parse_page(html([values or source_row(kind)]), kind, "untrusted-source-label", zone, NOW).rows[0]

    def test_source_scope_order_identity_status_money_and_microseconds(self):
        row = self.parse()
        self.assertEqual(row["source_site"], "yash")
        self.assertEqual(row["uid"], "synthetic-member")
        self.assertEqual(row["status"], "处理中")
        self.assertEqual(row["amount"], "123.45")
        self.assertEqual(row["fee"], "0.00")
        self.assertEqual(row["currency"], "INR")
        self.assertEqual(row["currency_basis"], "platform_default")
        self.assertEqual(row["created_at"], "2030-02-01T11:30:00.123456+00:00")
        self.assertIsNone(row["completed_at"])

    def test_withdrawal_uses_original_fee_amount_and_fixed_source_timezone(self):
        row = self.parse(source_row("withdrawal", **{"提现金额": "1,200.2500", "手续费": "2.00"}), "withdrawal", "UTC+05:30")
        self.assertEqual(row["amount"], "1200.2500")
        self.assertEqual(row["fee"], "2.00")
        self.assertEqual(row["created_at"], "2030-02-01T06:00:00.123456+00:00")

    def test_raw_allowlist_excludes_all_private_notes_accounts_and_attachment_fields(self):
        row = self.parse()
        self.assertLessEqual(set(row["raw_fields"]), S.RAW_FIELDS)
        text = json.dumps(row)
        for forbidden in ("private-note", "private-risk", "private-message", "Private Person", "1234567890123456", "Private Bank", "private.example", "must-not-be-stored", "must-not-execute"):
            self.assertNotIn(forbidden, text)
        self.assertNotIn("最后操作人", row["raw_fields"])
        oversized=self.parse(source_row(**{"供应商商户":"x"*257}))
        self.assertNotIn("供应商商户",oversized["raw_fields"])

    def test_business_operators_retained_sensitive_values_anonymized_stably(self):
        for value in ("operator-A", "Admin_9", "系统", "自动", "SYSTEM"):
            self.assertEqual(self.parse(source_row(**{"最后操作人": value}))["operator"], value)
        for value in ("person@example.test", "+91 (123) 456-7890", "1234567890123456", "https://private.example/user"):
            operator = self.parse(source_row(**{"最后操作人": value}))["operator"]
            self.assertRegex(operator, r"^operator-[a-p]{16}$")
            self.assertNotRegex(operator, r"\d")
            self.assertNotIn(value, json.dumps(self.parse(source_row(**{"最后操作人": value}))))
            self.assertEqual(operator, S.masked_operator(value))

    def test_explicit_currency_is_preserved_and_conflicts_cannot_advance_the_window(self):
        for original, expected in (("INR", "INR"), ("usdt", "USDT"), ("₹", "INR"), ("U", "USDT")):
            row = self.parse(source_row(**{"币种": original}))
            self.assertEqual((row["currency"], row["currency_basis"]), (expected, "source_field"))
        with self.assertRaises(S.SyncError):
            self.parse(source_row(**{"币种": "INR", "Currency": "USDT"}))

    def test_token_channel_or_order_type_never_silently_becomes_inr_or_assumes_usdt_units(self):
        for field, value in (("供应商商户", "TronPayUSDT"), ("支付方式", "USDT"), ("充值类型", "充值U"), ("提现类型", "U提现"), ("支付通道", "TRC20")):
            row = self.parse(source_row(**{field: value}))
            self.assertIsNone(row["currency"])
            self.assertEqual(row["currency_basis"], "token_type_unverified")
        self.assertEqual(self.parse(source_row(**{"支付方式": "UPI"}))["currency"], "INR")

    def test_finished_failures_keep_status_and_are_not_relabelled_success(self):
        for kind, header, value in (("deposit", "订单状态", "充值失败"), ("deposit", "订单状态", "订单过期"), ("withdrawal", "提现状态", "已退币")):
            row = self.parse(source_row(kind, **{header: value, "完成时间": "2030-02-01 11:45:00"}), kind)
            self.assertEqual(row["status"], value)
            self.assertEqual(row["completed_at"], "2030-02-01T11:45:00+00:00")

    def test_invalid_money_dates_missing_headers_and_unknown_first_order_fail_closed(self):
        for changes in ({"充值金额": "NaN"}, {"充值金额": "bad"}, {"下单时间": "not-time"}, {"是否首单": "maybe"}, {"UID": "-"}, {"订单号": "x"*201}):
            with self.subTest(changes=changes), self.assertRaises(S.SyncError):
                self.parse(source_row(**changes))
        with self.assertRaises(S.SyncError):
            S.parse_page('<html>login</html>', "deposit", "yash", "UTC", NOW)


class PagingTests(unittest.TestCase):
    def source(self, pages):
        source = Mock()
        source.fetch.side_effect = lambda kind, mode, start, end, page: pages[page]
        return source

    def test_complete_pagination_rechecks_first_page(self):
        source = self.source({1: S.Page([record(1)], 2, 2), 2: S.Page([record(2)], 2, 2)})
        rows = S.collect_window(source, "deposit", "createTime", START, NOW)
        self.assertEqual(len(rows), 2)
        self.assertEqual([call.args[-1] for call in source.fetch.call_args_list], [1, 2, 1])

    def test_duplicates_missing_pages_changed_totals_and_page_shift_never_complete(self):
        cases = [[S.Page([record(1)], 2, 2), S.Page([record(1)], 2, 2)],
            [S.Page([record(1)], 2, 2), S.Page([], 2, 2)],
            [S.Page([record(1)], 2, 2), S.Page([record(2)], 3, 2)],
            [S.Page([record(1)], 2, 2), S.Page([record(2)], 2, 2), S.Page([record(3)], 2, 2)]]
        for pages in cases:
            source = Mock(); source.fetch.side_effect = pages
            with self.subTest(pages=pages), self.assertRaises(S.SyncError):
                S.collect_window(source, "deposit", "createTime", START, NOW)

    def test_inclusive_source_boundary_preserves_final_second_microseconds_without_cross_window_duplicates(self):
        final = NOW - timedelta(microseconds=1)
        source = self.source({1: S.Page([record(1, created_at=START), record(2, created_at=final), record(3, created_at=NOW)], 3, 1)})
        rows = S.collect_window(source, "deposit", "createTime", START, NOW)
        self.assertEqual([row["order_no"] for row in rows], ["synthetic-1", "synthetic-2"])
        success = [record(1, created_at=START-timedelta(days=10), completed_at=final), record(2, completed_at=NOW)]
        self.assertEqual(len(S.filter_window(success, "completeTime", START, NOW)), 1)

    def test_missing_source_time_cannot_prove_an_empty_complete_window(self):
        with self.assertRaises(S.SyncError):
            S.filter_window([record()], "completeTime", START, NOW)

    def test_zero_source_window_is_confirmable_without_fabricating_an_order(self):
        rows = S.collect_window(self.source({1: S.Page([], 0, 0)}), "deposit", "createTime", START, NOW)
        self.assertEqual(rows, [])

    def test_over_limit_page_is_detected_before_downloading_all_pages(self):
        source = self.source({1: S.Page([record()], S.MAX_RECEIPT_KEYS+1, 100)})
        with self.assertRaises(S.WindowTooLarge):
            S.collect_window(source, "deposit", "createTime", START, NOW)
        self.assertEqual(source.fetch.call_count, 1)


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="yash-test-")
        self.addCleanup(self.directory.cleanup)
        self.client = S.UploadClient(cfg(self.directory.name))
        token = patch.object(S, "YASH_UPLOAD_TOKEN", "synthetic-scoped-token")
        token.start(); self.addCleanup(token.stop)

    def test_check_uses_only_scoped_header_and_exact_function_endpoint(self):
        with patch.object(S, "http_request", return_value=(b'{"ok":true,"schema_version":1,"source_site":"yash"}', {})) as request:
            self.client.verify()
        url, headers, body = request.call_args.args
        self.assertEqual(url, S.YASH_UPLOAD_URL)
        self.assertEqual(headers["X-Yash-Key"], "synthetic-scoped-token")
        self.assertEqual(set(headers), {"X-Yash-Key", "Content-Type", "Accept"})
        self.assertEqual(json.loads(body), {"action": "check"})

    def test_placeholder_is_not_treated_as_an_activated_file(self):
        with patch.object(S, "YASH_UPLOAD_TOKEN", "__YASH_UPLOAD_TOKEN__"), self.assertRaises(S.SyncError):
            self.client.headers()

    def test_upload_batches_require_exact_integer_acceptance(self):
        with patch.object(self.client, "request", side_effect=[{"ok":True,"accepted":2},{"ok":True,"accepted":1}]) as request:
            self.client.upsert([record(1),record(2),record(3)])
        self.assertEqual([len(call.args[0]["records"]) for call in request.call_args_list], [2,1])
        for call in request.call_args_list:
            self.assertEqual(call.args[0]["schema_version"], 1)
            self.assertEqual(call.args[0]["action"], "ingest")
            self.assertRegex(call.args[0]["batch_id"], r"^[a-f0-9-]{36}$")
        for accepted in (0, True, "1", None):
            with patch.object(self.client, "request", return_value={"ok":True,"accepted":accepted}), self.assertRaises(S.SyncError):
                self.client.upsert([record()])

    def test_receipts_check_verification_and_full_count_even_for_zero(self):
        with patch.object(self.client, "request", return_value={"ok":True,"verified":True,"source_count":0}) as request:
            self.client.receipt("deposit", "createTime", START, NOW, [], NOW)
        payload = request.call_args.args[0]
        self.assertEqual(payload["end_exclusive"], NOW.isoformat())
        self.assertEqual(payload["order_keys"], [])
        self.assertEqual(payload["source_timezone"], "UTC")
        for response in ({"ok":True,"verified":False,"source_count":1},{"ok":True,"verified":True,"source_count":0},{"ok":True,"verified":True,"source_count":True}):
            with patch.object(self.client, "request", return_value=response), self.assertRaises(S.SyncError):
                self.client.receipt("deposit", "createTime", START, NOW, [record()], NOW)

    def test_malformed_or_unacknowledged_upload_response_fails_closed(self):
        for body in (b'not-json', b'[]', b'{"ok":false}', b'{"ok":1}'):
            with patch.object(S, "http_request", return_value=(body,{})), self.assertRaises(S.SyncError):
                self.client.request({"action":"check"})

    def test_ingest_count_limit_and_request_size_split_without_losing_records(self):
        client=S.UploadClient(cfg(self.directory.name,batch_size=1000))
        with patch.object(client,"request",side_effect=lambda payload:{"ok":True,"accepted":len(payload["records"])}) as request:
            client.upsert([record(i) for i in range(501)])
        self.assertEqual([len(call.args[0]["records"]) for call in request.call_args_list],[500,1])
        def fake_request(payload):
            if len(payload["records"])>1:raise S.WindowTooLarge("synthetic body limit")
            return {"ok":True,"accepted":1}
        with patch.object(self.client,"request",side_effect=fake_request) as request:self.client.upsert([record(1),record(2)])
        self.assertEqual([len(call.args[0]["records"]) for call in request.call_args_list],[2,1,1])
        with patch.object(self.client,"request",side_effect=S.WindowTooLarge("synthetic body limit")),self.assertRaises(S.SyncError):self.client.upsert([record()])

    def test_oversized_receipt_cannot_be_sent_or_accepted(self):
        with patch.object(S,"MAX_REQUEST_BYTES",100),patch.object(S,"http_request") as request,self.assertRaises(S.WindowTooLarge):
            self.client.receipt("deposit","createTime",START,NOW,[record()],NOW)
        request.assert_not_called()


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="yash-state-test-")
        self.addCleanup(self.directory.cleanup)
        self.config = cfg(self.directory.name)
        self.state = S.State(Path(self.directory.name)/"progress.sqlite3", "synthetic")
        self.addCleanup(self.state.close)

    def test_window_is_uploaded_then_receipted_before_return(self):
        calls = []
        target = Mock()
        target.upsert.side_effect = lambda rows: calls.append("upload")
        target.receipt.side_effect = lambda *args: calls.append("receipt")
        with patch.object(S,"collect_window", return_value=[record()]), patch.object(S,"datetime",FrozenDatetime):
            rows = S.window_sync(Mock(),target,self.config,"deposit","createTime",START,NOW)
        self.assertEqual(calls,["upload","receipt"])
        self.assertEqual(rows,[record()])

    def test_failed_upload_or_unverified_receipt_never_advances_checkpoint(self):
        for failure in ("upsert","receipt"):
            target = Mock();getattr(target,failure).side_effect=S.SyncError("synthetic failed acknowledgement")
            with patch.object(S,"collect_window",return_value=[record()]), patch.object(S,"datetime",FrozenDatetime), self.assertRaises(S.SyncError):
                S.run_cycle(self.config,self.state,Mock(),target)
            self.assertIsNone(self.state.get("deposit/createTime"))

    def test_full_zero_windows_are_receipted_and_advance_all_four_streams(self):
        target = Mock()
        with patch.object(S,"collect_window",return_value=[]),patch.object(S,"datetime",FrozenDatetime):
            S.run_cycle(self.config,self.state,Mock(),target)
        self.assertEqual(target.receipt.call_count,4)
        for kind in S.ENDPOINTS:
            for mode in ("createTime","completeTime"):
                self.assertEqual(self.state.get(kind+"/"+mode),NOW.isoformat())

    def test_large_windows_split_without_gaps_and_child_failure_keeps_parent_checkpoint(self):
        middle=START+timedelta(minutes=30)
        def collect(source,kind,mode,start,end):
            if (start,end)==(START,NOW):raise S.WindowTooLarge("synthetic large window")
            return [record(1 if start==START else 2,created_at=start+timedelta(seconds=1))]
        target=Mock()
        with patch.object(S,"collect_window",side_effect=collect),patch.object(S,"datetime",FrozenDatetime):
            rows=S.window_sync(Mock(),target,self.config,"deposit","createTime",START,NOW)
        self.assertEqual(len(rows),2)
        self.assertEqual([(call.args[2],call.args[3]) for call in target.receipt.call_args_list],[(START,middle),(middle,NOW)])
        target=Mock();target.receipt.side_effect=[None,S.SyncError("child rejected")]
        with patch.object(S,"collect_window",side_effect=collect),patch.object(S,"datetime",FrozenDatetime),self.assertRaises(S.SyncError):
            S.run_cycle(self.config,self.state,Mock(),target)
        self.assertIsNone(self.state.get("deposit/createTime"))

    def test_failed_statuses_remain_watched_terminal_statuses_stop_and_state_persists(self):
        failed=record();failed["status"]="充值失败";self.state.track([failed]);self.assertEqual(len(self.state.pending(10)),1)
        failed["status"]="充值成功";self.state.track([failed]);self.assertEqual(self.state.pending(10),[])
        self.state.set("deposit/createTime",NOW.isoformat())
        reopened=S.State(Path(self.directory.name)/"progress.sqlite3","synthetic")
        try:self.assertEqual(reopened.get("deposit/createTime"),NOW.isoformat())
        finally:reopened.close()

    def test_current_windows_run_before_history_and_history_budget_resumes_forward(self):
        config=cfg(self.directory.name,backfill_start=(START-timedelta(days=1)).isoformat())
        with patch.object(S,"datetime",FrozenDatetime),patch.object(S,"window_sync",return_value=[]) as window,patch.object(S.time,"monotonic",side_effect=[0,0,11]):
            S.run_cycle(config,self.state,Mock(),Mock(),budget_seconds=10)
        self.assertEqual(window.call_count,5)
        self.assertEqual(self.state.get("deposit/createTime"),(config.start+timedelta(hours=1)).isoformat())
        for call in window.call_args_list[:4]:self.assertEqual(call.args[-2:],(START,NOW))

    def test_single_second_overflow_fails_without_unbounded_recursion(self):
        with patch.object(S,"collect_window",side_effect=S.WindowTooLarge("synthetic overflow")),self.assertRaises(S.SyncError):
            S.window_sync(Mock(),Mock(),self.config,"deposit","createTime",START,START+timedelta(seconds=1))

    def test_manual_wide_window_is_split_to_backend_36_hour_limit(self):
        end=START+timedelta(days=3)
        target=Mock()
        with patch.object(S,"collect_window",return_value=[]):S.window_sync(Mock(),target,self.config,"deposit","createTime",START,end)
        self.assertEqual(target.receipt.call_count,2)
        for call in target.receipt.call_args_list:self.assertLessEqual(call.args[3]-call.args[2],timedelta(hours=36))


class ActivationTests(unittest.TestCase):
    def test_cdp_defaults_are_fixed_no_source_request_import_or_credentials_required(self):
        self.assertEqual(S.CDP_HTTP,"http://127.0.0.1:9222")
        self.assertEqual(S.YASH_ORIGIN,"https://yash.y-o-admin.com")
        self.assertEqual(S.CHECK_INTERVAL_SECONDS,10)
        self.assertIs(S.RUN_ON_START,False)
        self.assertFalse(hasattr(S,"import_curl"))
        self.assertFalse(hasattr(S,"read_request"))

    def test_first_activation_only_requires_source_request_and_timezone_and_saves_private_config(self):
        with tempfile.TemporaryDirectory(prefix="yash-config-test-") as directory:
            path=Path(directory)/"config.json"
            with patch("builtins.input",return_value="UTC+05:30") as prompt,contextlib.redirect_stdout(io.StringIO()):
                S.prepare_config(path)
            self.assertEqual(prompt.call_count,1)
            values=json.loads(path.read_text())
            self.assertEqual(values["interval_seconds"],600)
            self.assertEqual(values["backfill_start"],"2026-10-01 00:00:00")
            self.assertEqual(values["site_timezone"],"UTC+05:30")
            self.assertEqual(values["backfill_timezone"],"UTC+05:30")
            self.assertNotIn("supabase_secret_key",values)
            self.assertNotIn("supabase_url",values)
            self.assertNotIn("source_headers",values)
            self.assertNotIn("headers_file",values)
            if os.name!="nt":self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
            S.Config.from_file(path)

    def test_october_first_business_start_stays_indian_midnight_for_each_source_display_timezone(self):
        for source_zone in ("UTC","UTC+08:00","UTC+05:30"):
            config=cfg(".",backfill_start="2026-10-01 00:00:00",site_timezone=source_zone)
            self.assertEqual(config.start,datetime(2026,9,30,18,30,tzinfo=UTC))
            self.assertEqual(config.zone,S.site_zone(source_zone))

    def test_default_activation_does_not_fetch_until_first_ten_second_check(self):
        with tempfile.TemporaryDirectory(prefix="yash-main-test-") as directory:
            path=Path(directory)/"config.json";config=cfg(directory,backfill_start="2026-10-01 00:00:00")
            path.write_text(json.dumps(config.data))
            source=Mock();source.fetch.return_value=S.Page([],0,0);target=Mock()
            def first_check(*args):
                source.fetch.assert_not_called();target.verify.assert_not_called();cycle.assert_not_called()
                self.assertEqual(args[0],110)
                return True
            with patch.object(S,"YASH_UPLOAD_TOKEN","synthetic-scoped-token"),patch.object(sys,"argv",["yash_sync.py","--config",str(path)]),patch.object(S,"SourceClient",return_value=source),patch.object(S,"UploadClient") as client,patch.object(S,"channel_polling",return_value=contextlib.nullcontext()) as polling,patch.object(S,"run_cycle",side_effect=KeyboardInterrupt) as cycle,patch.object(S.time,"monotonic",return_value=100),patch.object(S,"wait_until_due",side_effect=first_check):
                client.return_value=target
                self.assertEqual(S.main(),0)
            self.assertEqual(source.fetch.call_count,0)
            self.assertEqual(cycle.call_args.kwargs["budget_seconds"],480)
            polling.assert_called_once()

    def test_refresh_preserves_checkpoint_scope_and_removes_legacy_project_credentials(self):
        with tempfile.TemporaryDirectory(prefix="yash-refresh-test-") as directory:
            path=Path(directory)/"config.json"
            old={"site_timezone":"UTC","backfill_start":"2026-10-01 00:00:00","headers_file":"config.json","source_headers":{"cookie":"synthetic-cookie"},"state_file":"state/progress.sqlite3","supabase_secret_key":"synthetic-old-key","supabase_url":"https://synthetic.supabase.co"}
            path.write_text(json.dumps(old))
            with patch("builtins.input",return_value=""),contextlib.redirect_stdout(io.StringIO()):S.prepare_config(path,refresh=True)
            updated=json.loads(path.read_text());self.assertEqual(updated["state_file"],old["state_file"]);self.assertEqual(updated["backfill_start"],old["backfill_start"]);self.assertNotIn("supabase_secret_key",updated)
            self.assertNotIn("source_headers",updated);self.assertNotIn("headers_file",updated)

    def test_source_query_keeps_inclusive_end_and_never_receives_upload_token(self):
        with tempfile.TemporaryDirectory(prefix="yash-source-test-") as directory:
            config=cfg(directory)
            with patch.object(S.CDPClient,"get_html",return_value=html()) as request,patch.object(S.time,"sleep"):
                S.SourceClient(config).fetch("deposit","createTime",START,NOW,1)
            path,params=request.call_args.args
            self.assertEqual(path,"/admin/order/index")
            self.assertEqual(params["endDate"],"2030-02-01 12:00:00")
            self.assertNotIn("X-Yash-Key",params)
            self.assertNotIn("Authorization",params)


def channel_source_row(kind="deposit", **changes):
    row = {"通道名称": "Synthetic-QR", "支付供应商": "SyntheticPay", "通道类型": "扫码",
        "最小交易金额(INR)": "100", "最大交易金额(INR)": "50,000", "近10分钟成功率": "-",
        "近30分钟成功率": "0%", "近1小时成功率": "16.67%", "近4小时成功率": "20%",
        "近8小时成功率": "18.18%", "近24小时成功率": "17.75%", "今日成功率": "17.98%",
        "总成功率": "13.52%", "余额": "0 INR", "优先级": "10", "权重": "200",
        "状态": "已启用" if kind == "deposit" else "可用", "备注": "代收 4% 代付 1%",
        "操作": "下单测试 禁用 编辑 删除"}
    row.update({"支付方式": "UPI-QR,Innate UPI-QR", "代收次数要求": "0"} if kind == "deposit" else {"余额阈值": "-"})
    row.update(changes)
    return row


def channel_html(rows=None, *, kind="deposit", ids=None, total=None, pages=1):
    rows = [channel_source_row(kind)] if rows is None else rows
    headers = list(rows[0]) if rows else list(channel_source_row(kind))
    ids = ids if ids is not None else [str(index + 1) for index in range(len(rows))]
    result = '<table><thead><tr>' + ''.join('<th>' + escape(header) + '</th>' for header in headers) + '</tr></thead><tbody>'
    for channel_id, row in zip(ids, rows):
        result += '<tr data-id="' + escape(channel_id) + '">' + ''.join('<td>' + escape(str(row.get(header, '-'))) + '</td>' for header in headers) + '</tr>'
    return result + '</tbody></table><div class="pager-analysis">总计 ' + str(len(rows) if total is None else total) + ' 条，共 ' + str(pages) + ' 页</div>'


class ChannelParseTests(unittest.TestCase):
    def parse(self, kind="deposit", **changes):
        return S.parse_channel_page(channel_html([channel_source_row(kind, **changes)], kind=kind), kind).rows[0]

    def test_stable_identity_source_provider_all_eight_rates_and_zero_are_distinct_from_missing(self):
        row = self.parse()
        self.assertEqual(row["channel_id"], "1")
        self.assertEqual(row["provider"], "SyntheticPay")
        self.assertEqual(row["channel_type"], "扫码")
        self.assertEqual(row["payment_method"], "UPI-QR,Innate UPI-QR")
        self.assertIsNone(row["success_rate_10m"])
        self.assertEqual(row["success_rate_30m"], "0")
        self.assertEqual(row["success_rate_1h"], "16.67")
        self.assertEqual(row["success_rate_total"], "13.52")
        self.assertEqual(len([field for field in row if field.startswith("success_rate_")]), 8)
        self.assertEqual((row["min_amount"], row["max_amount"]), ("100", "50000"))
        self.assertEqual((row["required_deposit_count"], row["priority"], row["weight"]), (0, 10, 200))
        self.assertEqual(row["notes"], "代收 4% 代付 1%")
        self.assertNotIn("下单测试", json.dumps(row, ensure_ascii=False))
        self.assertNotIn("raw_fields", row)

    def test_inr_limits_and_explicit_usdt_balance_are_never_combined(self):
        row = self.parse(**{"通道类型": "USDT-TRC20", "余额": "0 USDT"})
        self.assertEqual(row["limit_currency"], "INR")
        self.assertEqual((row["balance"], row["balance_currency"]), ("0", "USDT"))
        unknown = self.parse(**{"通道类型": "USDT-TRC20", "余额": "100"})
        self.assertEqual(unknown["balance"], "100")
        self.assertIsNone(unknown["balance_currency"])
        negative = self.parse(**{"余额": "-12.05 INR"})
        self.assertEqual(negative["balance"], "-12.05")

    def test_withdrawal_threshold_currency_requires_own_explicit_evidence(self):
        row = self.parse("withdrawal", **{"余额阈值": "100"})
        self.assertIsNone(row["payment_method"])
        self.assertIsNone(row["required_deposit_count"])
        self.assertEqual(row["balance_threshold"], "100")
        self.assertIsNone(row["balance_threshold_currency"])
        row = self.parse("withdrawal", **{"余额阈值": "1,000.50 USDT"})
        self.assertEqual((row["balance_threshold"], row["balance_threshold_currency"]), ("1000.50", "USDT"))

    def test_both_direction_statuses_are_source_derived_and_unknown_not_guessed(self):
        for kind, text, expected in (("deposit", "已启用", True), ("deposit", "已禁用", False), ("withdrawal", "可用", True), ("withdrawal", "禁用", False), ("withdrawal", "余额不足", None)):
            with self.subTest(status=text):
                row = self.parse(kind, **{"状态": text})
                self.assertEqual(row["status_text"], text)
                self.assertIs(row["enabled"], expected)

    def test_notes_scrub_auth_contacts_accounts_urls_and_length_but_keep_business_rates(self):
        secret_values = ["password=sensitive-value", "cookie: session-value", "账号: sensitive-account", "银行卡号1234567890123456", "name@example.test", "+91 (123) 456-7890", "https://private.test/proof.pdf", "@contact_user", "x" * 32]
        for value in secret_values:
            with self.subTest(value=value):
                note = self.parse(**{"备注": "代收4%; " + value + "; 代付1%"})["notes"]
                self.assertIn("代收4%", note)
                self.assertNotIn(value, note)
                self.assertIn("代付1%", note)
        self.assertLessEqual(len(self.parse(**{"备注": "配置备注" * 200})["notes"]), 400)

    def test_missing_columns_stable_ids_pager_and_invalid_numeric_never_form_snapshots(self):
        for markup in (channel_html().replace('data-id="1"', ''), channel_html().replace("总计", "没有"), channel_html().replace("今日成功率", "其他"), channel_html().replace("最小交易金额(INR)", "最小交易金额"), channel_html().replace("最大交易金额(INR)", "最大交易金额(USDT)"), channel_html(ids=["unsafe/id"]), "<html>login</html>"):
            with self.assertRaises(S.SyncError): S.parse_channel_page(markup, "deposit")
        for changes in ({"近10分钟成功率": "50"}, {"近10分钟成功率": "101%"}, {"近10分钟成功率": "NaN%"}, {"权重": "-1"}, {"优先级": "1.5"}, {"余额": "unknown"}, {"最大交易金额(INR)": "99"}, {"余额": "1.123456789 INR"}):
            with self.assertRaises(S.SyncError): self.parse(**changes)

    def test_zero_channel_page_is_explicit_and_over_limit_does_not_form_a_partial_snapshot(self):
        page = S.parse_channel_page(channel_html([], total=0, pages=0), "deposit")
        self.assertEqual((page.rows, page.total, page.pages), ([], 0, 0))
        for markup in (channel_html(total=2001), channel_html(total=0), channel_html(pages=0)):
            with self.assertRaises(S.SyncError): S.parse_channel_page(markup, "deposit")


class ChannelSyncTests(unittest.TestCase):
    def test_all_pages_unique_count_and_first_page_are_verified_and_new_ids_discovered(self):
        rows = [{"channel_id": "stable-old"}, {"channel_id": "new-channel"}]
        source = Mock(); source.fetch_channels.side_effect = [S.Page([rows[0]], 2, 2), S.Page([rows[1]], 2, 2), S.Page([rows[0]], 2, 2)]
        self.assertEqual(S.collect_channels(source, "deposit"), rows)
        self.assertEqual([call.args for call in source.fetch_channels.call_args_list], [("deposit", 1), ("deposit", 2), ("deposit", 1)])

    def test_missing_duplicates_changed_totals_and_page_shift_never_send_full_snapshot(self):
        one, two = {"channel_id": "1"}, {"channel_id": "2"}
        cases = [[S.Page([one], 2, 2), S.Page([], 2, 2)], [S.Page([one], 2, 2), S.Page([one], 2, 2)], [S.Page([one], 2, 2), S.Page([two], 3, 2)], [S.Page([one], 1, 1), S.Page([two], 1, 1)], [S.Page([one], 2001, 2)]]
        for pages in cases:
            source=Mock(); source.fetch_channels.side_effect=pages
            with self.assertRaises(S.SyncError): S.collect_channels(source, "deposit")
        target=Mock()
        with patch.object(S,"collect_channels",side_effect=S.SyncError("synthetic gap")), self.assertLogs(S.LOG, level="ERROR"):
            self.assertFalse(S.channel_sync_cycle(Mock(), target))
        target.channels.assert_not_called()

    def test_zero_snapshot_rechecks_empty_first_page_before_uploading(self):
        source=Mock(); source.fetch_channels.return_value=S.Page([], 0, 0)
        target=Mock()
        self.assertTrue(S.channel_sync_cycle(source, target))
        self.assertEqual(source.fetch_channels.call_count, 4)
        self.assertEqual(target.channels.call_count, 2)
        self.assertEqual(target.channels.call_args.args[1], [])

    def test_readonly_check_does_not_upload_and_other_direction_still_runs_after_failure(self):
        target=Mock()
        with patch.object(S,"collect_channels",return_value=[]): self.assertTrue(S.channel_sync_cycle(Mock(), target, check_only=True))
        target.channels.assert_not_called()
        with patch.object(S,"collect_channels",side_effect=[S.SyncError("synthetic error"), []]), self.assertLogs(S.LOG, level="ERROR"):
            self.assertFalse(S.channel_sync_cycle(Mock(), target))
        target.channels.assert_called_once()
        self.assertEqual(target.channels.call_args.args[0], "withdrawal")

    def test_upload_atomic_snapshot_requires_exact_ack_and_no_stale_success(self):
        target=S.UploadClient(cfg(".")); rows=[{"channel_id":"1"}]
        accepted={"ok":True,"accepted":1,"source_count":1,"snapshot_applied":True}
        with patch.object(target,"request",return_value=accepted) as request:
            target.channels("deposit",rows,NOW)
            payload=request.call_args.args[0]
            self.assertEqual(payload["action"],"channels")
            self.assertEqual((payload["source_count"],payload["fetched_count"]),(1,1))
            self.assertEqual(payload["records"],rows)
        for result in ({**accepted,"snapshot_applied":False},{**accepted,"accepted":True},{**accepted,"accepted":0},{**accepted,"source_count":0}):
            with patch.object(target,"request",return_value=result),self.assertRaises(S.SyncError): target.channels("deposit",rows,NOW)
        with patch.object(target,"request",side_effect=S.WindowTooLarge("synthetic bound")) as request,self.assertRaises(S.WindowTooLarge): target.channels("deposit",rows,NOW)
        self.assertEqual(request.call_count,1)

    def test_channel_cdp_get_has_only_fixed_tab_paging_and_no_credentials(self):
        client=S.SourceClient(cfg("."))
        with patch.object(client.browser,"get_html",return_value=channel_html()) as request:
            client.fetch_channels("deposit",1)
            path,params=request.call_args.args
            self.assertEqual(path,"/admin/paymentChannel/config")
            self.assertEqual(params,{"tab":"depositChannel","page":1,"limit":1000})
            self.assertEqual(len(request.call_args.args),2)

    def test_ten_minute_poll_waits_for_first_tick_then_uses_dedicated_clients(self):
        stop=Mock()
        with patch.object(S,"SourceClient") as source,patch.object(S,"UploadClient") as target,patch.object(S,"channel_sync_cycle") as cycle,patch.object(S,"run_cycle") as orders,patch.object(S,"State") as state,patch.object(S.time,"monotonic",side_effect=[100,110]),patch.object(S,"wait_until_due",side_effect=[True,False]) as waiter:
            S.poll_channels(cfg("."),stop)
            cycle.assert_called_once_with(source.return_value,target.return_value,stop)
            self.assertEqual([call.args for call in waiter.call_args_list],[(110,stop),(710,stop)])
            orders.assert_not_called();state.assert_not_called()

    def test_background_poll_runs_during_other_work_and_stops_on_context_exit(self):
        entered=threading.Event(); stopped=threading.Event()
        def poll(config,stop):
            entered.set(); stop.wait(2); stopped.set()
        with patch.object(S,"poll_channels",side_effect=poll):
            with S.channel_polling(cfg(".")):
                self.assertTrue(entered.wait(1))
                self.assertFalse(stopped.is_set())
            self.assertTrue(stopped.is_set())

    def test_stop_before_upload_prevents_late_snapshot_after_process_shutdown(self):
        stop=threading.Event();target=Mock()
        def collect(*args):stop.set();return []
        with patch.object(S,"collect_channels",side_effect=collect):self.assertFalse(S.channel_sync_cycle(Mock(),target,stop))
        target.channels.assert_not_called()


def server_frame(payload, opcode=1, final=True):
    size=len(payload)
    prefix=bytes([(0x80 if final else 0)|opcode,size]) if size<126 else bytes([(0x80 if final else 0)|opcode,126])+struct.pack("!H",size) if size<=65535 else bytes([(0x80 if final else 0)|opcode,127])+struct.pack("!Q",size)
    return prefix+payload


class FakeCDPSocket:
    def __init__(self, frames=b"", invalid_handshake=False):
        self.frames=frames;self.invalid_handshake=invalid_handshake;self.sent=[];self.pending=b"";self.closed=False

    def sendall(self, data):
        self.sent.append(data)
        if data.startswith(b"GET "):
            key=next(line.split(b": ",1)[1] for line in data.split(b"\r\n") if line.startswith(b"Sec-WebSocket-Key: "))
            accept=base64.b64encode(hashlib.sha1(key+b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            if self.invalid_handshake:accept=b"wrong"
            self.pending=b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+b"\r\n\r\n"+self.frames

    def recv(self, size):
        result,self.pending=self.pending[:size],self.pending[size:];return result

    def settimeout(self, timeout):self.timeout=timeout
    def close(self):self.closed=True


def decode_client_frame(frame):
    assert frame[1]&0x80
    size=frame[1]&127;offset=2
    if size==126:size=struct.unpack("!H",frame[2:4])[0];offset=4
    elif size==127:size=struct.unpack("!Q",frame[2:10])[0];offset=10
    mask=frame[offset:offset+4];body=frame[offset+4:]
    assert len(body)==size
    return frame[0]&15,bytes(value^mask[index%4] for index,value in enumerate(body))


class CDPTests(unittest.TestCase):
    def test_target_lists_only_local_pages_and_selects_exact_existing_yash_origin(self):
        pages=[{"id":"other","type":"page","url":"https://other.example/admin","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/page/other"},
            {"id":"spoof","type":"page","url":"https://yash.y-o-admin.com.evil.example/","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/page/spoof"},
            {"id":"worker","type":"service_worker","url":S.YASH_ORIGIN,"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/page/worker"},
            {"id":"a-login","type":"page","url":S.YASH_ORIGIN+"/login","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/page/a-login"},
            {"id":"z-orders","type":"page","url":S.YASH_ORIGIN+"/admin/order/index","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/page/z-orders"}]
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False);response.read.return_value=json.dumps(pages).encode()
        opener=Mock();opener.open.return_value=response
        with patch.object(S,"build_opener",return_value=opener) as build:
            self.assertEqual(S.CDPClient().target(),"ws://127.0.0.1:9222/devtools/page/z-orders")
        self.assertEqual(opener.open.call_args.args[0].full_url,"http://127.0.0.1:9222/json/list")
        self.assertEqual(build.call_args.args[0].proxies,{})
        self.assertIsInstance(build.call_args.args[1],S.NoRedirect)
        response.read.return_value=json.dumps(pages[:3]).encode()
        with patch.object(S,"build_opener",return_value=opener),self.assertRaisesRegex(S.SyncError,"未找到"):S.CDPClient().target()

    def test_socket_rejects_external_alternative_port_browser_and_credential_urls(self):
        for url in ("ws://evil.example:9222/devtools/page/id","ws://127.0.0.1:9999/devtools/page/id","ws://localhost:9222/devtools/page/id","ws://127.0.0.1:9222/devtools/browser/id","ws://user:secret@127.0.0.1:9222/devtools/page/id","ws://127.0.0.1:9222/devtools/page/id?x=1","ws://127.0.0.1:9222/devtools/page/id#fragment"):
            with self.subTest(url=url),self.assertRaises(S.SyncError):S.LocalCDPSocket(url)
        for value in ({},None,123,"https://yash.y-o-admin.com:444/","http://yash.y-o-admin.com/","https://user@ y-o-admin.com/"):
            self.assertFalse(S.yash_tab_url(value))

    def test_read_only_fetch_expression_guards_origin_path_method_redirect_and_never_uses_cookies(self):
        browser=S.CDPClient();connection=Mock();connection.evaluate.return_value={"ok":True,"html":"<table/>"}
        socket_context=Mock();socket_context.__enter__=Mock(return_value=connection);socket_context.__exit__=Mock(return_value=False)
        with patch.object(browser,"target",return_value="ws://127.0.0.1:9222/devtools/page/id"),patch.object(S,"LocalCDPSocket",return_value=socket_context):
            self.assertEqual(browser.get_html("/admin/paymentChannel/config",{"tab":"depositChannel","page":1,"limit":1000}),"<table/>")
        expression=connection.evaluate.call_args.args[0]
        for required in ("location.origin", "method:'GET'", "mode:'same-origin'", "credentials:'same-origin'", "redirect:'error'", "cache:'no-store'"):
            self.assertIn(required,expression)
        self.assertIn("https://yash.y-o-admin.com/admin/paymentChannel/config?",expression)
        self.assertIn("'X-Requested-With':'XMLHttpRequest'",expression)
        self.assertIn(".toLowerCase()",expression)
        for forbidden in ("document.cookie","localStorage","window.open",".click(","location.href=","setStatus","delete","X-Yash-Key","Runtime.callFunctionOn"):
            self.assertNotIn(forbidden,expression)
        for path,params in (("/paymentChannel/setStatus",{}),("/admin/paymentChannel/setStatus",{}),("/admin/order/index",{"action":"delete"}),("https://evil.example/",{}),("/paymentChannel/config",{"tab":"depositChannel","page":1,"limit":1000}),("/admin/paymentChannel/config",{"tab":"depositChannel","page":1,"limit":1000,"payment_supplier":"filter"})):
            with self.assertRaises(S.SyncError):browser.get_html(path,params)

    def test_fetch_diagnostics_keep_safe_reason_and_never_expose_server_secrets(self):
        cases=[({"code":"http_error","status":404},"HTTP 404"),
            ({"code":"http_error","status":403},"HTTP 403"),
            ({"code":"http_error","status":429},"限制请求频率"),
            ({"code":"http_error","status":"private-source-secret"},"HTTP 错误"),
            ({"code":"not_html","mime":"application/json"},"返回 JSON"),
            ({"code":"not_html","mime":"private-source-secret"},"返回 非 HTML"),
            ({"code":"wrong_origin"},"已离开固定 YASH"),
            ({"code":"read_timeout"},"超过 60 秒"),
            ({"code":"read_failed"},"网络中断"),
            ({"code":"private-source-secret"},"返回格式无效")]
        for result,expected in cases:
            with self.subTest(result=result):
                browser=S.CDPClient();connection=Mock();connection.evaluate.return_value={"ok":False,"body":"private-source-secret","error":"private-source-secret",**result}
                context=Mock();context.__enter__=Mock(return_value=connection);context.__exit__=Mock(return_value=False)
                with patch.object(browser,"target",return_value="ws://127.0.0.1:9222/devtools/page/id"),patch.object(S,"LocalCDPSocket",return_value=context),self.assertRaises(S.SyncError) as error:
                    browser.get_html(S.CHANNEL_PATH,{"tab":"depositChannel","page":1,"limit":1000})
                self.assertIn(expected,str(error.exception));self.assertIn(S.CHANNEL_PATH,str(error.exception))
                self.assertNotIn("private-source-secret",str(error.exception))

    def test_websocket_handshake_tail_fragmented_text_ping_and_masked_runtime_command(self):
        result=json.dumps({"id":1,"result":{"result":{"value":{"ok":True,"html":"<table>synthetic</table>"}}}}).encode()
        notification=server_frame(json.dumps({"method":"Runtime.consoleAPICalled","params":{}}).encode())
        frames=notification+server_frame(result[:20],final=False)+server_frame(b"ping",opcode=9)+server_frame(result[20:],opcode=0)
        fake=FakeCDPSocket(frames)
        with patch.object(S.socket,"create_connection",return_value=fake) as connect:
            with S.LocalCDPSocket("ws://127.0.0.1:9222/devtools/page/synthetic") as connection:
                value=connection.evaluate("synthetic-expression")
        self.assertEqual(value["html"],"<table>synthetic</table>")
        connect.assert_called_once_with(("127.0.0.1",9222),timeout=5)
        self.assertTrue(fake.closed)
        opcode,payload=decode_client_frame(fake.sent[1]);command=json.loads(payload)
        self.assertEqual(opcode,1);self.assertEqual(command["method"],"Runtime.evaluate")
        self.assertFalse(command["params"]["userGesture"])
        self.assertEqual(decode_client_frame(fake.sent[2]),(10,b"ping"))

    def test_bad_handshake_closed_frames_oversized_frames_and_bad_result_fail_closed(self):
        cases=[FakeCDPSocket(invalid_handshake=True),FakeCDPSocket(server_frame(b"",opcode=8)),FakeCDPSocket(bytes([0x81,127])+struct.pack("!Q",S.MAX_CDP_MESSAGE_BYTES+1)),FakeCDPSocket(server_frame(json.dumps({"id":1,"result":{"result":None}}).encode())),FakeCDPSocket(server_frame(json.dumps({"id":1,"result":{"exceptionDetails":{"text":"private-source-error"}}}).encode()))]
        for fake in cases:
            with patch.object(S.socket,"create_connection",return_value=fake),self.assertRaises(S.SyncError) as error:
                with S.LocalCDPSocket("ws://127.0.0.1:9222/devtools/page/id") as connection:connection.evaluate("safe")
            self.assertTrue(fake.closed);self.assertNotIn("private-source-error",str(error.exception))

    def test_scheduler_checks_in_ten_second_steps_and_cancel_prevents_fetch(self):
        with patch.object(S.time,"monotonic",side_effect=[100,110,115]),patch.object(S.time,"sleep") as sleep:
            self.assertTrue(S.wait_until_due(115))
            self.assertEqual([call.args[0] for call in sleep.call_args_list],[10,5])
        stop=threading.Event();stop.set()
        with patch.object(S.time,"sleep") as sleep:
            self.assertFalse(S.wait_until_due(100,stop));sleep.assert_not_called()

    def test_explicit_check_is_immediate_readonly_and_checks_both_sources_without_background_loop(self):
        with tempfile.TemporaryDirectory(prefix="yash-check-") as directory:
            path=Path(directory)/"config.json";path.write_text(json.dumps(cfg(directory,backfill_start="2026-10-01 00:00:00").data))
            source=Mock();source.fetch.return_value=S.Page([],0,0);target=Mock()
            with patch.object(S,"YASH_UPLOAD_TOKEN","synthetic-scoped-token"),patch.object(sys,"argv",["yash_sync.py","--check","--config",str(path)]),patch.object(S,"SourceClient",return_value=source),patch.object(S,"UploadClient",return_value=target),patch.object(S,"channel_sync_cycle",return_value=True) as channels,patch.object(S,"wait_until_due") as waiter,patch.object(S,"channel_polling") as polling:
                self.assertEqual(S.main(),0)
            self.assertEqual(source.fetch.call_count,4)
            channels.assert_called_once_with(source,target,check_only=True)
            waiter.assert_not_called();polling.assert_not_called();target.upsert.assert_not_called()



class StorageMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="yash-storage-test-")
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.script = self.directory / "PY_CODE"
        self.script.mkdir()
        self.legacy = self.script / "yash_sync_config.json"
        self.destination = self.directory / "Desktop" / "PY_DATA" / "yashbet" / "yash_sync_config.json"
        self.previous = self.directory / "Library" / "Application Support" / "YASHBET" / "yash_sync_config.json"
        previous_patch = patch.object(S, "PREVIOUS_CONFIG", self.previous)
        previous_patch.start()
        self.addCleanup(previous_patch.stop)
        self.data = cfg(self.script, site_timezone="UTC+08:00", backfill_start="2026-10-01 00:00:00",
            backfill_timezone="UTC+05:30", state_file="yash_sync_state/progress.sqlite3",
            lock_file="yash_sync_state/sync.lock").data
        self.legacy.write_text(json.dumps(self.data))
        self.state_path = self.script / "yash_sync_state" / "progress.sqlite3"
        self.state = S.State(self.state_path, "preserved-namespace")
        self.state.set("deposit/createTime", "2030-02-01T11:00:00+00:00")
        self.state.track([record()])
        self.state.close()

    def migrate(self):
        return S.migrate_legacy_config(self.destination, self.legacy)

    def test_platform_app_directories_keep_all_default_files_away_from_script(self):
        home = self.directory / "home"
        for platform, environment, expected in (
            ("darwin", {}, home / "Library" / "Application Support" / "YASHBET"),
            ("win32", {"LOCALAPPDATA": str(home / "local")}, home / "local" / "YASHBET"),
            ("win32", {}, home / "AppData" / "Local" / "YASHBET"),
            ("linux", {"XDG_STATE_HOME": str(home / "custom-state")}, home / "custom-state" / "YASHBET"),
            ("linux", {"XDG_STATE_HOME": "relative-invalid"}, home / ".local" / "state" / "YASHBET"),
        ):
            with self.subTest(platform=platform, environment=environment), patch.object(S.sys, "platform", platform), patch.object(S.Path, "home", return_value=home), patch.dict(os.environ, environment, clear=True):
                self.assertEqual(S.previous_application_data_directory(), expected)
                self.assertEqual(S.application_data_directory(), home / "Desktop" / "PY_DATA" / "yashbet")

    def test_migration_preserves_timezone_progress_watched_and_unrelated_files(self):
        unrelated = self.script / "other.py"
        unrelated.write_text("untouched")
        self.assertTrue(self.migrate())
        self.assertFalse(self.legacy.exists())
        self.assertFalse(self.state_path.parent.exists())
        self.assertEqual(unrelated.read_text(), "untouched")
        migrated = S.Config.from_file(self.destination)
        self.assertEqual(migrated.get("site_timezone"), "UTC+08:00")
        self.assertEqual(migrated.get("backfill_timezone"), "UTC+05:30")
        self.assertEqual(migrated.start, S.Config(self.data, self.script).start)
        self.assertEqual(migrated.path("state_file"), (self.destination.parent / "state" / "progress.sqlite3").resolve())
        self.assertEqual(migrated.path("lock_file"), (self.destination.parent / "state" / "sync.lock").resolve())
        reopened = S.State(migrated.path("state_file"), "preserved-namespace")
        try:
            self.assertEqual(reopened.get("deposit/createTime"), "2030-02-01T11:00:00+00:00")
            self.assertEqual(len(reopened.pending(10)), 1)
        finally:
            reopened.close()
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(migrated.path("state_file").stat().st_mode), 0o600)
        self.assertFalse(self.migrate())

    def test_committed_wal_is_included_not_just_main_database_file(self):
        db = S.sqlite3.connect(self.state_path)
        try:
            db.execute("pragma journal_mode=wal")
            db.execute("pragma wal_autocheckpoint=0")
            db.execute("insert into progress values (?,?,?)", ("second-timezone", "withdrawal/completeTime", "latest-wal-progress"))
            db.commit()
            self.assertGreater(Path(str(self.state_path) + "-wal").stat().st_size, 0)
            self.assertTrue(self.migrate())
        finally:
            db.close()
        db = S.State(self.destination.parent / "state" / "progress.sqlite3", "second-timezone")
        try:
            self.assertEqual(db.get("withdrawal/completeTime"), "latest-wal-progress")
        finally:
            db.close()

    def test_active_legacy_process_lock_prevents_migration(self):
        with S.process_lock(self.state_path.parent / "sync.lock"):
            with self.assertRaisesRegex(S.SyncError, "已有一个同步进程"):
                self.migrate()
        self.assertTrue(self.legacy.exists())
        self.assertTrue(self.state_path.exists())
        self.assertFalse(self.destination.exists())

    def test_active_sqlite_writer_prevents_migration_even_without_process_lock(self):
        db = S.sqlite3.connect(self.state_path)
        try:
            db.execute("begin immediate")
            with self.assertRaisesRegex(S.SyncError, "旧断点正在使用"):
                self.migrate()
        finally:
            db.rollback()
            db.close()
        self.assertTrue(self.legacy.exists())
        self.assertTrue(self.state_path.exists())
        self.assertFalse(self.destination.exists())

    def test_existing_destination_config_is_never_overwritten_or_merged(self):
        self.destination.parent.mkdir(parents=True)
        self.destination.write_text("existing-config")
        self.assertFalse(self.migrate())
        self.assertEqual(self.destination.read_text(), "existing-config")
        self.assertTrue(self.legacy.exists())
        self.assertTrue(self.state_path.exists())

    def test_existing_destination_state_or_orphan_log_is_never_overwritten(self):
        state = self.destination.parent / "state" / "progress.sqlite3"
        state.parent.mkdir(parents=True)
        for suffix in ("", "-wal", "-shm", "-journal"):
            path = Path(str(state) + suffix)
            path.write_bytes(b"existing-state")
            with self.assertRaisesRegex(S.SyncError, "已有配置或断点"):
                self.migrate()
            self.assertEqual(path.read_bytes(), b"existing-state")
            self.assertTrue(self.legacy.exists())
            self.assertFalse(self.destination.exists())
            path.unlink()

    def test_failed_publication_rolls_back_only_our_new_files(self):
        actual_link = S.os.link
        def link(source, destination):
            if Path(destination) == self.destination:
                raise OSError("synthetic config publication failure")
            actual_link(source, destination)
        with patch.object(S.os, "link", side_effect=link), self.assertRaises(OSError):
            self.migrate()
        self.assertTrue(self.state_path.exists())
        self.assertTrue(self.legacy.exists())
        self.assertFalse(self.destination.exists())
        self.assertFalse((self.destination.parent / "state" / "progress.sqlite3").exists())
        self.assertTrue(self.migrate())

    def test_unrecognized_files_in_state_directory_are_preserved(self):
        extra = self.state_path.parent / "other-app.sqlite3"
        extra.write_bytes(b"not-ours")
        self.migrate()
        self.assertEqual(extra.read_bytes(), b"not-ours")
        self.assertFalse(self.state_path.exists())
        self.assertFalse(self.legacy.exists())

    def test_corrupt_or_custom_state_is_preserved_and_never_reinitialized(self):
        self.state_path.write_bytes(b"not-a-database")
        with self.assertRaisesRegex(S.SyncError, "无法完整读取"):
            self.migrate()
        self.assertEqual(self.state_path.read_bytes(), b"not-a-database")
        self.assertFalse(self.destination.exists())
        self.data["state_file"] = "other-app/progress.sqlite3"
        self.legacy.write_text(json.dumps(self.data))
        with self.assertRaisesRegex(S.SyncError, "自定义"):
            self.migrate()
        self.assertTrue(self.legacy.exists())

    @unittest.skipIf(os.name == "nt", "symlink creation may require Windows developer mode")
    def test_symlinked_legacy_state_is_not_moved_or_deleted(self):
        actual = self.script / "external-state"
        self.state_path.parent.rename(actual)
        self.state_path.parent.symlink_to(actual, target_is_directory=True)
        with self.assertRaisesRegex(S.SyncError, "链接断点"):
            self.migrate()
        self.assertTrue(self.legacy.exists())
        self.assertTrue((actual / "progress.sqlite3").exists())

    def test_default_main_migrates_offline_then_check_remains_explicit(self):
        with patch.object(S, "DEFAULT_CONFIG", self.destination), patch.object(S, "LEGACY_CONFIG", self.legacy), patch.object(sys, "argv", ["yash_sync.py", "--refresh"]), patch.object(S, "UploadClient") as target, patch.object(S, "SourceClient") as source, patch("builtins.input", return_value=""), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(S.main(), 0)
            source.assert_not_called()
            target.return_value.verify.assert_not_called()
            target.return_value.request.assert_not_called()
        self.assertFalse(self.legacy.exists())
        self.assertEqual(json.loads(self.destination.read_text())["site_timezone"], "UTC+08:00")

    def test_explicit_config_path_retains_existing_behavior_without_auto_migration(self):
        with patch.object(sys, "argv", ["yash_sync.py", "--config", str(self.legacy), "--refresh"]), patch.object(S, "migrate_legacy_config") as migrate, patch.object(S, "UploadClient"), patch.object(S, "SourceClient") as source, patch("builtins.input", return_value=""), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(S.main(), 0)
            migrate.assert_not_called()
            source.assert_not_called()
        self.assertTrue(self.legacy.exists())
        self.assertFalse(self.destination.exists())

    def prepare_previous_layout(self, keep_legacy=False):
        self.previous.parent.mkdir(parents=True)
        data = dict(self.data, state_file="state/progress.sqlite3", lock_file="state/sync.lock")
        self.previous.write_text(json.dumps(data))
        previous_state = self.previous.parent / "state" / "progress.sqlite3"
        previous_state.parent.mkdir()
        previous_state.write_bytes(self.state_path.read_bytes())
        if not keep_legacy:
            self.state_path.unlink()
            self.state_path.parent.rmdir()
            self.legacy.unlink()
        return previous_state

    def migrate_locations(self):
        with patch.object(S, "LEGACY_CONFIG", self.legacy):
            return S.migrate_previous_locations(self.destination)

    def test_version_three_appsupport_layout_migrates_and_removes_only_known_files(self):
        previous_state = self.prepare_previous_layout()
        unrelated = self.previous.parent / "notes.txt"
        unrelated.write_text("untouched")
        self.assertTrue(self.migrate_locations())
        self.assertTrue(self.destination.exists())
        self.assertFalse(self.previous.exists())
        self.assertFalse(previous_state.parent.exists())
        self.assertFalse((self.previous.parent / "storage.lock").exists())
        self.assertEqual(unrelated.read_text(), "untouched")
        state = S.State(self.destination.parent / "state" / "progress.sqlite3", "preserved-namespace")
        try:
            self.assertEqual(state.get("deposit/createTime"), "2030-02-01T11:00:00+00:00")
            self.assertEqual(len(state.pending(10)), 1)
        finally:
            state.close()
        self.assertEqual(json.loads(self.destination.read_text())["site_timezone"], "UTC+08:00")
        self.assertFalse(self.migrate_locations())

    def test_version_three_storage_lock_blocks_migration_during_setup_or_refresh(self):
        previous_state = self.prepare_previous_layout()
        with S.process_lock(self.previous.parent / "storage.lock"):
            with self.assertRaisesRegex(S.SyncError, "已有一个同步进程"):
                self.migrate_locations()
        self.assertTrue(self.previous.exists())
        self.assertTrue(previous_state.exists())
        self.assertFalse(self.destination.exists())

    def test_multiple_legacy_locations_never_choose_or_combine_progress(self):
        previous_state = self.prepare_previous_layout(keep_legacy=True)
        snapshot = {path: path.read_bytes() for path in (self.legacy, self.state_path, self.previous, previous_state)}
        with self.assertRaisesRegex(S.SyncError, "两处原文件均保留"):
            self.migrate_locations()
        self.assertFalse(self.destination.exists())
        for path, before in snapshot.items():
            self.assertEqual(path.read_bytes(), before)

    def test_existing_requested_destination_wins_without_touching_either_legacy(self):
        previous_state = self.prepare_previous_layout(keep_legacy=True)
        self.destination.parent.mkdir(parents=True)
        self.destination.write_text("authoritative-new-config")
        self.assertFalse(self.migrate_locations())
        self.assertEqual(self.destination.read_text(), "authoritative-new-config")
        for path in (self.legacy, self.state_path, self.previous, previous_state):
            self.assertTrue(path.exists())

    def test_orphan_old_state_is_not_silently_ignored_or_reinitialized(self):
        self.legacy.unlink()
        with self.assertRaisesRegex(S.SyncError, "有 YASH 断点但缺少配置"):
            self.migrate_locations()
        self.assertTrue(self.state_path.exists())
        self.assertFalse(self.destination.exists())

    def test_active_new_process_prevents_migration_and_source_initialization(self):
        with S.process_lock(self.destination.parent / "storage.lock"), patch.object(S, "DEFAULT_CONFIG", self.destination), patch.object(S, "LEGACY_CONFIG", self.legacy), patch.object(sys, "argv", ["yash_sync.py", "--once"]), patch.object(S, "UploadClient"), patch.object(S, "SourceClient") as source, patch.object(S, "migrate_legacy_config") as migrate:
            self.assertEqual(S.main(), 1)
            migrate.assert_not_called()
            source.assert_not_called()
        self.assertTrue(self.legacy.exists())
        self.assertFalse(self.destination.exists())

    def test_main_keeps_process_lock_until_state_connection_closes(self):
        events = []
        @contextlib.contextmanager
        def lock(path):
            events.append("lock")
            try:
                yield
            finally:
                events.append("unlock")
        state = Mock()
        state.close.side_effect = lambda: events.append("close-state")
        with patch.object(sys, "argv", ["yash_sync.py", "--config", str(self.legacy), "--once"]), patch.object(S, "UploadClient"), patch.object(S, "SourceClient"), patch.object(S, "State", return_value=state), patch.object(S, "process_lock", side_effect=lock), patch.object(S, "channel_sync_cycle", return_value=True), patch.object(S, "run_cycle"), patch.object(S, "wait_until_due", return_value=True):
            self.assertEqual(S.main(), 0)
        self.assertEqual(events, ["lock", "close-state", "unlock"])


class FixedTenMinuteScheduleTests(unittest.TestCase):
    def test_channels_keep_ten_minute_cadence_after_a_failed_cycle(self):
        config = cfg(".", interval_seconds=60, channel_interval_seconds=60)
        stop = threading.Event()
        now = {"value": 100}
        deadlines = []
        def wait(due, event):
            self.assertIs(event, stop)
            deadlines.append(due)
            now["value"] = due
            return len(deadlines) < 3
        with patch.object(S, "SourceClient"), patch.object(S, "UploadClient"), patch.object(S.time, "monotonic", side_effect=lambda: now["value"]), patch.object(S, "wait_until_due", side_effect=wait), patch.object(S, "channel_sync_cycle", side_effect=[False, True]) as cycle:
            S.poll_channels(config, stop)
        self.assertEqual(S.SYNC_INTERVAL_SECONDS, 600)
        self.assertEqual(S.CHANNEL_INTERVAL_SECONDS, 600)
        self.assertEqual(deadlines, [110, 710, 1310])
        self.assertEqual(cycle.call_count, 2)

    def test_loop_survives_upload_503_preserves_checkpoint_then_recovers_using_old_config(self):
        with tempfile.TemporaryDirectory(prefix="yash-loop-retry-") as directory:
            path = Path(directory) / "config.json"
            config = cfg(directory, interval_seconds=60, channel_interval_seconds=60)
            path.write_text(json.dumps(config.data))
            state_path = Path(directory) / "state/progress.sqlite3"
            source, target, opener = Mock(), Mock(), Mock()
            private_marker = "SYNTHETIC_PRIVATE_HTTP_BODY"
            opener.open.side_effect = S.HTTPError(S.YASH_UPLOAD_URL, 503, private_marker, {}, io.BytesIO(private_marker.encode()))
            first_upload = {"pending": True}
            def upsert(rows):
                if first_upload["pending"]:
                    first_upload["pending"] = False
                    S.http_request(S.YASH_UPLOAD_URL, {"X-Yash-Key": "synthetic-upload-key"}, b"{}", purpose="upload")
            target.upsert.side_effect = upsert
            now, deadlines = {"value": 100}, []
            def wait(due):
                deadlines.append(due)
                now["value"] = due
                if len(deadlines) == 2:
                    # A failed server response must not mark even an empty window complete.
                    with S.sqlite3.connect(state_path) as db:
                        self.assertEqual(db.execute("select count(*) from progress").fetchone()[0], 0)
                    target.receipt.assert_not_called()
                if len(deadlines) == 3:
                    with S.sqlite3.connect(state_path) as db:
                        progress = dict(db.execute("select name,value from progress"))
                    for kind in S.ENDPOINTS:
                        for basis in ("createTime", "completeTime"):
                            self.assertEqual(progress[kind + "/" + basis], NOW.isoformat())
                    raise KeyboardInterrupt()
                return True
            with patch.object(sys, "argv", ["yash_cdp.py", "--loop", "--config", str(path)]), patch.object(S, "SourceClient", return_value=source), patch.object(S, "UploadClient", return_value=target), patch.object(S, "channel_polling", return_value=contextlib.nullcontext()) as channels, patch.object(S, "collect_window", return_value=[]), patch.object(S, "datetime", FrozenDatetime), patch.object(S.time, "monotonic", side_effect=lambda: now["value"]), patch.object(S.time, "sleep") as sleep, patch.object(S, "wait_until_due", side_effect=wait), patch.object(S, "upload_tls_context", return_value=S.ssl.SSLContext(S.ssl.PROTOCOL_TLS_CLIENT)), patch.object(S, "build_opener", return_value=opener), self.assertLogs(S.LOG, level="INFO") as logs:
                self.assertEqual(S.main(), 0)
            self.assertEqual(deadlines, [110, 710, 1310])
            self.assertEqual(opener.open.call_count, 4)
            self.assertEqual([call.args for call in sleep.call_args_list], [(2,), (4,), (8,)])
            self.assertEqual(target.receipt.call_count, 4)
            channels.assert_called_once()
            text = "\n".join(logs.output)
            self.assertIn("服务暂时不可用（HTTP 503）", text)
            self.assertIn("持续同步仍在运行", text)
            self.assertNotIn(private_marker, text)
            self.assertEqual(json.loads(path.read_text())["interval_seconds"], 60)

    def test_once_still_reports_failure_instead_of_claiming_a_complete_backfill(self):
        with tempfile.TemporaryDirectory(prefix="yash-once-retry-") as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(cfg(directory).data))
            with patch.object(sys, "argv", ["yash_cdp.py", "--once", "--config", str(path)]), patch.object(S, "UploadClient"), patch.object(S, "SourceClient"), patch.object(S, "channel_sync_cycle", return_value=True), patch.object(S, "channel_polling") as background, patch.object(S, "run_cycle", side_effect=S.SyncError("Supabase 上传服务暂时不可用（HTTP 503）")), patch.object(S, "wait_until_due", return_value=True):
                self.assertEqual(S.main(), 1)
            background.assert_not_called()


class UploadTLSTests(unittest.TestCase):
    def tls(self):
        # Real secure context, but no certificate or network operations in tests.
        return S.ssl.SSLContext(S.ssl.PROTOCOL_TLS_CLIENT)

    def test_empty_macos_default_store_loads_system_roots_without_relaxing_tls(self):
        context = self.tls()
        with patch.object(S.ssl, "create_default_context", return_value=context), patch.dict(os.environ, {}, clear=True), patch.object(S.sys, "platform", "darwin"), patch.dict(sys.modules, {"certifi": None}), patch.object(S.Path, "is_file", return_value=True), patch.object(S.ssl.SSLContext, "cert_store_stats", side_effect=[{"x509_ca": 0}, {"x509_ca": 128}]), patch.object(S.ssl.SSLContext, "load_verify_locations") as load:
            self.assertIs(S.upload_tls_context(), context)
        load.assert_called_once_with(cafile="/etc/ssl/cert.pem")
        self.assertEqual(context.verify_mode, S.ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_existing_root_store_never_adds_alternate_bundle(self):
        context = self.tls()
        with patch.object(S.ssl, "create_default_context", return_value=context), patch.dict(os.environ, {}, clear=True), patch.object(S.ssl.SSLContext, "cert_store_stats", return_value={"x509_ca": 12}), patch.object(S.ssl.SSLContext, "load_verify_locations") as load:
            self.assertIs(S.upload_tls_context(), context)
        load.assert_not_called()
        self.assertTrue(context.check_hostname)

    def test_explicit_ssl_file_or_directory_does_not_fall_back_even_with_zero_roots(self):
        for name in ("SSL_CERT_FILE", "SSL_CERT_DIR"):
            with self.subTest(name=name):
                context = self.tls()
                with patch.object(S.ssl, "create_default_context", return_value=context), patch.dict(os.environ, {name: "/synthetic/explicit-trust"}, clear=True), patch.object(S.ssl.SSLContext, "cert_store_stats", return_value={"x509_ca": 0}), patch.object(S.ssl.SSLContext, "load_verify_locations") as load:
                    self.assertIs(S.upload_tls_context(), context)
                load.assert_not_called()
                self.assertEqual(context.verify_mode, S.ssl.CERT_REQUIRED)

    def test_existing_certifi_is_optional_fallback_when_system_bundle_is_missing(self):
        context = self.tls()
        certifi = Mock()
        certifi.where.return_value = "/synthetic/certifi.pem"
        with patch.object(S.ssl, "create_default_context", return_value=context), patch.dict(os.environ, {}, clear=True), patch.object(S.sys, "platform", "darwin"), patch.dict(sys.modules, {"certifi": certifi}), patch.object(S.Path, "is_file", autospec=True, side_effect=lambda p: str(p) == "/synthetic/certifi.pem"), patch.object(S.ssl.SSLContext, "cert_store_stats", side_effect=[{"x509_ca": 0}, {"x509_ca": 136}]), patch.object(S.ssl.SSLContext, "load_verify_locations") as load:
            self.assertIs(S.upload_tls_context(), context)
        load.assert_called_once_with(cafile="/synthetic/certifi.pem")
        self.assertEqual(context.verify_mode, S.ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_all_ca_sources_missing_reports_actionable_error(self):
        context = self.tls()
        paths = Mock(capath=None)
        with patch.object(S.ssl, "create_default_context", return_value=context), patch.dict(os.environ, {}, clear=True), patch.object(S.sys, "platform", "darwin"), patch.dict(sys.modules, {"certifi": None}), patch.object(S.Path, "is_file", return_value=False), patch.object(S.ssl.SSLContext, "cert_store_stats", return_value={"x509_ca": 0}), patch.object(S.ssl, "get_default_verify_paths", return_value=paths), patch.object(S.ssl.SSLContext, "load_verify_locations") as load:
            with self.assertRaisesRegex(S.SyncError, "没有可用的受信任证书库"):
                S.upload_tls_context()
        load.assert_not_called()
        self.assertEqual(context.verify_mode, S.ssl.CERT_REQUIRED)

    def test_hashed_ca_directory_can_load_roots_lazily(self):
        context = self.tls()
        with patch.object(S.ssl, "create_default_context", return_value=context), patch.dict(os.environ, {}, clear=True), patch.object(S.sys, "platform", "linux"), patch.dict(sys.modules, {"certifi": None}), patch.object(S.ssl.SSLContext, "cert_store_stats", return_value={"x509_ca": 0}), patch.object(S.ssl, "get_default_verify_paths", return_value=Mock(capath="/synthetic/hashed-ca")):
            self.assertIs(S.upload_tls_context(), context)
        self.assertTrue(context.check_hostname)

    def test_invalid_default_certificate_configuration_never_leaks_error_text(self):
        with patch.object(S.ssl, "create_default_context", side_effect=OSError("SECRET.proxy:user@host/private.pem")):
            with self.assertRaises(S.SyncError) as error:
                S.upload_tls_context()
        self.assertIn("证书配置无法加载", str(error.exception))
        self.assertNotIn("SECRET", str(error.exception))

    def request(self, opener):
        context = self.tls()
        with patch.object(S, "upload_tls_context", return_value=context), patch.object(S, "build_opener", return_value=opener) as build, patch.object(S.time, "sleep") as sleep:
            try:
                result = S.http_request(S.YASH_UPLOAD_URL, {"X-Yash-Key": "SYNTHETIC_PRIVATE_KEY"}, b"{}", purpose="upload")
                error = None
            except S.SyncError as exc:
                result, error = None, exc
        handlers = build.call_args.args
        self.assertEqual(len(handlers), 2)
        self.assertTrue(any(isinstance(handler, S.NoRedirect) for handler in handlers))
        tls_handler = next(handler for handler in handlers if isinstance(handler, S.HTTPSHandler))
        self.assertIs(tls_handler._context, context)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, S.ssl.CERT_REQUIRED)
        return result, error, sleep

    def test_certificate_failure_stops_immediately_without_blind_retries(self):
        opener = Mock()
        opener.open.side_effect = S.URLError(S.ssl.SSLCertVerificationError(1, "SYNTHETIC_PRIVATE_KEY certificate text"))
        result, error, sleep = self.request(opener)
        self.assertIsNone(result)
        self.assertIn("HTTPS 证书校验失败", str(error))
        self.assertIn("Supabase 上传连接", str(error))
        self.assertNotIn("SYNTHETIC_PRIVATE_KEY", str(error))
        self.assertEqual(opener.open.call_count, 1)
        sleep.assert_not_called()

    def test_network_categories_are_sanitized_and_retries_bounded(self):
        secret = "SYNTHETIC_PRIVATE_KEY https://user:password@proxy.invalid"
        examples = (
            (S.socket.gaierror(-2, secret), "域名解析失败"),
            (TimeoutError(secret), "连接或读取超时"),
            (ConnectionRefusedError(61, secret), "连接被拒绝"),
            (S.ssl.SSLError(1, secret), "TLS 安全连接未完成"),
            (OSError(secret), "连接中断"),
            (secret, "连接中断"),
        )
        for reason, message in examples:
            with self.subTest(category=message, kind=type(reason).__name__):
                opener = Mock()
                opener.open.side_effect = S.URLError(reason)
                result, error, sleep = self.request(opener)
                self.assertIsNone(result)
                self.assertIn(message, str(error))
                self.assertNotIn("SYNTHETIC_PRIVATE_KEY", str(error))
                self.assertNotIn("password", str(error))
                self.assertEqual(opener.open.call_count, 4)
                self.assertEqual([call.args for call in sleep.call_args_list], [(2,), (4,), (8,)])

    def test_proxy_tunnel_authentication_failure_does_not_blindly_retry(self):
        opener = Mock()
        opener.open.side_effect = S.URLError(OSError("Tunnel connection failed: 407 SYNTHETIC_PRIVATE_KEY"))
        _, error, sleep = self.request(opener)
        self.assertIn("代理要求认证", str(error))
        self.assertNotIn("SYNTHETIC_PRIVATE_KEY", str(error))
        self.assertEqual(opener.open.call_count, 1)
        sleep.assert_not_called()

    def test_http_407_has_proxy_diagnostic_without_retry_or_response_leak(self):
        opener = Mock()
        error = S.HTTPError(S.YASH_UPLOAD_URL, 407, "SYNTHETIC_PRIVATE_KEY proxy authentication", {}, io.BytesIO(b"SYNTHETIC_PRIVATE_KEY"))
        opener.open.side_effect = error
        _, failure, sleep = self.request(opener)
        self.assertIn("代理", str(failure))
        self.assertNotIn("SYNTHETIC_PRIVATE_KEY", str(failure))
        self.assertEqual(opener.open.call_count, 1)
        sleep.assert_not_called()

    def test_http_service_errors_are_distinct_from_activation_and_bounded(self):
        for code, fragment, attempts in ((503, "服务暂时不可用", 4), (502, "服务暂时不可用", 4), (429, "限制请求频率", 4), (401, "上传授权未通过", 1), (403, "上传授权未通过", 1), (400, "上传请求未被接受", 1)):
            with self.subTest(code=code):
                opener = Mock()
                opener.open.side_effect = S.HTTPError(S.YASH_UPLOAD_URL, code, "SYNTHETIC_PRIVATE_KEY", {}, io.BytesIO(b"SYNTHETIC_PRIVATE_KEY"))
                _, failure, sleep = self.request(opener)
                self.assertIn(fragment, str(failure))
                self.assertIn(str(code), str(failure))
                self.assertNotIn("SYNTHETIC_PRIVATE_KEY", str(failure))
                self.assertEqual(opener.open.call_count, attempts)
                if attempts == 4:
                    self.assertNotIn("激活", str(failure))
                    self.assertEqual([call.args for call in sleep.call_args_list], [(2,), (4,), (8,)])
                else:
                    sleep.assert_not_called()

    def test_transient_timeout_recovers_without_resetting_tls_or_upload_headers(self):
        response = Mock()
        response.read.return_value = b'{"ok":true}'
        response.headers = {"Content-Type": "application/json"}
        manager = Mock()
        manager.__enter__ = Mock(return_value=response)
        manager.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.side_effect = [S.URLError(TimeoutError("synthetic")), manager]
        result, error, sleep = self.request(opener)
        self.assertIsNone(error)
        self.assertEqual(result, (b'{"ok":true}', response.headers))
        self.assertEqual(opener.open.call_count, 2)
        sleep.assert_called_once_with(2)
        for call in opener.open.call_args_list:
            self.assertEqual(call.args[0].get_header("X-yash-key"), "SYNTHETIC_PRIVATE_KEY")
            self.assertEqual(call.args[0].data, b"{}")
            self.assertEqual(call.kwargs, {"timeout": 60})


if __name__=="__main__":
    unittest.main()
