#!/usr/bin/env python3
"""YASH.BET → Hensem 单文件采集程序（Python 3.11+，无需 pip）。

直接运行：python yash_sync.py
首次激活只需粘贴后台订单列表 Copy as cURL (bash)，确认后台显示时区。
充值、提现从 2026-10-01 补齐，每 10 分钟同步；无需建表或填写数据库密钥。
登录过期：python yash_sync.py --refresh
只检测：python yash_sync.py --check
补齐一轮：python yash_sync.py --once

配置和断点自动保存到本机，电脑需保持开机联网；不要分享配置或激活版脚本。
只上传订单业务字段，不上传附件、图片、视频、PDF、银行卡号或备注。
"""
from __future__ import annotations

import argparse
import shlex
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
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
LOG = logging.getLogger("yash-sync")
YASH_UPLOAD_URL = "https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/yash-order-ingest"
YASH_UPLOAD_TOKEN = "__YASH_UPLOAD_TOKEN__"
MAX_RECEIPT_KEYS = 50000
MAX_REQUEST_BYTES = 12 * 1024 * 1024
MAX_WINDOW_SECONDS = 36 * 3600
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


def parse_page(html_text, order_type, source_site, site_timezone, observed_at):
    parser = TreeParser()
    parser.feed(html_text)
    candidates = []
    for table in parser.root.walk("table"):
        headers = [cell_text(n) for n in table.walk("th")]
        if "UID" in headers and "订单号" in headers:
            candidates.append((table, headers))
    if len(candidates) != 1:
        raise SyncError("响应不是可识别的订单列表，可能登录已过期或页面格式改变；请重新复制 cURL")
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
        for key in ("site_timezone", "backfill_start", "headers_file"):
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


def http_request(url, headers, body=None, purpose="source"):
    # Separate request openers prevent source authentication being sent to Supabase.
    opener = build_opener(NoRedirect())
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
            if purpose == "upload":
                raise SyncError(f"上传接口 HTTP {code}；激活权限或数据确认失败，断点未推进") from None
            raise SyncError(f"后台 HTTP {code}；登录过期请运行 --refresh 更新登录请求") from None
        except (URLError, TimeoutError, OSError, HTTPException):
            if attempt < 3:
                time.sleep(2 ** attempt * 2)
                continue
            raise SyncError("网络请求失败；当前窗口进度未推进") from None


class SourceClient:
    def __init__(self, cfg):
        self.cfg = cfg

    def fetch(self, kind, time_type, start, end, page, order_no=None):
        document = json.loads(self.cfg.path("headers_file").read_text(encoding="utf-8"))
        document = document.get("source_headers", document)
        headers = document.get(kind, document.get("default", document))
        headers = {k: str(v) for k, v in headers.items()}
        for k, v in headers.items():
            if "\n" in v or "\r" in v:
                raise SyncError("请求头存在换行，请运行 python yash_sync.py --refresh")
        headers.setdefault("Accept", "text/html")
        headers.setdefault("X-Requested-With", "XMLHttpRequest")
        params = {"timeType": time_type, "startDate": start.astimezone(self.cfg.zone).strftime("%Y-%m-%d %H:%M:%S"), "endDate": end.astimezone(self.cfg.zone).strftime("%Y-%m-%d %H:%M:%S"), "page": page, "limit": self.cfg.get("page_limit", 1000)}
        if order_no:
            params["orderNo"] = order_no
        url = self.cfg.get("base_url", "https://yash.y-o-admin.com").rstrip("/") + ENDPOINTS[kind] + "?" + urlencode(params)
        observed = datetime.now(UTC)
        body, response_headers = http_request(url, headers)
        if "json" in response_headers.get("Content-Type", ""):
            raise SyncError("来源返回 JSON，可能登录过期；此版本按附件 HTML 解析")
        html_text = body.decode(response_headers.get_content_charset() or "utf-8", errors="strict")
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
    path.parent.mkdir(parents=True, exist_ok=True)
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


DEFAULT_CONFIG = Path(__file__).resolve().with_name("yash_sync_config.json")

def import_curl(text):
    # Request bash-format even on Windows: it avoids PowerShell/cmd quoting ambiguity.
    tokens = shlex.split(text.replace("\\\r\n", "").replace("\\\n", ""))
    if not tokens or tokens[0] != "curl":
        raise SyncError("请使用 DevTools 的 Copy as cURL (bash)，不是 Response 或 PowerShell 格式")
    urls, headers = [], {}
    i = 1
    while i < len(tokens):
        token = tokens[i]
        if token in {"-H", "--header", "-b", "--cookie", "--url", "-X", "--request"}:
            if i + 1 >= len(tokens):
                raise SyncError("cURL 参数不完整")
            value = tokens[i + 1]
            i += 2
            if token in {"-H", "--header"}:
                name, sep, content = value.partition(":")
                if not sep or not name.strip():
                    raise SyncError("cURL 请求头格式错误")
                headers[name.strip().lower()] = content.strip()
            elif token in {"-b", "--cookie"}:
                if "=" not in value:
                    raise SyncError("不支持 Cookie 文件路径；请复制包含 Cookie 值的请求")
                headers["cookie"] = value
            elif token == "--url":
                urls.append(value)
            elif value.upper() != "GET":
                raise SyncError("这里只导入订单列表 GET 请求")
        elif token.startswith(("https://", "http://")):
            urls.append(token)
            i += 1
        elif token in {"--compressed", "--globoff", "-s", "--silent"}:
            i += 1
        else:
            # Do not execute shell operators, body arguments or unknown flags.
            raise SyncError("cURL 含不支持的参数，请重新复制订单列表 GET 请求（bash 格式）")
    if len(urls) != 1:
        raise SyncError("cURL 必须只包含一个 URL")
    url = urlsplit(urls[0])
    if url.scheme != "https" or url.netloc != "yash.y-o-admin.com" or url.path not in {"/admin/order/index", "/admin/order/transfer"}:
        raise SyncError("请选中 index? 或 transfer? 订单列表请求，不要选 JS 或登录请求")
    # urllib handles transfer framing itself; compression is deliberately not requested.
    omit = {"host", "content-length", "connection", "accept-encoding", "content-type"}
    headers = {k: v for k, v in headers.items() if k not in omit and not k.startswith(":")}
    if not any(k in headers for k in ("cookie", "authorization", "x-auth-token", "x-token")):
        raise SyncError("cURL 没有 Cookie/鉴权头；复制时请包含请求头")
    if any("\n" in v or "\r" in v for v in headers.values()):
        raise SyncError("请求头含换行")
    return headers


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


