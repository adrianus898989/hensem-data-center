"""Optional browser login recovery for the fixed M8 origin.

Credentials are injected in memory by the private launcher. This module never
writes credentials, tokens or browser storage and does not call a login API.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import struct
import time
import urllib.parse

import ar_middle_channel_sync as sync

COOLDOWN_SECONDS = 600
PUBLIC_STATES = frozenset({"authenticated", "login_form", "expired_dialog", "manual_required", "session_expired",
                           "unexpected_page", "wrong_origin", "submitted", "confirmed", "reloading", "form_changed", "loading"})


def totp(secret, at=None, *, digits=6, period=30):
    """RFC 6238 SHA-1 TOTP; ordinary Google Authenticator codes use six digits."""
    if not isinstance(secret, str) or digits not in (6, 8) or type(period) is not int or period <= 0:
        raise sync.SyncError("AUTO_LOGIN_TOTP_CONFIG_INVALID")
    text = re.sub(r"\s+", "", secret).upper().rstrip("=")
    if not re.fullmatch(r"[A-Z2-7]{16,256}", text):
        raise sync.SyncError("AUTO_LOGIN_TOTP_CONFIG_INVALID")
    try:
        key = base64.b32decode(text + "=" * (-len(text) % 8), casefold=True)
        moment = time.time() if at is None else at
        if isinstance(moment, bool) or not isinstance(moment, (int, float)) or moment < 0:
            raise ValueError
        counter = int(moment // period)
        digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    except (ValueError, TypeError, OverflowError, struct.error):
        raise sync.SyncError("AUTO_LOGIN_TOTP_CONFIG_INVALID") from None
    offset = digest[-1] & 15
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7fffffff
    return str(value % (10 ** digits)).zfill(digits)


STATE_JS = r"""
const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],.n-dialog')]
  .filter(el => visible(el) && el.textContent.includes('登录身份已失效，请重新登录!'));
const leaves = dialogs.filter(el => !dialogs.some(other => other !== el && el.contains(other)));
const expired = leaves.length === 1 ? leaves[0] : null;
if (expired) return 'expired_dialog';
if (dialogs.length) return 'manual_required';
if (location.pathname === '/login') {
  const forms = [...document.querySelectorAll('form')].filter(visible);
  if (forms.length !== 1) return document.readyState === 'loading' ? 'loading' : 'manual_required';
  const form = forms[0], fields = ['用户名','密码','谷歌验证码'].map(label =>
    [...form.querySelectorAll('input')].filter(input => visible(input) && input.placeholder === label));
  if (fields.some(items => items.length !== 1)) return 'manual_required';
  const inputs = fields.map(items => items[0]);
  if (inputs[0].type !== 'text' || inputs[1].type !== 'password' || inputs[2].type !== 'text' ||
      inputs.some(input => input.disabled || input.readOnly)) return 'manual_required';
  if ([...form.querySelectorAll('input')].some(input => visible(input) &&
      ['text','password','email','tel','number'].includes(input.type) && !inputs.includes(input)) ||
      [...document.querySelectorAll('iframe,.g-recaptcha,.h-captcha,[data-sitekey]')].some(visible)) return 'manual_required';
  const buttons = [...form.querySelectorAll('button[type="submit"]')].filter(button => visible(button) && button.textContent.trim() === '登录');
  if (buttons.length !== 1 || buttons[0].form !== form || inputs.some(input => input.form !== form) || new URL(buttons[0].getAttribute('formaction') || form.getAttribute('action') || location.href, location.href).origin !== origin) return 'manual_required';
  return 'login_form';
}
let session;
try { session = JSON.parse(localStorage.getItem('ACCESS-TOKEN') || 'null'); } catch { return 'session_expired'; }
if (session && typeof session.value === 'string' && session.value.trim() &&
    (session.expire == null || typeof session.expire === 'number' && session.expire > Date.now())) return 'authenticated';
