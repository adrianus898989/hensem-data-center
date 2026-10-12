"""Offline synthetic privacy and original-business regression tests.

No browser, HTTP request, running collector, remote state or real order is used.
Set LG_BASELINE_SOURCE to the user's private original to run comparison checks.
The generated delivery is ignored by Git because it retains private config.
"""
import ast
import copy
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'collectors/lg-business-notes-upgrade/lg_withdraw_to_sheet.py'
PART = ROOT / 'collectors/lg-business-notes-upgrade/business_fields.py.part'
BASELINE = Path(os.environ['LG_BASELINE_SOURCE']) if os.environ.get('LG_BASELINE_SOURCE') else None


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


w = load(DELIVERY, 'lg_business_offline')
P = {'platform': 'SUPERLG', 'country_code': 'PH'}
NOW = datetime(2026, 10, 12, 1, 0, tzinfo=timezone.utc)
START = int(NOW.timestamp())


def source(**extra):
    return {'orderId': 'ORDER-TEST-1', 'userId': '7654321098765432',
            'createTime': START, 'operatorAt': START + 20, 'callbackTime': START + 30,
            'status': 2, 'orderAmount': Decimal('123456789012345.123456789012345678'),
            'realAmount': Decimal('123456789012345.123456789012345678'),
            'operatorName': 'system', 'withdrawThirdName': 'synthetic-provider',
            'rechargeThirdName': 'synthetic-recharge',
            'phone': '09171234567', 'account': '4111111111111111',
            'email': 'synthetic@example.test', 'name': 'Synthetic Person',
            **extra}


def normalized(**extra):
    return w.lgd_normalize_order(source(**extra), P, 'withdraw', None)


