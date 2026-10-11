"""Synthetic filesystem/configuration tests; no original collector is executed."""
import ast
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
DIR=ROOT/'collectors/newar-business-fields-upgrade'
SPEC=importlib.util.spec_from_file_location('upgrade',DIR/'upgrade.py')
u=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(u)
PAYLOAD=(DIR/'newar_business_fields.py').read_bytes()
OLD=b'def build_business_fields(*args):\n    return {"operatorType": "manual"}\n'
ALLOW={hashlib.sha256(OLD).hexdigest()}

def embedded(duplicate=False):
    members=[('newar_business_fields',OLD.decode()),('other_helper','CONFIG="SYNTHETIC_FIXTURE_ONLY"\n')]
    if duplicate:members.append(('newar_business_fields',OLD.decode()))
    dictionary='{'+','.join(repr(k)+':'+repr(v) for k,v in members)+'}'
    bootstrap='raise RuntimeError("DO_NOT_EXECUTE")\n# 本地配置\nFILES='+dictionary+'\n'
    source='# 只测试文件文本\nPRIVATE_CONFIG={"password":"SYNTHETIC_FIXTURE_ONLY"}\n'+u.BOOTSTRAP_NAME+'='+repr(bootstrap)+'\nraise RuntimeError("DO_NOT_EXECUTE")\n'
    return source,bootstrap

def bootstrap_value(source):
    return next(n.value.value for n in ast.parse(source).body if isinstance(n,ast.Assign)
                and any(isinstance(t,ast.Name) and t.id==u.BOOTSTRAP_NAME for t in n.targets))

