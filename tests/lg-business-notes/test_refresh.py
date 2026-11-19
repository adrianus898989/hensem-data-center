"""Synthetic offline checks for the optional one-file refresh candidate.

Neither collector main nor a browser/network is invoked. Fake cloud receipts
model the legacy live contract; real SQL behavior has a separate PGlite test.
"""
import ast
import contextlib
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = Path(os.environ.get('LG_REFRESH_DELIVERY', str(ROOT.parent / 'deliveries/lg-business-notes-v8.3-candidate-20261012/lgwithdraw_to_sheet.py')))
spec = importlib.util.spec_from_file_location('lg_refresh_offline', DELIVERY)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
NOW = datetime(2026, 10, 12, 1, 2, 3, 456789, tzinfo=timezone.utc)
PLATFORMS = [{'platform': 'SUPERLG', 'country_code': 'PH'}, {'platform': 'TEST-PK', 'country_code': 'PK'}]


class FakeCloud:
    def __init__(self):
        self.calls, self.runs = [], {}
        self.finish_transform = lambda receipt: receipt

    def transport(self, endpoint, payload, headers):
        self.calls.append(copy.deepcopy(payload))
        action = payload['action']
        if action == 'check':
            return {'ok': True, 'source_system': 'LG', 'protocol_version': 1, 'live_protocol_version': 1, 'scope_count': 2}
        if action not in ('begin', 'chunk', 'finish') or payload['sync_mode'] != 'live':
            raise AssertionError('Only explicit live actions are permitted')
        common = {'ok': True, 'source_system': 'LG', 'snapshot_id': payload['snapshot_id']}
        if action == 'begin':
            old = self.runs.get(payload['snapshot_id'])
            if old is None:
                old = {'begin': copy.deepcopy(payload), 'chunks': {}, 'finished': False}
                self.runs[payload['snapshot_id']] = old
            elif old['begin'] != payload:
                raise AssertionError('Cached begin payload changed')
            return {**common, 'status': 'live' if old['finished'] else 'collecting',
                    'expected_count': payload['expected_count'], 'expected_chunks': payload['expected_chunks'],
                    'observed_at': payload['observed_at']}
        run = self.runs[payload['snapshot_id']]
        if action == 'chunk':
            old = run['chunks'].get(payload['chunk_index'])
            if old is not None and old != payload:
                raise AssertionError('Cached chunk payload changed')
            run['chunks'][payload['chunk_index']] = copy.deepcopy(payload)
            return {**common, 'status': 'unchanged' if old else 'accepted', 'chunk_index': payload['chunk_index'], 'order_count': len(payload['orders'])}
        receipt = {**common, 'status': 'unchanged' if run['finished'] else 'live',
                   'observed_at': payload['observed_at'], 'order_count': run['begin']['expected_count'],
                   'source_count': run['begin']['source_total'], 'changed_count': run['begin']['expected_count'], 'partial_day': True}
        run['finished'] = True
        return self.finish_transform(receipt)

    def factory(self, config):
        return w.lgd_RefreshIngest(config, self.transport)


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'realtime'
        self.config = {'endpoint': 'https://synthetic.invalid', 'token': 'SYNTHETIC',
                       'state_dir': str(self.root), 'platforms': PLATFORMS[:1],
                       'page_size': 2, 'chunk_size': 1, 'max_pages': 100}
        self.args = SimpleNamespace(start='2026-10-10', end='2026-10-11', kinds=('recharge', 'withdraw'))
        self.cloud = FakeCloud()
        self.source_calls, self.closed = [], 0
        self.now_patch = patch.object(w, 'lgd_utc_now', return_value=NOW)
        self.now_patch.start()
        self.addCleanup(self.now_patch.stop)
        self.log_patch = patch.object(w, 'lgd_log')
        self.log_patch.start()
        self.addCleanup(self.log_patch.stop)
        w.STOP.clear()

    def api_factory(self, config, platform):
        test = self
        class API:
            def close(self):
                test.closed += 1
            def __call__(self, kind, query):
                test.source_calls.append((copy.deepcopy(platform), kind, copy.deepcopy(query)))
                row = {'orderId': f'SYNTHETIC-{kind}-{query["startAt"]}', 'userId': 'MEMBER-TEST',
                       'createTime': query['startAt'] + 60, 'status': 6, 'orderAmount': '100.25',
                       'remark': '手工复核 phone: 09171234567', 'appRemark': '待确认'}
                return {'code': 0, 'data': {'list': [row], 'totalNum': 1, 'currentPage': query['pageNum'], 'nextPage': False}}
        return API()

    def run_refresh(self, api_factory=None):
        return w.run_refresh(self.config, self.args, api_factory or self.api_factory, self.cloud.factory)

    def states(self):
        return list((self.root / 'refresh_v1').glob('*/state.json'))

    def caches(self):
        return list((self.root / 'refresh_v1').glob('*/outbox/*.json'))

    def test_complete_dates_run_once_in_order_with_exact_live_payloads(self):
        self.config['platforms'] = PLATFORMS
        self.assertEqual(self.run_refresh(), 0)
        self.assertEqual(len(self.source_calls), 8)
        self.assertEqual(self.closed, 8)
        begins = [x for x in self.cloud.calls if x['action'] == 'begin']
        self.assertEqual([x['stat_date'] for x in begins], ['2026-10-10'] * 4 + ['2026-10-11'] * 4)
        self.assertTrue(all(x['sync_mode'] == 'live' for x in self.cloud.calls if x['action'] != 'check'))
        self.assertEqual(len(json.loads(self.states()[0].read_text())), 8)
        self.assertFalse(self.caches())
        # Finished work is not re-read even when this same command is rerun later.
        before = len(self.cloud.calls)
        with patch.object(w, 'lgd_utc_now', return_value=NOW + timedelta(days=1)):
            self.assertEqual(self.run_refresh(lambda *a: self.fail('completed scope recollected')), 0)
        self.assertEqual(len(self.cloud.calls), before + 1)
        self.assertFalse((self.root / 'progress.json').exists())
        self.assertFalse((self.root / 'midnight').exists())

    def test_real_time_locks_do_not_block_refresh_and_refresh_excludes_itself(self):
        with contextlib.ExitStack() as stack:
            for root in (self.root, self.root.parent / 'lg_supabase_detail_private_v1', self.root.parent / 'lg_hourly_private_v1'):
                stack.enter_context(w.lgd_single_process(root))
            with patch.object(w, 'WindowClient', side_effect=AssertionError('window path used')), patch.object(w, 'midnight_worker', side_effect=AssertionError('midnight used')):
                self.assertEqual(self.run_refresh(), 0)
        with w.lgd_single_process(self.root / 'refresh_v1'):
            with self.assertRaises(w.lgd_SyncError):
                self.run_refresh()

    def test_query_cutoff_is_frozen_for_all_platforms_and_pages(self):
        self.config['platforms'] = PLATFORMS
        self.assertEqual(self.run_refresh(), 0)
        cutoff = int(NOW.timestamp())
        for platform, _, query in self.source_calls:
            local_start, _ = w.lgd_day_bounds(datetime.fromtimestamp(query['startAt'], timezone.utc).astimezone(w.ZoneInfo(w.lgd_COUNTRY_ZONES[platform['country_code']])).date().isoformat(), platform['country_code'])
            self.assertEqual(query['startAt'], int(local_start.timestamp()))
            self.assertLess(query['endAt'], cutoff)
            self.assertEqual(query['timeType'], 1)
            self.assertNotIn('status', query)
        manifest = json.loads(next((self.root / 'refresh_v1').glob('*/job.json')).read_text())
        self.assertEqual(manifest['frozen_at'], w.second_iso(NOW.replace(microsecond=0)))

    def test_lost_finish_ack_replays_identical_cache_without_recollection(self):
        def lost_ack(receipt):
            raise ConnectionError('synthetic lost acknowledgement')
        self.cloud.finish_transform = lost_ack
        self.assertEqual(self.run_refresh(), 1)
        self.assertEqual(len(self.caches()), 4)
        self.assertFalse(self.states())
        cached = {p.name: p.read_bytes() for p in self.caches()}
        original_payloads = [x for x in self.cloud.calls if x['action'] != 'check']
        self.cloud.finish_transform = lambda receipt: receipt
        self.cloud.calls.clear()
        with patch.object(w, 'lgd_utc_now', return_value=NOW + timedelta(hours=3)):
            self.assertEqual(self.run_refresh(lambda *a: self.fail('unacknowledged scope recollected')), 0)
        self.assertEqual([x for x in self.cloud.calls if x['action'] != 'check'], original_payloads)
        self.assertFalse(self.caches())
        self.assertEqual(len(json.loads(self.states()[0].read_text())), len(cached))

    def test_bad_finish_receipts_keep_outbox_and_never_confirm(self):
        mutations = [{'status': 'published'}, {'status': 'superseded'}, {'snapshot_id': 'wrong'},
                     {'observed_at': '2026-10-01T00:00:00Z'}, {'order_count': True},
                     {'source_count': 0}, {'changed_count': 2}, {'partial_day': 1}, {'source_system': 'OTHER'}]
        self.args.end = self.args.start
        self.args.kinds = ('withdraw',)
        for index, mutation in enumerate(mutations):
            with self.subTest(receipt=index):
                self.config['state_dir'] = str(self.root / str(index))
                self.cloud = FakeCloud()
                self.cloud.finish_transform = lambda receipt, m=mutation: {**receipt, **m}
                self.assertEqual(self.run_refresh(), 1)
                local = Path(self.config['state_dir']) / 'refresh_v1'
                self.assertEqual(len(list(local.glob('*/outbox/*.json'))), 1)
                self.assertFalse(list(local.glob('*/state.json')))

    def test_bad_begin_and_chunk_receipts_do_not_advance_to_finish(self):
        self.args.end = self.args.start
        self.args.kinds = ('withdraw',)
        for index, target in enumerate(('begin', 'chunk')):
            self.config['state_dir'] = str(self.root / str(index))
            cloud = FakeCloud()
            transport = cloud.transport
            def bad(endpoint, payload, headers):
                receipt = transport(endpoint, payload, headers)
                if payload['action'] == target:
                    receipt['expected_chunks' if target == 'begin' else 'chunk_index'] = True
                return receipt
            cloud.transport = bad
            self.cloud = cloud
            self.assertEqual(self.run_refresh(), 1)
            self.assertNotIn('finish', [x['action'] for x in cloud.calls])

    def test_unsafe_cache_rejected_before_any_upload_and_preserved(self):
        self.cloud.finish_transform = lambda receipt: {**receipt, 'status': 'published'}
        self.assertEqual(self.run_refresh(), 1)
        paths = self.caches()
        for path in paths:
            data = json.loads(path.read_text())
            data['snapshot']['chunks'][0][0]['raw']['phone'] = '09171234567'
            path.write_text(json.dumps(data))
        hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        self.cloud.calls.clear()
        self.assertEqual(self.run_refresh(lambda *a: self.fail('cache recollected')), 1)
        self.assertEqual([x['action'] for x in self.cloud.calls], ['check'])
        self.assertEqual(hashes, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
        self.assertFalse(self.states())

    def test_source_outside_frozen_bound_fails_before_saving_or_uploading(self):
        class BadAPI:
            def close(self):
                pass
            def __call__(self, kind, query):
                return {'code': 0, 'data': {'list': [{'orderId': 'SYNTHETIC', 'createTime': int(NOW.timestamp())}], 'totalNum': 1, 'currentPage': 1, 'nextPage': False}}
        self.assertEqual(self.run_refresh(lambda *a: BadAPI()), 1)
        self.assertFalse(self.caches())
        self.assertFalse(self.states())
        self.assertEqual([x['action'] for x in self.cloud.calls], ['check'])

    def test_complete_buffered_pages_are_checked_before_target_day_selection(self):
        self.args.end = self.args.start
        self.args.kinds = ('withdraw',)
        bounds = []
        class PagedAPI:
            def close(self):
                pass
            def __call__(self, kind, query):
                bounds.append((query['startAt'], query['endAt']))
                # Three target-day records plus one record in the original
                # forward buffer. All four count for source-page completeness.
                values = [{'orderId': 'SYNTHETIC-' + str(i), 'createTime': query['startAt'] + (86460 if i == 3 else 60 + i),
                           'status': 6, 'orderAmount': '100', 'remark': '复核 09171234567'} for i in range(4)]
                page = query['pageNum']
                return {'code': 0, 'data': {'list': values[(page-1)*2:page*2], 'totalNum': 4, 'currentPage': page, 'nextPage': page < 2}}
        self.cloud.finish_transform = lambda receipt: {**receipt, 'status': 'published'}
        self.assertEqual(self.run_refresh(lambda *a: PagedAPI()), 1)
        self.assertEqual(len(bounds), 2)
        self.assertEqual(bounds[0], bounds[1])
        snapshot = json.loads(self.caches()[0].read_text())['snapshot']
        self.assertEqual(snapshot['expected_count'], 3)
        self.assertEqual(snapshot['source_total'], 3)
        self.assertEqual(snapshot['source_audit']['window_total'], 4)
        self.assertEqual(snapshot['source_audit']['fetched_rows'], 4)
        self.assertNotIn('09171234567', json.dumps(snapshot))

    def test_moving_or_incomplete_pages_never_cache_or_upload_partial_day(self):
        class MovingAPI:
            def close(self):
                pass
            def __call__(self, kind, query):
                page = query['pageNum']
                values = [{'orderId': 'SYNTHETIC-' + str(page) + '-' + str(i), 'createTime': query['startAt'] + 60,
                           'status': 6, 'orderAmount': '100'} for i in range(2)]
                return {'code': 0, 'data': {'list': values, 'totalNum': 4 if page == 1 else 5, 'currentPage': page, 'nextPage': True}}
        self.assertEqual(self.run_refresh(lambda *a: MovingAPI()), 1)
        self.assertFalse(self.caches())
        self.assertFalse(self.states())
        self.assertEqual([x['action'] for x in self.cloud.calls], ['check'])

    def test_today_and_future_day_rejected_in_each_platform_timezone(self):
        for day in ('2026-10-12', '2026-10-13'):
            self.args.end = day
            with self.assertRaises(w.lgd_SyncError):
                self.run_refresh(lambda *a: self.fail('incomplete day source read'))

    def test_empty_complete_snapshot_has_no_chunks_and_acknowledges_zero(self):
        class EmptyAPI:
            def close(self):
                pass
            def __call__(self, kind, query):
                return {'code': 0, 'data': {'list': [], 'totalNum': 0, 'currentPage': 1, 'nextPage': False}}
        self.assertEqual(self.run_refresh(lambda *a: EmptyAPI()), 0)
        self.assertNotIn('chunk', [x['action'] for x in self.cloud.calls])
        self.assertEqual(len(json.loads(self.states()[0].read_text())), 4)

    def test_stop_and_cloud_capability_failure_prevent_source_reads(self):
        w.STOP.set()
        with self.assertRaises(w.lgd_SyncError):
            self.run_refresh(lambda *a: self.fail('source read after stop'))
        w.STOP.clear()
        self.cloud.transport = lambda *a: {'ok': True, 'source_system': 'LG', 'protocol_version': 1, 'live_protocol_version': 0, 'scope_count': 1}
        with self.assertRaises(w.lgd_SyncError):
            self.run_refresh(lambda *a: self.fail('source read before capability check'))
        self.assertFalse(self.caches())

    def test_original_business_collection_realtime_and_midnight_ast_unchanged(self):
        legacy = ast.parse((ROOT / 'collectors/lg-business-notes-upgrade/lg_withdraw_to_sheet.py').read_text())
        candidate = ast.parse(DELIVERY.read_text(), feature_version=(3, 9))
        old = {n.name: ast.dump(n, include_attributes=False) for n in legacy.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        new = {n.name: ast.dump(n, include_attributes=False) for n in candidate.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        changed = [name for name in old if new[name] != old[name]]
        self.assertEqual(changed, ['ack_time', 'main'])
        def assignments(tree):
            return {n.targets[0].id: ast.dump(n.value, include_attributes=False) for n in tree.body
                    if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id != 'VERSION'}
        self.assertTrue(assignments(legacy) == assignments(candidate), 'Original settings changed')

    def test_ack_time_right_pads_only_valid_utc_fractions_for_python39(self):
        original_parse = w.lgd_parse_time
        seen = []
        def python39_parse(value, zone):
            seen.append(value)
            fraction = w.re.search(r'\.(\d+)', value)
            if fraction and len(fraction.group(1)) not in (3, 6):
                return None
            return original_parse(value, zone)
        with patch.object(w, 'lgd_parse_time', side_effect=python39_parse):
            for digits in ('1', '12', '123', '1234', '12345', '123456'):
                for suffix in ('Z', '+00:00'):
                    value = '2026-10-12T01:02:03.' + digits + suffix
                    parsed = w.ack_time(value, whole=False)
                    self.assertEqual(parsed.microsecond, int(digits.ljust(6, '0')))
                    self.assertEqual(seen[-1], '2026-10-12T01:02:03.' + digits.ljust(6, '0') + suffix)
                    with self.assertRaises(w.lgd_SyncError):
                        w.ack_time(value)
            self.assertEqual(w.ack_time('2026-10-12T01:02:03.0Z').microsecond, 0)
            self.assertEqual(w.ack_time('2026-10-12T01:02:03Z').microsecond, 0)
            for value in ('2026-10-12T01:02:03.1234567Z', '2026-10-12T01:02:03.1+08:00',
                          '2026-10-12T01:02:03.1', '2026-10-12 01:02:03.1Z',
                          '2026-10-12T01:02:03.Z', True, None):
                before = len(seen)
                with self.assertRaises(w.lgd_SyncError):
                    w.ack_time(value, whole=False)
                self.assertEqual(len(seen), before)


if __name__ == '__main__':
    unittest.main()