def read_request(prompt):
    print(prompt)
    print("Chrome Network 中右键 index? 或 transfer? → Copy as cURL (bash)。")
    print("直接粘贴全部内容，然后单独输入 END 并回车；也可输入已保存的文件路径。")
    first = input().strip()
    if not first:
        raise SyncError("未输入请求")
    if not first.startswith("curl"):
        path = Path(first.strip('"')).expanduser()
        return import_curl(path.read_text(encoding="utf-8-sig"))
    lines = [first]
    while True:
        line = input()
        if line.strip() == "END":
            break
        lines.append(line)
    return import_curl("\n".join(lines))


def prepare_config(path, refresh=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if refresh:
        if not path.exists():
            raise SyncError("尚未配置；直接运行 python yash_sync.py 完成首次配置")
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        if path.exists():
            raise SyncError("配置已存在；直接运行开始同步，更新 Cookie 用 --refresh")
        print("YASH.BET → Hensem；充值+提现；从印度时间 2026-10-01 零点补齐；每10分钟一轮。")
        print("上传范围已固定，无需建表或填写数据库密钥。")
        data = {
            "base_url": "https://yash.y-o-admin.com", "backfill_start": "2026-10-01 00:00:00", "backfill_timezone": "UTC+05:30",
            "interval_seconds": 600, "page_limit": 1000,
            "window_seconds": 3600, "overlap_seconds": 3600, "settle_seconds": 60,
            "reconcile_days": 7, "reconcile_interval_seconds": 86400,
            "pending_checks_per_cycle": 200, "cycle_budget_seconds": 480,
            "request_delay_seconds": 0.25, "batch_size": 200, "max_pages": 10000,
            "state_file": "yash_sync_state/progress.sqlite3", "lock_file": "yash_sync_state/sync.lock",
            "headers_file": path.name,
        }
    headers = read_request("请粘贴充值订单列表的完整 cURL（只是解析文字，不执行命令）：")
    source_headers = {"default": headers}
    separate = input("提现是否需单独请求头？需要输入 y，共用登录直接回车：").strip().lower()
    if separate == "y":
        source_headers["withdrawal"] = read_request("请粘贴提现订单列表的完整 cURL：")
    data["source_headers"] = source_headers
    if not refresh:
        print("后台时区请确认：印度时间可填 UTC+05:30，中国时间可填 UTC+08:00。")
        zone = input("后台时区（固定 UTC 偏移或 IANA 名称）：").strip()
        site_zone(zone)
        data["site_timezone"] = zone
    # Older local configuration must not retain project-wide database credentials.
    for key in ("supabase_url", "supabase_secret_key", "secrets_file", "table"):
        data.pop(key, None)
    private_json(path, data)
    print("登录信息已更新，断点保留。" if refresh else "配置已保存；直接运行本程序即可检测并开始同步。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--setup", action="store_true", help="首次配置后退出")
    group.add_argument("--refresh", action="store_true", help="更新本机登录请求，保留断点")
    group.add_argument("--check", action="store_true", help="只读检测来源和 Supabase，不写入")
    group.add_argument("--once", action="store_true", help="补抓/同步一轮，完成后退出")
    group.add_argument("--loop", action="store_true", help="每600秒同步，历史补抓分批继续；不并发重叠")
    args = parser.parse_args()
    if not (args.check or args.once or args.setup or args.refresh):
        args.loop = True
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    state = None
    try:
        UploadClient(None).headers()
        config_path = Path(args.config).expanduser().resolve()
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
        with process_lock(cfg.path("lock_file", "state/sync.lock")):
            if args.check or args.loop:
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
                    return 0
            identity = [YASH_UPLOAD_URL, "schema_version:1", cfg.get("base_url"), cfg.get("site_timezone"), cfg.get("backfill_start"), cfg.get("backfill_timezone", "UTC+05:30")]
            namespace = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
            state = State(cfg.path("state_file", "state/progress.sqlite3"), namespace)
            while True:
                tick = time.monotonic()
                try:
                    run_cycle(cfg, state, source, target, budget_seconds=int(cfg.get("cycle_budget_seconds", 480)) if args.loop else None)
                except (SyncError, OSError, ValueError) as exc:
                    message = str(exc) if isinstance(exc, SyncError) else "配置/编码/本地文件无效，请检查配置和文件权限"
                    LOG.error("%s", message)
                    if args.once:
                        return 1
                if args.once:
                    return 0
                remaining = max(0, int(cfg.get("interval_seconds", 600)) - (time.monotonic() - tick))
                LOG.info("等待 %.0f 秒后开始下一轮；登录过期可用 python yash_sync.py --refresh 更新登录", remaining)
                time.sleep(remaining)
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
        if state:
            state.close()


if __name__ == "__main__":
    raise SystemExit(main())
