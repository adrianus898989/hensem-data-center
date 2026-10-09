#!/usr/bin/env python3
"""YASH.BET → Hensem 单文件采集程序（Python 3.11+，无需 pip）。

持续运行并自动补历史：python yash_sync.py --loop
连接本机 Chrome CDP，只读取已打开并登录的 YASH 页面；首次只需确认后台显示时区。
充值、提现从 2026-10-01 补齐，每 10 分钟同步；无需建表或填写数据库密钥。
充值、提现通道也每 10 分钟独立更新；只读取配置，不修改通道或下单测试。
登录过期后在浏览器重新登录；程序会继续重试。配置时区：python yash_sync.py --refresh
只检测：python yash_sync.py --check
只执行一轮后退出：python yash_sync.py --once（失败会返回非零；持续采集直接使用 --loop）

配置和断点统一保存在 ~/Desktop/PY_DATA/yashbet/，脚本目录只需保留本文件；电脑需保持开机联网。
旧版同目录配置与断点会安全迁移；不要分享配置或激活版脚本。
只上传订单与通道业务字段；不上传附件、图片、视频、PDF、银行卡号或订单备注。
通道业务备注经过脱敏，不保留原始 HTML。
"""
from __future__ import annotations

import argparse
import base64
import sys
import tempfile
import contextlib
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import socket
import ssl
import struct
import time
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler, ProxyHandler
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
LOG = logging.getLogger("yash-sync")
COLLECTOR_VERSION = "2026.10.09.6"
# CDP / browser: fixed local debugging endpoint; existing YASH tabs only.
CDP_HTTP = "http://127.0.0.1:9222"
CHECK_INTERVAL_SECONDS = 10
RUN_ON_START = False
YASH_ORIGIN = "https://yash.y-o-admin.com"
MAX_CDP_MESSAGE_BYTES = 32 * 1024 * 1024
YASH_UPLOAD_URL = "https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/yash-order-ingest"
YASH_UPLOAD_TOKEN = "__YASH_UPLOAD_TOKEN__"
MAX_RECEIPT_KEYS = 50000
MAX_REQUEST_BYTES = 12 * 1024 * 1024
MAX_WINDOW_SECONDS = 36 * 3600
MAX_CHANNELS = 2000
# Both streams have a fixed ten-minute cadence, including old configurations.
SYNC_INTERVAL_SECONDS = 600
CHANNEL_INTERVAL_SECONDS = SYNC_INTERVAL_SECONDS
CHANNEL_TABS = {"deposit": "depositChannel", "withdrawal": "withdrawChannel"}
CHANNEL_PATH = "/admin/paymentChannel/config"
CHANNEL_RATE_HEADERS = {
    "近10分钟成功率": "success_rate_10m", "近30分钟成功率": "success_rate_30m",
    "近1小时成功率": "success_rate_1h", "近4小时成功率": "success_rate_4h",
    "近8小时成功率": "success_rate_8h", "近24小时成功率": "success_rate_24h",
    "今日成功率": "success_rate_today", "总成功率": "success_rate_total",
}
RAW_FIELDS = frozenset({
    "UID", "订单号", "子订单号", "三方订单号", "订单状态", "提现状态", "充值金额", "提现金额",
    "手续费", "充值前余额", "提现后余额", "充值总金额", "优惠比例", "下单时间", "申请时间",
    "完成时间", "供应商商户", "支付通道", "支付方式", "提现账户类型", "来源", "充值类型",
    "提现类型", "是否首单", "币种", "货币", "Currency",
})
ENDPOINTS = {"deposit": "/admin/order/index", "withdrawal": "/admin/order/transfer"}
TERMINAL = {
    # Failed/expired orders can be reset or manually confirmed in the supplied UI.
    "deposit": {"充值成功", "用户取消", "人工确认成功"},
    "withdrawal": {"已提现", "已驳回", "已退币", "已罚没", "人工确认成功"},
}


class SyncError(Exception):
    pass


class WindowTooLarge(SyncError):
    pass


def currency_facts(raw):
    """Currency names are evidence; a token channel name alone is not a unit."""
    explicit = [str(raw[key]).strip().upper() for key in ("币种", "货币", "Currency") if raw.get(key)]
    aliases = {"₹": "INR", "印度卢比": "INR", "卢比": "INR", "U": "USDT", "泰达币": "USDT"}
    if explicit:
        values = {aliases.get(value, value) for value in explicit}
        if len(values) == 1 and re.fullmatch(r"[A-Z]{3,5}", next(iter(values))):
            return next(iter(values)), "source_field"
        raise SyncError("原币种字段无效或相互冲突，未推进同步进度")
    markers = " ".join(str(raw.get(key) or "") for key in (
        "供应商商户", "支付通道", "支付方式", "提现账户类型", "来源", "充值类型", "提现类型"))
    if re.search(r"USDT|USDC|TRC\s*20|ERC\s*20|BEP\s*20|(?:充值|提现|支付|收|付)\s*U\b|(?<![A-Za-z])U(?![A-Za-z])|泰达币|虚拟币|数字货币", markers, re.I):
        return None, "token_type_unverified"
    return "INR", "platform_default"


def masked_operator(value):
    text = nullable(value or "")
    if text is None:
        return None
    normalized = " ".join(text.split())
    sensitive = re.search(r"https?://|www\.|[^\s@]+@[^\s@]+|(?:\d[\s().+-]*){7,}", normalized, re.I)
    if sensitive or len(normalized) > 80:
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
        return "operator-" + digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))
    return normalized


def site_zone(name):
    match = re.fullmatch(r"UTC([+-])(\d{2}):(\d{2})", name)
    if match:
        hours, minutes = int(match[2]), int(match[3])
        if hours > 14 or minutes > 59 or (hours == 14 and minutes):
            raise SyncError("无效 UTC 时区偏移")
        offset = timedelta(hours=hours, minutes=minutes)
        return timezone(offset if match[1] == "+" else -offset)
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise SyncError("后台时区无效；Windows 可用 UTC+05:30、UTC+08:00 等固定偏移") from None