return document.readyState === 'loading' ? 'loading' : 'session_expired';
"""


class BrowserLogin:
    def __init__(self, config, *, now=time.time, sleep=time.sleep):
        self.config = config
        settings = config.get("auto_login") or {}
        if not isinstance(settings, dict) or type(settings.get("enabled", False)) is not bool:
            raise sync.SyncError("AUTO_LOGIN_CONFIG_INVALID")
        self.enabled = settings.get("enabled", False)
        self.cdp_url = str(config.get("cdp_url") or "").rstrip("/")
        self._now, self._sleep = now, sleep
        self.failures = 0
        self.cooldown_until = 0.0
        self._manual_required = False
        self._username = self._password = self._secret = None
        if self.enabled:
            sync.validate_cdp_url(self.cdp_url)
            self._username, self._password, self._secret = (settings.get(key) for key in ("username", "password", "totp_secret"))
            if not isinstance(self._username, str) or not self._username.strip() or len(self._username) > 200 or \
                    not isinstance(self._password, str) or not self._password or len(self._password) > 4096 or \
                    any(ord(char) < 32 for char in self._username + self._password):
                raise sync.SyncError("AUTO_LOGIN_CONFIG_INVALID")
            totp(self._secret, 0)  # Validate syntax without disclosing it.

    @property
    def cooling_down(self):
        return self._now() < self.cooldown_until

    def mark_success(self):
        self.failures, self.cooldown_until, self._manual_required = 0, 0.0, False

    def mark_failure(self, *, manual=False):
        self.failures += 1
        if manual or self.failures >= 2:
            self.cooldown_until = self._now() + COOLDOWN_SECONDS
            self._manual_required = manual

    def _evaluate(self, expression):
        """Only allow public state codes out of the browser, never DOM or tokens."""
        sync.validate_cdp_url(self.cdp_url)
        try:
            targets = sync.http_json(self.cdp_url + "/json", direct_connection=True)
            if not isinstance(targets, list):
                raise sync.SyncError("CDP_TARGET_LIST_INVALID")
            matching = [target for target in targets if isinstance(target, dict) and target.get("type") == "page"
                        and urllib.parse.urlsplit(target.get("url", "")).scheme == "https"
                        and urllib.parse.urlsplit(target.get("url", "")).netloc == urllib.parse.urlsplit(sync.ORIGIN).netloc]
            if len(matching) != 1:
                raise sync.SyncError("CDP_REQUIRES_ONE_M8_PAGE")
            target = matching[0]
            sync.validate_debugger_url(target.get("webSocketDebuggerUrl"), self.cdp_url, target.get("id"))
            websocket = sync.WebSocket(target["webSocketDebuggerUrl"], self.cdp_url, target["id"])
            try:
                websocket.send(sync.json_bytes({"id": 1, "method": "Runtime.evaluate", "params": {
                    "expression": expression, "awaitPromise": True, "returnByValue": True, "timeout": 15000}}))
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    result = json.loads(websocket.receive())
                    if result.get("id") != 1:
                        continue
                    body = result.get("result", {})
                    if "error" in result or body.get("exceptionDetails"):
                        raise sync.SyncError("AUTO_LOGIN_BROWSER_EVALUATION_FAILED")
                    state = body.get("result", {}).get("value")
                    if not isinstance(state, str) or state not in PUBLIC_STATES:
                        raise sync.SyncError("AUTO_LOGIN_BROWSER_RESPONSE_INVALID")
                    return state
                raise sync.SyncError("AUTO_LOGIN_BROWSER_TIMEOUT")
            finally:
                websocket.close()
        except sync.SyncError:
            raise
        except Exception:
            raise sync.SyncError("AUTO_LOGIN_BROWSER_CONNECTION_FAILED") from None

    def _expression(self, body):
        return "(async () => { const origin = " + json.dumps(sync.ORIGIN) + "; if (location.origin !== origin) return 'wrong_origin'; " + body + " })()"

    def state(self):
        return self._evaluate(self._expression(STATE_JS))

    def _confirm_expiry(self):
        body = r"""