class UpgradeTests(unittest.TestCase):
    def test_payload_is_the_frozen_published_module(self):
        self.assertEqual(hashlib.sha256(PAYLOAD).hexdigest(),u.NEW_HELPER_SHA256)
        self.assertEqual(PAYLOAD,(ROOT/'collectors/newar_business_fields.py').read_bytes())

    def test_embedded_patch_preserves_outer_configuration_and_other_helper(self):
        source,boot=embedded();updated,changed=u.replace_embedded(source,PAYLOAD,ALLOW)
        self.assertTrue(changed)
        self.assertEqual(source.split(u.BOOTSTRAP_NAME+'=')[0],updated.split(u.BOOTSTRAP_NAME+'=')[0])
        self.assertEqual(ast.literal_eval(ast.parse(source).body[0].value),ast.literal_eval(ast.parse(updated).body[0].value))
        before=ast.parse(boot);after=ast.parse(bootstrap_value(updated))
        olddict=next(n for n in ast.walk(before) if isinstance(n,ast.Dict))
        newdict=next(n for n in ast.walk(after) if isinstance(n,ast.Dict))
        self.assertEqual(ast.literal_eval(olddict)['other_helper'],ast.literal_eval(newdict)['other_helper'])
        self.assertEqual(ast.literal_eval(newdict)['newar_business_fields'].encode(),PAYLOAD)
        # Both source layers deliberately contain raise statements; parsing never executes them.
        self.assertIn('DO_NOT_EXECUTE',updated)

    def test_unknown_version_or_ambiguous_dictionary_is_rejected(self):
        source,_=embedded()
        with self.assertRaisesRegex(u.UpgradeError,'VERSION_UNSUPPORTED'):u.replace_embedded(source,PAYLOAD)
        with self.assertRaisesRegex(u.UpgradeError,'NOT_UNIQUE'):u.replace_embedded(embedded(True)[0],PAYLOAD,ALLOW)
        with self.assertRaisesRegex(u.UpgradeError,'BOOTSTRAP_NOT_UNIQUE'):u.replace_embedded('print("fixture")',PAYLOAD,ALLOW)

    def test_helper_and_single_file_apply_with_private_backup_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);helper=root/'newar_business_fields.py';script=root/'collector.py'
            helper.write_bytes(OLD);source,_=embedded();script.write_text(source)
            plans=[u.prepare(helper,PAYLOAD,allowed_old=ALLOW),u.prepare(script,PAYLOAD,embedded=True,allowed_old=ALLOW)]
            self.assertEqual(u.apply(plans),2)
            self.assertEqual(helper.read_bytes(),PAYLOAD)
            self.assertEqual(helper.with_name(helper.name+'.pre-newar-method-fix.bak').read_bytes(),OLD)
            self.assertEqual(script.with_name(script.name+'.pre-newar-method-fix.bak').read_text(),source)
            self.assertEqual(script.with_name(script.name+'.pre-newar-method-fix.bak').stat().st_mode&0o777,0o600)
            self.assertEqual(u.apply([u.prepare(helper,PAYLOAD),u.prepare(script,PAYLOAD,embedded=True)]),0)

    def test_utf8_byte_columns_and_bom_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'collector.py';source,_=embedded();file.write_bytes(b'\xef\xbb\xbf'+source.encode())
            plan=u.prepare(file,PAYLOAD,embedded=True,allowed_old=ALLOW)
            self.assertTrue(plan['replacement'].startswith(b'\xef\xbb\xbf'))
            updated=plan['replacement'][3:].decode();self.assertIn('只测试文件文本',updated)
            self.assertEqual(ast.literal_eval(next(n for n in ast.walk(ast.parse(bootstrap_value(updated))) if isinstance(n,ast.Dict)))['newar_business_fields'].encode(),PAYLOAD)

    def test_changed_target_and_conflicting_backup_fail_before_any_write(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'helper.py';p.write_bytes(OLD);plan=u.prepare(p,PAYLOAD,allowed_old=ALLOW);p.write_bytes(OLD+b'# changed\n')
            with self.assertRaisesRegex(u.UpgradeError,'CHANGED'):u.apply([plan])
            p.write_bytes(OLD);backup=p.with_name(p.name+'.pre-newar-method-fix.bak');backup.write_text('SYNTHETIC_UNRELATED_BACKUP')
            with self.assertRaisesRegex(u.UpgradeError,'BACKUP_CONFLICT'):u.apply([u.prepare(p,PAYLOAD,allowed_old=ALLOW)])
            self.assertEqual(p.read_bytes(),OLD)

    def test_partial_filesystem_failure_rolls_back_first_target(self):
        with tempfile.TemporaryDirectory() as directory:
            files=[Path(directory)/'a.py',Path(directory)/'b.py']
            for p in files:p.write_bytes(OLD)
            plans=[u.prepare(p,PAYLOAD,allowed_old=ALLOW) for p in files]
            real=u.atomic_write;calls=[]
            def fail_once(path,data,mode):
                calls.append(path)
                if len(calls)==2:raise OSError('synthetic IO failure')
                return real(path,data,mode)
            with patch.object(u,'atomic_write',side_effect=fail_once):
                with self.assertRaises(OSError):u.apply(plans)
            self.assertTrue(all(p.read_bytes()==OLD for p in files))

    def test_cli_reports_public_codes_without_source_or_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            helpers=Path(directory);(helpers/'newar_business_fields.py').write_text('PRIVATE_CONFIG="SYNTHETIC_FIXTURE_ONLY"\n')
            out=io.StringIO();err=io.StringIO()
            with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
                self.assertEqual(u.main(['--helpers-dir',str(helpers)]),1)
            self.assertEqual(err.getvalue().strip(),'HELPER_VERSION_UNSUPPORTED')
            self.assertNotIn('SYNTHETIC_FIXTURE_ONLY',out.getvalue()+err.getvalue())

    def test_symlink_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            real=Path(directory)/'real.py';link=Path(directory)/'link.py';real.write_bytes(OLD);link.symlink_to(real)
            with self.assertRaisesRegex(u.UpgradeError,'NOT_REGULAR_FILE'):u.prepare(link,PAYLOAD,allowed_old=ALLOW)

if __name__=='__main__':unittest.main()