class Node:
    def __init__(self, tag="", attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def walk(self, tag=None):
        if tag is None or self.tag == tag:
            yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk(tag)

    def text(self):
        if self.tag in {"script", "style"}:
            return ""
        if self.tag == "br":
            return "\n"
        return "".join(c.text() if isinstance(c, Node) else c for c in self.children)


class TreeParser(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def plain(value):
    parser = TreeParser()
    parser.feed(value)
    return parser.root.text().strip()


def cell_text(node):
    tips = [n.attrs["data-tip"] for n in node.walk() if "data-tip" in n.attrs]
    return "\n".join(plain(t) for t in tips) if tips else " ".join(node.text().split())


def nullable(value):
    return None if value.strip() in {"", "-"} else value.strip()


def money(value, percent=False):
    value = nullable(value)
    if value is None:
        return None
    try:
        result = Decimal(value.replace(",", "").removesuffix("%") if percent else value.replace(",", ""))
        if not result.is_finite():
            raise InvalidOperation
        return format(result, "f")
    except InvalidOperation:
        raise SyncError("发现无法解析的金额/比例；未推进同步进度") from None


def source_time(value, zone):
    value = nullable(value)
    if value is None:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=zone)
        return dt.astimezone(UTC).isoformat()
    except ValueError:
        raise SyncError("发现无法解析的日期；未推进同步进度") from None


@dataclass
class Page:
    rows: list[dict]
    total: int
    pages: int


def channel_note(value):
    """Retain business notes, never source account/contact/authentication details."""
    value = " ".join(value.split())
    value = re.sub(r"(?:密码|密钥|秘钥|口令|令牌|账号|账户|卡号|账户名|姓名|银行|电话|手机|联系人|谷歌验证|password|secret|token|cookie|authorization|api[_ -]?key|account|phone)\s*[:：=]?\s*[^,，;；\n]+", "[已隐藏]", value, flags=re.I)
    value = re.sub(r"https?://\S+|www\.\S+|[^\s@]+@[^\s@]+|@[A-Za-z0-9_]+|(?:\d[\s().+-]*){7,}|[A-Za-z0-9_+/=-]{24,}", "[已隐藏]", value, flags=re.I)
    return nullable(value[:400])


def channel_decimal(value, *, percent=False, signed=False):
    text = nullable(value)
    if text in {None, "—", "--"}:
        return None
    if percent and not text.endswith("%"):
        raise SyncError("通道成功率缺少百分号，未更新通道清单")
    result = money(text, percent=percent)
    number = Decimal(result)
    if (not signed and number < 0) or (percent and number > 100):
        raise SyncError("通道金额/比例超出有效范围，未更新通道清单")
    if number == 0:
        result = format(abs(number), "f")
    if not re.fullmatch(r"-?\d{1,16}(?:\.\d{1,8})?" if signed else r"\d{1,16}(?:\.\d{1,8})?", result):
        raise SyncError("通道金额/比例精度超出上传范围，未更新通道清单")
    return result


def channel_balance(value, *, signed=False):
    """Only an explicit amount suffix proves the balance currency."""
    text = nullable(value)
    if text in {None, "—", "--"}:
        return None, None
    match = re.fullmatch(r"([+-]?[\d,]+(?:\.\d+)?)\s+([A-Za-z]{3,5})", text)
    if match:
        return channel_decimal(match[1], signed=signed), match[2].upper()
    return channel_decimal(text, signed=signed), None


def channel_integer(value):
    text = nullable(value)
    if text in {None, "—", "--"}:
        return None
    if not re.fullmatch(r"\d{1,10}", text) or int(text) > 2147483647:
        raise SyncError("通道计数/优先级/权重格式改变，未更新通道清单")
    return int(text)


def parse_channel_page(html_text, kind):
    if kind not in CHANNEL_TABS:
        raise SyncError("通道业务方向无效")
    parser = TreeParser()
    parser.feed(html_text)
    candidates = []
    for table in parser.root.walk("table"):
        headers = [cell_text(node) for node in table.walk("th")]
        if "通道名称" in headers and "支付供应商" in headers:
            candidates.append((table, headers))
    if len(candidates) != 1:
        raise SyncError("无法识别通道配置表，可能登录过期；通道清单保持原样")
    table, headers = candidates[0]
    required = {"通道名称", "支付供应商", "通道类型", "余额", "优先级", "权重", "状态", "备注", *CHANNEL_RATE_HEADERS}
    required |= {"支付方式", "代收次数要求"} if kind == "deposit" else {"余额阈值"}
    if not required.issubset(headers) or len(set(headers)) != len(headers):
        raise SyncError("通道表头缺失或重复，未更新通道清单")
    limit_headers = []
    for prefix in ("最小交易金额", "最大交易金额"):
        found = [(header, re.fullmatch(re.escape(prefix) + r"[（(]([A-Z]{3,5})[）)]", header)) for header in headers]
        found = [(header, match[1]) for header, match in found if match]
        if len(found) != 1:
            raise SyncError("通道交易限额缺少明确币种，未更新通道清单")
        limit_headers.append(found[0])
    if limit_headers[0][1] != limit_headers[1][1]:
        raise SyncError("通道交易限额币种不一致，未更新通道清单")
    pagers = [node.text() for node in parser.root.walk() if "pager-analysis" in node.attrs.get("class", "").split()]
    if len(pagers) != 1:
        raise SyncError("通道分页信息缺失或含糊，未更新通道清单")
    total_match = re.search(r"总计\s*([\d,]+)\s*条", pagers[0])
    pages_match = re.search(r"共\s*([\d,]+)\s*页", pagers[0])
    if not total_match or not pages_match:
        raise SyncError("通道分页总数无法核验，未更新通道清单")
    total, pages = int(total_match[1].replace(",", "")), int(pages_match[1].replace(",", ""))
    if total > MAX_CHANNELS or pages > MAX_CHANNELS or (total > 0 and pages < 1):
        raise SyncError("通道清单超过上限或分页无效，未更新通道清单")
    rows = []
    for tr in table.walk("tr"):
        cells = [node for node in tr.children if isinstance(node, Node) and node.tag == "td"]
        if not cells:
            continue
        if total == 0 and len(cells) == 1 and cells[0].attrs.get("colspan"):
            continue
        if len(cells) != len(headers):
            raise SyncError("通道行列数不一致，未更新通道清单")
        channel_id = tr.attrs.get("data-id", "")
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", channel_id):
            raise SyncError("通道缺少稳定 ID，未更新通道清单")
        values = {header: cell_text(cell) for header, cell in zip(headers, cells) if header != "操作"}
        balance, balance_currency = channel_balance(values["余额"], signed=True)
        threshold, threshold_currency = channel_balance(values.get("余额阈值", ""))
        status = nullable(values["状态"])
        record = {
            "channel_id": channel_id, "channel_name": nullable(values["通道名称"]),
            "provider": nullable(values["支付供应商"]), "channel_type": nullable(values["通道类型"]),
            "payment_method": nullable(values.get("支付方式", "")),
            "min_amount": channel_decimal(values[limit_headers[0][0]]),
            "max_amount": channel_decimal(values[limit_headers[1][0]]), "limit_currency": limit_headers[0][1],
            "balance": balance, "balance_currency": balance_currency,
            "balance_threshold": threshold, "balance_threshold_currency": threshold_currency,
            "required_deposit_count": channel_integer(values.get("代收次数要求", "")),
            "priority": channel_integer(values["优先级"]), "weight": channel_integer(values["权重"]),
            "status_text": status, "enabled": {"已启用": True, "已禁用": False, "可用": True, "禁用": False}.get(status),
            "notes": channel_note(values["备注"]),
        }
        for field in ("channel_name", "provider", "channel_type", "status_text"):
            if not record[field] or len(record[field]) > 200:
                raise SyncError("通道业务字段缺失或超长，未更新通道清单")
        if record["payment_method"] is not None and len(record["payment_method"]) > 200:
            raise SyncError("通道支付方式超长，未更新通道清单")
        if record["min_amount"] is not None and record["max_amount"] is not None and Decimal(record["min_amount"]) > Decimal(record["max_amount"]):
            raise SyncError("通道最小限额大于最大限额，未更新通道清单")
        record.update({field: channel_decimal(values[header], percent=True) for header, field in CHANNEL_RATE_HEADERS.items()})
        rows.append(record)
    if len(rows) > total or (total == 0 and rows):
        raise SyncError("通道行数与分页不符，未更新通道清单")
    return Page(rows, total, pages)


def parse_page(html_text, order_type, source_site, site_timezone, observed_at):
    parser = TreeParser()
    parser.feed(html_text)
    candidates = []
    for table in parser.root.walk("table"):
        headers = [cell_text(n) for n in table.walk("th")]
        if "UID" in headers and "订单号" in headers:
            candidates.append((table, headers))
    if len(candidates) != 1:
        raise SyncError("响应不是可识别的订单列表；请确认浏览器中的 YASH 页面已登录")
    table, headers = candidates[0]
    required = {"UID", "订单号", "完成时间", "子订单号"}
    required |= {"充值金额", "下单时间", "订单状态"} if order_type == "deposit" else {"提现金额", "手续费", "申请时间", "提现状态"}
    if not required.issubset(headers) or len(set(headers)) != len(headers):
        raise SyncError("订单表头缺失或重复；停止以免错误入库")
    analyses = [n.text() for n in parser.root.walk() if "pager-analysis" in n.attrs.get("class", "").split()]
    pager_text = " ".join(analyses)
    total_match = re.search(r"总计\s*([\d,]+)\s*条", pager_text)
    pages_match = re.search(r"共\s*([\d,]+)\s*页", pager_text)
    if not total_match or not pages_match:
        raise SyncError("响应缺少总条数/总页数，无法确认抓取完整性")
    total, pages = int(total_match[1].replace(",", "")), int(pages_match[1].replace(",", ""))
    zone = site_zone(site_timezone)
    if isinstance(observed_at, datetime):
        observed_at = observed_at.astimezone(UTC).isoformat()
    result = []
    for tr in table.walk("tr"):
        cells = [n for n in tr.children if isinstance(n, Node) and n.tag == "td"]
        if not cells:
            continue
        # Recognize an explicit empty-state row only when the pager agrees.
        if len(cells) == 1 and cells[0].attrs.get("colspan") and total == 0:
            continue
        if len(cells) != len(headers):
            raise SyncError("明细行列数与表头不符；停止以免漏行")
        raw = {h: nullable(cell_text(c)) for h, c in zip(headers, cells) if h in RAW_FIELDS}
        operator = masked_operator(next((cell_text(c) for h, c in zip(headers, cells) if h == "最后操作人"), ""))
        order_no = raw.get("订单号")
        if not order_no or not raw.get("UID"):
            raise SyncError("明细缺少订单号或 UID")
        if len(order_no) > 200:
            raise SyncError("订单号超过上传契约长度，未推进同步进度")
        def value(h):
            return raw.get(h) or ""
        first = raw.get("是否首单")
        if first not in {None, "是", "否"}:
            raise SyncError("无法识别是否首单字段")
        currency, currency_basis = currency_facts(raw)
        result.append({
            "source_site": "yash", "order_type": order_type, "order_no": order_no,
            "uid": raw["UID"], "child_order_no": raw.get("子订单号"),
            "supplier_order_no": raw.get("三方订单号"),
            "status": raw.get("订单状态" if order_type == "deposit" else "提现状态"),
            "amount": money(value("充值金额" if order_type == "deposit" else "提现金额")),
            "fee": money(value("手续费")), "balance_before": money(value("充值前余额")),
            "balance_after": money(value("提现后余额")), "credited_amount": money(value("充值总金额")),
            "discount_percent": money(value("优惠比例"), percent=True),
            "created_at": source_time(value("下单时间" if order_type == "deposit" else "申请时间"), zone),
            "completed_at": source_time(value("完成时间"), zone), "source_timezone": site_timezone,
            "supplier": raw.get("供应商商户"), "channel": raw.get("支付通道"),
            "payment_method": raw.get("支付方式", raw.get("提现账户类型")),
            "source_category": raw.get("来源"), "order_category": raw.get("充值类型", raw.get("提现类型")),
            "is_first_order": None if first is None else first == "是", "raw_fields": {key: value for key, value in raw.items() if value is None or len(value) <= 256},
            "observed_at": observed_at, "currency": currency, "currency_basis": currency_basis,
            "operator": operator,
        })
    if (total == 0 and result) or (total > 0 and pages < 1):
        raise SyncError("分页总数与明细不一致")
    return Page(result, total, pages)


@dataclass
class Config:
    data: dict
    directory: Path

    @classmethod
    def from_file(cls, path):
        path = Path(path).resolve()
        data = json.loads(path.read_text(encoding="utf-8"))
        for key in ("site_timezone", "backfill_start"):
            if not data.get(key) or "REPLACE" in str(data[key]):
                raise SyncError(f"请先配置 {key}")
        site_zone(data["site_timezone"])
        site_zone(data.get("backfill_timezone", "UTC+05:30"))
        datetime.fromisoformat(data["backfill_start"])
        origin = urlsplit(data.get("base_url", "https://yash.y-o-admin.com"))
        if origin.scheme != "https" or origin.netloc != "yash.y-o-admin.com" or origin.path not in {"", "/"}:
            raise SyncError("来源 base_url 必须是 https://yash.y-o-admin.com")
        for key, default, minimum in [("interval_seconds", 600, 60), ("overlap_seconds", 3600, 1), ("window_seconds", 3600, 60), ("page_limit", 1000, 1), ("reconcile_days", 7, 1), ("reconcile_interval_seconds", 86400, 600), ("max_pages", 10000, 1), ("batch_size", 200, 1)]:
            if int(data.get(key, default)) < minimum:
                raise SyncError(f"{key} 配置无效")
        return cls(data, path.parent)

    def get(self, key, default=None):
        return self.data.get(key, default)

    def path(self, key, default=None):
        value = Path(self.get(key, default))
        return value if value.is_absolute() else self.directory / value

    @property
    def zone(self):
        return site_zone(self.get("site_timezone"))

    @property
    def start(self):
        dt = datetime.fromisoformat(self.get("backfill_start"))
        business_zone = site_zone(self.get("backfill_timezone", "UTC+05:30"))
        return (dt if dt.tzinfo else dt.replace(tzinfo=business_zone)).astimezone(UTC)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def upload_tls_context():
    """Python.org macOS installs may have no CA until its installer is run."""
    try:
        context = ssl.create_default_context()
    except (OSError, ssl.SSLError):
        raise SyncError("上传连接：Python 证书配置无法加载，请检查 SSL_CERT_FILE / SSL_CERT_DIR；未上传数据") from None
    explicit = any(os.environ.get(name) for name in ("SSL_CERT_FILE", "SSL_CERT_DIR"))
    if context.cert_store_stats().get("x509_ca", 0) or explicit:
        return context
    candidates = ["/etc/ssl/cert.pem"] if sys.platform == "darwin" else []
    try:
        import certifi  # Optional existing dependency; never install or download a CA.
        candidates.append(certifi.where())
    except ImportError:
        pass
    for candidate in candidates:
        if not isinstance(candidate, str) or not Path(candidate).is_file():
            continue
        try:
            context.load_verify_locations(cafile=candidate)
        except (OSError, ssl.SSLError):
            continue
        if context.cert_store_stats().get("x509_ca", 0):
            return context
    # Hashed certificate directories load certificates on demand.
    if ssl.get_default_verify_paths().capath:
        return context
    raise SyncError("上传连接：Python 没有可用的受信任证书库；请修复 Python 证书安装，断点未推进")


def network_failure(error, purpose):
    """Fixed diagnostic categories only: no proxy URL, headers or raw errors."""
    reason = error.reason if isinstance(error, URLError) else error
    retry = True
    if isinstance(reason, ssl.SSLCertVerificationError):
        detail, retry = "HTTPS 证书校验失败，请检查 Python 证书库、电脑时间及代理证书", False
    elif isinstance(reason, ssl.SSLError):
        detail = "TLS 安全连接未完成"
    elif isinstance(reason, socket.gaierror):
        detail = "域名解析失败，请检查网络、DNS及代理配置"
    elif isinstance(reason, (TimeoutError, socket.timeout)):
        detail = "连接或读取超时，请检查网络及代理配置"
    elif isinstance(reason, ConnectionRefusedError):
        detail = "连接被拒绝，请检查网络及代理是否运行"
    elif isinstance(reason, OSError) and str(reason).startswith("Tunnel connection failed: 407"):
        detail, retry = "代理要求认证，请检查系统或环境变量中的代理配置", False
    else:
        detail = "连接中断，请检查网络及代理配置"
    stage = "Supabase 上传连接" if purpose == "upload" else "读取连接"
    return f"{stage}失败：{detail}；当前窗口进度未推进", retry


def http_request(url, headers, body=None, purpose="source"):
    # Separate request openers prevent source authentication being sent to Supabase.
    opener = build_opener(NoRedirect(), HTTPSHandler(context=upload_tls_context()))
    for attempt in range(4):
        try:
            req = Request(url, data=body, headers=headers)
            with opener.open(req, timeout=60) as resp:
                return resp.read(), resp.headers
        except HTTPError as exc:
            code = exc.code
            exc.close()
            if code == 429 or 500 <= code <= 599:
                if attempt < 3:
                    time.sleep(2 ** attempt * 2)
                    continue
            # Never log URL, response body, headers, or exceptions with credentials.
            if code == 407:
                raise SyncError("上传连接失败：代理要求认证，请检查代理配置；断点未推进") from None
            stage = "Supabase 上传服务" if purpose == "upload" else "读取服务"
            if 500 <= code <= 599:
                raise SyncError(f"{stage}暂时不可用（HTTP {code}）；当前窗口未确认，断点未推进") from None
            if code == 429:
                raise SyncError(f"{stage}限制请求频率（HTTP 429）；当前窗口未确认，断点未推进") from None
            if purpose == "upload":
                if code in (401, 403):
                    raise SyncError(f"上传授权未通过（HTTP {code}）；请核对激活权限，断点未推进") from None
                raise SyncError(f"上传请求未被接受（HTTP {code}）；数据未确认，断点未推进") from None
            raise SyncError(f"读取接口 HTTP {code}；当前窗口进度未推进") from None
        except (URLError, TimeoutError, OSError, HTTPException) as error:
            message, retry = network_failure(error, purpose)
            if retry and attempt < 3:
                time.sleep(2 ** attempt * 2)
                continue
            raise SyncError(message) from None


def yash_tab_url(value):
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        return url.scheme == "https" and url.hostname == "yash.y-o-admin.com" and url.port in (None, 443) and not url.username and not url.password
    except (TypeError, ValueError):
        return False


class LocalCDPSocket:
    """Minimal bounded RFC 6455 client for one existing localhost page target."""
    def __init__(self, debugger_url):
        try:
            url = urlsplit(debugger_url)
            valid = (url.scheme == "ws" and url.hostname == "127.0.0.1" and url.port == 9222
                and not url.username and not url.password and not url.query and not url.fragment
                and re.fullmatch(r"/devtools/page/[A-Za-z0-9_-]{1,128}", url.path))
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise SyncError("CDP 返回了非本机页面连接，已拒绝")
        self.path = url.path
        self.sock = None
        self.buffer = b""
        self.deadline = 0

    def __enter__(self):
        try:
            self.sock = socket.create_connection(("127.0.0.1", 9222), timeout=5)
            self.deadline = time.monotonic() + 5
            key = base64.b64encode(os.urandom(16)).decode("ascii")
            request = (f"GET {self.path} HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
            self.sock.sendall(request.encode("ascii"))
            while b"\r\n\r\n" not in self.buffer:
                if len(self.buffer) > 32768:
                    raise SyncError("CDP 握手响应过长")
                self._receive()
            header, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
            lines = header.decode("iso-8859-1").split("\r\n")
            fields = {}
            for line in lines[1:]:
                name, separator, value = line.partition(":")
                if not separator or name.lower() in fields:
                    raise SyncError("CDP 握手无效")
                fields[name.lower()] = value.strip()
            expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
            if (not re.fullmatch(r"HTTP/1\.[01] 101(?: .*)?", lines[0]) or fields.get("upgrade", "").lower() != "websocket"
                    or "upgrade" not in [part.strip().lower() for part in fields.get("connection", "").split(",")]
                    or fields.get("sec-websocket-accept") != expected or "sec-websocket-extensions" in fields):
                raise SyncError("CDP WebSocket 握手校验失败")
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.sock is not None:
            self.sock.close()
            self.sock = None

    def _receive(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise SyncError("CDP 读取超时，未推进同步进度")
        self.sock.settimeout(remaining)
        chunk = self.sock.recv(65536)
        if not chunk:
            raise SyncError("CDP 页面连接已关闭，请保持 YASH 页面打开")
        self.buffer += chunk

    def _read(self, size):
        while len(self.buffer) < size:
            self._receive()
        result, self.buffer = self.buffer[:size], self.buffer[size:]
        return result

    def _send(self, opcode, payload):
        mask = os.urandom(4)
        size = len(payload)
        if size > MAX_CDP_MESSAGE_BYTES:
            raise SyncError("CDP 请求超过大小上限")
        header = bytes([0x80 | opcode, 0x80 | size]) if size < 126 else bytes([0x80 | opcode, 0x80 | 126]) + struct.pack("!H", size) if size <= 65535 else bytes([0x80 | opcode, 0x80 | 127]) + struct.pack("!Q", size)
        encoded = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.sock.sendall(header + mask + encoded)

    def _message(self):
        fragments = bytearray()
        started = False
        while True:
            if time.monotonic() >= self.deadline:
                raise SyncError("CDP 读取超时")
            first, second = self._read(2)
            final, opcode = bool(first & 0x80), first & 15
            if first & 0x70 or second & 0x80:
                raise SyncError("CDP 帧格式无效")
            size = second & 127
            if size == 126:
                size = struct.unpack("!H", self._read(2))[0]
            elif size == 127:
                size = struct.unpack("!Q", self._read(8))[0]
            if size > MAX_CDP_MESSAGE_BYTES or len(fragments) + size > MAX_CDP_MESSAGE_BYTES:
                raise SyncError("CDP 页面响应过大，未推进同步进度")
            if opcode >= 8 and (not final or size > 125):
                raise SyncError("CDP 控制帧无效")
            payload = self._read(size)
            if opcode == 8:
                raise SyncError("CDP 页面连接已关闭，请保持 YASH 页面打开")
            if opcode == 9:
                self._send(10, payload)
                continue
            if opcode == 10:
                continue
            if opcode == 1 and not started:
                started = True
            elif opcode != 0 or not started:
                raise SyncError("CDP 消息格式无效")
            fragments.extend(payload)
            if final:
                return bytes(fragments).decode("utf-8")

    def evaluate(self, expression):
        self.deadline = time.monotonic() + 70
        self._send(1, json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True, "userGesture": False,
            "timeout": 65000, "disableBreaks": True}}, ensure_ascii=True).encode("utf-8"))
        while time.monotonic() < self.deadline:
            response = json.loads(self._message())
            if not isinstance(response, dict) or response.get("id") != 1:
                continue
            result = response.get("result")
            if response.get("error") or not isinstance(result, dict) or result.get("exceptionDetails"):
                raise SyncError("YASH 浏览器未完成只读请求；页面可能已跳转或执行受限，未推进同步进度")
            value = result.get("result")
            if not isinstance(value, dict):
                raise SyncError("CDP 页面结果格式无效，未推进同步进度")
            return value.get("value")
        raise SyncError("CDP 读取超时")


