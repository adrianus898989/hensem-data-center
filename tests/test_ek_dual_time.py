import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

spec = importlib.util.spec_from_file_location('ek', Path(__file__).parents[1] / 'collectors/ek_sync.py')
ek = importlib.util.module_from_spec(spec)
sys.modules['ek'] = ek
spec.loader.exec_module(ek)

class DualTimeTests(unittest.TestCase):
    def test_member_and_third_party_order_ids_preserved_without_other_private_fields(self):
        source={'id':77,'uid':'000012345678901234567890','out_trade_no':'THIRD-77',
            'order_num':'ORDER-77','amount':100,'extra':0,'balance':100,'status':1,
            'fee':2,'real_amount':98,'password':'never-save','token':'never-save',
            'bank_account':'never-save','ip':'never-save','mobile':'never-save',
            'create_time':'2026-09-17 10:00:00','update_time':'2026-09-18 10:00:00'}
        for dtype,normalizer in [('charge',ek.normalize_charge),('withdraw',ek.normalize_withdraw)]:
            row=normalizer('00000000-0000-0000-0000-000000000001',source)
            self.assertEqual(row['uid'],source['uid'])
            self.assertEqual(row['out_trade_no'],'THIRD-77')
            self.assertEqual(row['raw_payload']['uid'],source['uid'])
            self.assertNotIn('never-save',json.dumps(row))
            self.assertEqual(set(row),set(ek.ORDER_WRITE_COLUMNS[ek.ORDER_SPECS[dtype]['table']]))
        self.assertIsNone(ek.optional_order_identifier(None,'uid'))
        self.assertEqual(ek.optional_order_identifier(123,'uid'),'123')
        with self.assertRaises(RuntimeError):ek.optional_order_identifier(123.5,'uid')
        with self.assertRaises(RuntimeError):ek.optional_order_identifier(True,'uid')

    def args(self, *extra):
        return ek.build_parser().parse_args(['--date', '2026-09-18', *extra])

    def window(self, since=''):
        args = self.args()
        args._time_basis = 'success'
        args.created_since = since
        return ek.task_window(date(2026,9,18), args)

    def test_completion_query_has_no_accidental_same_day_creation_filter(self):
        platform = ek.Platform('EK7', 'https://example.test', 'example.test')
        for dtype in ('charge','withdraw'):
            template = ek.static_request_template(platform,dtype).canonical_filters()
            request, touched, _ = template.rewrite_date(self.window())
            if dtype=='charge':
                params=parse_qs(urlparse(request.url).query)
                self.assertNotIn('create_time[0]',params)
                self.assertEqual(params['update_time[0]'],['2026-09-17T18:30:00.000Z'])
                self.assertEqual(params['status'],['1'])
            else:
                body=json.loads(request.post_data)
                self.assertEqual(body['create_time'],[])
                self.assertEqual(body['update_time'][1],'2026-09-18T18:29:59.999Z')
                self.assertEqual(body['status'],'3')
            self.assertEqual(touched,2)

    def test_creation_and_completion_ranges_are_independent(self):
        platform = ek.Platform('EK7','https://example.test','example.test')
        request,_,_=ek.static_request_template(platform,'charge').rewrite_date(self.window('2026-09-01'))
        params=parse_qs(urlparse(request.url).query)
        self.assertEqual(params['create_time[0]'],['2026-08-31T18:30:00.000Z'])
        self.assertEqual(params['update_time[0]'],['2026-09-17T18:30:00.000Z'])

    def test_accept_prior_month_success_but_not_wrong_completion_day(self):
        ek.validate_item_date({'create_time':'2026-08-30 12:00:00','update_time':'2026-09-18 10:00:00'},self.window())
        with self.assertRaises(RuntimeError):
            ek.validate_item_date({'create_time':'2026-09-18 10:00:00','update_time':'2026-09-19 00:00:00'},self.window())
        with self.assertRaises(RuntimeError):
            ek.validate_item_date({'create_time':'2026-08-30 12:00:00','update_time':'2026-09-18 10:00:00'},self.window('2026-09-01'))

    def test_queue_keeps_old_progress_and_completion_jobs_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            store=ek.TaskStore(Path(temp)/'queue.json')
            old=store.enroll('EK7','charge',date(2026,9,18))
            store.finish(old,{'written':10})
            success=store.enroll('EK7','charge',date(2026,9,18),basis='success')
            store.save()
            reopened=ek.TaskStore(store.path)
            self.assertEqual(reopened.jobs[old]['status'],'done')
            self.assertEqual(reopened.jobs[success]['status'],'pending')
            self.assertNotEqual(old,success)

    def test_daily_enrolls_both_order_types_and_both_time_bases(self):
        with tempfile.TemporaryDirectory() as temp:
            args=ek.build_parser().parse_args(['--mode','daily','--platform','EK7','--lookback-days','1','--state-dir',temp])
            store=ek.TaskStore(ek.queue_file(args))
            store.enroll_audit(args,datetime(2026,9,19,4,tzinfo=timezone.utc))
            self.assertEqual(len(store.jobs),4)
            self.assertEqual({j['basis'] for j in store.jobs.values()},{'created','success'})

    def test_partial_hours_and_validation(self):
        args=self.args()
        args._window_start='2026-09-18T10:00:00'
        args._window_end='2026-09-18T10:59:59'
        window=ek.task_window(date(2026,9,18),args)
        self.assertEqual(window.utc_start,'2026-09-18T04:30:00.000Z')
        self.assertEqual(window.utc_end,'2026-09-18T05:29:59.999Z')
        invalid=ek.build_parser().parse_args(['--start','2026-09-18T00:00:00'])
        with self.assertRaises(ek.CollectorError): ek.validate_time_args(invalid)

    def test_range_queue_splits_days_without_losing_first_last_times(self):
        with tempfile.TemporaryDirectory() as temp:
            args=ek.build_parser().parse_args(['--platform','EK7','--no-write','--time-basis','success','--start','2026-09-17T11:00:00','--end','2026-09-18T12:00:00','--state-dir',temp])
            ek.validate_time_args(args)
            with patch.object(ek,'execute_queued_task',return_value=None): ek.run_selected(args)
            jobs=list(ek.TaskStore(ek.queue_file(args)).jobs.values())
            self.assertEqual(len(jobs),4)
            self.assertEqual({j['start'] for j in jobs if j['day']=='2026-09-17'},{'2026-09-17T11:00:00'})
            self.assertEqual({j['end'] for j in jobs if j['day']=='2026-09-18'},{'2026-09-18T12:00:00'})

if __name__=='__main__': unittest.main()
