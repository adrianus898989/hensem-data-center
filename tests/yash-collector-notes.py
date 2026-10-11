"""Offline optional YASH note capture and independent history replay regressions."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('yash_notes_base', ROOT / 'tests/yash-collector-sync.py')
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
S, UTC, NOW = B.S, B.UTC, B.NOW


def parsed(changes=None, *, missing=(), kind='withdrawal'):
    values = B.source_row(kind, **(changes or {}))
    for key in missing:
        values.pop(key, None)
    return S.parse_page(B.html([values]), kind, 'yash', 'UTC', NOW)


class NoteParseTests(unittest.TestCase):
    def test_two_true_source_columns_are_separate_and_never_enter_raw_fields(self):
        page = parsed({'订单备注': 'Order business text', '风控备注': 'Risk business text'})
        row = page.rows[0]
        self.assertEqual((row['order_note'], row['risk_note']), ('Order business text', 'Risk business text'))
        self.assertTrue(page.note_headers_complete)
        self.assertNotIn('订单备注', row['raw_fields']); self.assertNotIn('风控备注', row['raw_fields'])
        self.assertFalse(any(key in parsed(kind='deposit').rows[0] for key in ('order_note', 'risk_note')))

    def test_missing_column_is_unknown_while_explicit_empty_is_not_missing(self):
        row = parsed({'订单备注': '', '风控备注': '  '}).rows[0]
        self.assertEqual((row['order_note'], row['risk_note']), ('', ''))
        page = parsed({'订单备注': ''}, missing=('风控备注',))
        self.assertEqual(page.rows[0]['order_note'], ''); self.assertNotIn('risk_note', page.rows[0])
        self.assertFalse(page.note_headers_complete)
        self.assertEqual(parsed({'订单备注': '-'}).rows[0]['order_note'], '-')

    def test_normal_missing_headers_omit_updates_while_present_source_empty_is_explicit(self):
        for missing in (('订单备注',), ('风控备注',), ('订单备注', '风控备注')):
            page = parsed({'订单备注': 'Existing order business note', '风控备注': ''}, missing=missing)
            row = page.rows[0]
            for field, header in (('order_note', '订单备注'), ('risk_note', '风控备注')):
                if header in missing:
                    self.assertNotIn(field, row, 'a missing source column must not clear a previously stored note')
                else:
                    self.assertEqual(row[field], 'Existing order business note' if field == 'order_note' else '')
            with patch.object(S, 'datetime', B.FrozenDatetime): S.validate_order_upload(page.rows)
            self.assertFalse(page.note_headers_complete)

    def test_sensitive_text_is_redacted_but_known_native_order_identifiers_survive(self):
        order = 'YASH-NATIVE-ORDER-123456789012345678901234567890'
        child = '98765432101234567890'
        text = f'订单号 {order}; 子单 {child}; password=synthetic-secret; 银行卡号:1234567890123456; phone:98765432101234567890; https://example.invalid/{order}; person@example.invalid; 222333444555666; Bearer opaque-private-token-value-abcdefghijklmnop'
        row = parsed({'订单号': order, '子订单号': child, '订单备注': text}).rows[0]
        note = row['order_note']
        self.assertIn(order, note); self.assertIn(child, note)
        remainder = note.replace(order, '').replace(child, '')
        for private in ('synthetic-secret', '1234567890123456', 'https://', 'person@example', '222333444555666', 'opaque-private-token-value'):
            self.assertNotIn(private, remainder)
        self.assertNotIn('\n', note)

    def test_known_ids_do_not_prevent_credential_or_contact_assignments_being_hidden(self):
        value = 'phone:1234567890123; token:ORDER-NATIVE-12345678901234567890; 单号 ORDER-NATIVE-12345678901234567890'
        note, issue = S.order_business_note(value, ['1234567890123', 'ORDER-NATIVE-12345678901234567890'])
        self.assertFalse(issue); self.assertNotIn('1234567890123', note.replace('ORDER-NATIVE-12345678901234567890', ''))
        self.assertEqual(note.count('ORDER-NATIVE-12345678901234567890'), 1)

    def test_short_ids_cannot_split_formatted_phone_redaction(self):
        note, issue = S.order_business_note('联系 91 123 456 7890; 单号 123', ['1', '91', '123'])
        self.assertFalse(issue); self.assertNotIn('456', note); self.assertNotIn('7890', note)
        self.assertIn('单号 123', note)

    def test_explicit_international_phone_is_hidden_before_long_id_protection(self):
        order = '1234567890123'
        note, issue = S.order_business_note(f'联系 +91 ({order}); 单号 {order}', [order, '91'])
        self.assertFalse(issue); self.assertEqual(note.count(order), 1)
        self.assertNotIn('+91', note); self.assertIn('单号 ' + order, note)

    def test_overlong_optional_field_stays_unknown_and_does_not_drop_order(self):
        with self.assertLogs(S.LOG, level='WARNING') as messages:
            page = parsed({'订单备注': 'X' * 2001, '风控备注': 'Known risk'})
        row = page.rows[0]
        self.assertIsNone(row['order_note']); self.assertEqual(row['risk_note'], 'Known risk')
        self.assertEqual(len(page.rows), 1); self.assertTrue(page.note_headers_complete)
        self.assertNotIn('X' * 50, '\n'.join(messages.output)); self.assertIn('未知', messages.output[0])
        with patch.object(S, 'datetime', B.FrozenDatetime): S.validate_order_upload(page.rows)

    def test_controls_are_optional_unknown_and_exact_unicode_limit_is_preserved(self):
        self.assertEqual(S.order_business_note('业务' * 1000), ('业务' * 1000, False))
        self.assertEqual(S.order_business_note('业务\x01秘密'), (None, True))
        self.assertEqual(S.order_business_note(None), (None, False))
        self.assertEqual(S.order_business_note(''), ('', False))

    def test_uploaded_values_require_withdrawal_single_line_limit_and_legacy_remains_valid(self):
        row = parsed().rows[0]
        with patch.object(S, 'datetime', B.FrozenDatetime):
            for value in ('X' * 2001, 'line\nbreak', 123):
                bad = {**row, 'order_note': value}
                with self.assertRaises(S.SyncError): S.validate_order_upload([bad])
            with self.assertRaises(S.SyncError): S.validate_order_upload([{**row, 'order_type': 'deposit'}])
            legacy = {k:v for k,v in row.items() if k not in ('order_note','risk_note')}
            S.validate_order_upload([legacy]); S.validate_order_upload([{**row,'order_note':'','risk_note':None}])


class NoteHistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.cfg = B.cfg(self.directory.name)
        self.state = S.State(Path(self.directory.name) / 'progress.sqlite3', 'synthetic-scope')
        self.addCleanup(self.state.close)
        self.start, self.end = S.notes_backfill_bounds('2026-10-09','2026-10-10', NOW)
        self.name = 'withdrawal/notes_v1/createTime/' + self.start.isoformat() + '/' + self.end.isoformat()
        self.old = {name:'2030-01-01T00:00:00+00:00' for name in ('deposit/createTime','deposit/completeTime','withdrawal/createTime','withdrawal/completeTime','reconcile','reconcile_target')}
        self.state.set_many(self.old)
        self.state.db.execute("insert into watched values('synthetic-scope','withdrawal','watched-order','2030-01-01T00:00:00Z','unchanged')"); self.state.db.commit()

    def test_indian_inclusive_dates_are_independent_of_source_display_timezone(self):
        self.assertEqual(self.start.isoformat(), '2026-10-08T18:30:00+00:00')
        self.assertEqual(self.end.isoformat(), '2026-10-10T18:30:00+00:00')
        for zone in ('UTC','UTC+08:00','UTC+05:30','Asia/Kolkata'):
            with patch.object(self.cfg, 'data', {**self.cfg.data, 'site_timezone':zone}):
                self.assertEqual(S.notes_backfill_bounds('2026-10-09','2026-10-10',NOW),(self.start,self.end))
        for first,last in (('20261009','2026-10-10'),('2026-02-30','2026-10-10'),('2026-10-10','2026-10-09'),('2030-02-01','2030-02-01')):
            with self.assertRaises(S.SyncError): S.notes_backfill_bounds(first,last,NOW)

    def test_two_day_replay_keeps_all_original_progress_and_watched_rows(self):
        rows = [{'order_note':'Known','risk_note':''}]
        with patch.object(S, 'window_sync', return_value=rows) as window:
            S.run_notes_backfill(self.cfg,self.state,Mock(),Mock(),self.start,self.end)
        self.assertEqual(window.call_count,2)
        for call in window.call_args_list:
            self.assertEqual(call.args[3:5],('withdrawal','createTime')); self.assertEqual(call.kwargs,{'require_notes':True})
        self.assertEqual({name:self.state.get(name) for name in self.old},self.old)
        self.assertEqual(self.state.db.execute('select * from watched').fetchall(), [('synthetic-scope','withdrawal','watched-order','2030-01-01T00:00:00Z','unchanged')])
        self.assertEqual(self.state.get(self.name), self.end.isoformat())
        with patch.object(S, 'window_sync') as window:
            S.run_notes_backfill(self.cfg,self.state,Mock(),Mock(),self.start,self.end)
            window.assert_not_called()

    def test_failure_and_restart_only_resume_unfinished_note_day(self):
        rows = [{'order_note':None,'risk_note':''}]
        with patch.object(S,'window_sync',side_effect=[rows,S.SyncError('Synthetic upload unavailable')]):
            with self.assertRaises(S.SyncError): S.run_notes_backfill(self.cfg,self.state,Mock(),Mock(),self.start,self.end)
        second = self.start + timedelta(days=1)
        self.assertEqual(self.state.get(self.name), second.isoformat()); self.assertEqual(self.state.get(self.name+'/unknown_fields'),'1')
        with patch.object(S,'window_sync',return_value=rows) as window, self.assertLogs(S.LOG,level='WARNING') as messages:
            S.run_notes_backfill(self.cfg,self.state,Mock(),Mock(),self.start,self.end)
        self.assertEqual(window.call_count,1); self.assertEqual(window.call_args.args[5],second)
        self.assertEqual(self.state.get(self.name+'/unknown_fields'),'2')
        self.assertIn('未补齐', messages.output[-1]); self.assertEqual({name:self.state.get(name) for name in self.old},self.old)

    def test_invalid_durable_note_cursor_is_rejected_without_resetting_state(self):
        self.state.set(self.name,'not-a-date')
        with patch.object(S,'window_sync') as window:
            with self.assertRaises(S.SyncError): S.run_notes_backfill(self.cfg,self.state,Mock(),Mock(),self.start,self.end)
            window.assert_not_called()
        self.assertEqual(self.state.get(self.name),'not-a-date'); self.assertEqual({name:self.state.get(name) for name in self.old},self.old)

    def test_each_page_and_confirmation_require_true_note_headers_before_upload(self):
        row = B.record(kind='withdrawal')
        for pages in ([S.Page([row],1,1,False)], [S.Page([row],2,2,True),S.Page([{**row,'order_no':'other'}],2,2,False)], [S.Page([row],2,2,True),S.Page([{**row,'order_no':'other'}],2,2,True),S.Page([row],2,2,False)]):
            source,target=Mock(),Mock(); source.fetch.side_effect=pages * 3
            with patch.object(S.time, "sleep"), self.assertRaises(S.SyncError): S.window_sync(source,target,self.cfg,'withdrawal','createTime',B.START,NOW,require_notes=True)
            target.upsert.assert_not_called(); target.receipt.assert_not_called()

    def test_failed_batch_or_receipt_does_not_advance_independent_checkpoint(self):
        for failure in ('upsert','receipt'):
            target=Mock(); getattr(target,failure).side_effect=S.SyncError('Synthetic failure')
            with patch.object(S,'collect_window',return_value=[{**B.record(kind='withdrawal',created_at=self.start+timedelta(minutes=1)), 'order_note':'', 'risk_note':''}]):
                with self.assertRaises(S.SyncError): S.run_notes_backfill(self.cfg,self.state,Mock(),target,self.start,self.end)
            self.assertIsNone(self.state.get(self.name)); self.assertIsNone(self.state.get(self.name+'/unknown_fields'))

    def test_large_note_windows_keep_header_requirement_in_each_split_child(self):
        calls=[]
        def collect(source,kind,mode,start,end,*,require_notes=False):
            calls.append((start,end,require_notes))
            if end-start>timedelta(hours=12):
                raise S.WindowTooLarge("Synthetic oversized window")
            return []
        target=Mock()
        with patch.object(S,'collect_window',side_effect=collect):
            S.run_notes_backfill(self.cfg,self.state,Mock(),target,self.start,self.end)
        self.assertTrue(all(call[2] is True for call in calls))
        self.assertEqual(target.receipt.call_count,4)
        self.assertEqual(self.state.get(self.name),self.end.isoformat())

    def test_explicit_zero_window_still_requires_upload_receipt_then_advances(self):
        source,target=Mock(),Mock(); source.fetch.return_value=S.Page([],0,0,True)
        S.run_notes_backfill(self.cfg,self.state,source,target,self.start,self.end)
        self.assertEqual(target.upsert.call_count,2); self.assertEqual(target.receipt.call_count,2)
        self.assertEqual(self.state.get(self.name),self.end.isoformat())

    def test_main_routes_explicit_stage_without_starting_original_loop_or_channels(self):
        import json
        path=Path(self.directory.name)/'config.json'; path.write_text(json.dumps(self.cfg.data))
        argv=['yash_cdp.py','--config',str(path),'--backfill-notes-from','2026-10-09','--backfill-notes-to','2026-10-10']
        with patch.object(S,'YASH_UPLOAD_TOKEN','synthetic-token'),patch.object(sys,'argv',argv),patch.object(S,'SourceClient'),patch.object(S,'run_notes_backfill') as notes,patch.object(S,'run_cycle') as cycles,patch.object(S,'channel_sync_cycle') as channels,patch.object(S,'channel_polling') as polling,patch.object(S,'datetime',B.FrozenDatetime):
            self.assertEqual(S.main(),0)
        self.assertEqual(notes.call_count,1); cycles.assert_not_called(); channels.assert_not_called(); polling.assert_not_called()

    def test_cli_rejects_partial_or_mixed_stage_before_any_client_is_created(self):
        for argv in (['--backfill-notes-from','2026-10-09'],['--loop','--backfill-notes-from','2026-10-09','--backfill-notes-to','2026-10-10']):
            with patch.object(sys,'argv',['yash_cdp.py',*argv]),patch.object(S,'SourceClient') as source,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit): S.main()
                source.assert_not_called()


if __name__=='__main__': unittest.main()
