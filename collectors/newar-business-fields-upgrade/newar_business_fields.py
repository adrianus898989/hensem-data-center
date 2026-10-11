"""Offline schema-v2 business facts, never original notes or event payloads.

All added fields are scalar. Source timestamps remain separate from observation
timestamps. A missing operator is unknown, not proof of automatic handling.
The caller controls status/payment success and does not infer them from a time.
For withdrawals a lock holder or last modifier is an identity, not a payout
method. The native operator takes priority; lock/modification identities and
generic event actors remain unknown instead of overriding that source field.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
import unicodedata
from typing import Any, Mapping


BUSINESS_FIELDS = frozenset({
    "businessSchemaVersion", "sourceSubmittedAt", "sourceOperatedAt",
    "sourceHandledAt", "sourcePaidAt", "sourceSubmittedSourceField",
    "sourceOperatedSourceField", "sourceHandledSourceField", "sourcePaidSourceField",
    "operatorName", "operatorType", "operatorSourceField", "requestedAmount",
    "requestedAmountSource", "paidAmount", "paidAmountSource", "requestedCurrency",
    "paidCurrency", "paymentMethod", "withdrawDisplayState", "thirdPaymentState",
    "automaticReasonLabel", "memberNoteLabel", "automaticReasonSource",
    "memberNoteSource", "sourceEventCount", "sourceEventFirstTime",
    "sourceEventLastTime", "sourceEventDigest", "lastEventState",
    "lastEventOperator", "lastEventTime", "lastEventSource",
    "workorderTypeId", "issueLabelSanitized", "rejectionReasonSanitized",
    "problemTagsSanitized", "followupSourceField",
})
OPERATOR_FIELDS = (
    "lockOperator", "lastUpdateMan", "operator", "operatorName", "operatorUser",
    "operatorUsername", "operateUser", "operateName", "operater", "operaterName",
    "adminName", "adminUserName", "adminUser", "auditUser", "auditUserName",
    "auditor", "auditName", "payOperator", "paidOperator", "payer", "handler",
    "handleUser", "handleName", "dealUser", "dealName", "updateBy", "updatedBy",
    "modifier", "modifiedBy", "payUser", "payUserName", "payAdmin", "payAdminName",
    "reviewUser", "reviewUserName", "approveUser", "approveUserName", "payBy",
    "paidBy", "reviewBy", "approveBy", "auditBy", "handleBy", "operatorAccount",
    "adminAccount", "operatorUserName", "opUserName", "opName", "operateUserName",
    "dealUserName", "processorName", "handlerName", "assigneeName",
    "customerServiceName", "currentOperatorName", "lastOperatorName", "lastUpdateName",
)
EVENT_LIST_FIELDS = (
    "statusList", "logList", "payRecords", "auditLogs", "operateLogs",
    "operationLogs", "history", "histories",
)
WORKORDER_OPERATOR_FIELDS = (
    "lastUpdateMan", "operator", "operatorName", "operatorUserName",
    "operatorAccount", "opUserName", "opName", "operateName", "operateUserName",
    "dealUserName", "processorName", "handlerName", "currentOperatorName",
    "lastOperatorName", "lastUpdateName",
)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_AUTO = {"system", "auto", "automatic", "机器人", "系统"}
_UNKNOWN = {"unknown", "null", "none", "undefined", "-", "--", "n/a"}
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MIN = datetime(2020, 1, 1, tzinfo=timezone.utc)


def sanitize_business_text(value: Any) -> tuple[str | None, str]:
    """Fail closed on non-text/oversized payloads; redact identifiers in labels.

    Financial limits such as '不少于2次' remain business facts. Long numerical
    identifiers, phones/cards, URLs, credentials and common wallet formats do
    not. Original text is never returned alongside a sanitized label.
    """
    if value is None:
        return None, "missing"
    if not isinstance(value, str) or len(value) > 4096 or _CONTROL.search(value):
        return None, "withheld"
    if any(unicodedata.category(char) in {"Cf", "Cs", "Cc"} for char in value):
        return None, "withheld"
    value = unicodedata.normalize("NFKC", value)
    text = re.sub(r"\s+", " ", value).strip()
    if not text or text.lower() in _UNKNOWN:
        return None, "empty"
    text = re.sub(r"(?i)(?:https?://|otpauth://|www\.)\S+", "{链接}", text)
    text = re.sub(r"(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "{邮箱}", text)
    text = re.sub(r"(?i)(?:bearer\s+)[A-Za-z0-9._~+/-]+=*", "{凭据}", text)
    text = re.sub(r"(?i)(?:密码|password|passwd|token|secret|authorization|谷歌密钥|验证码密钥|绑定密钥|seed)\s*[:：=]\s*\S+", "{凭据}", text)
    text = re.sub(r"(?<![A-Za-z0-9])(?:0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|(?:bc1|tb1)[a-zA-Z0-9]{25,87})(?![A-Za-z0-9])", "{地址}", text)
    # Include base58 public-wallet strings even without a preceding label.
    text = re.sub(r"(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,64}(?![A-Za-z0-9])", "{地址}", text)
    text = re.sub(r"(?i)(?:银行卡号|银行卡|银行账号|银行账户|卡号|bank\s*account|account\s*number|card\s*number|phone|mobile|手机号|电话号码|whatsapp|钱包地址|wallet\s*address|u地址|usdt\s*address)\s*[:：=]?\s*[+A-Za-z0-9][A-Za-z0-9+_.@/ -]{5,}", "{敏感信息}", text)
    text = re.sub(r"(?<!\d)\+?\d(?:[ -]?\d){6,}(?!\d)", "{标识}", text)
    text = re.sub(r"(?<![A-Za-z0-9])\d{2,}[xX*]{2,}\d{2,}(?![A-Za-z0-9])", "{标识}", text)
    text = re.sub(r"(?<![A-Za-z0-9])(?=[A-Za-z0-9]{24,}(?![A-Za-z0-9]))(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]+", "{标识}", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 256:
        return None, "withheld"
    return text or None, "sanitized"


def safe_operator(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    original = str(value).strip()
    label, _ = sanitize_business_text(original)
    # Redacted material is not a usable business-operator identity.
    if (not label or label != original or any(ch in label for ch in "{}") or len(label) > 100
            or not re.fullmatch(r"[\w .-]+", label)):
        return None
    return label


def source_failure_summary(response: Mapping[str, Any]) -> str:
    def code(value):
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            return "UNKNOWN"
        text = str(value)
        return text if re.fullmatch(r"[-A-Za-z0-9_]{1,32}", text) else "UNKNOWN"
    message = sanitize_business_text(response.get("msg") or response.get("message"))[0]
    return "status=" + code(response.get("status")) + " code=" + code(response.get("code")) + " msg=" + (message or "未提供安全错误说明")


def source_time(value: Any) -> str | None:
    if value in (None, "") or isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return None
    try:
        number = Decimal(str(value).strip())
        if not number.is_finite() or number != number.to_integral_value() or not 0 < number <= 253402300799999:
            return None
        stamp = _EPOCH + timedelta(milliseconds=int(number))
    except (InvalidOperation, OverflowError, ValueError):
        return None
    if stamp < _MIN or stamp > datetime.now(timezone.utc) + timedelta(minutes=5):
        return None
    return stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _time_fact(raw: Mapping[str, Any], fields: tuple[str, ...]) -> tuple[str | None, str | None]:
    for field in fields:
        stamp = source_time(raw.get(field))
        if stamp is not None:
            return stamp, field
    return None, None


def _amount(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return None
    try:
        number = Decimal(str(value).strip())
        if not number.is_finite() or number < 0 or len(number.as_tuple().digits) > 100 or abs(number.as_tuple().exponent) > 100:
            return None
        text = format(number.copy_abs() if number == 0 else number, "f")
    except InvalidOperation:
        return None
    integer, _, fraction = text.partition(".")
    integer, fraction = integer.lstrip("0") or "0", fraction.rstrip("0")
    if len(integer) > 16 or len(fraction) > 8:
        return None
    return integer + ("." + fraction if fraction else "")


def _money_fact(raw: Mapping[str, Any], fields: tuple[str, ...]) -> tuple[str | None, str | None]:
    for field in fields:
        amount = _amount(raw.get(field))
        if amount is not None:
            return amount, field
    return None, None


def _descriptor(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    return sanitize_business_text(str(value))[0]


def _operator_fact(raw: Mapping[str, Any], fields: tuple[str, ...] = OPERATOR_FIELDS) -> tuple[str | None, str | None]:
    for field in fields:
        name = safe_operator(raw.get(field))
        if name:
            return name, field
    return None, None


def _withdraw_operator_fact(raw: Mapping[str, Any], events: list[dict[str, Any]]) -> tuple[str | None, str | None, str]:
    """Keep actor provenance without treating every named actor as manual.

    ``operator`` is the native scalar retained by the detail receiver. A system
    literal in that field must win over lockOperator/lastUpdateMan. Neither a
    identity holding a lock does not prove that the payout was manually
    submitted. Generic audit-event actors also do not prove it. Keep the native
    operator field's existing system/named-operator contract; do not extend it
    to other identities without source evidence.
    No remark, payment state, payment type or update timestamp is a method flag.
    """
    name = safe_operator(raw.get("operator"))
    if name:
        return name, "operator", "auto" if name.lower() in _AUTO else "unknown" if name.lower() in _UNKNOWN else "manual"
    name, field = _operator_fact(raw)
    if name:
        return name, field, "unknown"
    event = next((item for item in reversed(events) if item["operator"]), None)
    if event:
        return event["operator"], event["operator_source"], "unknown"
    return None, None, "unknown"


def _events(raw: Mapping[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for field in EVENT_LIST_FIELDS:
        rows = raw.get(field)
        if not isinstance(rows, list) or len(rows) > 512:
            continue
        for index, row in enumerate(rows):
            if not isinstance(row, Mapping):
                continue
            stamp, stamp_field = _time_fact(row, ("time", "operationTime", "operateTime", "handledTime", "processedTime"))
            if not stamp:
                continue
            state = _descriptor(row.get("status") if row.get("status") not in (None, "") else row.get("state"))
            operator, operator_field = _operator_fact(row)
            result.append({"at": stamp, "state": state, "operator": operator,
                           "source": field + "[" + str(index) + "]." + str(stamp_field),
                           "operator_source": field + "[" + str(index) + "]." + operator_field if operator_field else None})
    return sorted(result, key=lambda item: (item["at"], item["source"]))


def build_business_fields(raw: Mapping[str, Any], dataset: str, currency: str | None = None) -> dict[str, Any]:
    result = {key: None for key in BUSINESS_FIELDS}
    result["businessSchemaVersion"] = 2
    result["operatorType"] = "unknown"
    submitted = ("submissionTime",) if dataset == "workorder" else ("submittedTime",)
    operated = ("operationTime", "operateTime", "lastOperateTime")
    # For work orders only, dateType=1 is the confirmed last-operation query.
    if dataset == "workorder":
        operated += ("lastUpdateTime",)
    for label, fields in (
        ("Submitted", submitted), ("Operated", operated),
        ("Handled", ("handledTime", "handleTime", "processedTime")),
    ):
        result["source" + label + "At"], result["source" + label + "SourceField"] = _time_fact(raw, fields)
    is_paid = (str(raw.get("rechargeState")) == "Payed" if dataset == "charge" else
               str(raw.get("thirdState")).strip() == "3" if dataset == "withdraw" else False)
    if is_paid:
        paid_fields = (("rechargeSuccessTime",) if dataset == "charge" else
                       ("paidTime", "paymentTime", "withdrawSuccessTime", "payoutTime", "paySuccessTime"))
        result["sourcePaidAt"], result["sourcePaidSourceField"] = _time_fact(raw, paid_fields)
    events = _events(raw)
    if events:
        result["sourceEventCount"] = len(events)
        result["sourceEventFirstTime"], result["sourceEventLastTime"] = events[0]["at"], events[-1]["at"]
        result["sourceEventDigest"] = hashlib.sha256(json.dumps(events, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        last = events[-1]
        result.update({"lastEventState": last["state"], "lastEventOperator": last["operator"],
                       "lastEventTime": last["at"], "lastEventSource": last["source"]})
    if dataset == "withdraw":
        name, name_field, handling_type = _withdraw_operator_fact(raw, events)
        result["operatorType"] = handling_type
    else:
        name, name_field = _operator_fact(raw, WORKORDER_OPERATOR_FIELDS if dataset == "workorder" else OPERATOR_FIELDS)
        if not name and dataset != "workorder":
            event = next((item for item in reversed(events) if item["operator"]), None)
            if event:
                name, name_field = event["operator"], event["operator_source"]
        if name:
            result["operatorType"] = "auto" if name.lower() in _AUTO else "unknown" if name.lower() in _UNKNOWN else "manual"
    result["operatorName"], result["operatorSourceField"] = name, name_field
    result["requestedAmount"], result["requestedAmountSource"] = _money_fact(raw, ("mainAmount", "mainCurrencyAmount", "currencyAmount", "amount"))
    result["requestedCurrency"] = currency if currency in {"INR", "PKR", "USDT"} else None
    if is_paid:
        result["paidAmount"], result["paidAmountSource"] = _money_fact(raw, (
            "mainCurrencyPaidAmount", "mainPaidAmount", "currencyPaidAmount", "paidAmount",
            "mainCurrencyPayAmount", "actualAmount", "realAmount", "successAmount",
        ))
        if result["paidAmount"] is not None:
            result["paidCurrency"] = result["requestedCurrency"]
    result["paymentMethod"] = _descriptor(raw.get("payMethod"))
    result["withdrawDisplayState"] = _descriptor(raw.get("withdrawState")) if dataset == "withdraw" else None
    result["thirdPaymentState"] = _descriptor(raw.get("thirdState")) if dataset == "withdraw" else None
    for source, label, source_key in (
        ("remark", "automaticReasonLabel", "automaticReasonSource"),
        ("userRemark", "memberNoteLabel", "memberNoteSource"),
    ):
        if source in raw:
            result[label], _ = sanitize_business_text(raw[source])
            result[source_key] = source
    if dataset == "workorder":
        type_id = raw.get("workOrderTypeId")
        if not isinstance(type_id, bool) and isinstance(type_id, (str, int)):
            text = str(type_id).strip()
            if re.fullmatch(r"[A-Za-z0-9_-]{1,80}", text):
                result["workorderTypeId"] = text
        result["issueLabelSanitized"], _ = sanitize_business_text(raw.get("displayName"))
        for field in ("rejectionReason", "rejectReason"):
            if field in raw:
                result["rejectionReasonSanitized"], _ = sanitize_business_text(raw[field])
                break
        for field in ("problemTags", "issueTags"):
            if field not in raw:
                continue
            value = raw[field]
            if isinstance(value, list) and len(value) <= 32 and all(isinstance(item, str) for item in value):
                labels = [sanitize_business_text(item)[0] for item in value]
                value = json.dumps([label for label in labels if label], ensure_ascii=False, separators=(",", ":"))
            result["problemTagsSanitized"], _ = sanitize_business_text(value)
            break
        for field in ("reminderCount", "followupCount", "followUpCount"):
            value = raw.get(field)
            if not isinstance(value, bool) and isinstance(value, (str, int)) and re.fullmatch(r"\d{1,9}", str(value)):
                result["followupSourceField"] = field
                break
    return result
