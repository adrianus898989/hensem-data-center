"""Tests launch temporary dummy scripts only. No live collector or API call."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("collector_manager", Path(__file__).with_name("collector_manager.py"))
cm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cm)

DEMO = """import os, signal, time
from pathlib import Path
keep = True
def stop(sig, frame):
    global keep
    keep = False
signal.signal(signal.SIGINT, stop)
with open('starts.txt', 'a') as f: f.write(str(os.getpid()) + '\\n')
while keep: time.sleep(0.02)
Path('graceful.txt').write_text('stopped')
"""


class FakeAPI:
    def __init__(self):
        self.desired = "stopped"
        self.revision = 0
        self.failure = False
        self.requests = []

    def call(self, request):
        self.requests.append(request)
        if self.failure:
            raise cm.ManagerError("network_unavailable")
        return {"ok": True, "pollSeconds": 15,
                "tasks": [{"id": "demo", "desiredState": self.desired, "revision": self.revision}]}


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="collector-manager-test-")
        self.root = Path(self.tmp.name)
        self.state = cm.private_dir(self.root / "state")
        self.script = self.root / ("dummy_" + self.root.name + ".py")
        self.script.write_text(DEMO)
        self.config = {"endpoint": "https://example.supabase.co/functions/v1/collector-control", "tasks": [
            {"id": "demo", "label": "Temporary test", "python": sys.executable,
             "script": str(self.script), "args": [], "cwd": str(self.root)}]}
        self.config_path = self.root / "config.json"
        self.save_config()
        cm.private_write(self.state / "device.json", {"endpoint": self.config["endpoint"],
                         "deviceId": "11111111-1111-1111-1111-111111111111", "token": "a" * 64})
        self.api = FakeAPI()
        self.manager = cm.Manager(self.config_path, self.state, api=self.api)
        self.external = None
        self.orphan_pid = None
        self.helper_created = False

    def save_config(self):
        self.config_path.write_text(json.dumps(self.config))

    def wait(self, condition, timeout=6):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            if condition():
                return
            time.sleep(0.03)
        self.fail("temporary process condition timed out")

    def status(self):
        return self.manager.inspect(self.config["tasks"][0])

    def start(self):
        self.api.desired, self.api.revision = "running", self.api.revision + 1
        self.assertTrue(self.manager.cycle())
        self.wait(lambda: self.status()["observedState"] == "running")
        self.wait(lambda: (self.root / "starts.txt").exists())
        return self.status()["pid"]

    def stop(self):
        self.api.desired, self.api.revision = "stopped", self.api.revision + 1
        self.manager.cycle()
        self.wait(lambda: self.status()["observedState"] == "stopped")

    def tearDown(self):
        # Authentication-limited local guardian requests; only test-owned PIDs.
        if self.helper_created:
            (self.root / "finish_helper").write_text("finish")
            end = time.monotonic() + 5
            while time.monotonic() < end and not (self.root / "helper_done").exists():
                time.sleep(0.03)
        cm.guardian_request(self.state, "demo", "stop")
        end = time.monotonic() + 5
        while time.monotonic() < end:
            reply = cm.guardian_request(self.state, "demo", "status")
            if not reply or reply.get("pid") is None:
                break
            time.sleep(0.03)
        cm.guardian_request(self.state, "demo", "retire")
        if self.external is not None and self.external.poll() is None:
            self.external.send_signal(signal.SIGINT)
            self.external.wait(timeout=5)
        if self.orphan_pid:
            with contextlib.suppress(ProcessLookupError):
                os.kill(self.orphan_pid, signal.SIGINT)
            end = time.monotonic() + 5
            while time.monotonic() < end and not (self.root / "graceful.txt").exists():
                time.sleep(0.03)
        self.manager.close()
        for process in self.manager.children:
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=5)
        for logger in list(cm.logging.Logger.manager.loggerDict.values()):
            if isinstance(logger, cm.logging.Logger) and str(self.state) in logger.name:
                for handler in list(logger.handlers):
                    handler.close()
                    logger.removeHandler(handler)
        self.tmp.cleanup()

    def test_start_stop_idempotence_preserves_workdir_files(self):
        marker = self.root / "existing-orders.sqlite"
        marker.write_bytes(b"existing data must be preserved")
        first_pid = self.start()
        for _ in range(3):
            self.assertTrue(self.manager.cycle())
        self.assertEqual(self.status()["pid"], first_pid)
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)
        self.stop()
        self.assertEqual((self.root / "graceful.txt").read_text(), "stopped")
        self.assertEqual(marker.read_bytes(), b"existing data must be preserved")
        self.manager.cycle()
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)

    def test_network_failure_leaves_running_process_and_cannot_start(self):
        self.api.failure, self.api.desired = True, "running"
        self.assertFalse(self.manager.cycle())
        self.assertIsNone(self.status()["pid"])
        self.api.failure = False
        pid = self.start()
        self.api.failure, self.api.desired = True, "stopped"
        self.assertFalse(self.manager.cycle())
        self.assertEqual(self.status()["pid"], pid)

    def test_manager_restart_recovers_without_duplicate(self):
        pid = self.start()
        original_children = self.manager.children
        self.manager.close()
        self.manager = cm.Manager(self.config_path, self.state, api=self.api)
        self.manager.children.extend(original_children)
        self.manager.cycle()
        self.assertEqual(self.status()["pid"], pid)
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)
        self.stop()

    def test_removing_active_task_rejects_startup_then_restored_config_recovers(self):
        pid = self.start()
        original_children = self.manager.children
        old_tasks = self.config["tasks"]
        self.manager.close()
        # Simulate a crash before history could have been durably saved.
        (self.state / "history.json").unlink()
        self.config["tasks"] = []
        self.save_config()
        count = len(self.api.requests)
        with self.assertRaisesRegex(cm.ManagerError, "config_invalid"):
            cm.Manager(self.config_path, self.state, api=self.api)
        self.assertEqual(len(self.api.requests), count)
        self.assertEqual(cm.guardian_request(self.state, "demo", "status")["pid"], pid)
        self.assertFalse((self.root / "graceful.txt").exists())
        self.config["tasks"] = old_tasks
        self.save_config()
        self.manager = cm.Manager(self.config_path, self.state, api=self.api)
        self.manager.children.extend(original_children)
        self.manager.cycle()
        self.assertEqual(self.status()["pid"], pid)
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)

    def test_removing_stopped_task_retires_idle_guardian(self):
        self.start()
        self.stop()
        old_children = self.manager.children
        self.manager.close()
        self.config["tasks"] = []
        self.save_config()
        self.manager = cm.Manager(self.config_path, self.state, api=self.api)
        for child in old_children:
            child.wait(timeout=5)
        self.assertEqual(self.manager.inventory(), [])
        self.assertIsNone(cm.guardian_request(self.state, "demo", "status"))

    def test_removing_task_with_unreachable_locked_guardian_is_rejected(self):
        fd = cm.lock_file(self.state / "prior_task.lock")
        self.manager.close()
        try:
            with self.assertRaisesRegex(cm.ManagerError, "config_invalid"):
                cm.Manager(self.config_path, self.state, api=self.api)
            self.assertEqual(self.api.requests, [])
        finally:
            os.close(fd)
        self.manager = cm.Manager(self.config_path, self.state, api=self.api)

    def test_duplicate_manager_refused(self):
        with self.assertRaisesRegex(cm.ManagerError, "local_lock"):
            cm.Manager(self.config_path, self.state, api=self.api)
        reader = cm.Manager(self.config_path, self.state, api=self.api, read_only=True)
        try:
            self.assertEqual(reader.inventory()[0]["observedState"], "stopped")
        finally:
            reader.close()

    def test_external_process_never_stopped_or_duplicated(self):
        self.external = subprocess.Popen([sys.executable, str(self.script)], cwd=str(self.root))
        self.wait(lambda: (self.root / "starts.txt").exists())
        self.assertEqual(self.status()["observedState"], "external_running")
        self.api.desired = "running"
        self.manager.cycle()
        self.api.desired, self.api.revision = "stopped", 1
        self.manager.cycle()
        self.assertIsNone(self.external.poll())
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)

    def test_spawn_failure_and_restart_limit(self):
        # Executable exists but has no valid executable format: real Popen fails.
        bad = self.root / "invalid-python"
        bad.write_text("not executable binary format")
        bad.chmod(0o700)
        self.manager.close()
        self.config["tasks"][0]["python"] = str(bad)
        self.save_config()
        self.manager = cm.Manager(self.config_path, self.state, api=self.api)
        self.api.desired = "running"
        self.manager.cycle()
        self.wait(lambda: self.status()["detailCode"] == "spawn_failed")
        for attempt in range(cm.MAX_FAILURES):
            old_instance = self.status().get("instance")
            self.manager.cycle()
            item = self.manager.history["demo"]
            if item.get("failures", 0) >= cm.MAX_FAILURES:
                break
            item["nextStart"] = 0
            self.manager.cycle()
            self.wait(lambda: self.status().get("instance") != old_instance
                      and self.status().get("detailCode") == "spawn_failed")
        self.assertEqual(self.manager.inventory()[0]["detailCode"], "restart_limit")
        self.api.desired, self.api.revision = "stopped", self.api.revision + 1
        self.manager.cycle()
        self.assertEqual(self.manager.inventory()[0]["observedState"], "stopped")
        self.assertEqual(self.manager.history["demo"]["failures"], 0)

    def test_stale_response_and_unknown_remote_argv_rejected(self):
        self.api.desired = "running"
        with mock.patch.object(cm.time, "monotonic", side_effect=[100, 140]):
            self.assertFalse(self.manager.cycle())
        self.assertIsNone(self.status()["pid"])
        self.api.call = lambda request: {"ok": True, "tasks": [
            {"id": "demo", "desiredState": "running", "revision": 1, "argv": ["rm", "-rf"]}]}
        self.assertFalse(self.manager.cycle())
        self.assertIsNone(self.status()["pid"])

    def test_locked_unknown_owner_is_blocked_and_not_signaled(self):
        # Represents guardian gone while an inherited task lock is still held.
        fd = cm.lock_file(self.state / "demo.lock")
        try:
            with mock.patch.object(cm.os, "killpg") as kill:
                self.api.desired = "running"
                self.manager.cycle()
                self.api.desired, self.api.revision = "stopped", 1
                self.manager.cycle()
                self.assertEqual(self.status()["detailCode"], "orphaned_process")
                kill.assert_not_called()
        finally:
            os.close(fd)

    def test_guardian_crash_retains_child_lock_and_blocks_duplicate(self):
        self.orphan_pid = self.start()
        guardian = self.manager.children[0]
        guardian.terminate()  # This Popen is a test-owned guardian, never a collector from the user.
        guardian.wait(timeout=5)
        self.manager.cycle()
        self.assertEqual(self.status()["detailCode"], "orphaned_process")
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)
        self.api.desired, self.api.revision = "stopped", self.api.revision + 1
        self.manager.cycle()
        self.assertFalse((self.root / "graceful.txt").exists())

    def test_guardian_early_exit_is_counted_and_backed_off(self):
        # A valid but concurrently removed local script makes the wrapper fail validation.
        self.script.unlink()
        self.api.desired = "running"
        self.manager.cycle()
        self.wait(lambda: self.manager.children and self.manager.children[0].poll() is not None)
        self.manager.cycle()
        self.assertEqual(self.manager.history["demo"]["failures"], 1)
        self.assertGreater(self.manager.history["demo"]["nextStart"], time.time())
        self.assertFalse(self.manager.children)

    def make_helper_parent(self, wait_for_stop):
        helper = self.root / "separately_named_helper.py"
        helper.write_text("import signal,time\nfrom pathlib import Path\n"
                          "signal.signal(signal.SIGINT, signal.SIG_IGN)\n"
                          "Path('helper_ready').write_text('ready')\n"
                          "while not Path('finish_helper').exists(): time.sleep(0.02)\n"
                          "Path('helper_done').write_text('done')\n")
        parent = ("import subprocess,sys,time,signal\nfrom pathlib import Path\n"
                  "subprocess.Popen([sys.executable, " + repr(str(helper)) + "], close_fds=True)\n"
                  "with open('starts.txt','a') as f: f.write('start\\n')\n"
                  "while not Path('helper_ready').exists(): time.sleep(0.02)\n")
        if wait_for_stop:
            parent += "signal.signal(signal.SIGINT, lambda s,f: sys.exit(0))\nwhile True: time.sleep(0.02)\n"
        self.script.write_text(parent)
        self.helper_created = True

    def test_remaining_helper_blocks_restart_even_after_guardian_death(self):
        self.make_helper_parent(wait_for_stop=False)
        self.api.desired = "running"
        self.manager.cycle()
        self.wait(lambda: (self.root / "helper_ready").exists())
        self.wait(lambda: self.status()["detailCode"] == "orphaned_process")
        self.assertEqual(self.status()["observedState"], "blocked")
        self.manager.cycle()
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)
        guardian = self.manager.children[0]
        guardian.terminate()
        guardian.wait(timeout=5)
        saved = cm.private_read(self.state / "demo.guardian.json")
        self.assertIsInstance(saved["groupId"], int)
        self.manager.close()
        self.manager = cm.Manager(self.config_path, self.state, api=self.api)
        self.manager.cycle()
        self.assertEqual(self.status()["detailCode"], "orphaned_process")
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)

    def test_stopped_parent_with_surviving_helper_blocks_next_start(self):
        self.make_helper_parent(wait_for_stop=True)
        self.start()
        self.wait(lambda: (self.root / "helper_ready").exists())
        self.api.desired, self.api.revision = "stopped", self.api.revision + 1
        self.manager.cycle()
        self.wait(lambda: self.status()["detailCode"] == "orphaned_process")
        self.api.desired, self.api.revision = "running", self.api.revision + 1
        self.manager.cycle()
        self.assertEqual(self.status()["observedState"], "blocked")
        self.assertEqual(len((self.root / "starts.txt").read_text().splitlines()), 1)

    def test_stop_timeout_does_not_force_kill(self):
        self.script.write_text("import signal,time\nfrom pathlib import Path\n"
                               "signal.signal(signal.SIGINT, signal.SIG_IGN)\n"
                               "Path('ready').write_text('ready')\n"
                               "while not Path('finish').exists(): time.sleep(0.02)\n")
        cm.private_write(self.state / "demo.guardian.json", {"secret": "c" * 64})
        fd = cm.lock_file(self.state / "demo.lock")
        guard = cm.Guardian(self.config["tasks"][0], self.state, fd)
        try:
            guard.start()
            self.wait(lambda: (self.root / "ready").exists())
            with mock.patch.object(cm.os, "killpg", wraps=cm.os.killpg) as kill:
                guard.stop()
                guard.stopping_at = time.monotonic() - cm.STOP_WAIT - 1
                self.assertEqual(guard.status()["detailCode"], "stop_timeout")
                guard.stop()
                self.assertEqual(kill.call_count, 1)
                self.assertEqual(kill.call_args.args[1], signal.SIGINT)
                self.assertIsNone(guard.child.poll())
        finally:
            (self.root / "finish").write_text("finish")
            if guard.child:
                guard.child.wait(timeout=5)
            os.close(fd)

    def test_log_bound_and_secret_not_in_inventory(self):
        for _ in range(6000):
            cm.record(self.manager.logger, "network_unavailable")
        logs = list(self.state.glob("manager.log*"))
        self.assertLessEqual(len(logs), 3)
        self.assertLessEqual(sum(path.stat().st_size for path in logs), 3 * 65536)
        self.manager.cycle()
        serialized = json.dumps(self.api.requests)
        self.assertNotIn("a" * 64, serialized)
        self.assertNotIn(str(self.script), serialized)
        for path in logs:
            self.assertNotIn("a" * 64, path.read_text())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.state / "device.json").stat().st_mode), 0o600)

    def test_untrusted_endpoint_and_redirect_refused(self):
        for endpoint in ["http://example.com/functions/v1/collector-control", "https://a:b@example.com/functions/v1/collector-control",
                         "https://example.com/functions/v1/collector-control?token=x", "https://example.com/other"]:
            with self.assertRaises(cm.ManagerError):
                cm.endpoint_valid(endpoint)
        handler = cm.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, "", {}, "https://evil.example"))

    def test_reserved_manager_task_id_is_rejected(self):
        self.config["tasks"][0]["id"] = "manager"
        self.save_config()
        with self.assertRaisesRegex(cm.ManagerError, "config_invalid"):
            cm.load_config(self.config_path)

    def test_local_changed_task_does_not_control_old_child(self):
        pid = self.start()
        changed = dict(self.config["tasks"][0], args=["changed"])
        self.assertEqual(self.manager.inspect(changed)["detailCode"], "config_invalid")
        self.assertEqual(self.status()["pid"], pid)

    def test_pairing_secret_saved_privately_not_printed(self):
        paired = self.root / "paired"
        reply = {"ok": True, "deviceId": "22222222-2222-2222-2222-222222222222", "token": "b" * 64}
        output = io.StringIO()
        with mock.patch.object(cm.getpass, "getpass", return_value="C" * 32), \
                mock.patch.object(cm.API, "call", return_value=reply), contextlib.redirect_stdout(output):
            cm.pair(self.config_path, paired)
        self.assertNotIn("b" * 64, output.getvalue())
        self.assertNotIn("C" * 32, output.getvalue())
        self.assertEqual(cm.private_read(paired / "device.json")["token"], "b" * 64)
        with self.assertRaisesRegex(cm.ManagerError, "config_invalid"):
            cm.pair(self.config_path, paired)


if __name__ == "__main__":
    unittest.main()
