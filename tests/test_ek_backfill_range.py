"""Offline checks for the user-requested EK7 September 1–17 backfill."""
import contextlib
import importlib.util
import io
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "ek_backfill_collector", Path(__file__).parents[1] / "collectors/ek_sync.py"
)
ek = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ek
spec.loader.exec_module(ek)


class SeptemberBackfillTests(unittest.TestCase):
    def args(self, root):
        args = ek.build_parser().parse_args([
            "--mode", "once", "--platform", "EK7", "--data-type", "all",
            "--time-basis", "both", "--start", "2026-09-01T00:00:00",
            "--end", "2026-09-17T23:59:59", "--state-dir", str(root),
        ])
        ek.validate_time_args(args)
        return args

    def test_exact_requested_range_is_68_ek7_jobs_without_network(self):
        with tempfile.TemporaryDirectory() as root:
            args = self.args(root)
            seen = []

            def record(store, key, task_args, db, ensured, platforms):
                seen.append(store.jobs[key].copy())
                return None

            # Nothing can resolve a backend or write business data: DB and
            # execution are mocked. Queue files exist only in a temp directory.
            with patch.object(ek, "Supabase") as database, \
                    patch.object(ek, "execute_queued_task", side_effect=record), \
                    patch.object(ek, "resolve_platform_name", side_effect=AssertionError("network disallowed")), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(ek.run_selected(args), 0)
            self.assertEqual(len(seen), 68)
            self.assertEqual({job["platform"] for job in seen}, {"EK7"})
            self.assertEqual({job["basis"] for job in seen}, {"created", "success"})
            self.assertEqual({job["data_type"] for job in seen}, {"charge", "withdraw"})
            self.assertEqual(len({job["day"] for job in seen}), 17)
            self.assertEqual(min(job["day"] for job in seen), "2026-09-01")
            self.assertEqual(max(job["day"] for job in seen), "2026-09-17")
            self.assertTrue(all(not job["created_since"] for job in seen))
            self.assertEqual({job["start"] for job in seen if job["day"] == "2026-09-01"},
                             {"2026-09-01T00:00:00"})
            self.assertEqual({job["end"] for job in seen if job["day"] == "2026-09-17"},
                             {"2026-09-17T23:59:59"})
            database.return_value.upsert.assert_not_called()

    def test_repeating_once_refreshes_done_jobs_instead_of_only_missing(self):
        with tempfile.TemporaryDirectory() as root:
            args = self.args(root)
            visited = []

            def finish(store, key, task_args, db, ensured, platforms):
                self.assertEqual(store.jobs[key]["status"], "pending")
                visited.append(key)
                store.finish(key, {"written": 1})
                return None

            with patch.object(ek, "Supabase"), \
                    patch.object(ek, "execute_queued_task", side_effect=finish), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(ek.run_selected(args), 0)
                first_pass = visited.copy()
                self.assertEqual(ek.run_selected(args), 0)
            self.assertEqual(len(first_pass), 68)
            self.assertEqual(visited[68:], first_pass)
            self.assertEqual({job["status"] for job in ek.TaskStore(ek.queue_file(args)).jobs.values()}, {"done"})

    def test_final_second_is_inclusive_and_india_timezone_fixed(self):
        with tempfile.TemporaryDirectory() as root:
            args = self.args(root)
            args._window_start = "2026-09-17T00:00:00"
            args._window_end = args.end
            args._time_basis = "success"
            window = ek.task_window(date(2026, 9, 17), args)
            self.assertEqual(window.utc_start, "2026-09-16T18:30:00.000Z")
            self.assertEqual(window.utc_end, "2026-09-17T18:29:59.999Z")
            self.assertEqual(window.created_since, "")


if __name__ == "__main__":
    unittest.main()
