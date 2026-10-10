#!/usr/bin/env python3
"""Offline browser-login recovery tests. Credentials here are fictional."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest import mock

COLLECTORS = Path(__file__).resolve().parents[1] / "collectors"
sys.path.insert(0, str(COLLECTORS))
SPEC = importlib.util.spec_from_file_location("browser_login", COLLECTORS / "ar_middle_browser_login.py")
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
S = M.sync
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
NODE = shutil.which("node") or "/Users/jun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

DOM_FIXTURE = r"""
const vm = require('node:vm'), fs = require('node:fs');
const {expression, options} = JSON.parse(fs.readFileSync(0, 'utf8'));
let clicked = 0, filled = 0, dialogClicked = 0, captcha = !!options.captcha;
const origin = 'https://m8-admin.payplatform-manager.com';
const location = {origin, pathname:'/login', href:origin+'/login'};
const visible = {getClientRects:()=>[{}], isConnected:true};
const form = {...visible, getAttribute:key=>key==='action'?(options.formAction||''):null,
  contains:element=>inputs.includes(element), querySelectorAll:selector=>selector==='input'?inputs:selector==='button[type="submit"]'?[button]:[]};
class Input {
  constructor(placeholder,type){Object.assign(this,visible,{placeholder,type,form,disabled:false,readOnly:false});}
  dispatchEvent(){
    if(options.mutateAction) button.override='https://attacker.invalid/login';
    if(options.addCaptcha) captcha=true;
  }
}
Object.defineProperty(Input.prototype,'value',{get(){return this._value},set(value){this._value=value;filled++}});
const inputs = [new Input('用户名','text'),new Input('密码','password'),new Input('谷歌验证码','text')];
if(options.extraInput) inputs.push(new Input('图形验证码','text'));
const button = {...visible,form,disabled:false,textContent:'登录',override:options.buttonAction||'',
  getAttribute:key=>key==='formaction'?button.override:null,click:()=>clicked++};
const confirm = {...visible,disabled:false,textContent:'确定',click:()=>dialogClicked++};
const dialog = {...visible,textContent:'登录身份已失效，请重新登录!',contains:()=>false,querySelectorAll:()=>[confirm]};
const document = {readyState:'complete',querySelectorAll:selector=>selector==='form'?[form]:selector.includes('[role="dialog"]')?(options.expired?[dialog]:[]):selector.includes('iframe')?(captcha?[visible]:[]):[]};
const context = {location,document,URL,HTMLInputElement:Input,Event:class{constructor(type,details){this.type=type;this.details=details}},
  getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn();return 1},
  localStorage:{getItem:()=>null},Date,Promise};
vm.createContext(context);
Promise.resolve(vm.runInContext(expression, context)).then(state=>process.stdout.write(JSON.stringify({state,clicked,filled,dialogClicked})))
  .catch(()=>process.stdout.write(JSON.stringify({state:'test_script_failed',clicked,filled,dialogClicked})));