const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const all = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],.n-dialog')].filter(el => visible(el) && el.textContent.includes('登录身份已失效，请重新登录!'));
const dialogs = all.filter(el => !all.some(other => other !== el && el.contains(other)));
if (dialogs.length !== 1) return 'form_changed';
const buttons = [...dialogs[0].querySelectorAll('button')].filter(button => visible(button) && !button.disabled && button.textContent.trim() === '确定');
if (buttons.length !== 1 || location.origin !== origin) return 'form_changed';
buttons[0].click();
if (location.origin !== origin) return 'wrong_origin';
return 'confirmed';
"""
        return self._evaluate(self._expression(body))

    def _reload(self):
        return self._evaluate(self._expression("if (location.origin !== origin) return 'wrong_origin'; location.reload(); return 'reloading';"))

    def _submit(self, code):
        credentials = json.dumps({"username": self._username, "password": self._password, "otp": code}, ensure_ascii=True)
        body = r"""
if (location.pathname !== '/login') return 'form_changed';
const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const forms = [...document.querySelectorAll('form')].filter(visible);
if (forms.length !== 1) return 'form_changed';
const form = forms[0], fields = ['用户名','密码','谷歌验证码'].map(label => [...form.querySelectorAll('input')].filter(input => visible(input) && input.placeholder === label));
if (fields.some(items => items.length !== 1)) return 'form_changed';
const inputs = fields.map(items => items[0]);
if (inputs[0].type !== 'text' || inputs[1].type !== 'password' || inputs[2].type !== 'text' || inputs.some(input => input.disabled || input.readOnly)) return 'manual_required';
if ([...form.querySelectorAll('input')].some(input => visible(input) && ['text','password','email','tel','number'].includes(input.type) && !inputs.includes(input)) || [...document.querySelectorAll('iframe,.g-recaptcha,.h-captcha,[data-sitekey]')].some(visible)) return 'manual_required';
if (new URL(form.getAttribute('action') || location.href, location.href).origin !== origin) return 'manual_required';
const buttons = [...form.querySelectorAll('button[type="submit"]')].filter(button => visible(button) && button.textContent.trim() === '登录');
if (buttons.length !== 1) return 'form_changed';
if (buttons[0].form !== form || inputs.some(input => input.form !== form) || new URL(buttons[0].getAttribute('formaction') || form.getAttribute('action') || location.href, location.href).origin !== origin) return 'manual_required';
const credentials = CREDENTIALS_VALUE, setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
for (const [index, value] of [credentials.username,credentials.password,credentials.otp].entries()) {
  if (location.origin !== origin) return 'wrong_origin';
  setter.call(inputs[index], value);
  inputs[index].dispatchEvent(new Event('input', {bubbles:true}));
  inputs[index].dispatchEvent(new Event('change', {bubbles:true}));
}
await Promise.resolve();
await new Promise(resolve => setTimeout(resolve, 0));
if (location.origin !== origin || location.pathname !== '/login') return 'wrong_origin';
if (!form.isConnected || !buttons[0].isConnected || buttons[0].disabled || buttons[0].form !== form || !inputs.every(input => input.isConnected && form.contains(input) && input.form === form) || new URL(buttons[0].getAttribute('formaction') || form.getAttribute('action') || location.href, location.href).origin !== origin) return 'form_changed';
if ([...form.querySelectorAll('input')].some(input => visible(input) && ['text','password','email','tel','number'].includes(input.type) && !inputs.includes(input)) || [...document.querySelectorAll('iframe,.g-recaptcha,.h-captcha,[data-sitekey]')].some(visible)) return 'manual_required';
buttons[0].click();
if (location.origin !== origin) return 'wrong_origin';
return 'submitted';
""".replace("CREDENTIALS_VALUE", credentials)
        return self._evaluate(self._expression(body))

    def _wait_for(self, wanted, seconds=30):
        deadline = self._now() + seconds
        for _ in range(seconds + 1):
            state = self.state()
            if state in wanted:
                return state
            if state == "wrong_origin":
                raise sync.SyncError("AUTO_LOGIN_ORIGIN_MISMATCH")
            if state in ("manual_required", "form_changed"):
                raise sync.SyncError("AUTO_LOGIN_MANUAL_REQUIRED")
            if self._now() >= deadline:
                break
            self._sleep(1)
        raise sync.SyncError("AUTO_LOGIN_RECOVERY_TIMEOUT")

    def ensure(self, *, force_expired=False):
        if not self.enabled:
            raise sync.SyncError("AUTO_LOGIN_DISABLED")
        state = self.state()
        if state == "authenticated" and not force_expired:
            return True
        if self.cooling_down:
            raise sync.SyncError("AUTO_LOGIN_MANUAL_REQUIRED" if self._manual_required else "AUTO_LOGIN_COOLDOWN")
        try:
            if state == "wrong_origin":
                raise sync.SyncError("AUTO_LOGIN_ORIGIN_MISMATCH")
            if state == "manual_required":
                raise sync.SyncError("AUTO_LOGIN_MANUAL_REQUIRED")
            if state in ("authenticated", "session_expired", "loading"):
                if self._reload() != "reloading":
                    raise sync.SyncError("AUTO_LOGIN_MANUAL_REQUIRED")
                state = self._wait_for({"expired_dialog", "login_form"})
            if state == "expired_dialog":
                if self._confirm_expiry() != "confirmed":
                    raise sync.SyncError("AUTO_LOGIN_MANUAL_REQUIRED")
                state = self._wait_for({"login_form"})
            if state != "login_form":
                raise sync.SyncError("AUTO_LOGIN_MANUAL_REQUIRED")
            # Avoid submitting a TOTP in the last two seconds of its window.
            remaining = 30 - self._now() % 30
            if remaining < 2:
                self._sleep(remaining + 0.05)
            if self._submit(totp(self._secret, self._now())) != "submitted":
                raise sync.SyncError("AUTO_LOGIN_MANUAL_REQUIRED")
            self._wait_for({"authenticated"})
            return True
        except sync.SyncError as exc:
            self.mark_failure(manual=str(exc) in ("AUTO_LOGIN_MANUAL_REQUIRED", "AUTO_LOGIN_ORIGIN_MISMATCH"))
            raise
        except Exception:
            self.mark_failure()
            raise sync.SyncError("AUTO_LOGIN_RECOVERY_FAILED") from None


class AutoLoginSource(sync.Source):
    def __init__(self, config, *, login=None):
        super().__init__(config)
        self.login = login if login is not None else BrowserLogin(config)
        if self.login.enabled and self.login.cdp_url != str(config.get("cdp_url") or "").rstrip("/"):
            raise sync.SyncError("AUTO_LOGIN_CDP_BOUNDARY_MISMATCH")

    def fetch_readonly_path(self, path, payload):
        try:
            result = super().fetch_readonly_path(path, payload)
        except sync.SyncError as exc:
            if not self.login.enabled or str(exc) not in ("CDP_SOURCE_REQUEST_FAILED", "SOURCE_SESSION_REQUIRED", "SOURCE_SESSION_EXPIRED", "SOURCE_SESSION_INVALID", "HTTP_STATUS_401"):
                raise
            state = self.login.state()
            if state not in ("login_form", "expired_dialog", "session_expired"):
                raise
            self.login.ensure()
        else:
            if not isinstance(result, dict) or isinstance(result.get("code"), bool) or result.get("code") not in (4, "4"):
                if path in sync.PATHS.values() and isinstance(result, dict) and not isinstance(result.get("code"), bool) and result.get("code") in (0, "0"):
                    self.login.mark_success()
                return result
            if not self.login.enabled:
                return result
            self.login.ensure(force_expired=True)
        refreshed = dict(payload)
        refreshed["random"] = secrets.randbelow(900_000_000_000) + 100_000_000_000
        refreshed["timestamp"] = int(time.time())
        refreshed["signature"] = sync.source_signature(refreshed)
        try:
            result = super().fetch_readonly_path(path, refreshed)
        except sync.SyncError:
            self.login.mark_failure()
            raise
        if isinstance(result, dict) and not isinstance(result.get("code"), bool) and result.get("code") in (4, "4"):
            self.login.mark_failure()
            raise sync.SyncError("AUTO_LOGIN_RETRY_AUTH_FAILED")
        if path in sync.PATHS.values() and isinstance(result, dict) and not isinstance(result.get("code"), bool) and result.get("code") in (0, "0"):
            self.login.mark_success()
        return result