class CDPClient:
    def target(self):
        # Do not honor proxy env vars or redirects for the loopback debugging endpoint.
        opener = build_opener(ProxyHandler({}), NoRedirect())
        try:
            with opener.open(Request(CDP_HTTP + "/json/list", headers={"Accept": "application/json"}), timeout=5) as response:
                body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                raise SyncError("CDP 标签页目录过大")
            pages = json.loads(body)
        except (OSError, ValueError, HTTPException, URLError):
            raise SyncError("无法连接本机 CDP 127.0.0.1:9222；请打开支持 CDP 的浏览器并登录 YASH") from None
        if not isinstance(pages, list):
            raise SyncError("CDP 标签页目录格式无效")
        candidates = [page for page in pages if isinstance(page, dict) and page.get("type") == "page"
            and yash_tab_url(page.get("url")) and isinstance(page.get("id"), str)
            and isinstance(page.get("webSocketDebuggerUrl"), str)
            and page["webSocketDebuggerUrl"].endswith("/devtools/page/" + page["id"])]
        if not candidates:
            raise SyncError("未找到已打开的 https://yash.y-o-admin.com 页面；不会打开或跳转其他后台")
        return sorted(candidates, key=lambda page: (urlsplit(page["url"]).path in {"/login", "/admin/login"}, page["id"]))[0]["webSocketDebuggerUrl"]

    def get_html(self, path, params):
        if path == CHANNEL_PATH:
            if set(params) != {"tab", "page", "limit"} or params.get("tab") not in CHANNEL_TABS.values():
                raise SyncError("只允许完整通道清单 GET")
        elif path in ENDPOINTS.values():
            required = {"timeType", "startDate", "endDate", "page", "limit"}
            if not required.issubset(params) or set(params) - required - {"orderNo"} or params.get("timeType") not in {"createTime", "completeTime"}:
                raise SyncError("只允许订单列表 GET")
        else:
            raise SyncError("拒绝读取非 YASH 订单或通道配置路径")
        url = YASH_ORIGIN + path + "?" + urlencode(params)
        # No document/cookie reads, DOM writes, tab navigation, clicks or configuration actions.
        expression = """(async()=>{
          if(location.origin !== %s) return {ok:false,code:'wrong_origin'};
          const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);
          try {
            const response=await fetch(%s,{method:'GET',mode:'same-origin',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{Accept:'text/html','X-Requested-With':'XMLHttpRequest'},signal:controller.signal});
            if(location.origin !== %s) return {ok:false,code:'wrong_origin'};
            if(!response.ok) return {ok:false,code:'http_error',status:response.status};
            const type=(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if(type && !['text/html','application/xhtml+xml'].includes(type)) return {ok:false,code:'not_html',mime:type};
            return {ok:true,html:await response.text()};
          } catch (error) { return {ok:false,code:error && error.name==='AbortError'?'read_timeout':'read_failed'}; }
          finally {clearTimeout(timer);}
        })()""" % (json.dumps(YASH_ORIGIN), json.dumps(url), json.dumps(YASH_ORIGIN))
        try:
            with LocalCDPSocket(self.target()) as connection:
                result = connection.evaluate(expression)
        except (OSError, ValueError, HTTPException):
            raise SyncError("本机 CDP 连接中断；请保持 YASH 页面打开，稍后自动重试") from None
        if not isinstance(result, dict) or result.get("ok") is not True or not isinstance(result.get("html"), str):
            # Report only fixed categories and bounded HTTP metadata, never source bodies,
            # headers, exception strings or URLs that may contain authentication details.
            result = result if isinstance(result, dict) else {}
            code = result.get("code")
            reason = "浏览器返回格式无效"
            if code == "wrong_origin":
                reason = "选中的标签页已离开固定 YASH 后台，请保持该页面打开"
            elif code == "http_error":
                status = result.get("status")
                if type(status) is int and 100 <= status <= 599:
                    reason = f"接口 HTTP {status}"
                    if status in (401, 403):
                        reason += "，请在浏览器确认登录及查看权限"
                    elif status == 404:
                        reason += "，源后台未找到该列表地址"
                    elif status == 429:
                        reason += "，源后台限制请求频率"
                else:
                    reason = "接口返回 HTTP 错误"
            elif code == "not_html":
                mime = result.get("mime")
                category = {"application/json": "JSON", "text/plain": "纯文本", "application/octet-stream": "二进制"}.get(mime, "非 HTML") if isinstance(mime, str) else "非 HTML"
                reason = f"接口返回 {category}，并非订单或通道列表；请在浏览器查看该页是否有登录或权限提示"
            elif code == "read_timeout":
                reason = "源后台请求超过 60 秒"
            elif code == "read_failed":
                reason = "浏览器请求失败（网络中断、请求被拦截或发生重定向）；请在浏览器确认该列表能正常打开"
            raise SyncError(f"YASH 读取 {path} 失败：{reason}；未推进同步进度")
        return result["html"]


