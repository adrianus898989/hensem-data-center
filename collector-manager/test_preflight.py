import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).with_name("preflight.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightTests(unittest.TestCase):
    def test_spaces_helpers_and_python_versions(self):
        data = (" 12 1048576 /A Folder/Python.framework/Versions/3.13/Python\n"
                "13 512 /a/python3.9\n14 2048 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n"
                "15 1024 /Helpers/Google Chrome Helper (Renderer)\n"
                "16 1024 /Helpers/Google Chrome for Testing Helper (GPU)\n")
        result = preflight.summarize_processes(data)
        self.assertEqual(result["Python"], {"count": 2, "rss_kib": 1049088})
        self.assertEqual(result["Chrome"], {"count": 3, "rss_kib": 4096})

    def test_unrelated_or_malformed_names_never_leak(self):
        data = ("12 1 /private/ACCOUNT_SECRET/Unrelated\n13 2 /a/python3 --token=SECRET\n"
                "14 -1 /a/Python\ninvalid\n")
        report = preflight.render_report("bad", data, executable="python", version="3.9",
                                        system="Darwin", machine="arm64")
        self.assertNotIn("SECRET", report)
        self.assertIn("未知", report)
        self.assertIn("Python 进程：0 个", report)

    def test_read_failure_is_unknown_not_zero(self):
        report = preflight.render_report(None, None, executable="python", version="3.9",
                                        system="Darwin", machine="x86_64")
        self.assertIn("无法读取进程列表", report)
        self.assertNotIn("进程：0 个", report)
        self.assertIn("未验证后台连接或订单采集", report)

    def test_fixed_read_only_commands_and_redacted_failure(self):
        with patch.object(preflight.subprocess, "run", side_effect=subprocess.TimeoutExpired("SECRET", 10)) as run:
            self.assertIsNone(preflight.read_command("processes"))
            self.assertEqual(run.call_args.args[0], ("/bin/ps", "-axo", "pid=,rss=,comm="))
            self.assertNotIn("shell", run.call_args.kwargs)

    def test_gib_units_and_shared_memory_warning(self):
        report = preflight.render_report(str(48 * 1024 ** 3), "", executable="python",
                                        version="3.9", system="Darwin", machine="arm64")
        self.assertIn("物理内存：48.0 GiB", report)
        self.assertIn("共享页可能重复计算", report)


if __name__ == "__main__":
    unittest.main()
