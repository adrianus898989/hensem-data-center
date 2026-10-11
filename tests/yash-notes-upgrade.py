"""Synthetic-only local upgrader tests. No real config or activation is read."""
import contextlib
import importlib.util
import io
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'collectors/yash-notes-upgrade'
spec = importlib.util.spec_from_file_location('safe_yash_notes_upgrade', PACKAGE / 'upgrade_yash_notes.py')
U = importlib.util.module_from_spec(spec); spec.loader.exec_module(U)
TEMPLATE = (ROOT / 'collectors/yash_sync.py').read_text()
FAKE_TOKEN = 'SYNTHETIC-UPLOAD-KEY-NOT-REAL-1234567890'


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.target = self.path / 'yash_cdp.py'
        self.template = self.path / 'yash_cdp.py.template'
        self.template.write_text(TEMPLATE)
        self.original = TEMPLATE.replace('"__YASH_UPLOAD_TOKEN__"', repr(FAKE_TOKEN)).replace('2026.10.11.10', '2026.10.09.9')
        self.target.write_text(self.original)
        self.config = self.path / 'config.json'; self.config.write_text('{"synthetic":"unchanged"}')
        self.state = self.path / 'state.sqlite3'; self.state.write_bytes(b'synthetic-state-unchanged')

    def upgrade(self):
        return U.upgrade(self.target, self.template)

    def assert_original(self):
        self.assertEqual(self.target.read_text(), self.original)
        self.assertEqual(self.config.read_text(), '{"synthetic":"unchanged"}')
        self.assertEqual(self.state.read_bytes(), b'synthetic-state-unchanged')

    def test_activated_upgrade_backups_exact_original_preserves_only_activation_and_is_private(self):
        backup = self.upgrade()
        self.assertEqual(backup.read_text(), self.original)
        values = U.activation_values(U.parse_script(self.target.read_text()))
        self.assertEqual(values, {'YASH_UPLOAD_URL':U.EXPECTED_URL,'YASH_UPLOAD_TOKEN':FAKE_TOKEN})
        self.assertEqual(self.config.read_text(), '{"synthetic":"unchanged"}')
        self.assertEqual(self.state.read_bytes(), b'synthetic-state-unchanged')
        self.assertIn('run_notes_backfill', self.target.read_text())
        if sys.platform != 'win32':
            self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)

    def test_old_top_level_code_is_never_executed(self):
        marker = self.path / 'MUST-NOT-EXIST'
        self.original += '\nopen(' + repr(str(marker)) + ', "w").write("executed")\n'
        self.target.write_text(self.original)
        self.upgrade()
        self.assertFalse(marker.exists())

    def test_placeholder_expression_duplicate_and_invalid_syntax_refuse_without_backup(self):
        cases = [TEMPLATE,
                 self.original.replace(repr(FAKE_TOKEN), 'str("not-constant")'),
                 self.original + '\nYASH_UPLOAD_TOKEN = "second-synthetic-key"\n',
                 self.original + '\ninvalid python syntax !\n',
                 self.original.replace(repr(FAKE_TOKEN), repr('bad key with spaces'))]
        for source in cases:
            with self.subTest(case=cases.index(source)):
                self.target.write_text(source)
                with self.assertRaises(U.UpgradeError): self.upgrade()
                self.assertEqual(self.target.read_text(), source)
                self.assertEqual(list(self.path.glob('*.bak')), [])

    def test_fixed_endpoint_rejects_other_host_path_query_fragment_and_protocol(self):
        for url in ['https://other.invalid/functions/v1/yash-order-ingest', U.EXPECTED_URL+'?key=synthetic', U.EXPECTED_URL+'#fragment', U.EXPECTED_URL+'/other', U.EXPECTED_URL.replace('https:', 'http:')]:
            self.target.write_text(self.original.replace(U.EXPECTED_URL, url))
            with self.assertRaises(U.UpgradeError): self.upgrade()
            self.assertEqual(list(self.path.glob('*.bak')), [])

    def test_template_tampering_refuses_without_changing_any_existing_file(self):
        self.template.write_text(TEMPLATE + '\n# altered\n')
        with self.assertRaises(U.UpgradeError): self.upgrade()
        self.assert_original(); self.assertEqual(list(self.path.glob('*.bak')), [])

    def test_atomic_replace_failure_keeps_original_and_private_backup(self):
        with patch.object(U.os, 'replace', side_effect=OSError('synthetic')):
            with self.assertRaises(OSError): self.upgrade()
        self.assert_original()
        backups = list(self.path.glob('*.bak')); self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), self.original)
        self.assertEqual(list(self.path.glob('.yash-notes-upgrade-*')), [])

    def test_symlink_target_refused_and_does_not_change_referent(self):
        alias = self.path / 'alias.py'
        alias.symlink_to(self.target)
        with self.assertRaises(U.UpgradeError): U.upgrade(alias, self.template)
        self.assert_original()

    def test_concurrent_target_edit_is_preserved_not_overwritten(self):
        original_backup = U.backup_original
        concurrent = self.original + '\n# concurrent local edit\n'
        def edit_after_backup(target, original):
            backup = original_backup(target, original)
            target.write_text(concurrent)
            return backup
        with patch.object(U, 'backup_original', side_effect=edit_after_backup):
            with self.assertRaises(U.UpgradeError): self.upgrade()
        self.assertEqual(self.target.read_text(), concurrent)
        self.assertEqual(list(self.path.glob('*.bak'))[0].read_text(), self.original)

    def test_repeated_upgrade_is_idempotent_and_keeps_first_backup(self):
        self.upgrade(); first = self.target.read_bytes()
        self.assertIsNone(self.upgrade())
        self.assertEqual(self.target.read_bytes(), first)
        self.assertEqual(len(list(self.path.glob('*.bak'))), 1)

    def test_cli_never_prints_synthetic_activation_on_success_or_failure(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), patch.object(U, '__file__', str(self.path / 'upgrade_yash_notes.py')):
            self.assertEqual(U.main(['--target', str(self.target)]), 0)
            self.target.write_text(self.original.replace(U.EXPECTED_URL, U.EXPECTED_URL+'?bad=1'))
            self.assertEqual(U.main(['--target', str(self.target)]), 1)
        self.assertNotIn(FAKE_TOKEN, out.getvalue()+err.getvalue())
        self.assertNotIn('YASH_UPLOAD_TOKEN', out.getvalue()+err.getvalue())


if __name__ == '__main__': unittest.main()