class SourceClient:
    def __init__(self, cfg):
        self.cfg = cfg
        self.browser = CDPClient()

    def fetch_channels(self, kind, page):
        if kind not in CHANNEL_TABS or not 1 <= page <= MAX_CHANNELS:
            raise SyncError("通道业务或页码无效")
        # Start from a clean query: never retain vendor/type/status filters or actions.
        params = {"tab": CHANNEL_TABS[kind], "page": page, "limit": 1000}
        html_text = self.browser.get_html(CHANNEL_PATH, params)
        time.sleep(float(self.cfg.get("request_delay_seconds", 0.25)))
        return parse_channel_page(html_text, kind)

    def fetch(self, kind, time_type, start, end, page, order_no=None):
        params = {"timeType": time_type, "startDate": start.astimezone(self.cfg.zone).strftime("%Y-%m-%d %H:%M:%S"), "endDate": end.astimezone(self.cfg.zone).strftime("%Y-%m-%d %H:%M:%S"), "page": page, "limit": self.cfg.get("page_limit", 1000)}
        if order_no:
            params["orderNo"] = order_no
        observed = datetime.now(UTC)
        html_text = self.browser.get_html(ENDPOINTS[kind], params)
        time.sleep(float(self.cfg.get("request_delay_seconds", 0.25)))
        result = parse_page(html_text, kind, "yash", self.cfg.get("site_timezone"), observed)
        if result.pages > self.cfg.get("max_pages", 10000):
            raise SyncError("窗口页数超过 max_pages；请缩短 window_seconds")
        return result

    def fetch_order(self, kind, order_no, created_at):
        # Query the original creation day, avoiding the UI's 180-day range restriction.
        created = datetime.fromisoformat(created_at).astimezone(self.cfg.zone)
        start = created.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        page = self.fetch(kind, "createTime", start, end, 1, order_no=order_no)
        if len(page.rows) != page.total or page.total > 1 or any(r["order_no"] != order_no for r in page.rows):
            raise SyncError("旧订单复查响应不符合 orderNo 过滤；请核对请求参数")
        return filter_window(page.rows, "createTime", start, end)


