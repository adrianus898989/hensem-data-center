"""Offline collector contract tests. Synthetic data; every network call is mocked."""
import contextlib
from datetime import datetime, timedelta, timezone
from html import escape
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
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
    def test_curl_is_parsed_not_executed_and_rejects_wrong_host_post_or_shell_operators(self):
        headers=S.import_curl("curl 'https://yash.y-o-admin.com/admin/order/index?page=1' -b 'session=synthetic' -H 'Accept: text/html'")
        self.assertEqual(headers["cookie"],"session=synthetic")
        for text in ("curl https://evil.example/admin/order/index -b session=synthetic", "curl https://yash.y-o-admin.com/admin/order/index -b session=synthetic -X POST", "curl https://yash.y-o-admin.com/admin/order/index -b session=synthetic ';' touch /tmp/forbidden"):
            with self.assertRaises(S.SyncError):S.import_curl(text)

    def test_first_activation_only_requires_source_request_and_timezone_and_saves_private_config(self):
        with tempfile.TemporaryDirectory(prefix="yash-config-test-") as directory:
            path=Path(directory)/"config.json"
            with patch.object(S,"read_request",return_value={"cookie":"session=synthetic"}),patch("builtins.input",side_effect=["","UTC+05:30"]),contextlib.redirect_stdout(io.StringIO()):
                S.prepare_config(path)
            values=json.loads(path.read_text())
            self.assertEqual(values["interval_seconds"],600)
            self.assertEqual(values["backfill_start"],"2026-10-01 00:00:00")
            self.assertEqual(values["site_timezone"],"UTC+05:30")
            self.assertEqual(values["backfill_timezone"],"UTC+05:30")
            self.assertNotIn("supabase_secret_key",values)
            self.assertNotIn("supabase_url",values)
            if os.name!="nt":self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
            S.Config.from_file(path)

    def test_october_first_business_start_stays_indian_midnight_for_each_source_display_timezone(self):
        for source_zone in ("UTC","UTC+08:00","UTC+05:30"):
            config=cfg(".",backfill_start="2026-10-01 00:00:00",site_timezone=source_zone)
            self.assertEqual(config.start,datetime(2026,9,30,18,30,tzinfo=UTC))
            self.assertEqual(config.zone,S.site_zone(source_zone))

    def test_default_activation_prechecks_four_views_and_enters_ten_minute_loop(self):
        with tempfile.TemporaryDirectory(prefix="yash-main-test-") as directory:
            path=Path(directory)/"config.json";config=cfg(directory,backfill_start="2026-10-01 00:00:00")
            path.write_text(json.dumps(config.data))
            source=Mock();source.fetch.return_value=S.Page([],0,0);target=Mock()
            with patch.object(S,"YASH_UPLOAD_TOKEN","synthetic-scoped-token"),patch.object(sys,"argv",["yash_sync.py","--config",str(path)]),patch.object(S,"SourceClient",return_value=source),patch.object(S,"UploadClient") as client,patch.object(S,"run_cycle",side_effect=KeyboardInterrupt) as cycle:
                client.return_value=target
                self.assertEqual(S.main(),0)
            self.assertEqual(source.fetch.call_count,4)
            self.assertEqual(cycle.call_args.kwargs["budget_seconds"],480)

    def test_refresh_preserves_checkpoint_scope_and_removes_legacy_project_credentials(self):
        with tempfile.TemporaryDirectory(prefix="yash-refresh-test-") as directory:
            path=Path(directory)/"config.json"
            old={"site_timezone":"UTC","backfill_start":"2026-10-01 00:00:00","headers_file":"config.json","state_file":"state/progress.sqlite3","supabase_secret_key":"synthetic-old-key","supabase_url":"https://synthetic.supabase.co"}
            path.write_text(json.dumps(old))
            with patch.object(S,"read_request",return_value={"cookie":"session=new-synthetic"}),patch("builtins.input",return_value=""),contextlib.redirect_stdout(io.StringIO()):S.prepare_config(path,refresh=True)
            updated=json.loads(path.read_text());self.assertEqual(updated["state_file"],old["state_file"]);self.assertEqual(updated["backfill_start"],old["backfill_start"]);self.assertNotIn("supabase_secret_key",updated)

    def test_source_query_keeps_inclusive_end_and_never_receives_upload_token(self):
        from email.message import Message
        with tempfile.TemporaryDirectory(prefix="yash-source-test-") as directory:
            config=cfg(directory);(Path(directory)/"config.json").write_text(json.dumps({"source_headers":{"default":{"cookie":"session=synthetic"}}}))
            response=Message();response["Content-Type"]="text/html; charset=utf-8"
            with patch.object(S,"http_request",return_value=(html().encode(),response)) as request,patch.object(S.time,"sleep"):
                S.SourceClient(config).fetch("deposit","createTime",START,NOW,1)
            url,headers=request.call_args.args
            self.assertIn("endDate=2030-02-01+12%3A00%3A00",url)
            self.assertNotIn("X-Yash-Key",headers)
            self.assertNotIn("Authorization",headers)


if __name__=="__main__":
    unittest.main()
