"""Reuse the original R8 pure offline runtime suite against the new delivery.

The historical test file stays unchanged. No collector main is executed. The
old no-member/no-business-fields assertion is replaced by the new privacy suite.
The old backend integration class is excluded: the new server contract has its
own integration tests and the historical backend rejects newly allowed fields.
"""
import argparse
import importlib.util
from pathlib import Path
import types
import unittest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-tests', required=True, type=Path)
    parser.add_argument('--delivery', required=True, type=Path)
    args = parser.parse_args()
    source = args.legacy_tests.read_text(encoding='utf-8')
    source = source[:source.index('\nclass EdgePGliteIntegrationTests')]
    tests = types.ModuleType('lg_previous_offline_tests')
    tests.__file__ = str(args.legacy_tests.resolve())
    exec(compile(source, str(args.legacy_tests), 'exec'), tests.__dict__)
    spec = importlib.util.spec_from_file_location('lg_current_offline', args.delivery)
    current = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(current)
    tests.w = current
    tests.TARGET = args.delivery.resolve()
    suite = unittest.TestSuite()
    replaced = 'test_decimal_amounts_remain_exact_and_raw_secrets_are_removed'
    for group in unittest.defaultTestLoader.loadTestsFromModule(tests):
        for test in group:
            if test._testMethodName != replaced:
                suite.addTest(test)
    return 0 if unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