"""


def evaluate_dom(expression, **options):
    result = subprocess.run([NODE, "-e", DOM_FIXTURE], input=json.dumps({"expression": expression, "options": options}),
                            text=True, capture_output=True, timeout=10, check=True)
    return json.loads(result.stdout)


def config(enabled=True):
    return {"cdp_url": "http://127.0.0.1:9777", "auto_login": {
        "enabled": enabled, "username": "fictional-user", "password": "fictional-password", "totp_secret": RFC_SECRET}}


class Clock:
    def __init__(self, value=1000):
        self.value = value

    def now(self):
        return self.value

    def sleep(self, duration):
        self.value += duration


class TotpTests(unittest.TestCase):
    def test_rfc6238_sha1_vectors_and_six_digit_google_code(self):
        for timestamp, expected in ((59, "94287082"), (1111111109, "07081804"), (1111111111, "14050471"),
                                    (1234567890, "89005924"), (2000000000, "69279037"), (20000000000, "65353130")):
            self.assertEqual(M.totp(RFC_SECRET, timestamp, digits=8), expected)
        self.assertEqual(M.totp(RFC_SECRET.lower(), 59), "287082")
        self.assertEqual(M.totp(" ".join(RFC_SECRET[i:i+4] for i in range(0, len(RFC_SECRET), 4)), 59), "287082")

    def test_bad_totp_config_never_exposes_seed(self):
        for value in (None, "fictional invalid seed!", "A", "0123456789012345"):
            with self.assertRaises(S.SyncError) as error:
                M.totp(value, 59)
            self.assertEqual(str(error.exception), "AUTO_LOGIN_TOTP_CONFIG_INVALID")
        for timestamp in (-1, float("nan"), float("inf"), True):
            with self.assertRaises(S.SyncError):
                M.totp(RFC_SECRET, timestamp)


class BrowserRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.login = M.BrowserLogin(config(), now=self.clock.now, sleep=self.clock.sleep)

    def test_existing_authenticated_session_never_fills_form_or_reloads(self):
        with mock.patch.object(self.login, "state", return_value="authenticated"), mock.patch.object(self.login, "_reload") as reload, mock.patch.object(self.login, "_submit") as submit:
            self.assertTrue(self.login.ensure())
        reload.assert_not_called()
        submit.assert_not_called()

    def test_exact_expired_dialog_confirmation_precedes_login_and_totp(self):
        with mock.patch.object(self.login, "state", side_effect=["expired_dialog", "login_form", "authenticated"]), \
             mock.patch.object(self.login, "_confirm_expiry", return_value="confirmed") as confirm, \
             mock.patch.object(self.login, "_submit", return_value="submitted") as submit:
            self.assertTrue(self.login.ensure())
        confirm.assert_called_once_with()
        submit.assert_called_once_with(M.totp(RFC_SECRET, self.clock.now()))
        self.assertEqual(self.login.failures, 0)

    def test_server_expiry_uses_official_reload_and_confirm_without_clearing_storage(self):
        with mock.patch.object(self.login, "state", side_effect=["authenticated", "expired_dialog", "login_form", "authenticated"]), \
             mock.patch.object(self.login, "_reload", return_value="reloading") as reload, \
             mock.patch.object(self.login, "_confirm_expiry", return_value="confirmed") as confirm, \
             mock.patch.object(self.login, "_submit", return_value="submitted"):
            self.assertTrue(self.login.ensure(force_expired=True))
        reload.assert_called_once_with()
        confirm.assert_called_once_with()

    def test_two_failed_recoveries_cool_down_and_shared_state_cannot_be_reset_by_constructor(self):
        with mock.patch.object(self.login, "state", return_value="login_form"), \
             mock.patch.object(self.login, "_submit", return_value="submitted") as submit, \
             mock.patch.object(self.login, "_wait_for", side_effect=S.SyncError("AUTO_LOGIN_RECOVERY_TIMEOUT")):
            for _ in range(2):
                with self.assertRaisesRegex(S.SyncError, "AUTO_LOGIN_RECOVERY_TIMEOUT"):
                    self.login.ensure()
            self.assertTrue(self.login.cooling_down)
            with self.assertRaisesRegex(S.SyncError, "AUTO_LOGIN_COOLDOWN"):
                self.login.ensure()
            self.assertEqual(submit.call_count, 2)
        source = M.AutoLoginSource(config(), login=self.login)
        self.assertIs(source.login, self.login)
        self.clock.sleep(601)
        self.assertFalse(self.login.cooling_down)
        self.login.mark_success()
        self.assertEqual(self.login.failures, 0)

    def test_captcha_unknown_page_and_cross_origin_need_manual_help_without_password_submission(self):
        for state, code in (("manual_required", "AUTO_LOGIN_MANUAL_REQUIRED"), ("unexpected_page", "AUTO_LOGIN_MANUAL_REQUIRED"), ("wrong_origin", "AUTO_LOGIN_ORIGIN_MISMATCH")):
            login = M.BrowserLogin(config(), now=self.clock.now, sleep=self.clock.sleep)
            with mock.patch.object(login, "state", return_value=state), mock.patch.object(login, "_submit") as submit:
                with self.assertRaisesRegex(S.SyncError, code):
                    login.ensure()
                with self.assertRaisesRegex(S.SyncError, "AUTO_LOGIN_MANUAL_REQUIRED"):
                    login.ensure()
            submit.assert_not_called()
            self.assertTrue(login.cooling_down)

    def test_totp_waits_for_new_window_before_form_submit(self):
        self.clock.value = 59
        with mock.patch.object(self.login, "state", side_effect=["login_form", "authenticated"]), mock.patch.object(self.login, "_submit", return_value="submitted") as submit:
            self.assertTrue(self.login.ensure())
        self.assertGreaterEqual(self.clock.now(), 60)
        submit.assert_called_once_with(M.totp(RFC_SECRET, self.clock.now()))

    def test_dom_scripts_are_bounded_to_unique_same_origin_form_and_public_codes(self):
        expressions = []
        with mock.patch.object(self.login, "_evaluate", side_effect=lambda expression: expressions.append(expression) or "submitted"):
            self.login._submit("123456")
        submit = expressions[0]
        for expected in ("location.origin !== origin", "location.pathname !== '/login'", "forms.length !== 1", "['用户名','密码','谷歌验证码']", "inputs[1].type !== 'password'", "form.getAttribute('action')", "buttons[0].getAttribute('formaction')", "buttons[0].form !== form", "buttons[0].disabled", "getOwnPropertyDescriptor(HTMLInputElement.prototype", "dispatchEvent(new Event('input'", "button[type=\"submit\"]", "credentials.otp"):
            self.assertIn(expected, submit)
        self.assertNotIn("localStorage.setItem", submit)
        self.assertNotIn("localStorage.clear", submit)
        self.assertNotIn("fetch(", submit)
        self.assertNotIn("return credentials", submit)
        with mock.patch.object(self.login, "_evaluate", side_effect=lambda expression: expressions.append(expression) or "confirmed"):
            self.login._confirm_expiry()
        self.assertIn("登录身份已失效，请重新登录!", expressions[1])
        self.assertIn("button.textContent.trim() === '确定'", expressions[1])

    def test_cdp_binding_is_loopback_unique_same_origin_and_never_returns_token_or_arbitrary_values(self):
        target = {"id": "fixture", "type": "page", "url": S.ORIGIN + "/login", "webSocketDebuggerUrl": "ws://127.0.0.1:9777/devtools/page/fixture"}
        websocket = mock.Mock()
        websocket.receive.return_value = json.dumps({"id": 1, "result": {"result": {"value": "login_form"}}}).encode()
        with mock.patch.object(S, "http_json", return_value=[target]) as listing, mock.patch.object(S, "WebSocket", return_value=websocket):
            self.assertEqual(self.login.state(), "login_form")
            listing.assert_called_once_with("http://127.0.0.1:9777/json", direct_connection=True)
            sent = json.loads(websocket.send.call_args.args[0])
            self.assertIn("return 'authenticated'", sent["params"]["expression"])
            self.assertNotIn("return session", sent["params"]["expression"])
            self.assertNotIn("fictional-password", sent["params"]["expression"])
            websocket.receive.return_value = json.dumps({"id": 1, "result": {"result": {"value": {"token": "fictional-private"}}}}).encode()
            with self.assertRaisesRegex(S.SyncError, "AUTO_LOGIN_BROWSER_RESPONSE_INVALID"):
                self.login.state()
        self.assertTrue(websocket.close.called)
        for targets in ([{**target, "url": "https://m8-admin.payplatform-manager.com.attacker.invalid/login"}], [target, {**target, "id": "second"}], [{**target, "webSocketDebuggerUrl": "ws://127.0.0.1:9778/devtools/page/fixture"}]):
            with mock.patch.object(S, "http_json", return_value=targets), mock.patch.object(S, "WebSocket") as connection:
                with self.assertRaises(S.SyncError):
                    self.login.state()
                connection.assert_not_called()
        unsafe = config()
        unsafe["cdp_url"] = "http://remote.invalid:9222"
        with self.assertRaisesRegex(S.SyncError, "CDP_URL_REQUIRES_EXPLICIT_LOCAL_HTTP"):
            M.BrowserLogin(unsafe)

    @unittest.skipUnless(Path(NODE).is_file() or shutil.which(NODE), "Node runtime unavailable")
    def test_real_dom_expression_submits_only_normal_same_origin_login(self):
        expressions = []
        with mock.patch.object(self.login, "_evaluate", side_effect=lambda expression: expressions.append(expression) or "submitted"):
            self.login._submit("123456")
        self.assertEqual(evaluate_dom(expressions[0]), {"state": "submitted", "clicked": 1, "filled": 3, "dialogClicked": 0})
        for options in ({"buttonAction": "https://attacker.invalid/login"}, {"formAction": "https://attacker.invalid/login"}, {"extraInput": True}, {"captcha": True}):
            result = evaluate_dom(expressions[0], **options)
            self.assertEqual(result, {"state": "manual_required", "clicked": 0, "filled": 0, "dialogClicked": 0})

    @unittest.skipUnless(Path(NODE).is_file() or shutil.which(NODE), "Node runtime unavailable")
    def test_input_event_action_change_or_captcha_never_clicks_submit(self):
        expressions = []
        with mock.patch.object(self.login, "_evaluate", side_effect=lambda expression: expressions.append(expression) or "submitted"):
            self.login._submit("123456")
        changed = evaluate_dom(expressions[0], mutateAction=True)
        self.assertEqual(changed["state"], "form_changed")
        self.assertEqual(changed["clicked"], 0)
        self.assertEqual(changed["filled"], 3)
        challenge = evaluate_dom(expressions[0], addCaptcha=True)
        self.assertEqual(challenge["state"], "manual_required")
        self.assertEqual(challenge["clicked"], 0)

    @unittest.skipUnless(Path(NODE).is_file() or shutil.which(NODE), "Node runtime unavailable")
    def test_real_dom_expression_confirms_only_exact_expired_dialog(self):
        expressions = []
        with mock.patch.object(self.login, "_evaluate", side_effect=lambda expression: expressions.append(expression) or "confirmed"):
            self.login._confirm_expiry()
        self.assertEqual(evaluate_dom(expressions[0], expired=True), {"state": "confirmed", "clicked": 0, "filled": 0, "dialogClicked": 1})
        self.assertEqual(evaluate_dom(expressions[0]), {"state": "form_changed", "clicked": 0, "filled": 0, "dialogClicked": 0})


class SourceRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.login = M.BrowserLogin(config(), now=self.clock.now, sleep=self.clock.sleep)
        self.source = M.AutoLoginSource(config(), login=self.login)

    def test_expired_json_retries_identical_readonly_route_once_with_new_signed_payload(self):
        payload = S.dictionary_payload("dynamic")
        original = dict(payload)
        with mock.patch.object(S.Source, "fetch_readonly_path", side_effect=[{"code": 4}, {"code": 0, "data": {}}]) as fetch, \
             mock.patch.object(self.login, "ensure", return_value=True) as ensure:
            self.assertEqual(self.source.fetch_readonly_path(S.DICTIONARY_PATHS["dynamic"], payload)["code"], 0)
        ensure.assert_called_once_with(force_expired=True)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(fetch.call_args_list[0].args[0], fetch.call_args_list[1].args[0])
        retry = fetch.call_args_list[1].args[1]
        self.assertEqual(retry["keys"], list(S.DYNAMIC_DICTIONARY_KEYS))
        self.assertEqual(retry["signature"], S.source_signature(retry))
        self.assertEqual(payload, original)

    def test_generic_cdp_or_network_error_never_blindly_logs_out_authenticated_session(self):
        for code in ("CDP_SOURCE_REQUEST_FAILED", "HTTP_STATUS_500", "NETWORK_REQUEST_FAILED"):
            with mock.patch.object(S.Source, "fetch_readonly_path", side_effect=S.SyncError(code)), \
                 mock.patch.object(self.login, "state", return_value="authenticated"), \
                 mock.patch.object(self.login, "ensure") as ensure:
                with self.assertRaisesRegex(S.SyncError, code):
                    self.source.fetch("withdrawal", S.request_payload("1102", 1, 300))
                ensure.assert_not_called()

    def test_explicit_browser_login_state_recovers_only_once_and_retries_do_not_recurse(self):
        with mock.patch.object(S.Source, "fetch_readonly_path", side_effect=[S.SyncError("CDP_SOURCE_REQUEST_FAILED"), {"code": 0}]) as fetch, \
             mock.patch.object(self.login, "state", return_value="login_form"), \
             mock.patch.object(self.login, "ensure", return_value=True) as ensure:
            self.assertEqual(self.source.fetch("deposit", S.request_payload("1102", 1, 300)), {"code": 0})
        ensure.assert_called_once_with()
        self.assertEqual(fetch.call_count, 2)
        with mock.patch.object(S.Source, "fetch_readonly_path", side_effect=[{"code": 4}, {"code": 4}]) as fetch, mock.patch.object(self.login, "ensure", return_value=True):
            with self.assertRaisesRegex(S.SyncError, "AUTO_LOGIN_RETRY_AUTH_FAILED"):
                self.source.fetch("withdrawal", S.request_payload("1102", 1, 300))
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(self.login.failures, 1)

    def test_disabled_login_retains_source_failure_and_never_evaluates_browser(self):
        source = M.AutoLoginSource(config(False))
        with mock.patch.object(S.Source, "fetch_readonly_path", return_value={"code": 4}), mock.patch.object(source.login, "ensure") as ensure:
            self.assertEqual(source.fetch("withdrawal", S.request_payload("1102", 1, 300)), {"code": 4})
        ensure.assert_not_called()

    def test_dictionary_or_invalid_business_success_cannot_reset_shared_failed_login_cooldown(self):
        def ensure(**kwargs):
            if self.login.cooling_down:
                raise S.SyncError("AUTO_LOGIN_COOLDOWN")
            return True
        with mock.patch.object(self.login, "ensure", side_effect=ensure):
            for _ in range(2):
                with mock.patch.object(S.Source, "fetch_readonly_path", side_effect=[{"code": 4}, {"code": 4}]):
                    with self.assertRaisesRegex(S.SyncError, "AUTO_LOGIN_RETRY_AUTH_FAILED"):
                        self.source.fetch("withdrawal", S.request_payload("1102", 1, 300))
                before = self.login.failures
                for body in ({"code": 0}, {"code": True}, {"code": 500}, {}, []):
                    with mock.patch.object(S.Source, "fetch_readonly_path", return_value=body):
                        self.source.fetch_readonly_path(S.DICTIONARY_PATHS["common"], S.dictionary_payload("common"))
                    self.assertEqual(self.login.failures, before)
            self.assertTrue(self.login.cooling_down)
            with mock.patch.object(S.Source, "fetch_readonly_path", return_value={"code": 4}) as fetch:
                with self.assertRaisesRegex(S.SyncError, "AUTO_LOGIN_COOLDOWN"):
                    self.source.fetch("withdrawal", S.request_payload("1102", 1, 300))
            self.assertEqual(fetch.call_count, 1)
        with mock.patch.object(S.Source, "fetch_readonly_path", return_value={"code": 0, "data": {}}):
            self.source.fetch("withdrawal", S.request_payload("1102", 1, 300))
        self.assertEqual(self.login.failures, 0)
        self.assertFalse(self.login.cooling_down)


if __name__ == "__main__":
    unittest.main()