class PrivacyTests(unittest.TestCase):
    def test_business_notes_and_states_have_independent_source_provenance(self):
        cases = [({}, '', 'missing'), ({'remark': None}, '', 'empty'),
                 ({'remark': ' \t\u200b'}, '', 'empty'),
                 ({'remark': '等待复核'}, '等待复核', 'present'),
                 ({'remark': '---'}, '---', 'present'),
                 ({'remark': '09171234567'}, '[已隐藏]', 'redacted')]
        for fields, expected, state in cases:
            with self.subTest(state=state, fields=list(fields)):
                result = normalized(**fields)['raw']
                self.assertEqual((result['remark'], result['remarkState']), (expected, state))
                self.assertEqual((result['appRemark'], result['appRemarkState']), ('', 'missing'))
                self.assertEqual(result['businessSchemaVersion'], 1)
        row = normalized(remark='源订单备注', appRemark='前台显示备注')['raw']
        self.assertEqual(row['remark'], '源订单备注')
        self.assertEqual(row['appRemark'], '前台显示备注')

    def test_same_order_nested_private_values_removed_without_losing_business_words(self):
        result = normalized(
            remark='请复核 Synthetic Person，09171234567，4111111111111111，synthetic@example.test，NESTED-PRIVATE，P-1234567，7654321098765432',
            bank={'account': 'NESTED-PRIVATE'},
            documents=[{'passportNumber': 'P-1234567'}])
        note = result['raw']['remark']
        for value in ('Synthetic Person', '09171234567', '4111111111111111',
                      'synthetic@example.test', 'NESTED-PRIVATE', 'P-1234567', '7654321098765432'):
            self.assertNotIn(value, note)
        self.assertIn('请复核', note)
        self.assertEqual(result['raw']['remarkState'], 'present')

    def test_unknown_sensitive_formats_unicode_and_labels_are_hidden(self):
        values = ['+63 (917) 234-5678', '4111 1111 1111 1111', '１２３４５６７８９０',
                  '0917\u200b123\u200b4567', 'person@sample.test', '192.0.2.45',
                  '2001:db8::1', '2001::1', '::1', 'https://example.test/private?token=secret',
                  'ftp://example.test/private', 'example.test/private', 'someone@ybl',
                  'DE89 3704 0044 0532 0130 00', 'AB1234567',
                  '123.456.789-01', '51012319900101123X',
                  'PIX: random-private-value', '姓名：张三', 'name: Synthetic Unknown',
                  'name Alice Smith', '姓名 张三', '98****1234', '4111****1111', '****1234',
                  '09xx xxxx 1234',
                  '身份证：sensitive-document', '手机号：09123456789']
        for value in values:
            with self.subTest(format=values.index(value)):
                text = w.lgd_redact_business_text(value)
                self.assertIn(w.LGD_REDACTED, text)
                self.assertNotEqual(text, value)
                self.assertEqual(text, w.lgd_redact_business_text(text))

    def test_name_problem_descriptions_and_normal_business_names_are_not_masked(self):
        for value in ('name mismatch', 'Name invalid', 'name missing', '姓名 不一致',
                      '姓名 不符', '姓名 缺失', 'synthetic-provider', 'Third Party Pay'):
            self.assertEqual(w.lgd_redact_business_text(value), value)
        result = normalized(name=None, remark='需复核; name Alice Smith; 手工拒绝后重试', appRemark='姓名 张三')
        self.assertEqual(result['raw']['remark'], '需复核; [已隐藏]; 手工拒绝后重试')
        self.assertEqual(result['raw']['appRemarkState'], 'redacted')

    def test_dates_short_error_codes_amounts_and_dedicated_business_ids_survive(self):
        note = '等待复核; 金额100.50; code 123456; 2026-10-12 10:30:00'
        result = normalized(remark=note, transactionId='999999999999999999', firstFlag=1,
                            totalOrderNum=123, currentProfitAmount=Decimal('-12.125'))
        self.assertEqual(result['raw']['remark'], note)
        self.assertEqual(result['raw']['transactionId'], '999999999999999999')
        self.assertEqual(result['raw']['firstFlag'], 1)
        self.assertEqual(result['raw']['totalOrderNum'], 123)
        self.assertEqual(result['raw']['currentProfitAmount'], '-12.125')
        self.assertEqual(result['order_amount'], '123456789012345.123456789012345678')
        w.lgd_validate_business_order(result)

    def test_member_id_is_exact_userid_and_never_phone_or_account_fallback(self):
        self.assertEqual(normalized()['member_id'], '7654321098765432')
        for user_id in (None, '', '09171234567', '4111111111111111'):
            self.assertIsNone(normalized(userId=user_id)['member_id'])
        self.assertIsNone(normalized(userId='09171234567', phone='0917-123-4567')['member_id'])
        self.assertIsNone(w.lgd_normalize_order({k: v for k,v in source().items() if k != 'userId'}, P, 'withdraw', None)['member_id'])
        self.assertEqual(normalized(userId='123456789012345678901234')['member_id'], '123456789012345678901234')

    def test_sensitive_values_in_top_level_business_text_are_cleaned(self):
        result = normalized(operatorName='Synthetic Person', withdrawThirdName='provider synthetic@example.test')
        self.assertEqual(result['operator_name'], '[已隐藏]')
        self.assertNotIn('synthetic@example.test', result['third_party'])
        w.lgd_validate_business_order(result)

    def test_group_projection_drops_private_nested_fields_and_unsafe_colors(self):
        groups = [{'groupId': 1, 'groupName': '需复核 Synthetic Person', 'colorTag': '#12ab',
                   'userId': 'GROUP-PRIVATE', 'phone': '09171234567', 'extra': 'PRIVATE'}]
        result = normalized(groupList=groups)['raw']['groupList']
        self.assertEqual(set(result[0]), {'groupId', 'groupName', 'colorTag'})
        self.assertEqual(result[0]['groupName'], '需复核 [已隐藏]')
        self.assertEqual(result[0]['colorTag'], '#12ab')
        for color in ('url(private)', '#12345', 'red; display:none', 'a' * 33):
            self.assertNotIn('colorTag', normalized(groupList=[{'groupId': 1, 'colorTag': color}])['raw']['groupList'][0])
        self.assertNotIn('userId', json.dumps(result))

    def test_long_notes_and_groups_are_bounded_after_redaction_without_failing_order(self):
        result = normalized(remark=('等待处理' * 5000) + '4111111111111111',
                            groupList=[{'groupId': i, 'groupName': '业务组'} for i in range(120)])
        self.assertEqual(len(result['raw']['remark']), 12000)
        self.assertTrue(result['raw']['remark'].endswith(w.LGD_TRUNCATED))
        self.assertNotIn('4111111111111111', result['raw']['remark'])
        self.assertEqual(len(result['raw']['groupList']), 100)
        self.assertTrue(result['raw']['groupListTruncated'])
        w.lgd_validate_business_order(result)

    def test_nested_note_is_never_serialized_and_boolean_metrics_are_rejected(self):
        with self.assertRaises(w.lgd_SyncError):
            normalized(remark={'phone': '09171234567'})
        with self.assertRaises(w.lgd_SyncError):
            normalized(firstFlag=True)

    def test_only_contract_keys_survive(self):
        result = normalized(secret={'password': 'PRIVATE'}, randomBusinessOrPrivate='UNKNOWN',
                            loginIp='192.0.2.4', sameLoginIpCount=None)
        for key in ('secret', 'randomBusinessOrPrivate', 'loginIp', 'sameLoginIpCount', 'userId', 'phone', 'account', 'name', 'email'):
            self.assertNotIn(key, result['raw'])


