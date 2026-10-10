#!/usr/bin/env python3
"""Read-only M8 channel snapshots. Python 3.10+, standard library only.

Run --init once, set AR_MIDDLE_BEARER and AR_MIDDLE_UPLOAD_KEY privately,
then --check / --once / --loop (every 300 seconds by default; legacy 600-second
configuration is supported). Optional browser login recovery uses the native
login form; channel editing and payment APIs are never called.
All local configuration, logs and restart state live in one data directory.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import ipaddress
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import ssl
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ORIGIN = "https://m8-admin.payplatform-manager.com"
INGEST_URL = "https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/ar-middle-channel-ingest"
PATHS = {"deposit": "/api/RechargeChannel/GetCategoryChannelPageList",
         "withdrawal": "/api/WithdrawChannel/GetPageList"}
DICTIONARY_PATHS = {"dynamic": "/api/Common/GetDynamicDictionary", "common": "/api/Common/GetDictionary"}
DYNAMIC_DICTIONARY_KEYS = ("sysPayChannelList", "thirdPayMerchantList", "tenantList")
INTERVAL = 300
COLLECTOR_VERSION = "2026-10-10-auth-guard-1"
MAX_PAGES = 1000
MAX_RESPONSE = 16 * 1024 * 1024
UNSAFE_DISPLAY_TEXT = re.compile(r"[a-z][a-z0-9+.-]*://|(?:javascript|data):|<[^>]*>|\bbearer\s+\S+|(?:\b(?:token|password|passwd|secret|authorization|api[_-]?key|access_token|cookie)|密码|密钥)\s*[:=：]", re.IGNORECASE)
# Bound against the native M8 tenant catalog, then checked against the existing
# platform registry. Unbound tenant 1040 (pop) is deliberately not enabled.
DEFAULT_TARGETS = [
    {"tenant_id": tenant, "platform_name": name, "country": country,
     "enabled": True, "verified": True, "verification_source": "native_m8_catalog_20261009"}
    for country, tenant, name in [
        ("IN", "1102", "Veer.Game"), ("IN", "1093", "JAICLUB"), ("IN", "1031", "IN999"),
        ("IN", "1023", "51GAME"), ("IN", "1041", "BIGMUMBAI"), ("IN", "1008", "RAJA"),
        ("IN", "1101", "Shree.Win"), ("IN", "1016", "TPPLAY"), ("IN", "1001", "82LOTTERY"),
        ("IN", "1064", "6CLUB"), ("IN", "1014", "LOTTERY7"), ("IN", "1048", "91CLUB"),
        ("IN", "1077", "JALWA"), ("IN", "1013", "OKWIN"), ("IN", "1021", "55CLUB"),
        ("PK", "1076", "92GO"), ("PK", "1092", "YAYWIN"), ("PK", "1072", "92DADU"),
        ("PK", "1069", "92R"), ("PK", "1078", "92COCO"), ("PK", "1067", "92PKR"),
        ("PK", "1087", "92GLORY"), ("PK", "1099", "92.GAME"), ("PK", "1090", "92STRIKE"),
        ("PK", "1089", "92STAR"), ("BR", "1074", "POPLUA"), ("BR", "1082", "POPCEU"),
        ("BR", "1003", "POPPG"), ("BR", "1002", "POP678"), ("BR", "1080", "POPBEM"),
        ("BR", "1038", "POP888"), ("BR", "1019", "POP555"), ("ID", "1045", "55FIVE"),
        ("VN", "1035", "82VN"), ("VN", "1042", "66CLUB"), ("VN", "1036", "VN168"),
        ("VN", "1043", "92LOTTERY"), ("MM", "1044", "6LOTTERY"), ("MY", "1046", "MZPLAY"),
        ("NG", "1004", "FB999"),
    ]
]


class SyncError(RuntimeError):
    """Only public error codes are logged; network/body/credential text is not."""


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def source_signature(payload):
    signed = {k: v for k, v in payload.items() if k not in ("timestamp", "signature")}
    canonical = json.dumps(signed, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.md5(canonical.encode("utf-8")).hexdigest().upper()


def request_payload(tenant_id, page_no, page_size):
    payload = {"tenantId": int(tenant_id), "pageNo": page_no, "pageSize": page_size,
               "orderBy": "Desc", "random": secrets.randbelow(900_000_000_000) + 100_000_000_000,
               "language": "zh", "timestamp": int(time.time())}
    payload["signature"] = source_signature(payload)
    return payload


def dictionary_payload(kind):
    if kind not in DICTIONARY_PATHS:
        raise SyncError("SOURCE_ROUTE_NOT_ALLOWED")
    payload = {"random": secrets.randbelow(900_000_000_000) + 100_000_000_000,
               "language": "zh", "timestamp": int(time.time())}
    if kind == "dynamic":
        payload["keys"] = list(DYNAMIC_DICTIONARY_KEYS)
    payload["signature"] = source_signature(payload)
    return payload


def source_id(value, code, *, allow_zero=False):
    # JSON numbers with a decimal point are parsed as Decimal. Accept only
    # exact integers; never round IDs or convert them through binary floats.
    if isinstance(value, Decimal):
        if not value.is_finite() or not 0 <= value < 10 ** 19 or value != value.to_integral_value():
            raise SyncError(code)
        value = int(value)
    pattern = r"(?:0|[1-9][0-9]{0,18})" if allow_zero else r"[1-9][0-9]{0,18}"
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not re.fullmatch(pattern, str(value)):
        raise SyncError(code)
    return str(value)


def native_id(value, code="SOURCE_ID_INVALID"):
    """Tenant and channel identities must be positive integers."""
    return source_id(value, code)


def metadata_id(value, code="SOURCE_CATEGORY_ID_INVALID"):
    """Preserve native zero-valued category/system/merchant metadata IDs."""
    return source_id(value, code, allow_zero=True)


def decimal_text(value, *, signed=False, percent=False):
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise SyncError("SOURCE_DECIMAL_INVALID")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise SyncError("SOURCE_DECIMAL_INVALID") from None
    if not number.is_finite() or (not signed and number < 0) or (percent and number > 100):
        raise SyncError("SOURCE_DECIMAL_RANGE")
    result = format(number, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    if number == 0:
        result = "0"
    digits = result.lstrip("-").split(".")
    if len(digits[0].lstrip("0")) > 16 or (len(digits) == 2 and len(digits[1]) > 8):
        raise SyncError("SOURCE_DECIMAL_PRECISION")
    return result


def optional_integer(value, *, signed=False):
    if value is None or value == "":
        return None
    result = decimal_text(value, signed=signed)
    number = Decimal(result)
    if number != number.to_integral_value() or number > 2_147_483_647 or number < -2_147_483_648:
        raise SyncError("SOURCE_INTEGER_INVALID")
    return int(number)


def safe_text(value, maximum=200):
    if value is None or value == "":
        return None
    if not isinstance(value, (str, int, Decimal)) or isinstance(value, bool):
        raise SyncError("SOURCE_TEXT_INVALID")
    text = str(value).strip()
    if len(text) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in text):
        raise SyncError("SOURCE_TEXT_INVALID")
    return text or None


def currency(value):
    result = safe_text(value, 16)
    if result is not None and not re.fullmatch(r"[A-Z][A-Z0-9]{1,15}", result):
        raise SyncError("SOURCE_CURRENCY_INVALID")
    return result


def redact_notes(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise SyncError("SOURCE_NOTES_INVALID")
    text = re.sub(r"[\x00-\x1f\x7f]", " ", value)
    text = re.sub(r"(?i)\b(?:bearer\s+\S+|https?://\S+|[\w.+-]+@[\w.-]+)", "[redacted]", text)
    text = re.sub(r"(?i)(?:token|secret|password|merchantcode|bank(?:account)?|account|upi|密码|密钥|银行卡|账号)\s*[:=：]\s*\S+", "[redacted]", text)
    text = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b|\b\d{6,}\b|\b[A-Za-z0-9_./+=-]{32,}\b", "[redacted]", text)
    return text.strip()[:400] or None


RATE_ALIASES = {}
for _window, _terms in {
    "15m": ["15m", "15min", "15minutes", "recent15Minutes", "last15Minutes"],
    "30m": ["30m", "30min", "30minutes", "recent30Minutes", "last30Minutes"],
    "1h": ["1h", "1hour", "recent1Hour", "last1Hour"],
    "4h": ["4h", "4hours", "recent4Hours", "last4Hours"],
    "8h": ["8h", "8hours", "recent8Hours", "last8Hours"],
    "24h": ["24h", "24hours", "recent24Hours", "last24Hours"],
    "today": ["today"], "total": ["total", "all"],
}.items():
    for _term in _terms:
        for _suffix in ("", "SuccessRate", "Rate"):
            RATE_ALIASES[re.sub(r"[^a-z0-9]", "", (_term + _suffix).lower())] = _window


def success_rates(value):
    result = {"success_rate_" + window: None for window in ("15m", "30m", "1h", "4h", "8h", "24h", "today", "total")}
    if value is None or value == "":
        return result
    if isinstance(value, str):
        try:
            value = json.loads(value, parse_float=Decimal)
        except (ValueError, TypeError):
            return result
    if not isinstance(value, dict):
        return result
    for key, ratio in value.items():
        window = RATE_ALIASES.get(re.sub(r"[^a-z0-9]", "", str(key).lower()))
        if window is None:
            continue  # Optional source statistics do not invalidate channel identity.
        if isinstance(ratio, dict):
            fields = [v for k, v in ratio.items() if str(k).lower() in ("rate", "successrate", "success_rate")]
            if len(fields) != 1:
                continue
            ratio = fields[0]
        if ratio is None or ratio == "":
            continue
        try:
            raw = decimal_text(ratio)
            number = Decimal(raw)
        except (SyncError, InvalidOperation, TypeError):
            continue
        if number > 1: continue
        field = "success_rate_" + window
        if result[field] is not None:
            result[field] = None
            continue
        result[field] = decimal_text(number * 100, percent=True)
    return result


def success_rates_from_row(row):
    result = success_rates(row.get("successRateInfo"))
    # Verified M8 recharge UI uses these misleadingly named '*Count' fields
    # as ratios and multiplies each by 100. The 15-minute source field stays
    # 15m even though the source's current Chinese translation says 10m.
    for field, window in (("recent15MinutesCount", "15m"), ("recent30MinutesCount", "30m"),
                          ("recent1HourCount", "1h"), ("recent24HoursCount", "24h")):
        value = row.get(field)
        if value is None or value == "": continue
        try:
            ratio = Decimal(decimal_text(value))
            result["success_rate_" + window] = decimal_text(ratio * 100, percent=True) if ratio <= 1 else None
        except (SyncError, InvalidOperation, TypeError):
            result["success_rate_" + window] = None
    return result


def source_updated_at(value):
    if value is None or value == "" or value in (0, -1):
        return None
    # M8's observed lastUpdateTime is Unix milliseconds, not local wall time.
    milliseconds = optional_integer_timestamp(value)
    if milliseconds < 631152000000 or milliseconds > 4102444800000:
        raise SyncError("SOURCE_UPDATE_TIME_INVALID")
    return dt.datetime.fromtimestamp(milliseconds / 1000, dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def optional_integer_timestamp(value):
    if isinstance(value, Decimal):
        if not value.is_finite() or value != value.to_integral_value():
            raise SyncError("SOURCE_UPDATE_TIME_INVALID")
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not re.fullmatch(r"[0-9]{12,13}", str(value)):
        raise SyncError("SOURCE_UPDATE_TIME_INVALID")
    return int(value)


def optional_metadata_name(value):
    if not isinstance(value, str) or not value.strip(): return None
    try:
        name = safe_text(value)
    except SyncError:
        return None
    if UNSAFE_DISPLAY_TEXT.search(name):
        return None
    return name


def optional_display_text(value, maximum=200):
    """Ordinary merchant IDs may be long numeric, hexadecimal or UUID strings."""
    try:
        text = safe_text(value, maximum)
    except SyncError:
        return None
    if text is None or UNSAFE_DISPLAY_TEXT.search(text):
        return None
    return text


def display_gateway_url(value):
    """Display-only URL: never follow it, and never retain URL credentials."""
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        return None
    text = value.strip()
    if re.search(r"[\s<>\\]|%(?![0-9a-fA-F]{2})", text) or any(ord(c) == 127 for c in text):
        return None
    try:
        parts = urllib.parse.urlsplit(text)
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname or parts.username is not None or parts.password is not None:
            return None
        port = parts.port
        host = parts.hostname.lower()
        if ":" in host:
            host = "[" + str(ipaddress.IPv6Address(host)) + "]"
        elif not re.fullmatch(r"[a-z0-9.-]+", host) or ".." in host:
            return None
        path = parts.path
        for _ in range(3):
            decoded = urllib.parse.unquote(path)
            if decoded == path:
                break
            path = decoded
        if re.search(r"(?i)(?:\b(?:token|password|passwd|secret|authorization|api[_-]?key|access_token|cookie)|密码|密钥)\s*[:=：]|/(?:token|password|passwd|secret|authorization|api[_-]?key|access_token|cookie|密码|密钥)/|\bbearer\s+", path) or any(ord(c) < 32 or ord(c) == 127 for c in path) or re.search(r"[<>\\]", path):
            return None
        netloc = host + (":" + str(port) if port is not None else "")
        return urllib.parse.urlunsplit((parts.scheme.lower(), netloc, parts.path, "", ""))
    except (ValueError, TypeError):
        return None


def display_white_ips(value):
    if value is None:
        return None
    if isinstance(value, str) and len(value) <= 16000:
        tokens = re.split(r"[,;，；\s]+", value.strip()) if value.strip() else []
    elif isinstance(value, list) and len(value) <= 100:
        tokens = value
    else:
        return None
    result = []
    for token in tokens:
        if not isinstance(token, str) or not re.fullmatch(r"[0-9a-fA-F.:/]+", token):
            return None  # An invalid partial whitelist must not look complete.
        try:
            parsed = str(ipaddress.ip_network(token, strict=False) if "/" in token else ipaddress.ip_address(token))
        except ValueError:
            return None
        if parsed not in result:
            result.append(parsed)
        if len(result) > 100:
            return None
    return result


def optional_withdrawal_value(parser, value):
    try:
        return parser(value)
    except (SyncError, ValueError, TypeError, InvalidOperation):
        return None


def dictionary_data(response):
    if not isinstance(response, dict) or isinstance(response.get("code"), bool) or response.get("code") not in (0, "0") or not isinstance(response.get("data"), dict):
        raise SyncError("SOURCE_DICTIONARY_UNAVAILABLE")
    return response["data"]


def dictionary_labels(entries, id_field, label_field, direction=None):
    result = {}
    if not isinstance(entries, list) or len(entries) > 100000:
        return result
    for entry in entries:
        if not isinstance(entry, dict) or (direction is not None and entry.get("inOutType") != direction):
            continue
        identifier = optional_withdrawal_value(metadata_id, entry.get(id_field))
        label = optional_metadata_name(entry.get(label_field))
        if identifier is None or label is None:
            continue
        if identifier in result and result[identifier] != label:
            result[identifier] = None  # Conflicting dictionary labels stay unknown.
        else:
            result[identifier] = label
    return {identifier: label for identifier, label in result.items() if label is not None}


def parse_dynamic_dictionary(response):
    data = dictionary_data(response)
    def entries(key):
        if key in data:
            return data[key]
        items = data.get("items")
        if isinstance(items, dict):
            return items.get(key, items.get(key[0].upper() + key[1:]))
        return None
    system = entries("sysPayChannelList")
    return {"system_channel_names": {
                "deposit": dictionary_labels(system, "sysChannelId", "sysChannelName", "Recharge"),
                "withdrawal": dictionary_labels(system, "sysChannelId", "sysChannelName", "Withdraw")},
            "merchant_names": dictionary_labels(entries("thirdPayMerchantList"), "merchantId", "customName"),
            "tenant_names": dictionary_labels(entries("tenantList"), "tenantId", "tenantName")}


def parse_common_dictionary(response):
    return {"system_category_names": dictionary_labels(dictionary_data(response).get("withdrawCategoryEnumList"), "id", "name")}


def withdrawal_details(row, system_channel, tenant_id, dictionaries=None):
    dictionaries = dictionaries if isinstance(dictionaries, dict) else {}
    merchant_id = optional_withdrawal_value(metadata_id, row.get("thirdPayMerchantId"))
    system_category_id = optional_withdrawal_value(metadata_id, system_channel.get("sysCategoryId"))
    return {
        "source_tenant_name": optional_metadata_name(dictionaries.get("tenant_names", {}).get(str(tenant_id))),
        "balance_updated_at": optional_withdrawal_value(source_updated_at, row.get("balanceUpdateTime")),
        "today_submit_count": optional_withdrawal_value(optional_integer, row.get("todaySubmitCount")),
        "recent_1h_success_count": optional_withdrawal_value(optional_integer, row.get("recent1HourSuccessCount")),
        "merchant_code": optional_display_text(row.get("merchantCode")),
        "merchant_name": optional_metadata_name(row.get("merchantCustomName")) or optional_metadata_name(dictionaries.get("merchant_names", {}).get(merchant_id)),
        "third_channel_code": optional_display_text(row.get("thirdChannelCode")),
        "is_use_channel_code": system_channel.get("isUseChannelCode") if type(system_channel.get("isUseChannelCode")) is bool else None,
        "is_fixed_channel_code": system_channel.get("isFixedChannelCode") if type(system_channel.get("isFixedChannelCode")) is bool else None,
        "system_category_id": system_category_id,
        "system_category_name": optional_metadata_name(dictionaries.get("system_category_names", {}).get(system_category_id)),
        "third_pay_api_url": display_gateway_url(system_channel.get("thirdPayApiUrl")),
        "notify_white_ips": display_white_ips(system_channel.get("notifyWhiteIpList")),
        "last_update_by": optional_display_text(row.get("lastUpdateMan")),
        "last_updated_at": optional_withdrawal_value(source_updated_at, row.get("lastUpdateTime")),
    }


def channel_categories(row, own_category, outer_category):
    """Keep all native tenant categories; system category IDs are unrelated."""
    categories = row.get("categories")
    if categories is not None and not isinstance(categories, list):
        raise SyncError("SOURCE_CATEGORIES_INVALID")
    if categories and len(categories) > 1000: raise SyncError("SOURCE_CATEGORIES_TOO_MANY")
    if not categories:
        category_id = own_category.get("categoryId")
        if category_id is None: category_id = outer_category.get("categoryId")
        if category_id is None: return []
        return [{"category_id": metadata_id(category_id),
                 "category_name": optional_metadata_name(own_category.get("categoryName") or outer_category.get("customName")),
                 "sort": optional_integer(own_category.get("sort") if own_category.get("sort") is not None else outer_category.get("sort"), signed=True)}]
    result, seen = [], {}
    for category in categories:
        if not isinstance(category, dict): raise SyncError("SOURCE_CATEGORIES_INVALID")
        tenant_id, ordinary_id = category.get("tenantCategoryId"), category.get("categoryId")
        if tenant_id is not None and ordinary_id is not None and metadata_id(tenant_id) != metadata_id(ordinary_id):
            raise SyncError("SOURCE_CATEGORY_ID_CONFLICT")
        category_id = metadata_id(tenant_id if tenant_id is not None else ordinary_id)
        item = {"category_id": category_id,
                "category_name": optional_metadata_name(category.get("customName") or category.get("categoryName")),
                "sort": optional_integer(category.get("sort"), signed=True)}
        if category_id in seen:
            if seen[category_id] != item: raise SyncError("SOURCE_CATEGORY_DUPLICATE_CONFLICT")
            continue
        seen[category_id] = item
        result.append(item)
    return result


def source_channel_name(system_channel):
    """An original system name is optional; customName and provider are separate."""
    names = []
    for field in ("sysChannelName", "channelName", "name"):
        value = system_channel.get(field)
        name = optional_metadata_name(value)
        if name is not None: names.append(name)
    # Conflicting names lack sufficient evidence to select one as the original.
    return names[0] if names and len(set(names)) == 1 else None


def normalize_record(row, tenant_id, position, category=None, *, order_type=None, dictionaries=None):
    if not isinstance(row, dict) or native_id(row.get("tenantId"), "SOURCE_TENANT_ID_INVALID") != str(tenant_id):
        raise SyncError("SOURCE_TENANT_MISMATCH")
    channel_id = native_id(row.get("id"), "SOURCE_CHANNEL_ID_INVALID")
    channel_name = safe_text(row.get("customName"))
    if not channel_name:
        raise SyncError("SOURCE_CHANNEL_NAME_MISSING")
    own_category = row.get("channelCategory") or {}
    system_channel = row.get("sysChannel") or {}
    if not isinstance(own_category, dict) or not isinstance(system_channel, dict):
        raise SyncError("SOURCE_CATEGORY_INVALID")
    category = category or {}
    own_id = own_category.get("categoryId")
    group_id = category.get("categoryId")
    if own_id is not None and group_id is not None and metadata_id(own_id) != metadata_id(group_id):
        raise SyncError("SOURCE_CATEGORY_MISMATCH")
    category_id = own_id if own_id is not None else group_id
    category_name = optional_metadata_name(own_category.get("categoryName") or category.get("customName"))
    source_state = safe_text(row.get("state"))
    channel_state = safe_text(row.get("channelState"))
    merchant_state = safe_text(row.get("merchantState"))
    status = "; ".join(f"{label}={value}" for label, value in
                       (("state", source_state), ("channelState", channel_state), ("merchantState", merchant_state))
                       if value is not None)
    if not status:
        raise SyncError("SOURCE_STATE_MISSING")
    unit = currency(row.get("sysCurrency"))
    balance = decimal_text(row.get("thirdBalance"), signed=True)
    threshold = decimal_text(row.get("autoCloseBalance"))
    fee_rate = decimal_text(row.get("thirdPayFeeRate"))
    dictionaries = dictionaries if isinstance(dictionaries, dict) else {}
    system_id = metadata_id(system_channel["sysChannelId"], "SOURCE_SYS_CHANNEL_ID_INVALID") if system_channel.get("sysChannelId") is not None else None
    dictionary_name = dictionaries.get("system_channel_names", {}).get(order_type, {}).get(system_id)
    out = {
        "channel_id": channel_id, "channel_name": channel_name, "status_text": status,
        "source_channel_name": source_channel_name(system_channel) or optional_metadata_name(dictionary_name),
        "provider": safe_text(row.get("payCode") if order_type == "withdrawal" else row.get("payCode") or row.get("merchantCustomName")), "channel_type": category_name,
        "payment_method": category_name,
        "category_id": metadata_id(category_id) if category_id is not None else None,
        "category_name": category_name,
        "channel_categories": channel_categories(row, own_category, category),
        "sys_channel_id": system_id,
        "third_pay_merchant_id": metadata_id(row["thirdPayMerchantId"], "SOURCE_MERCHANT_ID_INVALID") if row.get("thirdPayMerchantId") is not None else None,
        "source_state": source_state, "source_channel_state": channel_state, "source_merchant_state": merchant_state,
        "min_amount": decimal_text(row.get("minAmount")), "max_amount": decimal_text(row.get("maxAmount")),
        "limit_currency": unit, "balance": balance, "balance_currency": unit if balance is not None else None,
        "balance_threshold": threshold, "balance_threshold_currency": unit if threshold is not None else None,
        "fee_rate": fee_rate, "fee_rate_basis": "source_raw" if fee_rate is not None else None,
        "fee_amount": decimal_text(row.get("thirdPayFeeAmount")),
        "required_deposit_count": None, "priority": optional_integer(row.get("sort")),
        "weight": decimal_text(row.get("weight")), "source_position": position,
        # Verified source screenshots and matching channel IDs prove 0=off/1=on.
        "enabled": False if source_state == "0" else True if source_state == "1" else None,
        "notes": redact_notes(row.get("remark")),
        "source_updated_at": source_updated_at(row.get("lastUpdateTime")),
    }
    if order_type == "withdrawal":
        out["withdrawal_details"] = withdrawal_details(row, system_channel, tenant_id, dictionaries)
    elif order_type == "deposit":
        out["real_time_weight"] = decimal_text(row.get("realTimeWeight"))
    out.update(success_rates_from_row(row))
    if out["min_amount"] is not None and out["max_amount"] is not None and Decimal(out["min_amount"]) > Decimal(out["max_amount"]):
        raise SyncError("SOURCE_AMOUNT_RANGE_INVALID")
    return out


def page_rows(response, order_type, page_no, tenant_id, page_size):
    if not isinstance(response, dict) or isinstance(response.get("code"), bool) or response.get("code") not in (0, "0"):
        raise SyncError("SOURCE_BUSINESS_FAILURE")
    data = response.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("list"), list):
        raise SyncError("SOURCE_RESPONSE_SHAPE_INVALID")
    for field in ("pageNo", "totalPage", "totalCount"):
        if type(data.get(field)) is not int or data[field] < 0:
            raise SyncError("SOURCE_PAGER_METADATA_INVALID")
    total, pages = data["totalCount"], data["totalPage"]
    if data["pageNo"] != page_no or pages > MAX_PAGES:
        raise SyncError("SOURCE_PAGE_ECHO_MISMATCH")
    if total == 0:
        if pages not in (0, 1) or page_no != 1:
            raise SyncError("SOURCE_ZERO_NOT_PROVEN")
    elif pages < 1 or pages != (total + page_size - 1) // page_size or page_no > pages:
        raise SyncError("SOURCE_TOTAL_PAGE_MISMATCH")
    records = []
    if order_type == "deposit":
        for group in data["list"]:
            if not isinstance(group, dict) or not isinstance(group.get("channels"), list):
                raise SyncError("SOURCE_RECHARGE_GROUP_INVALID")
            # Native UI flattens channels: empty groups contribute no records,
            # including unclassified groups with zero/missing category IDs.
            if not group["channels"]:
                continue
            if group.get("categoryId") is not None:
                metadata_id(group["categoryId"])
            for row in group["channels"]:
                records.append((row, group))
    else:
        records = [(row, None) for row in data["list"]]
    if total == 0 and records:
        raise SyncError("SOURCE_ZERO_NOT_PROVEN")
    expected = 0 if total == 0 else min(page_size, total - (page_no - 1) * page_size)
    if len(records) != expected:
        raise SyncError("SOURCE_PAGE_INCOMPLETE")
    ids = []
    for row, _category in records:
        if not isinstance(row, dict) or native_id(row.get("tenantId"), "SOURCE_TENANT_ID_INVALID") != str(tenant_id):
            raise SyncError("SOURCE_TENANT_MISMATCH")
        ids.append(native_id(row.get("id"), "SOURCE_CHANNEL_ID_INVALID"))
    if len(ids) != len(set(ids)):
        raise SyncError("SOURCE_PAGE_DUPLICATE_CHANNEL")
    return total, pages, records, tuple(ids)


def collect_direction(source, tenant_id, order_type, page_size=300, dictionaries=None):
    response = source.fetch(order_type, request_payload(tenant_id, 1, page_size))
    total, pages, first_rows, first_ids = page_rows(response, order_type, 1, tenant_id, page_size)
    records, seen_ids, fingerprints = [], set(), set()
    for page_no in range(1, max(1, pages) + 1):
        if page_no == 1:
            raw_rows, ids = first_rows, first_ids
        else:
            response = source.fetch(order_type, request_payload(tenant_id, page_no, page_size))
            current_total, current_pages, raw_rows, ids = page_rows(response, order_type, page_no, tenant_id, page_size)
            if (current_total, current_pages) != (total, pages):
                raise SyncError("SOURCE_TOTAL_DRIFT")
        if ids and (ids in fingerprints or seen_ids.intersection(ids)):
            raise SyncError("SOURCE_PAGINATION_DUPLICATE")
        fingerprints.add(ids)
        seen_ids.update(ids)
        for row, group in raw_rows:
            records.append(normalize_record(row, tenant_id, len(records), group, order_type=order_type, dictionaries=dictionaries))
    # A second first-page query proves the count and anchor did not drift.
    final_response = source.fetch(order_type, request_payload(tenant_id, 1, page_size))
    confirmed_total, confirmed_pages, _rows, confirmed_ids = page_rows(final_response, order_type, 1, tenant_id, page_size)
    if (confirmed_total, confirmed_pages, confirmed_ids) != (total, pages, first_ids):
        raise SyncError("SOURCE_FINAL_CONFIRMATION_DRIFT")
    observed_at = utc_now()  # The final source verification has actually completed.
    if len(records) != total or len(seen_ids) != total:
        raise SyncError("SOURCE_SNAPSHOT_INCOMPLETE")
    return {"order_type": order_type, "observed_at": observed_at, "source_count": total,
            "fetched_count": len(records), "complete": True, "page_count": max(1, pages), "records": records}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SyncError("HTTP_REDIRECT_REFUSED")


def tls_context(ca_bundle=None):
    if ca_bundle:
        try:
            return ssl.create_default_context(cafile=str(ca_bundle))
        except (OSError, ssl.SSLError):
            raise SyncError("TLS_TRUSTED_CA_BUNDLE_INVALID") from None
    try:
        context = ssl.create_default_context()
    except (OSError, ssl.SSLError):
        raise SyncError("TLS_CERTIFICATE_CONFIGURATION_INVALID") from None
    explicit = any(os.environ.get(name) for name in ("SSL_CERT_FILE", "SSL_CERT_DIR"))
    if context.cert_store_stats().get("x509_ca", 0) or explicit:
        return context
    # Python.org macOS installs may lack their own CA bundle. Read only public
    # OS certificates; never export credentials, install CAs or disable TLS.
    candidates = ["/etc/ssl/cert.pem"] if sys.platform == "darwin" else []
    try:
        import certifi  # Optional preinstalled dependency; no pip requirement.
        candidates.append(certifi.where())
    except ImportError:
        pass
    for candidate in candidates:
        if not isinstance(candidate, str) or not Path(candidate).is_file(): continue
        try:
            context.load_verify_locations(cafile=candidate)
        except (OSError, ssl.SSLError):
            continue
        if context.cert_store_stats().get("x509_ca", 0): return context
    capath = ssl.get_default_verify_paths().capath
    if capath and Path(capath).is_dir(): return context  # Hashed CAs load on demand.
    raise SyncError("TLS_NO_TRUSTED_CA_CONFIGURE_CA_BUNDLE")


def http_json(url, payload=None, headers=None, *, context=None, direct_connection=False):
    body = json_bytes(payload) if payload is not None else None
    request = urllib.request.Request(url, data=body, headers=headers or {}, method="POST" if body is not None else "GET")
    handlers = [NoRedirect(), urllib.request.HTTPSHandler(context=context or tls_context())]
    if direct_connection: handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(request, timeout=40) as response:
            raw = response.read(MAX_RESPONSE + 1)
    except urllib.error.HTTPError as exc:
        raise SyncError("HTTP_STATUS_" + str(exc.code)) from None
    except (urllib.error.URLError, ssl.SSLError) as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, (ssl.SSLError, ssl.SSLCertVerificationError)):
            raise SyncError("TLS_CERTIFICATE_FAILURE_CONFIGURE_TRUSTED_CA_BUNDLE") from None
        raise SyncError("NETWORK_REQUEST_FAILED") from None
    if len(raw) > MAX_RESPONSE:
        raise SyncError("HTTP_RESPONSE_TOO_LARGE")
    try:
        return json.loads(raw, parse_float=Decimal)
    except (ValueError, UnicodeError):
        raise SyncError("HTTP_RESPONSE_NOT_JSON") from None


def validate_private_file(path):
    if not path.is_file() or path.is_symlink():
        raise SyncError("PRIVATE_FILE_MISSING_OR_SYMLINK")
    if os.name != "nt" and path.stat().st_mode & 0o077:
        raise SyncError("PRIVATE_FILE_REQUIRES_MODE_0600")


def source_bearer(config):
    token = os.environ.get("AR_MIDDLE_BEARER", "").strip()
    if not token and config.get("session_file"):
        path = Path(config["session_file"]).expanduser()
        if not path.is_absolute():
            path = config["_config_dir"] / path
        validate_private_file(path)
        try:
            session = json.loads(path.read_text(encoding="utf-8"))
            token = session.get("bearer") or session.get("access_token") or session.get("value")
            expires = session.get("expire")
        except (OSError, ValueError, AttributeError):
            raise SyncError("SOURCE_SESSION_FILE_INVALID") from None
        if expires is not None and (isinstance(expires, bool) or not isinstance(expires, (int, float)) or expires <= time.time() * 1000):
            raise SyncError("SOURCE_SESSION_EXPIRED")
    if not isinstance(token, str) or not token or any(ord(c) < 33 or ord(c) > 126 for c in token.removeprefix("Bearer ")):
        raise SyncError("SOURCE_SESSION_REQUIRED")
    return token if token.startswith("Bearer ") else "Bearer " + token


def validate_cdp_url(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port or 80
    except (ValueError, TypeError):
        raise SyncError("CDP_URL_REQUIRES_EXPLICIT_LOCAL_HTTP") from None
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/") or not 1 <= port <= 65535:
        raise SyncError("CDP_URL_REQUIRES_EXPLICIT_LOCAL_HTTP")
    return parsed


def validate_debugger_url(url, cdp_url, target_id):
    cdp = validate_cdp_url(cdp_url)
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port or 80
    except (ValueError, TypeError):
        raise SyncError("CDP_WEBSOCKET_BOUNDARY_MISMATCH") from None
    if not isinstance(target_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", target_id):
        raise SyncError("CDP_TARGET_ID_INVALID")
    if parsed.scheme != "ws" or parsed.hostname != cdp.hostname or port != (cdp.port or 80) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path != "/devtools/page/" + target_id:
        raise SyncError("CDP_WEBSOCKET_BOUNDARY_MISMATCH")
    return parsed


class WebSocket:
    """Small RFC6455 client used only for an explicitly configured local CDP."""
    def __init__(self, url, cdp_url, target_id):
        parsed = validate_debugger_url(url, cdp_url, target_id)
        self.sock = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=45)
        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        host = parsed.netloc
        target = parsed.path + ("?" + parsed.query if parsed.query else "")
        handshake = f"GET {target} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        self.sock.sendall(handshake.encode("ascii"))
        self.buffer = b""
        while b"\r\n\r\n" not in self.buffer:
            chunk = self.sock.recv(4096)
            if not chunk or len(self.buffer) > 16384:
                self.close(); raise SyncError("CDP_WEBSOCKET_HANDSHAKE_FAILED")
            self.buffer += chunk
        raw_headers, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        headers = {}
        lines = raw_headers.decode("latin1").split("\r\n")
        for line in lines[1:]:
            if ":" in line:
                name, value = line.split(":", 1); headers[name.lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
        if " 101 " not in lines[0] or headers.get("sec-websocket-accept") != expected:
            self.close(); raise SyncError("CDP_WEBSOCKET_HANDSHAKE_FAILED")

    def close(self):
        self.sock.close()

    def read_exact(self, count):
        while len(self.buffer) < count:
            chunk = self.sock.recv(max(4096, count - len(self.buffer)))
            if not chunk:
                raise SyncError("CDP_WEBSOCKET_CLOSED")
            self.buffer += chunk
        value, self.buffer = self.buffer[:count], self.buffer[count:]
        return value

    def send(self, data, opcode=1):
        mask = secrets.token_bytes(4)
        length = len(data)
        header = bytes([0x80 | opcode])
        header += bytes([0x80 | length]) if length < 126 else (bytes([0x80 | 126]) + struct.pack("!H", length) if length < 65536 else bytes([0x80 | 127]) + struct.pack("!Q", length))
        self.sock.sendall(header + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(data)))

    def receive(self):
        fragments = bytearray()
        while True:
            first, second = self.read_exact(2)
            opcode, final, masked = first & 15, first & 128, second & 128
            length = second & 127
            if length == 126: length = struct.unpack("!H", self.read_exact(2))[0]
            if length == 127: length = struct.unpack("!Q", self.read_exact(8))[0]
            if length > MAX_RESPONSE or len(fragments) + length > MAX_RESPONSE:
                raise SyncError("CDP_RESPONSE_TOO_LARGE")
            mask = self.read_exact(4) if masked else None
            data = self.read_exact(length)
            if mask: data = bytes(value ^ mask[i % 4] for i, value in enumerate(data))
            if opcode == 8: raise SyncError("CDP_WEBSOCKET_CLOSED")
            if opcode == 9: self.send(data, 10); continue
            if opcode == 10: continue
            if opcode not in (0, 1): raise SyncError("CDP_FRAME_INVALID")
            fragments.extend(data)
            if final: return bytes(fragments)


class Source:
    def __init__(self, config):
        self.config = config
        self.context = tls_context(config.get("ca_bundle"))
        self.next_request_at = 0.0
        self.dictionaries = {}

    def fetch(self, order_type, payload):
        if order_type not in PATHS:
            raise SyncError("SOURCE_ROUTE_NOT_ALLOWED")
        return self.fetch_readonly_path(PATHS[order_type], payload)

    def fetch_readonly_path(self, path, payload):
        if path not in (*PATHS.values(), *DICTIONARY_PATHS.values()):
            raise SyncError("SOURCE_ROUTE_NOT_ALLOWED")
        if path == DICTIONARY_PATHS["dynamic"] and (not isinstance(payload, dict) or payload.get("keys") != list(DYNAMIC_DICTIONARY_KEYS)):
            raise SyncError("SOURCE_DICTIONARY_KEYS_NOT_ALLOWED")
        delay = self.next_request_at - time.monotonic()
        if delay > 0: time.sleep(delay)
        self.next_request_at = time.monotonic() + self.config.get("min_request_interval_seconds", 1)
        if self.config.get("cdp_url"):
            return self.fetch_path_in_browser(path, payload)
        return http_json(ORIGIN + path, payload,
                         {"Content-Type": "application/json", "Authorization": source_bearer(self.config),
                          "Origin": ORIGIN, "Referer": ORIGIN + "/", "domainurl": ORIGIN}, context=self.context)

    def refresh_dictionaries(self, logger):
        # Metadata is fetched once per run cycle, never once per tenant. Do not
        # reuse old dictionary names after a failed refresh in a later cycle.
        self.dictionaries = {}
        for kind, parser in (("dynamic", parse_dynamic_dictionary), ("common", parse_common_dictionary)):
            try:
                response = self.fetch_readonly_path(DICTIONARY_PATHS[kind], dictionary_payload(kind))
                self.dictionaries.update(parser(response))
            except Exception:
                logger.warning("SOURCE_DICTIONARY_UNAVAILABLE kind=%s", kind)

    def fetch_in_browser(self, order_type, payload):
        if order_type not in PATHS:
            raise SyncError("SOURCE_ROUTE_NOT_ALLOWED")
        return self.fetch_readonly_path(PATHS[order_type], payload)

    def fetch_path_in_browser(self, path, payload):
        if path not in (*PATHS.values(), *DICTIONARY_PATHS.values()):
            raise SyncError("SOURCE_ROUTE_NOT_ALLOWED")
        if path == DICTIONARY_PATHS["dynamic"] and (not isinstance(payload, dict) or payload.get("keys") != list(DYNAMIC_DICTIONARY_KEYS)):
            raise SyncError("SOURCE_DICTIONARY_KEYS_NOT_ALLOWED")
        cdp = self.config["cdp_url"].rstrip("/")
        validate_cdp_url(cdp)
        targets = http_json(cdp + "/json", direct_connection=True)
        if not isinstance(targets, list): raise SyncError("CDP_TARGET_LIST_INVALID")
        matching = [target for target in targets if isinstance(target, dict) and target.get("type") == "page"
                    and urllib.parse.urlsplit(target.get("url", "")).scheme == "https"
                    and urllib.parse.urlsplit(target.get("url", "")).netloc == urllib.parse.urlsplit(ORIGIN).netloc]
        if len(matching) != 1:
            raise SyncError("CDP_REQUIRES_ONE_M8_PAGE")
        validate_debugger_url(matching[0].get("webSocketDebuggerUrl"), cdp, matching[0].get("id"))
        # Only the source JSON is returned. ACCESS-TOKEN never leaves the browser.
        expression = """(async () => {
          const origin = ORIGIN_VALUE, path = PATH_VALUE, payload = PAYLOAD_VALUE;
          const assertAuthenticated = () => {
            if (location.origin !== origin) throw new Error('SOURCE_ORIGIN_MISMATCH');
            if (location.pathname.replace(/\\/+$/, '') === '/login')
              throw new Error('SOURCE_BROWSER_LOGIN_REQUIRED');
            const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
            if ([...document.querySelectorAll('[role="dialog"],[role="alertdialog"],.n-dialog')]
                .some(el => visible(el) && el.textContent.includes('登录身份已失效，请重新登录!')))
              throw new Error('SOURCE_BROWSER_SESSION_EXPIRED');
          };
          assertAuthenticated();
          let session;
          try { session = JSON.parse(localStorage.getItem('ACCESS-TOKEN') || 'null'); }
          catch { throw new Error('SOURCE_SESSION_INVALID'); }
          if (!session || typeof session.value !== 'string' || !session.value.trim() ||
              (session.expire != null && (typeof session.expire !== 'number' || session.expire <= Date.now())))
            throw new Error('SOURCE_SESSION_REQUIRED');
          const bearer = session.value.startsWith('Bearer ') ? session.value : 'Bearer ' + session.value;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 40000);
          try {
            const response = await fetch(origin + path, {method:'POST', redirect:'error', credentials:'same-origin',
              signal:controller.signal, headers:{'Content-Type':'application/json','Authorization':bearer,'domainurl':origin},
              body:JSON.stringify(payload)});
            assertAuthenticated();
            if (!response.ok) throw new Error('SOURCE_HTTP_FAILURE');
            const text = await response.text();
            assertAuthenticated();
            return text;
          } finally { clearTimeout(timer); }
        })()""".replace("ORIGIN_VALUE", json.dumps(ORIGIN)).replace("PATH_VALUE", json.dumps(path)).replace("PAYLOAD_VALUE", json_bytes(payload).decode("utf-8"))
        try:
            websocket = WebSocket(matching[0]["webSocketDebuggerUrl"], cdp, matching[0]["id"])
            try:
                websocket.send(json_bytes({"id": 1, "method": "Runtime.evaluate", "params": {
                    "expression": expression, "awaitPromise": True, "returnByValue": True}}))
                deadline = time.monotonic() + 60
                while True:
                    if time.monotonic() > deadline: raise SyncError("CDP_RESPONSE_TIMEOUT")
                    message = json.loads(websocket.receive(), parse_float=Decimal)
                    if message.get("id") == 1:
                        break
                result = message.get("result", {})
                if "error" in message or result.get("exceptionDetails"):
                    details = result.get("exceptionDetails") or {}
                    exception = (details.get("exception") or {}) if isinstance(details, dict) else {}
                    description = (exception.get("description") or exception.get("value")) if isinstance(exception, dict) else None
                    if isinstance(description, str):
                        public = re.match(r"^(?:Error: )?(SOURCE_BROWSER_LOGIN_REQUIRED|SOURCE_BROWSER_SESSION_EXPIRED|SOURCE_SESSION_REQUIRED|SOURCE_SESSION_INVALID|SOURCE_ORIGIN_MISMATCH)(?:\n|$)", description)
                        if public:
                            raise SyncError(public[1])
                    raise SyncError("CDP_SOURCE_REQUEST_FAILED")
                value = result.get("result", {}).get("value")
                if not isinstance(value, str): raise SyncError("CDP_RESPONSE_INVALID")
                response = json.loads(value, parse_float=Decimal)
                if not isinstance(response, dict): raise SyncError("CDP_RESPONSE_INVALID")
                return response
            finally:
                websocket.close()
        except (OSError, ValueError, KeyError):
            raise SyncError("CDP_CONNECTION_FAILED") from None


class StateStore:
    def __init__(self, directory):
        path = directory / "state.sqlite3"
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("CREATE TABLE IF NOT EXISTS snapshots (tenant_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, captured_at TEXT NOT NULL, payload TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 1)")
        self.db.commit()
        if os.name != "nt": os.chmod(path, 0o600)

    def close(self):
        self.db.close()

    def save_complete(self, payload):
        with self.db:
            self.db.execute("INSERT INTO snapshots(tenant_id,snapshot_id,captured_at,payload,pending) VALUES(?,?,?,?,1) ON CONFLICT(tenant_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,captured_at=excluded.captured_at,payload=excluded.payload,pending=1",
                            (payload["source_tenant_id"], payload["snapshot_id"], payload["captured_at"], json_bytes(payload).decode("utf-8")))

    def pending(self):
        return [json.loads(row[0]) for row in self.db.execute("SELECT payload FROM snapshots WHERE pending=1 ORDER BY captured_at")]

    def acknowledge(self, payload):
        with self.db:
            self.db.execute("UPDATE snapshots SET pending=0 WHERE tenant_id=? AND snapshot_id=?",
                            (payload["source_tenant_id"], payload["snapshot_id"]))


class Upload:
    def __init__(self, config):
        self.config = config
        self.context = tls_context(config.get("ca_bundle"))

    def send(self, payload):
        key = os.environ.get("AR_MIDDLE_UPLOAD_KEY") or self.config.get("upload_key")
        if not isinstance(key, str) or not key.strip() or any(ord(c) < 33 or ord(c) > 126 for c in key):
            raise SyncError("TARGET_UPLOAD_KEY_REQUIRED")
        return http_json(INGEST_URL, payload, {"Content-Type": "application/json", "X-Collector-Key": key}, context=self.context)

    def apply(self, payload):
        result = self.send(payload)
        count = sum(direction["fetched_count"] for direction in payload["directions"])
        if not isinstance(result, dict) or result.get("ok") is not True or result.get("source") != "ar_middle" or result.get("snapshot_id") != payload["snapshot_id"] or result.get("snapshot_applied") is not True or type(result.get("accepted")) is not int or result["accepted"] != count or type(result.get("source_count")) is not int or result["source_count"] != count:
            raise SyncError("TARGET_SNAPSHOT_NOT_ACKNOWLEDGED")


def build_snapshot(source, target, page_size):
    tenant_id = native_id(target["tenant_id"], "CONFIG_TENANT_INVALID")
    dictionaries = getattr(source, "dictionaries", None)
    directions = [collect_direction(source, tenant_id, order_type, page_size, dictionaries) for order_type in PATHS]
    return {"action": "channels", "schema_version": 1, "source": "ar_middle", "source_origin": ORIGIN,
            "source_tenant_id": tenant_id, "snapshot_id": str(uuid.uuid4()), "captured_at": utc_now(), "directions": directions}


def resume_pending(store, upload, logger):
    errors = 0
    for payload in store.pending():
        try:
            upload.apply(payload)
            store.acknowledge(payload)
            logger.info("UPLOAD_RETRY_CONFIRMED tenant=%s snapshot=%s original_captured_at=%s", payload["source_tenant_id"], payload["snapshot_id"], payload.get("captured_at", "unknown"))
        except SyncError as exc:
            errors += 1
            logger.warning("UPLOAD_RETAINED tenant=%s code=%s", payload["source_tenant_id"], str(exc))
    return errors


def run_cycle(config, source, upload, store, logger, dry_run=False):
    failures = 0
    if not dry_run:
        resume_pending(store, upload, logger)
    refresh = getattr(source, "refresh_dictionaries", None)
    if callable(refresh):
        refresh(logger)
    for target in config["targets"]:
        if not target["enabled"]:
            continue
        try:
            payload = build_snapshot(source, target, config["page_size"])
            counts = ",".join(f"{d['order_type']}:{d['fetched_count']}" for d in payload["directions"])
            logger.info("SOURCE_COMPLETE tenant=%s channels=%s observed=%s", target["tenant_id"], counts, payload["captured_at"])
            if not dry_run:
                store.save_complete(payload)
                upload.apply(payload)
                store.acknowledge(payload)
                logger.info("UPLOAD_CONFIRMED tenant=%s snapshot=%s", target["tenant_id"], payload["snapshot_id"])
        except SyncError as exc:
            failures += 1
            logger.warning("TENANT_RETAINED tenant=%s code=%s", target["tenant_id"], str(exc))
        except Exception:
            failures += 1
            logger.error("TENANT_RETAINED tenant=%s code=UNEXPECTED_LOCAL_FAILURE", target["tenant_id"])
    # Retried but still unacknowledged snapshots must also make --once nonzero.
    return max(failures, len(store.pending())) if not dry_run else failures


@contextlib.contextmanager
def process_lock(directory):
    path = directory / "collector.lock"
    handle = open(path, "a+b")
    if os.name != "nt": os.chmod(path, 0o600)
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0: handle.write(b" "); handle.flush()
            handle.seek(0)
            try: msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError: raise SyncError("COLLECTOR_ALREADY_RUNNING") from None
        else:
            import fcntl
            try: fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError: raise SyncError("COLLECTOR_ALREADY_RUNNING") from None
        yield
    finally:
        handle.close()


def default_data_dir():
    return Path(__file__).resolve().parent / "data" / "ar-middle"


def init_config(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    config = {"source_origin": ORIGIN, "interval_seconds": INTERVAL, "page_size": 300,
              "min_request_interval_seconds": 1,
              "targets": DEFAULT_TARGETS, "cdp_url": None, "session_file": None,
              "upload_key": "", "ca_bundle": None}
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SyncError("CONFIG_EXISTS_NOT_OVERWRITTEN") from None
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2); handle.write("\n")


def load_config(path):
    validate_private_file(path)
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise SyncError("CONFIG_INVALID") from None
    if not isinstance(config, dict) or config.get("source_origin") != ORIGIN:
        raise SyncError("CONFIG_ORIGIN_OR_INTERVAL_INVALID")
    interval = config.get("interval_seconds", INTERVAL)
    if type(interval) is not int or interval not in (300, 600):
        raise SyncError("CONFIG_ORIGIN_OR_INTERVAL_INVALID")
    config["interval_seconds"] = interval
    page_size = config.get("page_size", 300)
    if type(page_size) is not int or not 1 <= page_size <= 300:
        raise SyncError("CONFIG_PAGE_SIZE_INVALID")
    spacing = config.get("min_request_interval_seconds", 1)
    if isinstance(spacing, bool) or not isinstance(spacing, (int, float)) or not 1 <= spacing <= 10:
        raise SyncError("CONFIG_REQUEST_SPACING_INVALID")
    config["min_request_interval_seconds"] = spacing
    targets = config.get("targets")
    if not isinstance(targets, list) or not targets:
        raise SyncError("CONFIG_TARGETS_REQUIRED")
    seen = set()
    for target in targets:
        if not isinstance(target, dict): raise SyncError("CONFIG_TARGET_INVALID")
        tenant_id = native_id(target.get("tenant_id"), "CONFIG_TENANT_INVALID")
        if tenant_id in seen: raise SyncError("CONFIG_DUPLICATE_TENANT")
        seen.add(tenant_id); target["tenant_id"] = tenant_id
        if not safe_text(target.get("platform_name")): raise SyncError("CONFIG_PLATFORM_NAME_REQUIRED")
        if type(target.get("enabled")) is not bool or type(target.get("verified")) is not bool:
            raise SyncError("CONFIG_TARGET_VERIFICATION_REQUIRED")
        if target["enabled"] and not target["verified"]:
            raise SyncError("CONFIG_UNVERIFIED_TENANT_DISABLED_REQUIRED")
    config["_config_dir"] = path.resolve().parent
    state_dir = Path(config.get("state_dir") or path.parent).expanduser()
    if not state_dir.is_absolute(): state_dir = config["_config_dir"] / state_dir
    config["_state_dir"] = state_dir.resolve()
    config["page_size"] = page_size
    if config.get("ca_bundle"):
        ca = Path(config["ca_bundle"]).expanduser()
        config["ca_bundle"] = str(ca if ca.is_absolute() else config["_config_dir"] / ca)
    return config


def make_logger(directory):
    logger = logging.getLogger("ar_middle_channels")
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)sZ %(levelname)s %(message)s")
    formatter.converter = time.gmtime
    for old in logger.handlers[:]: logger.removeHandler(old); old.close()
    log_path = directory / "sync.log"
    file_handler = RotatingFileHandler(log_path, maxBytes=2_000_000, backupCount=2, encoding="utf-8")
    if os.name != "nt": os.chmod(log_path, 0o600)
    file_handler.setFormatter(formatter); logger.addHandler(file_handler)
    stream = logging.StreamHandler(); stream.setFormatter(formatter); logger.addHandler(stream)
    return logger


def cycle_delay(started, now=None, interval_seconds=INTERVAL):
    elapsed = max(0, (time.monotonic() if now is None else now) - started)
    if elapsed <= interval_seconds: return interval_seconds - elapsed
    # Skip missed ticks after an overrun instead of immediately catching up.
    remainder = elapsed % interval_seconds
    return interval_seconds - remainder if remainder else 0


def auto_login_enabled(config):
    settings = config.get("auto_login")
    if settings is None:
        return False
    if not isinstance(settings, dict) or type(settings.get("enabled", False)) is not bool:
        raise SyncError("AUTO_LOGIN_CONFIG_INVALID")
    return settings.get("enabled", False)


def create_source(config):
    if not auto_login_enabled(config):
        return Source(config)
    # Standalone execution must share this exact core module/SyncError class
    # with the optional login module. Embedded launchers inject their factory.
    if __name__ == "__main__":
        current = sys.modules[__name__]
        if sys.modules.get("ar_middle_channel_sync", current) is not current:
            raise SyncError("AUTO_LOGIN_CORE_MODULE_CONFLICT")
        sys.modules["ar_middle_channel_sync"] = current
    from ar_middle_browser_login import AutoLoginSource
    return AutoLoginSource(config)


def log_startup(logger, config, mode, *, dry_run=False):
    port = validate_cdp_url(config["cdp_url"]).port or 80 if config.get("cdp_url") else "disabled"
    logger.info("COLLECTOR_STARTED version=%s mode=%s cdp_port=%s auto_login_enabled=%s dry_run=%s",
                COLLECTOR_VERSION, mode, port, auto_login_enabled(config), bool(dry_run))


def main(argv=None, *, source_factory=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    for flag in ("init", "check", "once", "loop"):
        action.add_argument("--" + flag, action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Read/validate all source pages without saving snapshots or uploading")
    parser.add_argument("--config", type=Path, default=default_data_dir() / "config.json")
    args = parser.parse_args(argv)
    try:
        if args.init:
            init_config(args.config)
            print("CONFIG_CREATED Set private source session and collector upload key, then run --check.")
            return 0
        config = load_config(args.config)
        directory = config["_state_dir"]
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name != "nt": os.chmod(directory, 0o700)
        logger = make_logger(directory)
        with process_lock(directory):
            source, upload = (source_factory or create_source)(config), Upload(config)
            log_startup(logger, config, "check" if args.check else "loop" if args.loop else "once", dry_run=args.dry_run)
            if args.check:
                if not args.dry_run:
                    result = upload.send({"action": "check", "source": "ar_middle", "source_origin": ORIGIN})
                    if not isinstance(result, dict) or result.get("ok") is not True or result.get("source") != "ar_middle" or result.get("action_scope") != "channels":
                        raise SyncError("TARGET_CHECK_NOT_ACKNOWLEDGED")
                for target in config["targets"]:
                    if not target["enabled"]: continue
                    for order_type in PATHS:
                        response = source.fetch(order_type, request_payload(target["tenant_id"], 1, config["page_size"]))
                        count, pages, _rows, _ids = page_rows(response, order_type, 1, target["tenant_id"], config["page_size"])
                        logger.info("CHECK_OK tenant=%s direction=%s count=%s pages=%s", target["tenant_id"], order_type, count, pages)
                return 0
            store = StateStore(directory)
            try:
                while True:
                    started = time.monotonic()
                    failures = run_cycle(config, source, upload, store, logger, args.dry_run)
                    logger.info("CYCLE_FINISHED failed_tenants=%s interval_seconds=%s dry_run=%s", failures, config["interval_seconds"], args.dry_run)
                    if not args.loop: return 1 if failures else 0
                    time.sleep(cycle_delay(started, interval_seconds=config["interval_seconds"]))
            finally:
                store.close()
    except KeyboardInterrupt:
        print("COLLECTOR_STOPPED Complete local snapshots remain available for restart.")
        return 130
    except SyncError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        print("UNEXPECTED_LOCAL_FAILURE", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