def collect_channels(source, kind, stop=None):
    def fetch(page_no):
        if stop is not None and stop.is_set():
            raise SyncError("通道采集已停止")
        return source.fetch_channels(kind, page_no)
    first = fetch(1)
    if first.total > MAX_CHANNELS or first.pages > MAX_CHANNELS or first.total < 0 or (first.total > 0 and first.pages < 1):
        raise SyncError("通道分页超过上限或无效，未更新通道清单")
    rows = list(first.rows)
    for page_no in range(2, first.pages + 1):
        page = fetch(page_no)
        if (page.total, page.pages) != (first.total, first.pages) or not page.rows:
            raise SyncError("通道分页总数变化或缺页，未更新通道清单")
        rows.extend(page.rows)
    keys = [row["channel_id"] for row in rows]
    if len(rows) != first.total or len(set(keys)) != first.total:
        raise SyncError("通道分页存在重复或缺失 ID，未更新通道清单")
    # Recheck even an empty/single-page response before declaring missing channels.
    confirm = fetch(1)
    if (confirm.total, confirm.pages) != (first.total, first.pages) or [row["channel_id"] for row in confirm.rows] != [row["channel_id"] for row in first.rows]:
        raise SyncError("通道清单在采集过程中变化，未更新通道清单")
    return rows


def channel_sync_cycle(source, target, stop=None, *, check_only=False):
    successful = True
    for kind in CHANNEL_TABS:
        if stop is not None and stop.is_set():
            return False
        try:
            observed = datetime.now(UTC)
            rows = collect_channels(source, kind, stop)
            if stop is not None and stop.is_set():
                return False
            if not check_only:
                target.channels(kind, rows, observed)
            LOG.info("%s %s通道：完整读取 %d 条%s", "检测" if check_only else "同步", "充值" if kind == "deposit" else "提现", len(rows), "" if check_only else "，更新已确认")
        except (SyncError, OSError, ValueError, TypeError, KeyError) as exc:
            successful = False
            if stop is not None and stop.is_set():
                return False
            # No raw rows, notes, headers or exception response bodies in logs.
            reason = str(exc) if isinstance(exc, SyncError) else "本机配置或页面格式异常"
            LOG.error("%s通道未更新：%s；保留原清单，下一轮重试", "充值" if kind == "deposit" else "提现", reason)
    return successful


def poll_channels(cfg, stop):
    # Dedicated clients and no SQLite access keep channel polling independent of backfill.
    source, target = SourceClient(cfg), UploadClient(cfg)
    next_due = time.monotonic() + (0 if RUN_ON_START else CHECK_INTERVAL_SECONDS)
    while wait_until_due(next_due, stop):
        tick = time.monotonic()
        channel_sync_cycle(source, target, stop)
        next_due = tick + CHANNEL_INTERVAL_SECONDS


def wait_until_due(next_due, stop=None):
    while stop is None or not stop.is_set():
        remaining = next_due - time.monotonic()
        if remaining <= 0:
            return True
        delay = min(CHECK_INTERVAL_SECONDS, remaining)
        if stop is not None:
            if stop.wait(delay):
                return False
        else:
            time.sleep(delay)
    return False