class CacheAndFlowTests(unittest.TestCase):
    def snapshot(self, order):
        return {'source_system': 'LG', 'platform': 'SUPERLG', 'country_code': 'PH',
                'capture_date': '2026-10-12', 'snapshot_id': 'fixed-synthetic-uuid',
                'observed_at': '2026-10-11T16:00:00Z', 'scheduled_at': '2026-10-11T16:00:00Z',
                'captured_at': '2026-10-11T16:00:30Z', 'pending_window_days': 7,
                'expected_count': 1, 'expected_chunks': 1, 'source_total': 1,
                'fetched_count': 1, 'chunks': [[order]]}

    def legacy_order(self):
        row = normalized()
        row['raw'] = w.lgd_legacy_sanitize_raw(source())
        row['member_id'] = None
        return row

    def test_valid_old_cache_is_byte_for_byte_unchanged_across_validation_and_upload(self):
        snapshot = self.snapshot(self.legacy_order())
        before = json.dumps(snapshot, sort_keys=True, ensure_ascii=False)
        calls = []
        def transport(url, payload, headers):
            calls.append(copy.deepcopy(payload))
            common = {'ok': True, 'snapshot_id': snapshot['snapshot_id']}
            if payload['action'] == 'pending_begin':
                return {**common, 'status': 'collecting', 'order_count': 1}
            if payload['action'] == 'pending_chunk':
                return {**common, 'status': 'accepted', 'order_count': 1, 'chunk_index': 0}
            return {**common, 'status': 'published', 'order_count': 1}
        cloud = w.lgd_Ingest({'endpoint': 'https://synthetic.invalid', 'token': 'SYNTHETIC'}, transport)
        cloud.upload(snapshot)
        self.assertEqual(json.dumps(snapshot, sort_keys=True, ensure_ascii=False), before)
        self.assertEqual(calls[1]['orders'], snapshot['chunks'][0])
        self.assertNotIn('businessSchemaVersion', calls[1]['orders'][0]['raw'])

    def test_bad_old_cache_never_sends_or_deletes_or_mutates_progress(self):
        snapshot = self.snapshot(self.legacy_order())
        with tempfile.TemporaryDirectory() as temp:
            state = w.lgd_State(Path(temp))
            state.save_snapshot(snapshot, 'https://synthetic.invalid')
            file = state.cache_path(w.lgd_snapshot_key(snapshot))
            bad = json.loads(file.read_text())
            bad['snapshot']['chunks'][0][0]['raw']['phone'] = '09171234567'
            file.write_text(json.dumps(bad))
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            cloud = w.lgd_Ingest({'endpoint': 'https://synthetic.invalid', 'token': 'SYNTHETIC'},
                                lambda *a, **k: self.fail('No unsafe cache may reach transport'))
            with self.assertRaises(w.lgd_SyncError):
                cloud.upload(state.cached(w.lgd_snapshot_key(snapshot))['snapshot'])
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), digest)
            self.assertEqual(state.entries, {})

    def test_bad_note_or_unknown_nested_field_rejected_before_new_window_begin(self):
        for mutate in (
            lambda order: order['raw'].update(remark='09171234567', remarkState='present'),
            lambda order: order['raw'].update(groupList=[{'userId': 'PRIVATE'}]),
            lambda order: order.update(phone='09171234567'),
        ):
            order = normalized(remark='需复核')
            mutate(order)
            client = w.WindowClient({'endpoint': 'https://synthetic.invalid', 'token': 'SYNTHETIC', 'chunk_size': 200},
                                    lambda *a, **k: self.fail('No invalid order may reach transport'))
            with self.assertRaises(w.lgd_SyncError):
                client.upload({}, {'cursor_at': '2026-10-12T00:00:00Z'}, 'uuid', NOW, NOW, NOW, [order])

    def test_source_pages_flow_through_real_normalizer_with_safe_notes(self):
        row = source(remark='重试；手机号：09171234567', appRemark='等待复核')
        calls = []
        def api(kind, query):
            calls.append((kind, query))
            return {'code': 0, 'data': {'list': [row], 'totalNum': 1, 'currentPage': 1, 'nextPage': False}}
        from datetime import timedelta
        orders = w.collect_window(P, 'withdraw', 'created', NOW, NOW + timedelta(minutes=10), api,
                                  {'page_size': 200, 'max_pages': 100})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1]['timeType'], 1)
        self.assertNotIn('status', calls[0][1])
        self.assertEqual(orders[0]['raw']['appRemark'], '等待复核')
        self.assertNotIn('09171234567', orders[0]['raw']['remark'])


