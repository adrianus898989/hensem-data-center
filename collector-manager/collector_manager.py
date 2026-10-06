#!/usr/bin/env python3
"""Local allowlisted collector supervisor; Python 3.9+, macOS/POSIX, stdlib only."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import getpass
import hashlib
import hmac
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import secrets
import shlex
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.0.0"
POLL_SECONDS = 15
MAX_RESPONSE = 128 * 1024
STOP_WAIT = 20
MAX_FAILURES = 5
ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
STATES = {"stopped", "starting", "running", "stopping", "failed", "blocked", "external_running"}
CODES = {"ok", "starting", "stopped", "stop_requested", "spawn_failed", "exited",
         "restart_backoff", "restart_limit", "stop_timeout", "local_lock", "external_running",
         "unavailable", "config_invalid", "manager_restarted", "orphaned_process",
         "auth_unavailable", "network_unavailable"}


class ManagerError(Exception):
    """Public errors contain a fixed code only, never secrets or child output."""


def private_dir(path):
    path = Path(path).absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ManagerError("config_invalid")
    os.chmod(str(path), 0o700)
    return path


def private_read(path, default=None):
    try:
        fd = os.open(str(path), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return default
    with os.fdopen(fd, "r", encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ManagerError("config_invalid")
        try:
            return json.load(stream)
        except (ValueError, UnicodeError):
            raise ManagerError("config_invalid")


def private_write(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, str(path))
        directory_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def lock_file(path):
    fd = os.open(str(path), os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    if os.fstat(fd).st_uid != os.getuid():
        os.close(fd)
        raise ManagerError("config_invalid")
    os.fchmod(fd, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise ManagerError("local_lock")
    return fd


def endpoint_valid(value):
    try:
        parsed = urllib.parse.urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname and not parsed.username
                 and not parsed.password and not parsed.query and not parsed.fragment
                 and parsed.port in (None, 443)
                 and parsed.path == "/functions/v1/collector-control"
                 and not any(ord(c) < 33 for c in value))
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise ManagerError("config_invalid")
    return value


def label_valid(value):
    return isinstance(value, str) and 1 <= len(value) <= 80 and not any(ord(c) < 32 or ord(c) == 127 for c in value)


def load_config(path):
    try:
        with open(path, "r", encoding="utf-8") as stream:
            config = json.load(stream)
        endpoint_valid(config["endpoint"])
        tasks = config["tasks"]
        if not isinstance(tasks, list) or len(tasks) > 100:
            raise ValueError()
        seen = set()
        for task in tasks:
            required = {"id", "label", "python", "script", "args", "cwd"}
            if not isinstance(task, dict) or not required.issubset(task) or set(task) - required - {"python_args"}:
                raise ValueError()
            if (not isinstance(task["id"], str) or not ID_RE.fullmatch(task["id"])
                    or task["id"] == "manager" or task["id"] in seen):
                raise ValueError()
            seen.add(task["id"])
            if not label_valid(task["label"]):
                raise ValueError()
            for field in ("python", "script", "cwd"):
                if not isinstance(task[field], str) or not os.path.isabs(task[field]) or "\0" in task[field]:
                    raise ValueError()
            if not os.path.isfile(task["python"]) or not os.access(task["python"], os.X_OK):
                raise ValueError()
            if not os.path.isfile(task["script"]) or not os.path.isdir(task["cwd"]):
                raise ValueError()
            if not isinstance(task["args"], list) or len(task["args"]) > 100:
                raise ValueError()
            if any(not isinstance(arg, str) or "\0" in arg or len(arg) > 4096 for arg in task["args"]):
                raise ValueError()
            python_args = task.get("python_args", [])
            if not isinstance(python_args, list) or len(python_args) > 8 or any(
                    flag not in ("-u", "-B", "-E", "-s", "-I", "-O", "-OO") for flag in python_args):
                raise ValueError()
        return config
    except (OSError, KeyError, TypeError, ValueError, AttributeError):
        raise ManagerError("config_invalid")


def task_signature(task):
    return hashlib.sha256(json.dumps(task, sort_keys=True).encode()).hexdigest()


class PrivateRotatingHandler(RotatingFileHandler):
    def _open(self):
        fd = os.open(self.baseFilename, os.O_CREAT | os.O_APPEND | os.O_WRONLY |
                     getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.fchmod(fd, 0o600)
        return os.fdopen(fd, "a", encoding="utf-8")


def event_logger(state_dir, name):
    logger = logging.getLogger("collector-manager." + str(state_dir) + "." + name)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        path = state_dir / (name + ".log")
        fd = os.open(str(path), os.O_CREAT | os.O_APPEND | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.close(fd)
        handler = PrivateRotatingHandler(str(path), maxBytes=65536, backupCount=2, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        logger.addHandler(handler)
    return logger


def record(logger, code, task_id="manager"):
    if code not in CODES or not ID_RE.fullmatch(task_id):
        raise ManagerError("config_invalid")
    logger.info("%s %s", task_id, code)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class API:
    def __init__(self, endpoint, token=None):
        self.endpoint = endpoint_valid(endpoint)
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, payload):
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.endpoint, json.dumps(payload).encode(), headers, method="POST")
        try:
            with self.opener.open(request, timeout=10) as response:
                body = response.read(MAX_RESPONSE + 1)
                if len(body) > MAX_RESPONSE:
                    raise ManagerError("network_unavailable")
                result = json.loads(body)
            if not isinstance(result, dict) or result.get("ok") is not True:
                raise ManagerError("network_unavailable")
            return result
        except urllib.error.HTTPError as error:
            raise ManagerError("auth_unavailable" if error.code in (401, 403) else "network_unavailable") from None
        except (OSError, urllib.error.URLError, ValueError, UnicodeError):
            raise ManagerError("network_unavailable") from None


def socket_location(state_dir, task_id):
    # macOS sockaddr_un paths are short. The directory is user-owned and private.
    tag = hashlib.sha256(str(state_dir).encode()).hexdigest()[:16]
    root = private_dir(Path(tempfile.gettempdir()) / ("cm-" + str(os.getuid()) + "-" + tag))
    task_tag = hashlib.sha256(task_id.encode()).hexdigest()[:20]
    return str(root / (task_tag + ".sock"))


def guardian_request(state_dir, task_id, action):
    auth = private_read(state_dir / (task_id + ".guardian.json"))
    if not auth or not isinstance(auth.get("secret"), str):
        return None
    request = {"secret": auth["secret"], "action": action}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(2)
            connection.connect(socket_location(state_dir, task_id))
            connection.sendall(json.dumps(request).encode() + b"\n")
            reply = b""
            while not reply.endswith(b"\n") and len(reply) <= 8192:
                part = connection.recv(8192)
                if not part:
                    break
                reply += part
        result = json.loads(reply)
        if result.get("authenticated") is not True:
            return None
        return result
    except (OSError, ValueError, AttributeError):
        return None


def external_process(task):
    """Conservative detection: basename matches block starting, never kill it."""
    try:
        result = subprocess.run(["/bin/ps", "-axo", "pid=,command="], capture_output=True,
                                text=True, timeout=5, check=True)
    except (OSError, subprocess.SubprocessError):
        raise ManagerError("unavailable")
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        try:
            pid = int(parts[0])
            words = shlex.split(parts[1])
        except (ValueError, TypeError):
            continue
        if pid == os.getpid():
            continue
        # Inspect argument tokens, not substring matches against terminal text.
        if task["script"] in parts[1] or any(
                word == task["script"] or os.path.basename(word) == os.path.basename(task["script"])
                for word in words[1:]):
            return pid
    return None


def group_presence(group_id):
    """Read-only: True/False, or None when membership cannot be established."""
    if type(group_id) is not int or group_id <= 1:
        return None
    try:
        result = subprocess.run(["/bin/ps", "-axo", "pgid=,stat="], capture_output=True,
                                text=True, timeout=5, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    for line in result.stdout.splitlines():
        words = line.split()
        if len(words) >= 2 and words[0].isdigit() and int(words[0]) == group_id:
            if not words[1].startswith("Z"):
                return True
    return False


def recorded_group_may_live(state_dir, task_id):
    saved = private_read(state_dir / (task_id + ".guardian.json"), {})
    group_id = saved.get("groupId")
    return group_id is not None and group_presence(group_id) is not False


class Guardian:
    def __init__(self, task, state_dir, lock_fd):
        self.task = task
        self.state_dir = state_dir
        self.lock_fd = lock_fd
        self.auth = private_read(state_dir / (task["id"] + ".guardian.json"))
        self.child = None
        self.instance = secrets.token_hex(16)
        self.group_id = self.auth.get("groupId")
        self.exit_requested = False
        self.exit_detail = "exited"
        self.stopping_at = None
        self.observed = "stopped"
        self.detail = "stopped"
        self.logger = event_logger(state_dir, "task-" + task["id"])

    def status(self):
        if self.child is not None and self.child.poll() is not None:
            self.exit_detail = "spawn_failed" if self.child.returncode == 125 else "exited"
            self.child = None
            self.observed = "stopped" if self.exit_requested else "failed"
            self.detail = "stopped" if self.exit_requested else self.exit_detail
            self.stopping_at = None
            record(self.logger, self.detail, self.task["id"])
        if self.child is None and self.group_id is not None:
            if group_presence(self.group_id) is not False:
                self.observed, self.detail = "blocked", "orphaned_process"
            else:
                self.group_id = None
                self.auth.pop("groupId", None)
                private_write(self.state_dir / (self.task["id"] + ".guardian.json"), self.auth)
                self.observed = "stopped" if self.exit_requested else "failed"
                self.detail = "stopped" if self.exit_requested else self.exit_detail
        if self.child is None and self.observed == "external_running":
            try:
                if not external_process(self.task):
                    self.observed, self.detail = "stopped", "stopped"
            except ManagerError:
                pass
        if self.stopping_at is not None and time.monotonic() - self.stopping_at >= STOP_WAIT:
            self.detail = "stop_timeout"
        return {"authenticated": True, "observedState": self.observed,
                "detailCode": self.detail, "pid": self.child.pid if self.child else None,
                "signature": task_signature(self.task), "instance": self.instance}

    def start(self):
        self.status()
        if self.child is not None or self.group_id is not None:
            return self.status()
        self.instance = secrets.token_hex(16)
        try:
            if external_process(self.task):
                self.observed, self.detail = "external_running", "external_running"
                return self.status()
            # Passing the lock keeps duplicates blocked if this guardian dies.
            read_fd, write_fd = os.pipe()
            try:
                self.child = subprocess.Popen([sys.executable, str(Path(__file__).absolute()), "_child",
                                               "--gate-fd", str(read_fd)],
                                          cwd=self.task["cwd"], stdin=subprocess.DEVNULL,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                          shell=False, start_new_session=True, pass_fds=(self.lock_fd, read_fd))
                self.group_id = self.child.pid
                self.auth["groupId"] = self.group_id
                # The bootstrap cannot execute the collector before this durable record.
                private_write(self.state_dir / (self.task["id"] + ".guardian.json"), self.auth)
                payload = json.dumps(self.task).encode()
                with os.fdopen(write_fd, "wb") as gate:
                    write_fd = None
                    gate.write(payload)
            finally:
                os.close(read_fd)
                if write_fd is not None:
                    os.close(write_fd)
            self.observed, self.detail = "running", "ok"
            self.stopping_at = None
            self.exit_requested = False
        except (OSError, ManagerError):
            self.observed, self.detail = "failed", "spawn_failed"
        record(self.logger, self.detail, self.task["id"])
        return self.status()

    def stop(self):
        self.status()
        if self.child is None:
            if self.group_id is not None:
                return self.status()
            self.observed, self.detail = "stopped", "stopped"
            return self.status()
        if self.child is not None and self.stopping_at is None:
            # Only our still-live child and its session group can receive SIGINT.
            try:
                group = os.getpgid(self.child.pid)
            except ProcessLookupError:
                return self.status()
            if group != self.child.pid:
                self.observed, self.detail = "blocked", "orphaned_process"
                return self.status()
            self.stopping_at = time.monotonic()
            self.exit_requested = True
            self.observed, self.detail = "stopping", "stop_requested"
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self.child.pid, signal.SIGINT)
            record(self.logger, self.detail, self.task["id"])
        return self.status()

    def serve(self):
        path = socket_location(self.state_dir, self.task["id"])
        with contextlib.suppress(FileNotFoundError):
            os.unlink(path)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(path)
            os.chmod(path, 0o600)
            server.listen(8)
            server.settimeout(1)
            self.start()
            while True:
                self.status()
                try:
                    connection, _ = server.accept()
                except socket.timeout:
                    continue
                with connection:
                    connection.settimeout(2)
                    try:
                        data = b""
                        while not data.endswith(b"\n") and len(data) < 8192:
                            part = connection.recv(8192)
                            if not part:
                                break
                            data += part
                        request = json.loads(data)
                        provided = request.get("secret", "")
                        if not isinstance(provided, str) or not hmac.compare_digest(provided, self.auth["secret"]):
                            connection.sendall(b'{"authenticated":false}\n')
                            continue
                        action = request.get("action")
                        if action == "status":
                            response = self.status()
                        elif action == "start":
                            response = self.start()
                        elif action == "stop":
                            response = self.stop()
                        elif action == "retire" and self.child is None and self.group_id is None:
                            connection.sendall(b'{"authenticated":true}\n')
                            with contextlib.suppress(FileNotFoundError):
                                os.unlink(path)
                            return
                        else:
                            response = {"authenticated": True, "detailCode": "config_invalid"}
                        connection.sendall(json.dumps(response).encode() + b"\n")
                    except (OSError, ValueError, AttributeError, ProcessLookupError):
                        pass
        with contextlib.suppress(FileNotFoundError):
            os.unlink(path)


class Manager:
    def __init__(self, config_path, state_dir, api=None, read_only=False):
        self.config_path = str(Path(config_path).absolute())
        self.config = load_config(self.config_path)
        self.state_dir = private_dir(state_dir)
        self.lock_fd = None if read_only else lock_file(self.state_dir / "manager.lock")
        try:
            self.validate_removed_tasks(retire_idle=not read_only)
        except (ManagerError, OSError):
            self.close()
            raise
        self.credentials = private_read(self.state_dir / "device.json")
        if not self.credentials or self.credentials.get("endpoint") != self.config["endpoint"]:
            self.close()
            raise ManagerError("auth_unavailable")
        self.api = api or API(self.config["endpoint"], self.credentials["token"])
        self.logger = event_logger(self.state_dir, "manager")
        self.history = private_read(self.state_dir / "history.json", {})
        self.stopping = False
        self.children = []
        self.last_failure = None
        if not read_only:
            record(self.logger, "manager_restarted")

    def close(self):
        if self.lock_fd is not None:
            os.close(self.lock_fd)
            self.lock_fd = None

    def validate_removed_tasks(self, retire_idle=True):
        """Never hide a still-running prior task by removing or renaming its ID."""
        registered = {task["id"] for task in self.config["tasks"]}
        prior = set()
        for path in self.state_dir.iterdir():
            for suffix in (".guardian.json", ".lock"):
                if path.name.endswith(suffix):
                    task_id = path.name[:-len(suffix)]
                    if task_id != "manager" and ID_RE.fullmatch(task_id):
                        prior.add(task_id)
        for task_id in sorted(prior - registered):
            status = guardian_request(self.state_dir, task_id, "status")
            if status:
                if status.get("observedState") != "stopped" or status.get("pid") is not None:
                    raise ManagerError("config_invalid")
                if not retire_idle:
                    continue
                if guardian_request(self.state_dir, task_id, "retire") != {"authenticated": True}:
                    raise ManagerError("config_invalid")
                deadline = time.monotonic() + 2
            else:
                if recorded_group_may_live(self.state_dir, task_id):
                    raise ManagerError("config_invalid")
                deadline = time.monotonic()
            # The task's inherited lock protects an orphan even without history.json.
            while True:
                try:
                    fd = lock_file(self.state_dir / (task_id + ".lock"))
                    os.close(fd)
                    break
                except ManagerError:
                    if time.monotonic() >= deadline:
                        raise ManagerError("config_invalid")
                    time.sleep(0.02)

    def inspect(self, task):
        status = guardian_request(self.state_dir, task["id"], "status")
        if status:
            if status.get("signature") != task_signature(task):
                return {"observedState": "blocked", "detailCode": "config_invalid", "pid": None}
            if status.get("observedState") in STATES and status.get("detailCode") in CODES:
                return status
            return {"observedState": "blocked", "detailCode": "config_invalid", "pid": None}
        if recorded_group_may_live(self.state_dir, task["id"]):
            return {"observedState": "blocked", "detailCode": "orphaned_process", "pid": None}
        try:
            fd = lock_file(self.state_dir / (task["id"] + ".lock"))
            os.close(fd)
        except ManagerError:
            return {"observedState": "blocked", "detailCode": "orphaned_process", "pid": None}
        try:
            external = external_process(task)
        except ManagerError:
            return {"observedState": "blocked", "detailCode": "unavailable", "pid": None}
        return {"observedState": "external_running" if external else "stopped",
                "detailCode": "external_running" if external else "stopped", "pid": external}

    def start_guardian(self, task):
        try:
            fd = lock_file(self.state_dir / (task["id"] + ".lock"))
        except ManagerError:
            return
        try:
            private_write(self.state_dir / (task["id"] + ".guardian.json"), {"secret": secrets.token_hex(32)})
            process = subprocess.Popen([sys.executable, str(Path(__file__).absolute()), "_guardian",
                                        "--config", self.config_path, "--state-dir", str(self.state_dir),
                                        "--task", task["id"], "--lock-fd", str(fd)],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       start_new_session=True, shell=False, pass_fds=(fd,))
            process.collector_task_id = task["id"]
            self.children.append(process)
        except OSError:
            record(self.logger, "spawn_failed", task["id"])
            item = self.history.setdefault(task["id"], {})
            item["failures"] = item.get("failures", 0) + 1
            item["nextStart"] = time.time() + min(300, 15 * 2 ** min(item["failures"], 5))
        finally:
            os.close(fd)

    def reconcile(self, task, command):
        item = self.history.setdefault(task["id"], {"failures": 0, "revision": -1})
        if command["revision"] < item.get("revision", -1):
            return
        item["revision"] = command["revision"]
        status = self.inspect(task)
        desired = command["desiredState"]
        if desired == "stopped":
            item.update(failures=0, nextStart=0, failedInstance=None)
            if status["observedState"] in ("running", "starting", "stopping", "failed"):
                guardian_request(self.state_dir, task["id"], "stop")
            return
        if status["observedState"] in ("running", "starting", "stopping", "blocked", "external_running"):
            return
        if status["observedState"] == "failed" and item.get("failedInstance") != status.get("instance"):
            item["failedInstance"] = status.get("instance")
            item["failures"] = item.get("failures", 0) + 1
            item["nextStart"] = time.time() + min(300, 15 * 2 ** min(item["failures"], 5))
        if item.get("failures", 0) >= MAX_FAILURES:
            record(self.logger, "restart_limit", task["id"])
            return
        if time.time() < item.get("nextStart", 0):
            return
        if status.get("authenticated"):
            guardian_request(self.state_dir, task["id"], "start")
        else:
            self.start_guardian(task)

    def inventory(self):
        result = []
        for task in self.config["tasks"]:
            status = self.inspect(task)
            item = self.history.get(task["id"], {})
            if status["observedState"] in ("failed", "stopped") and item.get("failures", 0) >= MAX_FAILURES:
                status.update(observedState="blocked", detailCode="restart_limit")
            elif status["observedState"] == "failed" and time.time() < item.get("nextStart", 0):
                status["detailCode"] = "restart_backoff"
            result.append({"id": task["id"], "label": task["label"], "observedState": status["observedState"],
                           "pid": status["pid"], "detailCode": status["detailCode"]})
        return result

    def cycle(self):
        alive = []
        for process in self.children:
            if process.poll() is None:
                alive.append(process)
                continue
            task_id = process.collector_task_id
            item = self.history.setdefault(task_id, {})
            item["failures"] = item.get("failures", 0) + 1
            item["nextStart"] = time.time() + min(300, 15 * 2 ** min(item["failures"], 5))
            record(self.logger, "spawn_failed", task_id)
        self.children = alive
        started = time.monotonic()
        try:
            response = self.api.call({"action": "poll", "deviceId": self.credentials["deviceId"],
                                      "agentVersion": VERSION, "tasks": self.inventory()})
            commands = response.get("tasks")
            if response.get("ok") is not True or not isinstance(commands, list) or len(commands) > 100:
                raise ManagerError("network_unavailable")
            local_tasks = {task["id"]: task for task in self.config["tasks"]}
            seen = set()
            for command in commands:
                if (not isinstance(command, dict) or set(command) != {"id", "desiredState", "revision"}
                        or command.get("id") not in local_tasks or command["id"] in seen
                        or command.get("desiredState") not in ("running", "stopped")
                        or type(command.get("revision")) is not int or not 0 <= command["revision"] <= 9007199254740991):
                    raise ManagerError("network_unavailable")
                seen.add(command["id"])
            # A slow or stale reply cannot start work after the request is obsolete.
            if time.monotonic() - started > 30:
                raise ManagerError("network_unavailable")
            for command in commands:
                if time.monotonic() - started > 30:
                    raise ManagerError("network_unavailable")
                self.reconcile(local_tasks[command["id"]], command)
            private_write(self.state_dir / "history.json", self.history)
            self.last_failure = None
            return True
        except ManagerError as error:
            code = str(error) if str(error) in CODES else "network_unavailable"
            if self.last_failure != code:
                record(self.logger, code)
            self.last_failure = code
            return False

    def run(self):
        def stop_manager(_signum, _frame):
            self.stopping = True
        signal.signal(signal.SIGINT, stop_manager)
        signal.signal(signal.SIGTERM, stop_manager)
        try:
            while not self.stopping:
                beginning = time.monotonic()
                self.cycle()
                while not self.stopping and time.monotonic() - beginning < POLL_SECONDS:
                    time.sleep(max(0, min(0.5, POLL_SECONDS - (time.monotonic() - beginning))))
        finally:
            self.close()


def pair(config_path, state_dir):
    config = load_config(config_path)
    state_dir = private_dir(state_dir)
    lock = lock_file(state_dir / "manager.lock")
    try:
        if private_read(state_dir / "device.json"):
            raise ManagerError("config_invalid")
        code = getpass.getpass("输入后台生成的一次性配对码（不显示）：").strip().upper()
        if not re.fullmatch(r"[0-9A-F]{32}", code):
            raise ManagerError("config_invalid")
        response = API(config["endpoint"]).call({"action": "pair", "code": code, "agentVersion": VERSION})
        token, device = response.get("token", ""), response.get("deviceId", "")
        if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
            raise ManagerError("auth_unavailable")
        if not isinstance(device, str) or not re.fullmatch(r"[0-9a-fA-F-]{36}", device):
            raise ManagerError("auth_unavailable")
        private_write(state_dir / "device.json", {"endpoint": config["endpoint"], "deviceId": device, "token": token})
        print("配对成功；设备凭据已保存到本机私有文件。")
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description="本机采集运行管理器（只启动本地登记的 PY）")
    parser.add_argument("action", choices=["check", "pair", "run", "status", "_guardian", "_child"])
    parser.add_argument("--config", help="本地 JSON 允许清单的绝对路径")
    parser.add_argument("--state-dir", default=str(Path.home() / "Library/Application Support/CollectorManager"))
    parser.add_argument("--task", help=argparse.SUPPRESS)
    parser.add_argument("--lock-fd", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--gate-fd", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.action == "_child":
            if args.gate_fd is None:
                raise ManagerError("config_invalid")
            with os.fdopen(args.gate_fd, "rb") as gate:
                payload = gate.read(524289)
            if not payload or len(payload) > 524288:
                raise ManagerError("config_invalid")
            task = json.loads(payload)
            argv = [task["python"]] + task.get("python_args", []) + [task["script"]] + task["args"]
            try:
                os.execv(task["python"], argv)
            except OSError:
                return 125
        if not args.config:
            raise ManagerError("config_invalid")
        if args.action == "check":
            config = load_config(args.config)
            print("配置检查通过：%d 个任务；未启动任何采集。" % len(config["tasks"]))
        elif args.action == "pair":
            pair(args.config, args.state_dir)
        elif args.action == "_guardian":
            config = load_config(args.config)
            task = next(task for task in config["tasks"] if task["id"] == args.task)
            if args.lock_fd is None or not stat.S_ISREG(os.fstat(args.lock_fd).st_mode):
                raise ManagerError("local_lock")
            Guardian(task, private_dir(args.state_dir), args.lock_fd).serve()
        else:
            manager = Manager(args.config, args.state_dir, read_only=args.action == "status")
            if args.action == "run":
                print("管理器已运行；每 15 秒接收后台指令。关闭管理器不会自动停止已运行的任务。")
                manager.run()
            else:
                try:
                    print(json.dumps(manager.inventory(), ensure_ascii=False, indent=2))
                finally:
                    manager.close()
        return 0
    except (ManagerError, OSError, StopIteration, ValueError) as error:
        code = str(error) if isinstance(error, ManagerError) and str(error) in CODES else "config_invalid"
        print("管理器未完成操作：" + code, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