@contextlib.contextmanager
def channel_polling(cfg):
    stop = threading.Event()
    worker = threading.Thread(target=poll_channels, args=(cfg, stop), name="yash-channels", daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop.set()
        worker.join(timeout=2)


def collect_window(source, kind, time_type, start, end):
    first = source.fetch(kind, time_type, start, end, 1)
    if first.total > MAX_RECEIPT_KEYS:
        raise WindowTooLarge("窗口超过完整性回执上限，将缩小时间范围")
    rows = list(first.rows)
    for page_no in range(2, first.pages + 1):
        page = source.fetch(kind, time_type, start, end, page_no)
        if (page.total, page.pages) != (first.total, first.pages) or not page.rows:
            raise SyncError("分页总数变化或缺页；窗口将重试，进度未推进")
        rows.extend(page.rows)
    keys = {(row["source_site"], row["order_type"], row["order_no"]) for row in rows}
    if len(rows) != first.total or len(keys) != first.total:
        raise SyncError("分页出现重复/缺失订单；窗口将重试，进度未推进")
    # Fetch page 1 again to detect page shifts during this window.
    if first.pages > 1:
        confirm = source.fetch(kind, time_type, start, end, 1)
        if (confirm.total, confirm.pages) != (first.total, first.pages) or [r["order_no"] for r in confirm.rows] != [r["order_no"] for r in first.rows]:
            raise SyncError("分页过程中排序变化；窗口将重试")
    return filter_window(rows, time_type, start, end)


def filter_window(rows, time_type, start, end):
    """The source end may be inclusive; retain an exact half-open UTC window."""
    key = {"createTime": "created_at", "completeTime": "completed_at"}.get(time_type)
    if not key or start >= end:
        raise SyncError("采集时间窗口无效")
    result = []
    for row in rows:
        try:
            value = datetime.fromisoformat(row.get(key) or "")
            if value.tzinfo is None:
                raise ValueError
        except (TypeError, ValueError):
            raise SyncError("时间视图中的订单缺少可核验时间；未确认完整窗口") from None
        if start <= value < end:
            result.append(row)
    return result


class UploadClient:
    def __init__(self, cfg):
        self.cfg = cfg

    def headers(self):
        if not YASH_UPLOAD_TOKEN or YASH_UPLOAD_TOKEN.startswith("__"):
            raise SyncError("此文件尚未激活，请使用已配置上传权限的交付版脚本")
        return {"X-Yash-Key": YASH_UPLOAD_TOKEN, "Content-Type": "application/json", "Accept": "application/json"}

    def request(self, payload):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(body) > MAX_REQUEST_BYTES:
            raise WindowTooLarge("上传请求超过大小上限，将拆分后重新核验")
        response, _ = http_request(YASH_UPLOAD_URL, self.headers(), body, purpose="upload")
        try:
            result = json.loads(response)
        except (ValueError, UnicodeError):
            raise SyncError("上传接口回执无效，断点未推进") from None
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise SyncError("上传接口未确认成功，断点未推进")
        return result

    def verify(self):
        result = self.request({"action": "check"})
        if result.get("schema_version") != 1 or result.get("source_site") != "yash":
            raise SyncError("上传接口未确认 YASH 数据范围，请重新获取激活版脚本")

    def channels(self, kind, rows, observed):
        keys = [row["channel_id"] for row in rows]
        if kind not in CHANNEL_TABS or len(rows) > MAX_CHANNELS or len(set(keys)) != len(rows):
            raise SyncError("通道快照格式或完整性无效，清单保持原样")
        # A full snapshot is atomic: never split it into batches that mark others missing.
        result = self.request({"action": "channels", "schema_version": 1, "snapshot_id": str(uuid.uuid4()),
            "order_type": kind, "observed_at": observed.isoformat(), "source_count": len(rows),
            "fetched_count": len(rows), "records": rows})
        if (result.get("snapshot_applied") is not True or type(result.get("accepted")) is not int
                or result["accepted"] != len(rows) or type(result.get("source_count")) is not int
                or result["source_count"] != len(rows)):
            raise SyncError("通道完整快照未确认更新，下一轮重新采集")

    def upsert(self, rows):
        size = min(500, int(self.cfg.get("batch_size", 200)))
        def upload_batch(batch):
            try:
                result = self.request({"action": "ingest", "schema_version": 1, "batch_id": str(uuid.uuid4()), "records": batch})
            except WindowTooLarge:
                if len(batch) <= 1:
                    raise SyncError("单笔订单超出请求大小上限，未推进断点") from None
                middle = len(batch) // 2
                upload_batch(batch[:middle])
                upload_batch(batch[middle:])
                return
            if type(result.get("accepted")) is not int or result["accepted"] != len(batch):
                raise SyncError("订单上传笔数未全部确认，断点未推进")
        for i in range(0, len(rows), size):
            upload_batch(rows[i:i + size])

    def receipt(self, kind, stream, start, end, rows, snapshot_at):
        keys = [row["order_no"] for row in rows]
        if any(not isinstance(key, str) or not key or len(key) > 200 for key in keys):
            raise SyncError("回执订单号格式不符合契约")
        if len(keys) > MAX_RECEIPT_KEYS or len(set(keys)) != len(keys):
            raise SyncError("窗口订单号重复或超过完整性回执上限")
        result = self.request({"action": "receipt", "schema_version": 1, "window_id": str(uuid.uuid4()),
            "order_type": kind, "stream": stream, "start_at": start.isoformat(), "end_exclusive": end.isoformat(),
            "source_count": len(keys), "order_keys": keys, "snapshot_at": snapshot_at.isoformat(), "source_timezone": self.cfg.get("site_timezone")})
        if result.get("verified") is not True or type(result.get("source_count")) is not int or result["source_count"] != len(keys):
            raise SyncError("完整窗口核验未通过，断点未推进；下轮会重新核对")


class State:
    def __init__(self, path, namespace):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.namespace = namespace
        self.db.execute("create table if not exists progress (namespace text, name text, value text, primary key(namespace,name))")
        self.db.execute("create table if not exists watched (namespace text, kind text, order_no text, created_at text, checked_at text not null default '', primary key(namespace,kind,order_no))")
        self.db.commit()

    def get(self, name):
        row = self.db.execute("select value from progress where namespace=? and name=?", (self.namespace, name)).fetchone()
        return row[0] if row else None

    def set(self, name, value):
        self.db.execute("insert into progress values (?,?,?) on conflict(namespace,name) do update set value=excluded.value", (self.namespace, name, value))
        self.db.commit()

    def close(self):
        self.db.close()

    def track(self, rows):
        for row in rows:
            key = (self.namespace, row["order_type"], row["order_no"])
            if row["status"] in TERMINAL[row["order_type"]]:
                self.db.execute("delete from watched where namespace=? and kind=? and order_no=?", key)
            elif row["created_at"]:
                self.db.execute("insert into watched (namespace,kind,order_no,created_at) values (?,?,?,?) on conflict(namespace,kind,order_no) do update set created_at=excluded.created_at", (*key, row["created_at"]))
        self.db.commit()

    def pending(self, limit):
        return self.db.execute("select kind,order_no,created_at from watched where namespace=? order by checked_at,created_at limit ?", (self.namespace, limit)).fetchall()

    def mark_checked(self, kind, order_no):
        self.db.execute("update watched set checked_at=? where namespace=? and kind=? and order_no=?", (datetime.now(UTC).isoformat(), self.namespace, kind, order_no))
        self.db.commit()


@contextlib.contextmanager
def process_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a+b") as handle:
        handle.seek(0)
        if not handle.read(1):
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise SyncError("已有一个同步进程运行，请勿重复启动") from None
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def window_sync(source, target, cfg, kind, mode, start, end):
    if end - start > timedelta(seconds=MAX_WINDOW_SECONDS):
        middle = start + timedelta(seconds=int((end - start).total_seconds()) // 2)
        return window_sync(source, target, cfg, kind, mode, start, middle) + window_sync(source, target, cfg, kind, mode, middle, end)
    last = None
    for attempt in range(3):
        try:
            rows = collect_window(source, kind, mode, start, end)
            snapshot_at = datetime.now(UTC)
            target.upsert(rows)
            target.receipt(kind, mode, start, end, rows, snapshot_at)
            LOG.info("%s %s 窗口 %s..%s：%d 条已入库并核验", kind, mode, start.isoformat(), end.isoformat(), len(rows))
            return rows
        except WindowTooLarge:
            seconds = int((end - start).total_seconds())
            if seconds <= 1:
                raise SyncError("一秒窗口仍超过回执上限，未推进断点，请联系维护人员") from None
            middle = start + timedelta(seconds=seconds // 2)
            return window_sync(source, target, cfg, kind, mode, start, middle) + window_sync(source, target, cfg, kind, mode, middle, end)
        except SyncError as exc:
            last = exc
            if "分页" not in str(exc):
                raise
            time.sleep(2 ** attempt)
    raise last


def run_cycle(cfg, state, source, target, budget_seconds=None):
    deadline = time.monotonic() + budget_seconds if budget_seconds else float("inf")
    target.verify()
    now = datetime.now(UTC).replace(microsecond=0) - timedelta(seconds=int(cfg.get("settle_seconds", 60)))
    if cfg.start > now:
        raise SyncError("补抓开始日期晚于当前可抓取时间")
    width = timedelta(seconds=int(cfg.get("window_seconds", 3600)))
    positions = {}
    for kind in ENDPOINTS:
        for mode in ("createTime", "completeTime"):
            name = f"{kind}/{mode}"
            checkpoint = state.get(name)
            cursor = datetime.fromisoformat(checkpoint) if checkpoint else cfg.start
            overlap = timedelta(seconds=int(cfg.get("overlap_seconds", 3600)))
            # Rewind only when near the current head; historical cursors must make forward progress.
            positions[(kind, mode)] = max(cfg.start, cursor - overlap) if cursor >= now - overlap else cursor
    if budget_seconds and any(start < now - width for start in positions.values()):
        LOG.info("先同步当前窗口，历史补抓按保存进度分批继续")
        for kind in ENDPOINTS:
            for mode in ("createTime", "completeTime"):
                rows = window_sync(source, target, cfg, kind, mode, max(cfg.start, now - timedelta(seconds=int(cfg.get("overlap_seconds", 3600)))), now)
                state.track(rows)
    pending = state.pending(int(cfg.get("pending_checks_per_cycle", 200)))
    checked = 0
    pending_deadline = min(deadline, time.monotonic() + budget_seconds * 0.15) if budget_seconds else deadline
    for kind, order_no, created_at in pending:
        if time.monotonic() >= pending_deadline:
            break
        rows = source.fetch_order(kind, order_no, created_at)
        target.upsert(rows)
        state.track(rows)
        state.mark_checked(kind, order_no)
        checked += 1
    LOG.info("本轮复查 %d 笔未完成旧订单（分批轮询）", checked)
    # Round robin, with durable cursors per time view, gives every stream backfill time.
    while any(start < now for start in positions.values()):
        for (kind, mode), start in list(positions.items()):
            if start >= now:
                continue
            end = min(start + width, now)
            rows = window_sync(source, target, cfg, kind, mode, start, end)
            state.track(rows)
            # Both page reads and all write batches must succeed before committing.
            state.set(f"{kind}/{mode}", end.isoformat())
            positions[(kind, mode)] = end
            if time.monotonic() >= deadline:
                LOG.info("本轮补抓时间用完，下轮先同步当前窗口再从断点继续")
                return
    # Daily replay catches status edits without completeTime inside this configured horizon.
    last = state.get("reconcile")
    # Initial backfill has already replayed every creation window.
    due = last is not None and (now - datetime.fromisoformat(last)).total_seconds() >= int(cfg.get("reconcile_interval_seconds", 86400))
    planned_end = state.get("reconcile_target")
    if due and not planned_end:
        planned_end = now.isoformat()
        start = max(cfg.start, now - timedelta(days=int(cfg.get("reconcile_days", 7))))
        for kind in ENDPOINTS:
            state.set(f"reconcile/{kind}", start.isoformat())
        state.set("reconcile_target", planned_end)
    if planned_end:
        reconcile_end = datetime.fromisoformat(planned_end)
        for kind in ENDPOINTS:
            start = datetime.fromisoformat(state.get(f"reconcile/{kind}"))
            while start < reconcile_end:
                end = min(start + width, reconcile_end)
                rows = window_sync(source, target, cfg, kind, "createTime", start, end)
                state.track(rows)
                state.set(f"reconcile/{kind}", end.isoformat())
                start = end
                if time.monotonic() >= deadline:
                    LOG.info("每日复查分批进行，下轮按断点继续")
                    return
        state.set("reconcile", planned_end)
        state.set("reconcile_target", "")
    elif last is None:
        state.set("reconcile", now.isoformat())
    LOG.info("本轮完成；充值、提现四个时间视图已追平")


def application_data_directory():
    return Path.home() / "Desktop" / "PY_DATA" / "yashbet"


def previous_application_data_directory():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "YASHBET"
    variable, fallback = ("LOCALAPPDATA", Path.home() / "AppData" / "Local") if sys.platform == "win32" else ("XDG_STATE_HOME", Path.home() / ".local" / "state")
    configured = Path(os.environ.get(variable, "")).expanduser()
    return (configured if configured.is_absolute() else fallback) / "YASHBET"


DEFAULT_CONFIG = application_data_directory() / "yash_sync_config.json"
LEGACY_CONFIG = Path(__file__).resolve().with_name("yash_sync_config.json")
PREVIOUS_CONFIG = previous_application_data_directory() / "yash_sync_config.json"


def private_json(path, data):
    fd, temporary = tempfile.mkstemp(prefix=".yash-config-", dir=path.parent)
    try:
        if os.name != "nt":
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def migrate_legacy_config(destination, legacy=None):
    """Caller holds the new storage lock; never overwrite or merge existing state."""
    legacy = LEGACY_CONFIG if legacy is None else Path(legacy)
    destination = Path(destination)
    if legacy == destination or not legacy.exists():
        return False
    if destination.exists():
        LOG.info("已使用 PY_DATA/yashbet 配置；旧目录文件保留，不覆盖已有断点")
        return False
    if legacy.is_symlink():
        raise SyncError("旧配置是链接，未自动搬移；原文件保持不变")
    legacy = legacy.parent.resolve() / legacy.name
    cfg = Config.from_file(legacy)
    source_state = cfg.path("state_file", "state/progress.sqlite3")
    source_lock = cfg.path("lock_file", "state/sync.lock")
    # Only known files from this collector's old defaults are eligible for removal.
    allowed_states = {legacy.parent / name / "progress.sqlite3" for name in ("state", "yash_sync_state")}
    allowed_locks = {legacy.parent / name / "sync.lock" for name in ("state", "yash_sync_state")}
    if (source_state.absolute() not in allowed_states or source_lock.absolute() not in allowed_locks
            or any(path.is_symlink() or path.parent.is_symlink() for path in (source_state, source_lock))
            or any(Path(str(source_state) + suffix).is_symlink() for suffix in ("-wal", "-shm", "-journal"))):
        raise SyncError("检测到自定义或链接断点路径，未自动搬移；旧文件保持不变，可继续使用 --config 指定旧配置")
    target_state = destination.parent / "state" / "progress.sqlite3"
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    published = []
    committed = False
    with process_lock(source_lock):
        original = legacy.read_bytes()
        # A concurrent old --refresh does not take its process lock; reject changed config.
        if json.loads(original) != cfg.data:
            raise SyncError("旧配置正在变化，未搬移；请先停止旧版程序后重试")
        if destination.exists() or any(Path(str(target_state) + suffix).exists() for suffix in ("", "-wal", "-shm", "-journal")):
            raise SyncError("PY_DATA/yashbet 已有配置或断点，未覆盖；旧文件保持不变")
        if not source_state.exists() and any(Path(str(source_state) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
            raise SyncError("旧断点主文件缺失但仍有日志，未搬移；请保留旧目录")
        with tempfile.TemporaryDirectory(prefix=".yash-migrate-", dir=destination.parent) as staging:
            staged_state = Path(staging) / "progress.sqlite3"
            staged_config = Path(staging) / "config.json"
            try:
                if source_state.exists():
                    # Hold the writer reservation while backup reads committed WAL pages.
                    # A byte copy/rename of only the .sqlite3 file would lose that progress.
                    with contextlib.closing(sqlite3.connect(source_state, timeout=0, isolation_level=None)) as guard:
                        guard.execute("begin immediate")
                        try:
                            with contextlib.closing(sqlite3.connect(source_state.as_uri() + "?mode=ro", uri=True, timeout=0)) as reader, contextlib.closing(sqlite3.connect(staged_state)) as copy:
                                deadline = time.monotonic() + 30
                                def backup_progress(status, remaining, total):
                                    if status in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED) or time.monotonic() > deadline:
                                        raise SyncError("旧断点正在使用或迁移超时，未搬移；请先停止旧版程序")
                                reader.backup(copy, pages=256, progress=backup_progress)
                                if copy.execute("pragma quick_check").fetchall() != [("ok",)]:
                                    raise SyncError("旧断点完整性检查未通过，未搬移；请保留旧目录")
                        finally:
                            guard.execute("rollback")
                        checkpoint = guard.execute("pragma wal_checkpoint(truncate)").fetchone()
                        if checkpoint and checkpoint[0] != 0:
                            raise SyncError("旧断点仍有活动读取，未搬移；请先停止旧版程序")
                    if os.name != "nt":
                        staged_state.chmod(0o600)
                data = dict(cfg.data)
                data.update(state_file="state/progress.sqlite3", lock_file="state/sync.lock")
                for key in ("supabase_url", "supabase_secret_key", "secrets_file", "table", "source_headers", "headers_file"):
                    data.pop(key, None)
                private_json(staged_config, data)
                if legacy.read_bytes() != original:
                    raise SyncError("旧配置正在变化，未搬移；请先停止旧版程序后重试")
                if staged_state.exists():
                    target_state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    # Exclusive publication also protects against an unexpected existing file.
                    os.link(staged_state, target_state)
                    published.append(target_state)
                os.link(staged_config, destination)
                published.append(destination)
                committed = True
            except sqlite3.Error:
                raise SyncError("旧断点正在使用或无法完整读取，未搬移；原配置和断点保持不变") from None
            finally:
                if not committed:
                    for path in reversed(published):
                        path.unlink()
        # Only remove originals after both new files are fully committed and checked.
        legacy.unlink()
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(str(source_state) + suffix).unlink(missing_ok=True)
    source_lock.unlink(missing_ok=True)
    for directory in {source_state.parent, source_lock.parent}:
        try:
            directory.rmdir()  # Keep any unrelated files in the old directory.
        except OSError:
            pass
    LOG.info("配置与断点已迁至 ~/Desktop/PY_DATA/yashbet/，原时区和全部同步进度已保留")
    return True


def migrate_previous_locations(destination):
    """Recognize the two shipped layouts without choosing between conflicting histories."""
    destination = Path(destination)
    candidates = {}
    for location in (LEGACY_CONFIG, PREVIOUS_CONFIG):
        location = Path(location)
        resolved = location.resolve()
        has_state = any((location.parent / name / ("progress.sqlite3" + suffix)).exists()
            for name in ("state", "yash_sync_state") for suffix in ("", "-wal", "-shm", "-journal"))
        if resolved != destination.resolve() and (location.exists() or has_state):
            candidates[resolved] = location
    if not candidates:
        return False
    if destination.exists():
        LOG.info("已使用 PY_DATA/yashbet 配置；旧目录文件保留，不覆盖已有断点")
        return False
    if len(candidates) != 1:
        raise SyncError("脚本旁和旧应用目录都存在 YASH 配置或进度，未自动选择或合并；两处原文件均保留")
    location = next(iter(candidates.values()))
    if not location.exists():
        raise SyncError("旧目录有 YASH 断点但缺少配置，未新建或合并进度；请保留旧文件")
    if location.resolve() == PREVIOUS_CONFIG.resolve():
        # Version .3 holds this outer lock even during setup/refresh before sync.lock.
        old_storage_lock = location.parent / "storage.lock"
        with process_lock(old_storage_lock):
            migrated = migrate_legacy_config(destination, location)
        if migrated:
            old_storage_lock.unlink(missing_ok=True)
            try:
                location.parent.rmdir()
            except OSError:
                pass  # Any unrelated files still belong to the user.
        return migrated
    return migrate_legacy_config(destination, location)



def prepare_config(path, refresh=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if refresh:
        if not path.exists():
            raise SyncError("尚未配置；直接运行 python yash_sync.py 完成首次配置")
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        if path.exists():
            raise SyncError("配置已存在；直接运行开始同步，修改时区用 --refresh")
        print("YASH.BET → Hensem；充值+提现从印度时间 2026-10-01 零点补齐；订单和两类通道均每10分钟独立更新。")
        print("上传范围已固定，无需建表或填写数据库密钥。")
        data = {
            "base_url": "https://yash.y-o-admin.com", "backfill_start": "2026-10-01 00:00:00", "backfill_timezone": "UTC+05:30",
            "interval_seconds": SYNC_INTERVAL_SECONDS, "page_limit": 1000,
            "window_seconds": 3600, "overlap_seconds": 3600, "settle_seconds": 60,
            "reconcile_days": 7, "reconcile_interval_seconds": 86400,
            "pending_checks_per_cycle": 200, "cycle_budget_seconds": 480,
            "request_delay_seconds": 0.25, "batch_size": 200, "max_pages": 10000,
            "state_file": "state/progress.sqlite3", "lock_file": "state/sync.lock",
        }
    print("只连接 http://127.0.0.1:9222 中已打开的 https://yash.y-o-admin.com；请在浏览器登录，无需复制请求或 Cookie。")
    print("后台时区请确认：印度时间可填 UTC+05:30，中国时间可填 UTC+08:00。")
    zone = input("后台显示时区（固定 UTC 偏移或 IANA 名称" + ("，回车保留现有配置" if refresh else "") + "）：").strip()
    if not zone and refresh:
        zone = data.get("site_timezone", "")
    site_zone(zone)
    data["site_timezone"] = zone
    # The CDP collector does not read or retain source credentials or project DB keys.
    for key in ("supabase_url", "supabase_secret_key", "secrets_file", "table", "source_headers", "headers_file"):
        data.pop(key, None)
    private_json(path, data)
    print("时区配置已更新，原时区断点保留。" if refresh else "配置已保存；启动后先等10秒检查，再按订单/通道各自周期同步。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--setup", action="store_true", help="首次配置后退出")
    group.add_argument("--refresh", action="store_true", help="确认/修改后台显示时区；登录由浏览器管理")
    group.add_argument("--check", action="store_true", help="只读检测来源和 Supabase，不写入")
    group.add_argument("--once", action="store_true", help="补抓/同步一轮，完成后退出")
    group.add_argument("--loop", action="store_true", help="订单和通道均每10分钟更新；自动补抓历史，临时失败保留断点并继续")
    args = parser.parse_args()
    if not (args.check or args.once or args.setup or args.refresh):
        args.loop = True
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    LOG.info("YASH CDP 版本 %s · 固定本机9222 · 只读采集", COLLECTOR_VERSION)
    state = None
    resources = contextlib.ExitStack()
    try:
        UploadClient(None).headers()
        config_path = Path(args.config).expanduser().resolve()
        if config_path == DEFAULT_CONFIG.resolve():
            resources.enter_context(process_lock(config_path.parent / "storage.lock"))
            migrate_previous_locations(config_path)
        if args.refresh:
            prepare_config(config_path, refresh=True)
            return 0
        if args.setup:
            prepare_config(config_path)
            return 0
        if not config_path.exists():
            prepare_config(config_path)
        cfg = Config.from_file(config_path)
        source, target = SourceClient(cfg), UploadClient(cfg)
        resources.enter_context(process_lock(cfg.path("lock_file", "state/sync.lock")))
        if args.check:
            target.verify()
            end = datetime.now(UTC).replace(microsecond=0) - timedelta(seconds=int(cfg.get("settle_seconds", 60)))
            start = max(cfg.start, end - timedelta(minutes=10))
            if start > end:
                raise SyncError("补抓开始日期在未来")
            for kind in ENDPOINTS:
                for mode in ("createTime", "completeTime"):
                    page = source.fetch(kind, mode, start, end, 1)
                    LOG.info("检测 %s %s：第一页 %d 条，窗口共 %d 条/%d 页", kind, mode, len(page.rows), page.total, page.pages)
            LOG.info("激活接口和后台订单读取检测通过；每个完整窗口入库后继续核验笔数")
            if args.check:
                return 0 if channel_sync_cycle(source, target, check_only=True) else 1
        identity = [YASH_UPLOAD_URL, "schema_version:1", cfg.get("base_url"), cfg.get("site_timezone"), cfg.get("backfill_start"), cfg.get("backfill_timezone", "UTC+05:30")]
        namespace = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
        state = State(cfg.path("state_file", "state/progress.sqlite3"), namespace)
        channels_ok = channel_sync_cycle(source, target) if args.once else True
        with channel_polling(cfg) if args.loop else contextlib.nullcontext():
            next_due = time.monotonic() + (0 if args.once or RUN_ON_START else CHECK_INTERVAL_SECONDS)
            if args.loop:
                LOG.info("CDP 固定本机9222，只读取 YASH；每%d秒检查，启动立即采集=%s；订单和通道均每10分钟更新（旧配置也适用）", CHECK_INTERVAL_SECONDS, RUN_ON_START)
            while wait_until_due(next_due):
                tick = time.monotonic()
                try:
                    run_cycle(cfg, state, source, target, budget_seconds=int(cfg.get("cycle_budget_seconds", 480)) if args.loop else None)
                except (SyncError, OSError, ValueError) as exc:
                    message = str(exc) if isinstance(exc, SyncError) else "配置/编码/本地文件无效，请检查配置和文件权限"
                    LOG.error("%s", message)
                    if args.once:
                        return 1
                    LOG.info("持续同步仍在运行：未完成窗口保留原断点，下一轮自动重试；通道独立按10分钟周期更新")
                if args.once:
                    return 0 if channels_ok else 1
                next_due = tick + SYNC_INTERVAL_SECONDS
                LOG.info("订单本轮结束，通道继续独立刷新；登录过期请在浏览器重新登录 YASH")
    except EOFError:
        LOG.error("首次配置需要交互输入；请在终端运行 python yash_sync.py")
        return 1
    except sqlite3.Error:
        LOG.error("本地状态库不可用，已停止；检查磁盘/权限，请保留 state 目录")
        return 1
    except (SyncError, OSError, ValueError) as exc:
        LOG.error("%s", str(exc) if isinstance(exc, SyncError) else "配置/文件无效，请运行 python yash_sync.py --setup")
        return 1
    except KeyboardInterrupt:
        LOG.info("已停止；下次启动按保存进度继续")
        return 0
    finally:
        try:
            if state:
                state.close()
        finally:
            resources.close()


if __name__ == "__main__":
    raise SystemExit(main())