@unittest.skipUnless(BASELINE and BASELINE.exists(), 'Private baseline supplied only locally')
class BaselinePreservationTests(unittest.TestCase):
    def test_original_business_functions_and_configuration_unchanged(self):
        original = ast.parse(BASELINE.read_text(encoding='utf-8'))
        new = ast.parse(DELIVERY.read_text(encoding='utf-8'))
        changed = {'lgd_sanitize_raw', 'lgd_normalize_order', 'lgd_State', 'lgd_Ingest', 'WindowClient'}
        after = {n.name: n for n in new.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        for node in original.body:
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name not in changed:
                self.assertEqual(ast.dump(node, include_attributes=False), ast.dump(after[node.name], include_attributes=False), node.name)
        original_assignments = {n.targets[0].id: ast.dump(n.value, include_attributes=False) for n in original.body
                                if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)}
        new_assignments = {n.targets[0].id: ast.dump(n.value, include_attributes=False) for n in new.body
                           if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)}
        for key, value in original_assignments.items():
            if key != 'VERSION':
                self.assertTrue(value == new_assignments[key], 'Original setting changed: ' + key)

    def test_financial_status_and_provider_fields_match_original_for_every_status_and_kind(self):
        import types
        old = types.ModuleType('lg_original_offline')
        exec(compile(BASELINE.read_text(encoding='utf-8'), '<private baseline>', 'exec'), old.__dict__)
        for kind in ('withdraw', 'recharge'):
            for code in range(8):
                row = source(status=code)
                expected = old.lgd_normalize_order(row, P, kind, None)
                actual = w.lgd_normalize_order(row, P, kind, None)
                for key in expected:
                    if key not in {'raw', 'member_id'}:
                        self.assertEqual(actual[key], expected[key], key)
                self.assertEqual({k: actual['raw'][k] for k in expected['raw']}, expected['raw'])


if __name__ == '__main__':
    unittest.main()
