#!/usr/bin/env python3
"""GEM7 / MAX7 / EK7 — v5.6 创建时间 / 成功时间双采集。

1. 在下方 LOGIN_CONFIG 的对应平台填写 username、password、totp_secret。
2. totp_secret 是谷歌验证绑定密钥，不是手机当前六位验证码；可填标准 otpauth TOTP 链接。
3. 保存后运行：python3 -u ek_sync.py --mode daily --platform all
4. 不用 setup-login，不用安装 keyring；旧版登录钥匙串/配置文件不会覆盖本区。
5. 三项都留空时仅使用手动登录会话；只填一部分会明确提示该平台配置不完整。
6. Chrome 9555 仍须运行。账号、密码、验证码错误会触发有限重试/暂停，不保证永不掉线。

安全提醒：填写后的 PY 含明文密码和验证器密钥，不要发送给别人或上传公开仓库。
默认每天双采：创建日全部订单 + 当日成功订单（包含以前创建的订单）。
成功时间对应后台 update_time；充值在 pay_time 中提供该时间供统一查询，原始时间均保留。
--time-basis success 可只补成功口径；--start/--end 支持印度时间段。
Supabase 的密钥仍沿用原环境变量/已有系统钥匙串，不在下方填写后台登录资料处改动。
依赖仍为 requests、websocket-client；TOTP 计算使用 Python 标准库。
本文件经过离线检查，未在你的 Mac、真实后台或生产数据库上实跑。
"""

from __future__ import annotations

# ==================== 登录资料配置区：只改这里 ====================
# 将账号、密码、谷歌验证绑定密钥填进对应的空双引号，保留键名、逗号与缩进。
# 三个平台分别填写，不是填写 Google 邮箱的账号密码。
# login_url 预填的是此前提供的后台地址；请核对，域名变更时填写完整 HTTPS 登录页。
# 密码含反斜杠时写成 \\，含双引号时写成 \"；普通字母、数字、@、# 等直接填。
# 修改配置后保存，并 Ctrl+C 停止旧进程后重启；不能在运行中直接生效。
LOGIN_CONFIG = {
    "GEM7": {
        "login_url": "https://0707-p83u8dxzf8u8dbh.gems7admz9xq4uhgv79sqka.com/#/login",
        "username": "",       # GEM7 后台账号
        "password": "",       # GEM7 后台密码
        "totp_secret": "",    # GEM7 谷歌验证绑定密钥（不是六位验证码）
    },
    "MAX7": {
        "login_url": "https://0909-3y0ksr952dc8gyxutw6j.admmax7scewudble87bj5j.com/#/login",
        "username": "",       # MAX7 后台账号
        "password": "",       # MAX7 后台密码
        "totp_secret": "",    # MAX7 谷歌验证绑定密钥（不是六位验证码）
    },
    "EK7": {
        "login_url": "https://9277-typfszybnpleek2ffhkumdg5aeyg10.ek7admotbiz2ac4khhopvjnlhy.com/#/login",
        "username": "",       # EK7 后台账号
        "password": "",       # EK7 后台密码
        "totp_secret": "",    # EK7 谷歌验证绑定密钥（不是六位验证码）
    },
}
# ==================== 配置区结束：下方不需要修改 ====================

import argparse
import base64
import copy
import hashlib
import math
import tempfile
import unicodedata
import json
import os
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    import requests
except ImportError as exc:  # pragma: no cover - only live environments omit it
    raise SystemExit("缺少 requests，请执行 pip3 install requests") from exc

try:
    import websocket  # type: ignore
except ImportError:  # sample-test remains intentionally dependency-light
    websocket = None


SCRIPT_VERSION = "gems7-api-sync-v5.6-order-details"
# User-confirmed backend day. Never derive it from the operator's computer TZ.
BACKEND_TIMEZONE_NAME = "Asia/Kolkata"
DEFAULT_CDP_HTTP = "http://127.0.0.1:9555"
DEFAULT_GEM7_URL = "https://0707-p83u8dxzf8u8dbh.gems7admz9xq4uhgv79sqka.com/#/operate/chargeOrder"
DEFAULT_SUPABASE_URL = "https://gmfyfzsxpxmaqtuuwgxb.supabase.co"
SUPABASE_RETRYABLE_STATUS = {429, 502, 503, 504}
PLATFORM_NAMES = ("GEM7", "MAX7", "EK7")
TEAM_CODE = "hong_kong"
TEAM_NAME = "香港"

ORDER_SPECS: Dict[str, Dict[str, str]] = {
    "charge": {
        "route": "/#/operate/chargeOrder",
        "api_path": "/api/operate/chargeOrder/index",
        "method": "GET",
        "table": "game66_charge_orders",
    },
    "withdraw": {
        "route": "/#/operate/withdrawOrder",
        "api_path": "/api/operate/withdrawOrder/index",
        "method": "POST",
        "table": "game66_withdraw_orders",
    },
}

# These are the only business meanings confirmed for this backend family.
# All other source status values remain in status_code and are unclassified.
STATUS_RULES: Dict[str, Dict[str, Dict[str, Any]]] = {
    "charge": {
        "1": {"status_text": "已支付", "status_group": "success"},
        "0": {"status_text": "待支付", "status_group": "pending"},
    },
    "withdraw": {
        "3": {
            "status_text": "付款成功",
            "status_group": "success",
            "payout_processed": True,
            "payout_success": True,
            "payout_confirmed": True,
            "in_payout": False,
        },
        "1": {
            "status_text": "已提交",
            "status_group": "in_payout",
            "payout_processed": False,
            "payout_success": False,
            "payout_confirmed": False,
            "in_payout": True,
        },
        "2": {
            "status_text": "代付失败",
            "status_group": "failed",
            "payout_processed": True,
            "payout_success": False,
            "payout_confirmed": True,
            "in_payout": False,
        },
        "-1": {
            "status_text": "审核拒绝",
            "status_group": "rejected",
            "payout_processed": False,
            "payout_success": False,
            "payout_confirmed": True,
            "in_payout": False,
        },
    },
}

HOP_BY_HOP_HEADERS = {
    "connection", "proxy-connection", "keep-alive", "transfer-encoding",
    "upgrade", "host", "content-length", "cookie", "accept-encoding",
}
PAGE_KEYS = {"page", "currentpage", "pageno", "pagenum", "pageindex"}
PAGE_SIZE_KEYS = {"pagesize", "perpage", "limit"}
DYNAMIC_KEY_RE = re.compile(r"(^|[^a-z])(signature|sign|nonce|timestamp)([^a-z]|$)", re.I)
DATE_TOKEN_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
MONEY_RE = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d{1,2})?$")
JWT_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
CHANNEL_MAP_PATH = Path(__file__).resolve().parent / ".gems7_channel_map.json"
# Verified on 2026-09-17 against both read-only payChannel endpoints for each
# platform. Charge and withdraw return the same dictionary within one
# platform, while GEM7/MAX7/EK7 use different dictionaries. Keep this
# single-file baseline so numeric provider IDs never become display names.
# Normalized rows SHA-256:
# 63ad9b8fdb0ba68ec319e45ca8909784fb9ed6367abc748e91ce0991d5270bfa
VERIFIED_CHANNEL_ROWS = """
GEM7|9|DeePay原生
GEM7|102|DeePay唤醒
GEM7|115|mepay原生
GEM7|118|RushPay跑分
GEM7|146|payFlow原生
GEM7|199|proPay(原生)
GEM7|234|RRPay原生
GEM7|266|RRPay(唤醒)
GEM7|343|LePay唤醒
GEM7|364|UmPay(唤醒)
GEM7|375|KCashPay(原生)
GEM7|385|CedarPay跑分
GEM7|390|SwayPay跑分
GEM7|404|chakrapay唤醒
GEM7|412|HuixPay唤醒
GEM7|432|BussPay唤醒
GEM7|435|dy3pay(原生)
GEM7|444|bharatPay(唤醒)
GEM7|445|TTpay唤醒
GEM7|449|bharatPay(原生)
GEM7|451|MePay(唤醒)
GEM7|452|VeroPay(唤醒)
GEM7|467|TigerPay唤醒
GEM7|478|Safe2Pay原生
GEM7|479|SafePay(唤醒)
GEM7|489|movpay跑分
GEM7|491|OnePay跑分
GEM7|492|Dy3Pay(唤醒)
GEM7|511|FunPay唤醒
GEM7|520|3TAPay唤醒
GEM7|525|tukpay跑分
GEM7|542|haoxpay唤醒
GEM7|555|TrustPay原生
GEM7|564|Win2pay跑分
GEM7|581|winpay扫码
GEM7|597|coinuspay(唤醒)
GEM7|634|RhinoPay跑分
GEM7|648|HuixPay(原生)
GEM7|651|Freepay(唤醒)
GEM7|659|elePay唤醒
GEM7|669|VstarPay唤醒
GEM7|704|ninepay(唤醒)
GEM7|740|syPay(原生)
GEM7|768|LHPay原生
GEM7|790|kivoPay唤醒
GEM7|801|lhPay(唤醒)
GEM7|826|LemonPay(原生)
GEM7|873|CCpay唤醒
GEM7|885|icPay跑分
GEM7|886|AIV3Pay停用
GEM7|887|ETpay(唤醒)
GEM7|907|TonyPay唤醒
GEM7|910|fastPay停用
GEM7|927|BiBiPay唤醒
GEM7|935|Gtpay唤醒
GEM7|939|apay唤醒
GEM7|943|N1pay(唤醒)
GEM7|958|RedBullpay(唤醒)
GEM7|978|t3Pay唤醒
GEM7|992|DDpay(唤醒)
GEM7|995|AIV3Pay跑分
GEM7|998|FastPay跑分
GEM7|1004|ICV2Pay跑分
GEM7|1007|jdPay(唤醒)
GEM7|1018|In4Pay跑分
GEM7|1027|securePay(原生)
GEM7|1032|joyPay(唤醒)
GEM7|1055|9ePay(唤醒)
GEM7|1058|CQGPay唤醒
GEM7|1087|flPay(唤醒)
GEM7|1101|maxpay跑分
GEM7|1103|NexPay3唤醒
GEM7|1104|NewbPay唤醒
GEM7|10001|CbibiPay唤醒
MAX7|9|DeePay原生
MAX7|115|MePay原生
MAX7|118|RushPay跑分
MAX7|146|payFlow原生
MAX7|199|ProPay原生
MAX7|200|ProPay唤醒
MAX7|234|RupeeRushPay原生
MAX7|343|LePay唤醒
MAX7|364|UmPay扫码
MAX7|375|KCashPay原生
MAX7|385|CedarPay跑分
MAX7|390|SwayPay(唤醒)测试中勿开
MAX7|404|ChakraPay唤醒
MAX7|412|HuixPay唤醒
MAX7|432|BussPay唤醒
MAX7|435|Dy3原生
MAX7|444|BharatPay唤醒
MAX7|445|TT2Pay唤醒
MAX7|449|BharatPay原生
MAX7|451|MePay唤醒
MAX7|452|veroPay唤醒
MAX7|467|TigerPay唤醒
MAX7|478|Safe2Pay原生
MAX7|489|MovPay跑分
MAX7|491|OnePay跑分
MAX7|492|DyPay3唤醒
MAX7|520|3TAPay唤醒
MAX7|525|TukPay跑分
MAX7|545|LHPay原生
MAX7|547|LhPay唤醒
MAX7|555|TrustPay原生
MAX7|564|Win2pay跑分
MAX7|581|Win2Pay扫码
MAX7|597|coinuspay唤醒
MAX7|634|RhinoPay跑分
MAX7|648|HuixPay原生
MAX7|651|Freepay(唤醒)测试中勿开
MAX7|659|ElePay唤醒
MAX7|669|VstarPay唤醒
MAX7|704|NinePay原生-新
MAX7|790|KIVOPay唤醒
MAX7|826|Lemon3PayV2原生
MAX7|873|CCpay(原生)
MAX7|885|ICV2Pay跑分1
MAX7|927|BiBiPay唤醒
MAX7|935|gtpay唤醒
MAX7|939|APay唤醒
MAX7|978|T3Pay唤醒(978)测试中勿开
MAX7|992|DDPay唤醒
MAX7|995|AIV3Pay跑分
MAX7|998|FastPay跑分
MAX7|1004|ICV2Pay跑分
MAX7|1018|In4Pay跑分
MAX7|1055|9EPay唤醒
MAX7|1058|CQGPay唤醒
MAX7|1080|FreePay唤醒
EK7|7|9SPay原生
EK7|9|DeePay原生
EK7|13|TBPay唤醒
EK7|14|ZipPay唤醒
EK7|21|SimplyPay原生
EK7|31|SuperPay唤醒
EK7|34|SharkPay唤醒
EK7|46|AiPay(唤醒)
EK7|50|YesPay唤醒
EK7|51|CloudsRSAPay原生
EK7|52|Inspay唤醒
EK7|55|PassPay(唤醒)
EK7|56|PayPay唤醒
EK7|58|FoxPay(原生)
EK7|60|UpiWakePay唤醒
EK7|61|PayablePay唤醒
EK7|63|OkPay唤醒
EK7|64|7DayPay(唤醒)
EK7|74|BestPay唤醒
EK7|78|JoyPay(唤醒) 停用
EK7|83|KK2Pay(原生)
EK7|93|MossPay唤醒
EK7|95|PayPay原生
EK7|100|TKPay原生
EK7|101|GdsPay唤醒
EK7|102|DeePay唤醒
EK7|103|PassPay(原生) 暂停
EK7|104|CloudsRSAPay唤醒
EK7|111|FePay原生
EK7|112|NewBePay唤醒
EK7|113|NewbePay原生
EK7|115|MePay原生
EK7|118|RushPay跑分
EK7|121|IPL原生
EK7|125|11Pay原生
EK7|127|EasyPay原生(E2Pay)
EK7|129|SFKakaPay扫码
EK7|131|HolyPay(唤醒)
EK7|139|SFPay原生
EK7|140|HexPay(原生)
EK7|141|sunpay唤醒
EK7|142|ColaPay唤醒
EK7|145|ToPay原生
EK7|146|payFlow原生
EK7|147|SFpay唤醒
EK7|148|Lemon2Pay原生 暂停
EK7|150|777Pay唤醒
EK7|153|NetPay原生
EK7|158|YunPay原生
EK7|164|KingPay唤醒
EK7|173|GnsPay(唤醒)
EK7|186|InfinityPay唤醒
EK7|187|CsmPay唤醒 (fectpay)
EK7|188|InruPay唤醒
EK7|190|DoMiPay(唤醒)
EK7|199|proPay原生
EK7|200|proPay(唤醒) 暂停
EK7|214|99Pay(原生)
EK7|216|BasePay(唤醒216)(测试中)
EK7|221|Pro3Pay原生
EK7|223|NinePay原生
EK7|230|TaTaPay唤醒 (停用）
EK7|234|RupeeRushPay原生
EK7|236|YtPay(原生)
EK7|243|HPay(原生243)(测试中)
EK7|244|INRUPAY原生
EK7|247|UdayPay(原生)
EK7|259|NicePay(原生)
EK7|262|SewingPay原生
EK7|263|Dy3原生
EK7|264|EPay(原生) 暂停
EK7|266|RupeeRushPay唤醒
EK7|274|Wanda (upi扫码)
EK7|283|WzPay原生
EK7|284|DecentPay原生
EK7|289|UnisPay唤醒
EK7|291|UwinPay原生
EK7|301|SafePay唤醒
EK7|303|HuPay原生-新 暂停
EK7|307|NinePay唤醒
EK7|308|KoiPay原生停用
EK7|309|AxPay原生新系统 暂停
EK7|310|MasterPay原生
EK7|315|WzPay唤醒
EK7|318|TopPay跑分
EK7|322|YhPay原生
EK7|327|InfinityPay原生
EK7|329|HTGJPay原生
EK7|331|BussPay(原生)
EK7|338|MiniPay原生
EK7|339|YiiPay原生(新系统)
EK7|341|SunnyPay原生
EK7|342|payBet(唤醒)
EK7|343|LePay唤醒
EK7|344|YhPay(唤醒)
EK7|348|SunsPay原生
EK7|349|UkPay(唤醒) 暂停
EK7|354|ToDayPay原生
EK7|356|FiveEPay原生
EK7|360|YayaWakePay唤醒
EK7|363|haoxPay唤醒
EK7|364|UmPay扫码
EK7|367|Instaxpay原生(停用）
EK7|368|DecentPay(唤醒)(测试中)
EK7|376|INTNETPAY唤醒
EK7|378|NowPay(原生)
EK7|380|99PAY唤醒
EK7|385|CedarPay跑分
EK7|389|SwayPay扫码
EK7|390|SwayPay跑分
EK7|392|GxtPay(392唤醒)(测试中)
EK7|394|upPay(唤醒)
EK7|398|TranSafepay(唤醒)测试中
EK7|400|NineStarPay唤醒
EK7|403|CK3原生
EK7|404|ChakraPay唤醒
EK7|407|BeePay(唤醒)
EK7|408|3MrPay(扫码) 暂停
EK7|411|payBet2(唤醒)
EK7|412|HuixPay唤醒
EK7|415|inpaynew(唤醒)(测试中)
EK7|420|YunPay唤醒
EK7|428|jdpay(唤醒)
EK7|430|SuqPay唤醒
EK7|432|BussPay唤醒
EK7|444|BharatPay唤醒
EK7|445|TT2Pay唤醒
EK7|448|MasterPay(唤醒)
EK7|449|bharatPay(原生)
EK7|451|MePay(唤醒)
EK7|452|veroPay唤醒
EK7|453|miPay(唤醒) 暂停
EK7|457|SuqPay(原生)457测试账号测试中
EK7|461|aaPay(唤醒)
EK7|464|deekPay原生
EK7|467|TigerPay唤醒
EK7|468|Red3Pay唤醒停用
EK7|475|MINIPay(唤醒)
EK7|478|Safe2Pay原生
EK7|479|Safe2Pay(唤醒) 暂停
EK7|483|mvPay(唤醒)
EK7|488|TaTaPay唤醒
EK7|489|MovPay跑分
EK7|491|OnePay跑分
EK7|492|Dy3Pay唤醒
EK7|493|嘉盛2纯代付
EK7|506|YiiPay(唤醒)
EK7|520|3TAPay(跑分)520
EK7|522|SolPay(原生)522测试中
EK7|524|elephantPay(原生)
EK7|525|TukPay跑分
EK7|529|mcgPay(扫码)
EK7|533|sveltpay原生
EK7|534|hfpay(唤醒) 暂停
EK7|538|hayuPay(原生)
EK7|539|BasePay(原生)
EK7|541|Sunny2Pay原生
EK7|545|LHPay原生
EK7|555|TrustPay原生
EK7|558|TrustPay唤醒
EK7|564|Win2pay跑分
EK7|569|SRpay原生
EK7|581|Win2Pay扫码
EK7|587|SharkPay(原生587)测试中
EK7|597|coinuspay(唤醒)
EK7|602|flashPay(唤醒)
EK7|608|lucyPay原生
EK7|617|rhinopay扫码
EK7|626|MIMIPay(原生)
EK7|628|YesPay(唤醒）
EK7|632|JJPay(原生) 暂停
EK7|633|OCpay(原生633)测试中
EK7|634|RhinoPay跑分
EK7|635|futurepay(唤醒)
EK7|637|FuturePay原生
EK7|641|Uni3Pay原生
EK7|644|marsPay(原生)
EK7|648|HuixPay(原生)
EK7|651|FreePay唤醒
EK7|653|flPay(原生)
EK7|654|smooPay(唤醒)654测试中
EK7|659|ElePay唤醒
EK7|666|khpay(唤醒)666测试中
EK7|669|VstarPay唤醒
EK7|679|AIAPay(唤醒)679测试中
EK7|685|AGV2Pay原生
EK7|686|nekpay(唤醒)
EK7|717|skyPay(唤醒)717测试中
EK7|722|opPay(原生) 暂停
EK7|732|DyPay2唤醒 暂停
EK7|736|payapay原生
EK7|737|AilePay原生
EK7|740|syPay(原生)
EK7|750|btPay(唤醒)
EK7|762|DidiV2Pay唤醒 暂停
EK7|764|soPay(唤醒) 暂停
EK7|785|CCpay原生
EK7|790|KIVOPay唤醒
EK7|792|CedarPay唤醒-PE
EK7|793|ToopPay(原生) 暂停
EK7|794|syPay(唤醒)
EK7|814|PassPay(扫码) 暂停
EK7|826|Lemon3Pay(原生) 暂停
EK7|842|fcpay(扫码) 暂停
EK7|843|fcpay(唤醒) 暂停
EK7|845|huPay(原生) 暂停
EK7|857|quickgaPay(原生)
EK7|859|starterpay(唤醒)
EK7|869|payFlow(唤醒) 暂停
EK7|870|mvPay(唤醒) 暂停
EK7|875|ARBPay(钱包) 暂停
EK7|877|LiraPay原生
EK7|885|ICPay跑分
EK7|886|AIV3Pay（系统禁用）停用
EK7|907|TonyPay唤醒
EK7|910|FastPay停用
EK7|927|BiBiPay唤醒
EK7|935|Gtpay唤醒
EK7|936|hoursPay(原生)
EK7|939|APay唤醒
EK7|943|N1Pay唤醒
EK7|948|aelopay(唤醒)
EK7|957|bibipay(原生)
EK7|958|RedBullpay
EK7|966|passingPay(唤醒)
EK7|978|T3Pay唤醒
EK7|989|CCpay跑分
EK7|990|ComePay唤醒
EK7|992|DD3Pay唤醒
EK7|994|mtpay(唤醒)
EK7|995|AIV3Pay跑分
EK7|996|newPay(原生)
EK7|998|FastPay跑分
EK7|1004|ICV2Pay跑分
EK7|1007|jdPay(唤醒)
EK7|1018|In4Pay跑分
EK7|1019|newpay(唤醒)
EK7|1023|securePay(唤醒)
EK7|1032|joyPay(唤醒)
EK7|1049|dnPay(唤醒)
EK7|1055|9ePay(唤醒)
EK7|1058|CQGPay唤醒
EK7|1087|flPay(唤醒)
EK7|1100|hengxPay唤醒
EK7|1101|maxpay跑分
EK7|1103|NexPay3唤醒
EK7|1104|NewbPay唤醒
EK7|10001|HuitonePay唤醒
EK7|10002|CbibiPay唤醒
""".strip()
VERIFIED_CHANNEL_MAPS: Dict[str, Dict[str, str]] = {
    name: {} for name in PLATFORM_NAMES
}
for _verified_row in VERIFIED_CHANNEL_ROWS.splitlines():
    _verified_platform, _verified_code, _verified_name = _verified_row.split("|", 2)
    VERIFIED_CHANNEL_MAPS[_verified_platform][_verified_code] = _verified_name
del _verified_row, _verified_platform, _verified_code, _verified_name
SOURCE_TIMEZONE_NAME = BACKEND_TIMEZONE_NAME
EMPTY_FILTER_KEYS = {
    "uid", "channel", "paychannelname", "paychannel", "paymethod", "ordernum",
    "outtradeno", "isfirst", "status", "nottobackcash", "firstpay", "chargeid",
    "chargetype", "paychanneltype", "paytype", "updatetime",
}


# v5: task isolation, persistent bounded scheduling and explicit partial status.
# No new database fields/tables; no secrets or full source rows in local state.
class CollectorError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False, scope: str = "task"):
        super().__init__(message)
        self.retryable = retryable
        self.scope = scope


class SourceHTTPError(CollectorError):
    def __init__(self, status: int):
        self.status = status
        super().__init__(
            f"GEMS API HTTP {status}" + ("，请在原 Chrome 页面重新登录/核对权限" if status in (401, 403) else ""),
            retryable=status in (0, 408, 429, 500, 502, 503, 504),
            scope="platform" if status in (401, 403) else "task",
        )


# ----- v5.4: code-configured automatic login; no business-write endpoints -----
# Protocol/API references (no external calls are made to these sites at runtime):
# https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
# https://chromedevtools.github.io/devtools-protocol/tot/Page/
# https://www.rfc-editor.org/rfc/inline-errata/rfc6238.html
LOGIN_MIN_INTERVAL = 60
LOGIN_MAX_PER_HOUR = 3
LOGIN_MAX_FAILURES = 3
# This EK7 origin is shown in the user's supplied login screenshot.
EK7_SCREENSHOT_LOGIN_URL = "https://9277-typfszybnpleek2ffhkumdg5aeyg10.ek7admotbiz2ac4khhopvjnlhy.com/#/login"
AUTOLOGIN_MANAGER: Optional["AutoLoginManager"] = None


class LoginRequired(CollectorError):
    def __init__(self, message: str = "后台会话不存在或已过期"):
        super().__init__(message, scope="platform")


class LoginProblem(CollectorError):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message, retryable=retryable, scope="platform")


class SessionRecovered(CollectorError):
    def __init__(self):
        super().__init__("后台已重新登录，当前任务须从第一页重新采集", retryable=True)


def parse_totp_binding(value: str) -> Dict[str, Any]:
    """Accept a locally entered Base32 binding secret or an otpauth TOTP URI.

    Never accept an individual 6-digit code as the long-term binding secret.
    Do not log the input, URL, secret, exception message, or generated code.
    """
    raw = value.strip()
    algorithm, digits, period = "SHA1", 6, 30
    if raw.lower().startswith("otpauth:"):
        try:
            parsed = urlparse(raw)
            pairs = parse_qsl(parsed.query, keep_blank_values=True)
            params = dict(pairs)
            if (parsed.scheme != "otpauth" or parsed.netloc != "totp" or parsed.fragment
                    or len(params) != len(pairs)):
                raise ValueError
            if set(params) - {"secret", "issuer", "algorithm", "digits", "period"}:
                raise ValueError
            raw = params["secret"]
            algorithm = params.get("algorithm", "SHA1").upper().replace("-", "")
            digits, period = int(params.get("digits", "6")), int(params.get("period", "30"))
        except (KeyError, ValueError, TypeError):
            raise LoginProblem("谷歌验证绑定内容格式无效；需要 TOTP 密钥，不是验证码或迁移二维码") from None
    if algorithm not in {"SHA1", "SHA256", "SHA512"} or digits not in {6, 8} or period not in {30, 60}:
        raise LoginProblem("验证码参数不受支持；请核对原始绑定信息，未擅自改算法或周期")
    compact = re.sub(r"\s+", "", raw).upper().rstrip("=")
    if not re.fullmatch(r"[A-Z2-7]{16,256}", compact):
        raise LoginProblem("请输入谷歌验证的绑定密钥（Base32），不是 App 当前显示的六位数字")
    try:
        decoded = base64.b32decode(compact + "=" * (-len(compact) % 8), casefold=True)
        canonical = base64.b32encode(decoded).decode("ascii").rstrip("=")
        if len(decoded) < 10 or canonical != compact:
            raise ValueError
    except Exception:
        raise LoginProblem("谷歌验证绑定密钥无效；内容未保存，也不会打印") from None
    return {"secret": compact, "algorithm": algorithm, "digits": digits, "period": period}


def totp_value(settings: Dict[str, Any], timestamp: Optional[float] = None) -> str:
    import hmac
    import struct
    stamp = time.time() if timestamp is None else timestamp
    if not isinstance(stamp, (int, float)) or not math.isfinite(stamp) or stamp < 0:
        raise LoginProblem("系统时间无效，无法生成验证码")
    secret = settings["secret"]
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", int(stamp // settings["period"])),
                      getattr(hashlib, settings["algorithm"].lower())).digest()
    offset = digest[-1] & 15
    number = (int.from_bytes(digest[offset:offset + 4], "big") & 0x7fffffff) % (10 ** settings["digits"])
    return str(number).zfill(settings["digits"])


def totp_matches(settings: Dict[str, Any], entered: str, timestamp: Optional[float] = None) -> bool:
    import hmac
    stamp = time.time() if timestamp is None else timestamp
    if not re.fullmatch(r"[0-9]{" + str(settings["digits"]) + r"}", entered):
        return False
    return any(hmac.compare_digest(entered, totp_value(settings, stamp + offset * settings["period"]))
               for offset in (-1, 0, 1) if stamp + offset * settings["period"] >= 0)


def validate_login_url(name: str, raw: str) -> Tuple[str, str]:
    """Pin HTTPS origin AND the login route. No redirect URLs or credentials."""
    platform = platform_from_url(name, raw)
    parsed = urlparse(raw)
    if (parsed.query or parsed.params or parsed.fragment not in {"/login", "/login/"}
            or any(c in raw for c in ("\n", "\r", "\t", "\\"))):
        raise LoginProblem("登录地址必须是该平台 HTTPS 的 #/login 页面，不能包含账号密码或跳转参数")
    path = parsed.path or "/"
    return platform.origin, platform.origin + path + "#/login"


def validate_local_cdp(raw: str) -> None:
    parsed = urlparse(raw)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise LoginProblem("自动登录只允许本机 Chrome 调试地址，默认 http://127.0.0.1:9555")
    try:
        if parsed.port is None:
            raise ValueError
    except ValueError:
        raise LoginProblem("Chrome 调试地址缺少有效端口") from None


def credential_slot(name: str, origin: str) -> str:
    return name + "-" + stable_hash(origin)[:24]


class LoginGuard:
    """Per-platform persistent submission limits, including process restarts."""
    def __init__(self, path: Path):
        self.path = path

    def read(self, slot: str, revision: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        try:
            root = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}
            if not isinstance(root, dict):
                raise ValueError
            entry = root.get(slot, {})
            if not isinstance(entry, dict):
                raise ValueError
            if entry.get("revision") != revision:
                # Correcting credentials clears their old failure/block state,
                # but must not erase recent attempts and hammer the same host.
                entry = {"revision": revision, "events": entry.get("events", []),
                         "failures": 0, "blocked": ""}
            if (not isinstance(entry.get("events"), list)
                    or not all(isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t)
                               for t in entry["events"])
                    or not isinstance(entry.get("failures"), int) or entry["failures"] < 0
                    or not isinstance(entry.get("blocked", ""), str)):
                raise ValueError
            return root, dict(entry)
        except (OSError, ValueError, TypeError):
            raise LoginProblem("登录保护记录损坏或无法读取；为防重复撞号，自动登录已暂停") from None

    def available(self, slot: str, revision: str, now: Optional[float] = None) -> Tuple[Dict[str, Any], Dict[str, Any], List[float]]:
        stamp = time.time() if now is None else now
        root, entry = self.read(slot, revision)
        recent = [t for t in entry["events"] if stamp - t < 3600]
        if entry.get("blocked") or entry["failures"] >= LOGIN_MAX_FAILURES:
            raise LoginProblem("自动登录保护已暂停该平台；请核对代码顶部 LOGIN_CONFIG，修改错误资料后重启；若已人工恢复登录，可用 --mode login-test 验证解除")
        if recent and stamp - max(recent) < LOGIN_MIN_INTERVAL:
            raise LoginProblem("距离上次登录提交不足60秒，未重复提交；请检查是否有其它会话互踢", retryable=True)
        if len(recent) >= LOGIN_MAX_PER_HOUR:
            raise LoginProblem("该平台一小时已提交3次登录，停止频繁重登；请排查会话互踢", retryable=True)
        return root, entry, recent

    def reserve(self, slot: str, revision: str, now: Optional[float] = None) -> None:
        stamp = time.time() if now is None else now
        root, entry, recent = self.available(slot, revision, stamp)
        # Persist BEFORE click; a crash/timeout must not allow immediate re-submit.
        entry.update(events=recent + [stamp], failures=entry["failures"] + 1)
        root[slot] = entry
        atomic_json(self.path, root)

    def success(self, slot: str, revision: str) -> None:
        root, entry = self.read(slot, revision)
        entry.update(failures=0, blocked="")  # Retain rolling-hour submissions.
        root[slot] = entry
        atomic_json(self.path, root)

    def block(self, slot: str, revision: str, reason: str) -> None:
        root, entry = self.read(slot, revision)
        entry["blocked"] = reason  # Only fixed reason labels; never server text.
        root[slot] = entry
        atomic_json(self.path, root)


# No input values, account names, response bodies, cookies or tokens are returned.
# The screenshots identify a three-input Chinese login form, not its API route.
# An unexpected fourth field/challenge is rejected, not guessed or bypassed.
LOGIN_DOM_HELPER = r"""
function inspectLogin(expected) {
  const visible = el => !!el && !!el.getClientRects().length &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  if (location.origin !== expected.origin) return {problem:'origin'};
  if (location.pathname !== expected.path || location.hash.split('?')[0].replace(/\/+$/, '') !== '#/login')
    return {problem:'route'};
  const text = (document.body && document.body.innerText || '').slice(0, 16000);
  const challenge = Array.from(document.querySelectorAll(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], ' +
    '[class*="geetest"], [class*="captcha-slider"], [class*="slider-captcha"], [class*="nc-container"]'
  )).some(visible) || /拖动.{0,10}(滑块|拼图)|请完成.{0,10}(人机|安全验证)|短信验证码|手机确认|扫描二维码登录/.test(text);
  if (challenge) return {problem:'challenge'};
  const inputs = Array.from(document.querySelectorAll('input')).filter(el =>
    visible(el) && !['hidden','button','submit','checkbox','radio'].includes(el.type));
  const passwords = inputs.filter(el => el.type === 'password');
  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).filter(el =>
    visible(el) && /^(登录|登入|登\s+录|log\s*in|sign\s*in)$/i.test((el.innerText || el.value || el.textContent || '').trim()));
  if (inputs.length !== 3 || passwords.length !== 1 || buttons.length !== 1) return {problem:'form'};
  const users = inputs.filter(el => el !== passwords[0] && (
    /(账户|账号|帐号|用户名|user.?name|account)/i.test([el.placeholder, el.name, el.id, el.getAttribute('aria-label')].join(' ')) ||
    el.autocomplete === 'username'));
  if (users.length !== 1) return {problem:'form'};
  const otp = inputs.find(el => el !== users[0] && el !== passwords[0]);
  if (!otp || !/谷歌|Google|Authenticator|一次性|验证器|动态口令|one.time/i.test(text)) return {problem:'form'};
  if (inputs.some(el => el.disabled || el.readOnly)) return {problem:'disabled'};
  const form = passwords[0].form;
  if (form && inputs.some(el => el.form !== form)) return {problem:'form'};
  if (form && form.hasAttribute('action') && new URL(form.action, location.href).origin !== expected.origin)
    return {problem:'action'};
  if (buttons[0].hasAttribute('formaction') && new URL(buttons[0].formAction, location.href).origin !== expected.origin)
    return {problem:'action'};
  return {problem:'', user:users[0], password:passwords[0], otp, button:buttons[0]};
}
"""


def login_dom_expression(profile: Dict[str, str], action: str, values: Optional[Dict[str, str]] = None) -> str:
    parsed = urlparse(profile["login_url"])
    expected = {"origin": profile["origin"], "path": parsed.path or "/"}
    data = {"expected": expected, "action": action, "values": values or {}}
    # data is JSON encoded, never concatenated as unescaped JavaScript.
    return "(async function(data){" + LOGIN_DOM_HELPER + r"""
      let state = inspectLogin(data.expected);
      if (state.problem) return {problem:state.problem};
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const write = (el,value) => {setter.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true}));
                                  el.dispatchEvent(new Event('change',{bubbles:true}));};
      if (data.action === 'fill') {
        write(state.user, data.values.username); write(state.password, data.values.password);
        write(state.otp, data.values.code);
        await new Promise(resolve => setTimeout(resolve, 80));
        state = inspectLogin(data.expected);
        if (state.problem) return {problem:state.problem};
        if (state.user.value !== data.values.username || state.password.value !== data.values.password ||
            state.otp.value !== data.values.code) return {problem:'fill'};
      } else if (data.action === 'submit') {
        if (!state.user.value || !state.password.value || !state.otp.value) return {problem:'fill'};
        if (state.button.disabled || state.button.getAttribute('aria-disabled') === 'true') return {problem:'disabled'};
        state.button.click();
        return {problem:'', submitted:true};
      } else if (data.action === 'clear') {
        write(state.password,''); write(state.otp,'');
      }
      return {problem:'', ready:true};
    })(""" + json.dumps(data, ensure_ascii=True) + ")"


def login_feedback_expression(origin: str) -> str:
    return r"""(() => {
      if(location.origin !== __ORIGIN__) return {problem:'origin'};
      const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const messages = Array.from(document.querySelectorAll(
        '[role="alert"], .el-message, .el-notification, .n-message, .arco-message, .ant-message, .el-form-item__error'
      )).filter(visible).map(el => el.innerText || '').join(' ').slice(0,8000);
      if (/账号.{0,6}(锁定|禁用|冻结)|账户.{0,6}(锁定|禁用|冻结)|account.{0,10}(locked|disabled)/i.test(messages)) return {problem:'locked'};
      if (/密码.{0,6}(错误|不正确)|账号或密码|账户或密码|用户不存在|账号不存在|invalid credentials|incorrect password/i.test(messages)) return {problem:'credentials'};
      if (/(验证码|动态口令).{0,8}(错误|不正确|失效|过期)|invalid.{0,8}(otp|code)/i.test(messages)) return {problem:'otp'};
      if (/请求.{0,6}频繁|尝试.{0,6}频繁|too many|rate.limit/i.test(messages)) return {problem:'rate'};
      return {problem:''};
    })()""".replace("__ORIGIN__", json.dumps(origin))


def auth_eval(client: "CDPClient", expression: str, timeout: float = 10) -> Any:
    # silent/userGesture are CDP options, not requests to bypass a CAPTCHA.
    result = client.call("Runtime.evaluate", {"expression": expression, "returnByValue": True,
                        "awaitPromise": True, "silent": True, "userGesture": True}, timeout)
    if result.get("exceptionDetails") or "value" not in result.get("result", {}):
        raise LoginProblem("登录页面操作未返回有效结果；未记录页面异常内容", retryable=True)
    return result["result"]["value"]


def inline_login_record(name: str) -> Optional[Dict[str, Any]]:
    """Read one platform from LOGIN_CONFIG, without I/O or any secret logging.

    Three blank credential fields mean manual-session mode. Partial or invalid
    credentials fail only this platform. A code configuration never falls back
    to an old account in login-profiles.json or the OS keychain.
    """
    if not isinstance(LOGIN_CONFIG, dict):
        raise LoginProblem("代码顶部 LOGIN_CONFIG 必须是平台配置字典")
    if name not in LOGIN_CONFIG:
        return None
    item = LOGIN_CONFIG[name]
    if not isinstance(item, dict):
        raise LoginProblem(f"{name} 的 LOGIN_CONFIG 配置必须是字典")
    fields = ("username", "password", "totp_secret")
    for field in fields:
        if not isinstance(item.get(field, ""), str):
            raise LoginProblem(f"{name} 的 {field} 必须填在引号内，不能写成数字或其它类型")
    username = item.get("username", "").strip()
    password = item.get("password", "")  # Preserve punctuation and actual spaces.
    binding = item.get("totp_secret", "").strip()
    values = {"username": username, "password": password, "totp_secret": binding}
    if not any(values.values()):
        return None
    missing = [field for field in fields if not values[field]]
    if missing:
        raise LoginProblem(f"{name} 代码顶部 LOGIN_CONFIG 未填完整：{', '.join(missing)}；该平台未尝试自动登录")
    raw_url = item.get("login_url", "")
    if not isinstance(raw_url, str) or not raw_url.strip():
        raise LoginProblem(f"{name} 缺少 login_url，请填写后台 HTTPS 的 #/login 地址")
    try:
        origin, login_url = validate_login_url(name, raw_url.strip())
    except (RuntimeError, ValueError, TypeError):
        raise LoginProblem(f"{name} login_url 无效；必须是本平台 HTTPS 的 #/login 地址，不能含账号密码或跳转参数") from None
    try:
        settings = parse_totp_binding(binding)
    except LoginProblem:
        raise LoginProblem(f"{name} totp_secret 无效；填写谷歌验证的绑定密钥或标准 TOTP 链接，不是 App 当前六位验证码") from None
    return {"platform": name, "origin": origin, "login_url": login_url,
            "username": username, "password": password, "totp": settings}


def inline_login_profile(record: Dict[str, Any]) -> Dict[str, str]:
    """Store only a non-plaintext revision in the rate-limit ledger.

    The same settings keep their revision across restarts. Changed credentials
    create a new revision; formatting-only changes in a TOTP key do not reset it.
    No password, username, seed or full otpauth URI is written to the ledger.
    """
    revision = stable_hash(["inline-login-v1", record["platform"], record["origin"],
                            record["login_url"], record["username"], record["password"], record["totp"]])[:32]
    return {"origin": record["origin"], "login_url": record["login_url"],
            "slot": credential_slot(record["platform"], record["origin"]), "revision": revision}


class AutoLoginManager:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.root = Path(args.state_dir).expanduser().resolve()
        self.guard = LoginGuard(self.root / "login-guard.json")
        self.preferred_targets: Dict[str, str] = {}
        self.config: Dict[str, Any] = {"version": 1, "profiles": {}}
        self.configuration_errors: Dict[str, str] = {}
        self._inline_records: Dict[str, Dict[str, Any]] = {}
        # Source is exclusively the editable code block. Do not load or overwrite
        # old login-profiles.json, and never prompt for the native login keychain.
        for name in PLATFORM_NAMES:
            try:
                record = inline_login_record(name)
                if record is not None:
                    self._inline_records[name] = record
                    self.config["profiles"][name] = inline_login_profile(record)
            except LoginProblem as exc:
                self.configuration_errors[name] = str(exc)  # Fixed field metadata only.

    def profile(self, name: str) -> Optional[Dict[str, str]]:
        if name in self.configuration_errors:
            raise LoginProblem(self.configuration_errors[name])
        item = self.config["profiles"].get(name)
        if item is None:
            return None
        if not isinstance(item, dict):
            raise LoginProblem(f"{name} 登录配置格式无效")
        try:
            origin, url = validate_login_url(name, item["login_url"])
            if (item["origin"] != origin or item["login_url"] != url
                    or item["slot"] != credential_slot(name, origin)
                    or not re.fullmatch(r"[a-f0-9]{32}", item["revision"])):
                raise ValueError
        except (KeyError, ValueError, TypeError):
            raise LoginProblem(f"{name} 登录配置的域名/凭据索引不一致；未自动转移凭据") from None
        return item

    def enabled(self, name: str) -> bool:
        return (not getattr(self.args, "no_auto_login", False)
                and name not in self.configuration_errors and self.profile(name) is not None)

    def configured_origin(self, name: str) -> str:
        profile = self.profile(name)
        return profile["origin"] if profile else ""

    def _credentials(self, name: str, profile: Dict[str, str]) -> Dict[str, Any]:
        record = self._inline_records.get(name)
        if record is None:
            raise LoginProblem(f"{name} 未配置自动登录；请填写代码顶部 LOGIN_CONFIG")
        expected = inline_login_profile(record)
        if any(profile.get(key) != value for key, value in expected.items()):
            raise LoginProblem(f"{name} 代码登录资料与当前绑定域名/版本不匹配；未填写凭据")
        return copy.deepcopy({key: record[key] for key in
                              ("platform", "origin", "username", "password", "totp")})

    def _target(self, platform: Platform, profile: Dict[str, str], deadline: float) -> Dict[str, Any]:
        matches = [t for t in cdp_targets(self.args.cdp_http)
                   if urlparse(text(t.get("url"))).scheme == "https"
                   and (urlparse(text(t.get("url"))).netloc.lower() == urlparse(platform.origin).netloc.lower())]
        if matches:
            preferred = self.preferred_targets.get(platform.name)
            return next((t for t in matches if t.get("id") == preferred), matches[0])
        # Only an explicitly configured, exact HTTPS login origin may be opened.
        version = http_json(self.args.cdp_http.rstrip("/") + "/json/version")
        ws_url = version.get("webSocketDebuggerUrl", "") if isinstance(version, dict) else ""
        if urlparse(ws_url).hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise LoginProblem("Chrome 浏览器调试连接不是本机地址，未创建登录页")
        browser = CDPClient(ws_url, timeout=10)
        try:
            result = browser.call("Target.createTarget", {"url": profile["login_url"], "background": True}, timeout=10)
            target_id = text(result.get("targetId"))
        finally:
            browser.close()  # Disconnect websocket only; never Browser.close.
        while time.monotonic() < deadline:
            for target in cdp_targets(self.args.cdp_http):
                if target.get("id") == target_id:
                    return target
            time.sleep(.25)
        raise LoginProblem("登录页未就绪；请确认 Chrome 9555 仍在运行", retryable=True)

    def _probe(self, client: "CDPClient", platform: Platform, data_type: str, deadline: float) -> None:
        replay = ReplayClient(platform, self.args.cdp_http, 10, deadline)
        replay.background = client  # Borrow only; caller owns and closes this socket.
        day = recent_complete_days(BACKEND_TIMEZONE_NAME, 1)[0]
        template, _, _ = static_request_template(platform, data_type).with_page_size(10).rewrite_date(build_date_window(day))
        payload = replay._fetch_once(template, ORDER_SPECS[data_type]["api_path"])
        parse_page(payload, data_type)  # A token alone is not a login-success test.

    def recover(self, platform: Platform, data_type: str, task_deadline: Optional[float]) -> None:
        validate_local_cdp(self.args.cdp_http)
        profile = self.profile(platform.name)
        if not profile or not self.enabled(platform.name):
            raise LoginProblem(f"{platform.name} 尚未配置自动登录；请填写代码顶部 LOGIN_CONFIG 或先手动登录")
        if platform.origin != profile["origin"]:
            raise LoginProblem(f"{platform.name} 当前采集域名与本地登录绑定不同；未填写凭据")
        deadline = min(time.monotonic() + 60, task_deadline or float("inf"))
        if deadline - time.monotonic() < 5:
            raise LoginProblem("本项时间预算不足以安全登录，留待后续任务", retryable=True)
        target = self._target(platform, profile, deadline)
        self.preferred_targets[platform.name] = text(target.get("id"))
        if urlparse(text(target.get("webSocketDebuggerUrl"))).hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise LoginProblem("登录页面调试连接不是本机地址，未填写凭据")
        client = CDPClient(text(target.get("webSocketDebuggerUrl")), timeout=10)
        credentials = None
        try:
            # A newly created target may report about:blank briefly. Wait without
            # exposing credentials; never fill a redirected/certificate-error page.
            ready_until = min(deadline, time.monotonic() + 10)
            while True:
                initial = auth_eval(client, "({origin:location.origin,href:location.href})")
                if isinstance(initial, dict) and initial.get("origin") == profile["origin"]:
                    break
                if (not isinstance(initial, dict) or initial.get("href") not in {"about:blank", ""}
                        or time.monotonic() >= ready_until):
                    raise LoginProblem("登录页未到达已绑定 HTTPS 来源；请检查网络/证书，未填写凭据")
                time.sleep(.2)
            before = ""
            try:
                before, _ = existing_tab_state(client, platform)
                self._probe(client, platform, data_type, deadline)
                self.guard.success(profile["slot"], profile["revision"])
                return  # A user/other tab already restored a valid session.
            except LoginRequired:
                pass
            except SourceHTTPError as exc:
                if exc.status != 401:
                    raise  # 403 permission error must not trigger another login.
            # Check persistent limits before reading secrets or filling fields.
            self.guard.available(profile["slot"], profile["revision"])
            state = auth_eval(client, "({origin:location.origin,path:location.pathname,hash:location.hash})")
            if not isinstance(state, dict) or state.get("origin") != profile["origin"]:
                raise LoginProblem("登录页来源不匹配；未填写凭据")
            expected_path = urlparse(profile["login_url"]).path or "/"
            if state.get("path") != expected_path or text(state.get("hash")).split("?", 1)[0].rstrip("/") != "#/login":
                client.call("Page.navigate", {"url": profile["login_url"]}, timeout=10)
            while time.monotonic() < deadline:
                try:
                    status = auth_eval(client, login_dom_expression(profile, "inspect"))
                except LoginProblem:
                    status = {"problem": "loading"}
                problem = status.get("problem") if isinstance(status, dict) else "form"
                if not problem:
                    break
                if problem in {"origin", "action"}:
                    raise LoginProblem("登录页跳到了未绑定来源或表单动作不一致；未填写凭据")
                if problem == "challenge":
                    self.guard.block(profile["slot"], profile["revision"], "challenge")
                    raise LoginProblem("出现人机/手机验证，自动登录暂停；需要在浏览器人工完成")
                time.sleep(.25)
            else:
                raise LoginProblem("没有识别到截图中的三输入框登录表单；未盲填或提交，请核对页面")
            credentials = self._credentials(platform.name, profile)
            settings = credentials["totp"]
            remaining = settings["period"] - time.time() % settings["period"]
            if remaining < 6:
                if time.monotonic() + remaining + 2 >= deadline:
                    raise LoginProblem("验证码即将切换且本项预算不足，未提交登录", retryable=True)
                time.sleep(remaining + .15)
            values = {"username": credentials["username"], "password": credentials["password"], "code": totp_value(settings)}
            filled = auth_eval(client, login_dom_expression(profile, "fill", values))
            del values
            if not isinstance(filled, dict) or filled.get("problem"):
                raise LoginProblem("登录字段未正确填写或页面变化；未提交登录")
            self.guard.reserve(profile["slot"], profile["revision"])
            log("确认会话失效，提交一次自动登录（账号、密码、验证码不记录）", platform.name)
            submitted = auth_eval(client, login_dom_expression(profile, "submit"))
            if not isinstance(submitted, dict) or submitted.get("submitted") is not True:
                raise LoginProblem("登录按钮未成功提交；本次已计入登录保护，不重复点击")
            while time.monotonic() < deadline:
                feedback = auth_eval(client, login_feedback_expression(profile["origin"]))
                problem = feedback.get("problem") if isinstance(feedback, dict) else "form"
                if problem in {"credentials", "locked", "rate", "origin"}:
                    self.guard.block(profile["slot"], profile["revision"], problem)
                    raise LoginProblem("后台拒绝账号密码、账号受限或来源变化；自动登录已暂停，请在浏览器核对")
                if problem == "otp":
                    raise LoginProblem("后台提示验证码无效；请核对绑定密钥和电脑自动校时，未连续试码")
                try:
                    token, _ = existing_tab_state(client, platform)
                except LoginRequired:
                    token = ""
                route = auth_eval(client, "({origin:location.origin,hash:location.hash})")
                if isinstance(route, dict) and route.get("origin") != profile["origin"]:
                    raise LoginProblem("登录后来源变化，未继续读取凭据")
                if token and isinstance(route, dict) and not text(route.get("hash")).startswith("#/login"):
                    self._probe(client, platform, data_type, deadline)
                    self.guard.success(profile["slot"], profile["revision"])
                    log("自动登录成功，已用只读订单接口验证；从当前任务第一页重新抓取", platform.name)
                    return
                # A challenge might be presented only after submitting.
                status = auth_eval(client, login_dom_expression(profile, "inspect"))
                if isinstance(status, dict) and status.get("problem") == "challenge":
                    self.guard.block(profile["slot"], profile["revision"], "challenge")
                    raise LoginProblem("登录后出现额外人机验证，已暂停；请人工处理")
                time.sleep(.3)
            raise LoginProblem("自动登录未在本项预算内通过只读验证；不重复点击，任务保留待补", retryable=True)
        except (LoginProblem, SourceHTTPError):
            raise
        except Exception:
            # No accidental keyring/JavaScript/CDP secret contents in exceptions.
            raise LoginProblem("自动登录未完成（连接或页面操作失败）；详细敏感内容未记录", retryable=True) from None
        finally:
            try:
                auth_eval(client, login_dom_expression(profile, "clear"), timeout=3)
            except Exception:
                pass
            credentials = None
            client.events.clear()
            client.close()


def setup_login(args: argparse.Namespace) -> int:
    """Compatibility hint; this version takes login fields directly from code."""
    print("本版不用终端设置登录资料，也不需要 keyring。")
    print("请编辑本 PY 顶部 LOGIN_CONFIG 的 username、password、totp_secret；保存后直接运行 daily。")
    return 0


def run_login_test(args: argparse.Namespace) -> int:
    """Local browser login plus a small read-only list query; no Supabase access."""
    failures = 0
    for name in selected_names(args):
        client = None
        try:
            platform = resolve_platform_name(name, args)
            for attempt in range(2):
                client = ReplayClient(platform, args.cdp_http, args.request_timeout, time.monotonic() + 90)
                template = static_request_template(platform, selected_types(args)[0]).with_page_size(10)
                template, _, _ = template.rewrite_date(build_date_window(recent_complete_days(BACKEND_TIMEZONE_NAME, 1)[0]))
                try:
                    parse_page(client.request(template), template.data_type)
                    break
                except SessionRecovered:
                    if attempt:
                        raise
                finally:
                    client.close()
            # Successful manual login can clear a stale challenge/credential
            # block, but rolling-hour submissions stay intact.
            if AUTOLOGIN_MANAGER is not None:
                profile = AUTOLOGIN_MANAGER.profile(name)
                if profile is not None:
                    AUTOLOGIN_MANAGER.guard.success(profile["slot"], profile["revision"])
            log("登录/只读接口检查通过；未写 Supabase", name)
        except Exception as exc:
            failures += 1
            log(f"登录检查未完成：{safe_error(exc)}", name)
        finally:
            if client:
                client.close()
    return 2 if failures else 0
# ----- end local automatic login -----


class DictionaryConflict(CollectorError):
    def __init__(self, mapping: Dict[str, str], conflicts: set):
        self.mapping = mapping
        self.conflicts = conflicts
        super().__init__(f"渠道字典存在 {len(conflicts)} 个重复冲突 ID")


class SupabaseError(CollectorError):
    def __init__(self, message: str, *, status: int = 0, code: str = "", table: str = ""):
        self.status, self.code, self.table = status, code, table
        self.splittable = status == 413 or code in {"57014", "54000"}
        transient = (status in {0, 408, 429, 502, 503, 504, 520, 522, 524}
                     or code in {"40001", "40P01", "55P03", "53300", "57P01", "57P02", "57P03"}
                     or code.startswith("08") or code.startswith("PGRST00")
                     or (status == 500 and not code))
        # Insufficient privileges may be table-specific; JWT/key failures are global.
        scope = "table" if table else "task"
        if code == "42501":
            scope = "table"
        elif status == 401 or code in {"PGRST300", "PGRST301", "PGRST302", "PGRST303"}:
            scope = "global"
        elif transient and code not in {"40001", "40P01", "55P03"}:
            scope = "global"
        elif self.splittable or code.startswith("22") or code.startswith("23"):
            scope = "task"
        super().__init__(message, retryable=transient or self.splittable, scope=scope)


class PartialTaskError(CollectorError):
    def __init__(self, accepted: int, rejected: int, written: int, issue_path: str):
        self.accepted, self.rejected, self.written = accepted, rejected, written
        self.issue_path = issue_path
        super().__init__(
            f"部分完成：有效={accepted}，异常={rejected}，确认写入={written}；异常清单={issue_path}")


def redact_text(value: Any, limit: int = 700) -> str:
    out = re.sub(r"[\r\n\t]+", " ", str(value)).strip()
    out = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "<JWT已隐藏>", out)
    out = re.sub(r"\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+", "<key已隐藏>", out)
    out = re.sub(r"(?i)(bearer\s+)\S+", r"\1<已隐藏>", out)
    out = re.sub(r"(?i)(apikey|authorization|access_token|refresh_token|password|token)\s*[:=]\s*[^\s,;]+",
                 r"\1=<已隐藏>", out)
    out = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "<邮箱已隐藏>", out)
    return out[:limit]


def safe_db_summary(payload: Any) -> Tuple[str, str]:
    """Never log Postgres details: it can contain the complete rejected row."""
    if not isinstance(payload, dict):
        return "", "响应不是标准错误对象（正文不记录）"
    raw_code = text(payload.get("code"))
    code = raw_code if re.fullmatch(r"[A-Z0-9_]{4,32}", raw_code) else ""
    labels = {
        "42P10": "冲突更新缺少匹配的唯一约束，请检查 (platform_id,vendor_id)",
        "42703": "数据库列不存在", "42P01": "数据库表不存在",
        "PGRST204": "列不在 Data API schema cache 中", "PGRST205": "表不在 Data API schema cache 中",
        "42501": "表权限/RLS 拒绝访问", "23502": "必填字段为空",
        "23503": "外键约束失败", "23505": "唯一约束冲突", "23514": "CHECK 约束失败",
        "22P02": "字段值的类型/格式不匹配", "22003": "数值超出数据库列范围",
        "22007": "日期格式不匹配", "22008": "日期超出范围",
        "57014": "数据库语句被取消/超时", "54000": "语句复杂度限制",
        "PGRST301": "JWT 无效", "PGRST302": "缺少有效授权", "PGRST303": "JWT 校验失败",
        "PGRST003": "等待数据库连接池超时", "PGRST102": "请求体格式无效",
    }
    label = labels.get(code, "请求被服务端拒绝；请按错误码检查服务端日志")
    # Extract schema identifiers only, never free-text message, hint or details.
    message = text(payload.get("message"))
    fields = re.findall(r"(?:column|relation|constraint|table)\s+[\"']([A-Za-z_][A-Za-z0-9_]{0,80})[\"']", message, re.I)
    fields += re.findall(r"[\"']([A-Za-z_][A-Za-z0-9_]{0,80})[\"']\s+(?:column|table)", message, re.I)
    if fields:
        label += "；对象=" + ",".join(dict.fromkeys(fields))
    return code, label


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class InstanceLock:
    """OS lock, released on process exit. Never unlink a live lock file."""
    def __init__(self, path: Path):
        self.path, self.handle = path, None

    def __enter__(self) -> "InstanceLock":
        import fcntl  # macOS/Linux: a PID file alone is not a safe process lock.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.handle.close()
            self.handle = None
            raise CollectorError("同一 CDP/Supabase 已有采集进程；请先在原终端 Ctrl+C 停止旧进程") from exc
        os.chmod(self.path, 0o600)
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.write(str(os.getpid()) + "\n")
        self.handle.flush()
        return self

    def __exit__(self, *exc: Any) -> None:
        if self.handle is not None:
            self.handle.close()
            self.handle = None

def log(message: str, platform: str = "") -> None:
    prefix = f"[{platform}] " if platform else ""
    print(datetime.now(ZoneInfo(BACKEND_TIMEZONE_NAME)).strftime("%Y-%m-%d %H:%M:%S %z"), prefix + message, flush=True)


def text(value: Any) -> str:
    return "" if value is None else str(value)


def normalized_key(value: Any) -> str:
    return re.sub(r"[^a-z]", "", text(value).lower())


def is_empty_filter(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def strict_int(value: Any, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise RuntimeError(f"GEMS 响应字段无效：{field}")
    return value


def scalar(value: Any, field: str) -> Any:
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            raise RuntimeError(f"GEMS 字段不是有限标量：{field}")
        return value
    raise RuntimeError(f"GEMS 字段不是标量：{field}")


def status_code(value: Any, field: str) -> str:
    source = scalar(value, field)
    if source is None or source == "":
        raise RuntimeError(f"GEMS 状态缺失：{field}")
    if isinstance(source, bool):
        return "true" if source else "false"
    return str(source)


def identifier(value: Any, field: str) -> str:
    if isinstance(value, bool) or value is None:
        raise RuntimeError(f"GEMS 订单标识无效：{field}")
    if isinstance(value, int) or (isinstance(value, str) and value.strip() == value and value):
        return str(value)
    raise RuntimeError(f"GEMS 订单标识无效：{field}")


def optional_text(value: Any) -> Optional[str]:
    if value is None or value == "" or value == "0" or value == 0:
        return None
    if isinstance(value, (str, int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def optional_order_identifier(value: Any, field: str) -> Optional[str]:
    """Preserve source IDs as text; never coerce a float or infer a member ID."""
    if value is None or value == "":
        return None
    return identifier(value, field)


def db_datetime(value: Any) -> Optional[str]:
    raw = optional_text(value)
    if raw is None:
        return None
    if raw.strip().lower() in {"-", "--", "null", "none", "0000-00-00 00:00:00"}:
        return None
    # GEMS returns India-local timestamps without an offset.  Attach the
    # source timezone explicitly so Postgres does not reinterpret them using
    # the database/session timezone.  An explicit source offset is preserved.
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})", raw):
        return raw
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?", raw):
        try:
            source_zone = ZoneInfo(SOURCE_TIMEZONE_NAME)
        except ZoneInfoNotFoundError as exc:
            raise RuntimeError(f"未知 GEMS 源时区：{SOURCE_TIMEZONE_NAME}") from exc
        parsed = datetime.fromisoformat(raw.replace(" ", "T", 1))
        return parsed.replace(tzinfo=source_zone).isoformat()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        try:
            source_zone = ZoneInfo(SOURCE_TIMEZONE_NAME)
        except ZoneInfoNotFoundError as exc:
            raise RuntimeError(f"未知 GEMS 源时区：{SOURCE_TIMEZONE_NAME}") from exc
        return datetime.fromisoformat(raw).replace(tzinfo=source_zone).isoformat()
    raise RuntimeError("GEMS 时间字段格式未知，拒绝写入")


def major_to_minor(value: Any, field: str) -> int:
    if isinstance(value, bool) or value is None:
        raise RuntimeError(f"GEMS 金额无效：{field}")
    source = str(value)
    if not MONEY_RE.fullmatch(source):
        raise RuntimeError(f"GEMS 金额格式无效：{field}")
    try:
        amount = Decimal(source)
    except InvalidOperation as exc:
        raise RuntimeError(f"GEMS 金额格式无效：{field}") from exc
    minor = amount * 100
    if minor != minor.to_integral_value() or amount < 0:
        raise RuntimeError(f"GEMS 金额精度无效：{field}")
    return int(minor)


def minor_display(value: int) -> str:
    return f"{value // 100}.{value % 100:02d}"


def stable_hash(value: Any) -> str:
    body = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def load_supabase_key() -> str:
    key = (
        os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )
    if key or sys.platform != "darwin":
        return key
    service = os.environ.get("GAME66_KEYCHAIN_SERVICE", "game66-sync-supabase")
    account = os.environ.get("GAME66_KEYCHAIN_ACCOUNT", "default")
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-a", account, "-s", service, "-w"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


@dataclass
class Platform:
    name: str
    origin: str
    host: str
    platform_id: str = ""

    def page_url(self, data_type: str) -> str:
        override = os.environ.get(f"GEMS7_{self.name}_{data_type.upper()}_URL", "").strip()
        raw = override or self.origin + ORDER_SPECS[data_type]["route"]
        parsed = urlparse(raw)
        if parsed.scheme != "https" or (parsed.hostname or "").lower() != self.host:
            raise RuntimeError(f"{self.name} 页面地址必须是已登记的 HTTPS host")
        return raw


@dataclass
class ParsedPage:
    items: List[Dict[str, Any]]
    total: int
    current_page: int
    total_page: int


@dataclass(frozen=True)
class DateWindow:
    timezone_name: str
    local_day: date
    local_start: str
    local_end: str
    utc_start: str
    utc_end: str
    basis: str = "created"
    created_since: str = ""


def build_date_window(day: date, timezone_name: str = BACKEND_TIMEZONE_NAME) -> DateWindow:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(f"未知时区：{timezone_name}") from exc
    start = datetime(day.year, day.month, day.day, tzinfo=zone)
    # API transport uses milliseconds; include the last second rather than
    # ending at 23:59:59.000, which can exclude fractional-second records.
    end = start + timedelta(days=1) - timedelta(milliseconds=1)

    def utc_text(value: datetime) -> str:
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    return DateWindow(
        timezone_name=timezone_name,
        local_day=day,
        local_start=start.strftime("%Y-%m-%d %H:%M:%S"),
        local_end=end.strftime("%Y-%m-%d %H:%M:%S") + ".999",
        utc_start=utc_text(start),
        utc_end=utc_text(end),
    )


@dataclass
class RequestTemplate:
    data_type: str
    method: str
    url: str
    headers: Dict[str, str]
    post_data: Optional[str]

    def clone(self) -> "RequestTemplate":
        return copy.deepcopy(self)

    def validate(self, platform: Platform) -> None:
        parsed = urlparse(self.url)
        spec = ORDER_SPECS[self.data_type]
        if parsed.scheme != "https" or (parsed.hostname or "").lower() != platform.host:
            raise RuntimeError(f"{platform.name} 捕获请求 host 不匹配，拒绝重放")
        if parsed.path != spec["api_path"]:
            raise RuntimeError(f"{platform.name} 捕获请求 path 不在允许列表")
        if self.method.upper() != spec["method"]:
            raise RuntimeError(
                f"{platform.name} {self.data_type} 方法不匹配：只允许 {spec['method']}"
            )

    def content_type(self) -> str:
        for key, value in self.headers.items():
            if key.lower() == "content-type":
                return value.lower()
        return ""

    def _decoded_body(self) -> Tuple[str, Any]:
        if self.post_data is None or self.post_data == "":
            return "none", None
        raw = self.post_data
        content_type = self.content_type()
        if "json" in content_type or raw.lstrip().startswith(("{", "[")):
            try:
                return "json", json.loads(raw)
            except json.JSONDecodeError as exc:
                raise RuntimeError("捕获请求的 JSON body 无法解析") from exc
        if "application/x-www-form-urlencoded" in content_type:
            return "form", parse_qsl(raw, keep_blank_values=True)
        return "opaque", raw

    def _set_body(self, kind: str, body: Any) -> None:
        if kind == "none":
            self.post_data = None
        elif kind == "json":
            self.post_data = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        elif kind == "form":
            self.post_data = urlencode(body, doseq=True)
        else:
            self.post_data = str(body)

    def _query_pairs(self) -> Tuple[Any, List[Tuple[str, str]]]:
        parsed = urlparse(self.url)
        return parsed, parse_qsl(parsed.query, keep_blank_values=True)

    def _set_query_pairs(self, parsed: Any, pairs: Sequence[Tuple[str, str]]) -> None:
        self.url = urlunparse(parsed._replace(query=urlencode(list(pairs), doseq=True)))

    def dynamic_markers(self) -> List[str]:
        markers: List[str] = []
        for key in self.headers:
            lowered = key.lower()
            if lowered not in {"authorization", "date"} and DYNAMIC_KEY_RE.search(lowered.replace("-", " ")):
                markers.append("header")
        _, pairs = self._query_pairs()
        for key, _ in pairs:
            if DYNAMIC_KEY_RE.search(key.replace("_", " ")):
                markers.append("query")
        kind, body = self._decoded_body()
        if kind == "json":
            for key, _ in walk_dict(body):
                if DYNAMIC_KEY_RE.search(key.replace("_", " ")):
                    markers.append("body")
        elif kind == "form":
            for key, _ in body:
                if DYNAMIC_KEY_RE.search(key.replace("_", " ")):
                    markers.append("body")
        return sorted(set(markers))

    def nonempty_status_filters(self) -> List[str]:
        found: List[str] = []
        _, pairs = self._query_pairs()
        for key, value in pairs:
            if normalized_key(key).endswith("status") and not is_empty_filter(value):
                found.append("query")
            parsed_value = try_json(value)
            if isinstance(parsed_value, (dict, list)) and nested_nonempty_status(parsed_value):
                found.append("query-json")
        kind, body = self._decoded_body()
        if kind == "json" and nested_nonempty_status(body):
            found.append("body")
        elif kind == "form":
            for key, value in body:
                if normalized_key(key).endswith("status") and not is_empty_filter(value):
                    found.append("body")
        return sorted(set(found))

    def canonical_filters(self) -> "RequestTemplate":
        """Clear only confirmed list filters; preserve pageSize and unknown keys."""
        result = self.clone()
        parsed, pairs = result._query_pairs()
        canonical_pairs: List[Tuple[str, str]] = []
        for key, value in pairs:
            normalized = normalized_key(key)
            if normalized in EMPTY_FILTER_KEYS:
                value = "[]" if value.strip().startswith("[") else ""
            elif normalized == "recent":
                value = "0"
            canonical_pairs.append((key, value))
        result._set_query_pairs(parsed, canonical_pairs)

        kind, body = result._decoded_body()
        if kind == "json" and isinstance(body, dict):
            canonicalize_nested_filters(body)
            result._set_body(kind, body)
        elif kind == "form":
            form = []
            for key, value in body:
                normalized = normalized_key(key)
                if normalized in EMPTY_FILTER_KEYS:
                    value = "[]" if value.strip().startswith("[") else ""
                elif normalized == "recent":
                    value = "0"
                form.append((key, value))
            result._set_body(kind, form)
        return result

    def rewrite_date(self, window: DateWindow) -> Tuple["RequestTemplate", int, bool]:
        if window.basis == "success":
            # The backend's completion picker sends update_time, independently
            # of create_time. Never rewrite both to the same day.
            result = self.clone()
            created = [window.created_since, window.utc_end] if window.created_since else []
            parsed, pairs = result._query_pairs()
            pairs = [(k, v) for k, v in pairs if k not in {
                "create_time", "create_time[0]", "create_time[1]",
                "update_time", "update_time[0]", "update_time[1]", "status"}]
            status = "1" if self.data_type == "charge" else "3"
            if self.method == "GET":
                pairs += [("update_time[0]", window.utc_start), ("update_time[1]", window.utc_end), ("status", status)]
                pairs += [(f"create_time[{i}]", v) for i, v in enumerate(created)]
                result._set_query_pairs(parsed, pairs)
            else:
                kind, body = result._decoded_body()
                if kind != "json" or not isinstance(body, dict):
                    raise CollectorError("成功时间请求必须是已确认的 JSON 模板")
                body.update(create_time=created, update_time=[window.utc_start, window.utc_end], status=status)
                result._set_body(kind, body)
            return result, 2, True
        result = self.clone()
        touched = 0
        changed = False

        parsed, pairs = result._query_pairs()
        new_pairs: List[Tuple[str, str]] = []
        for key, value in pairs:
            new_value, count, item_changed = rewrite_named_date(key, value, window)
            if count == 0:
                decoded = try_json(value)
                if isinstance(decoded, (dict, list)):
                    decoded, count, item_changed = rewrite_dates_nested(decoded, window)
                    if count:
                        new_value = json.dumps(decoded, ensure_ascii=False, separators=(",", ":"))
            touched += count
            changed = changed or item_changed
            new_pairs.append((key, str(new_value)))
        result._set_query_pairs(parsed, new_pairs)

        kind, body = result._decoded_body()
        if kind == "json":
            body, count, item_changed = rewrite_dates_nested(body, window)
            touched += count
            changed = changed or item_changed
            result._set_body(kind, body)
        elif kind == "form":
            new_form = []
            for key, value in body:
                new_value, count, item_changed = rewrite_named_date(key, value, window)
                touched += count
                changed = changed or item_changed
                new_form.append((key, new_value))
            result._set_body(kind, new_form)
        return result, touched, changed

    def page_values(self) -> List[int]:
        values: List[int] = []
        _, pairs = self._query_pairs()
        for key, value in pairs:
            if is_page_key(key):
                values.append(numeric_page(value))
        kind, body = self._decoded_body()
        if kind == "json":
            for key, value in walk_dict(body):
                if is_page_key(key):
                    values.append(numeric_page(value))
        elif kind == "form":
            for key, value in body:
                if is_page_key(key):
                    values.append(numeric_page(value))
        return values

    def with_page_size(self, requested_size: int) -> "RequestTemplate":
        """Raise the captured page size without changing any other request field."""
        result = self.clone()
        touched = 0
        parsed, pairs = result._query_pairs()
        updated_pairs: List[Tuple[str, str]] = []
        for key, value in pairs:
            if normalized_key(key) in PAGE_SIZE_KEYS:
                value = str(requested_size)
                touched += 1
            updated_pairs.append((key, value))
        result._set_query_pairs(parsed, updated_pairs)
        kind, body = result._decoded_body()
        if kind == "json":
            touched += mutate_page_size_nested(body, requested_size)
            result._set_body(kind, body)
        elif kind == "form":
            updated_form = []
            for key, value in body:
                if normalized_key(key) in PAGE_SIZE_KEYS:
                    value = str(requested_size)
                    touched += 1
                updated_form.append((key, value))
            result._set_body(kind, updated_form)
        if touched == 0:
            raise RuntimeError("捕获请求没有 pageSize 字段，无法安全调整分页大小")
        return result

    def with_page(self, requested_page: int, observed_current_page: int) -> "RequestTemplate":
        values = self.page_values()
        if not values:
            raise RuntimeError("多页响应没有可安全修改的 page 字段，拒绝只采首页")
        offsets = {value - observed_current_page for value in values}
        if len(offsets) != 1:
            raise RuntimeError("请求中多个 page 字段含义不一致，拒绝猜测分页")
        target_value = requested_page + next(iter(offsets))
        if target_value < 0:
            raise RuntimeError("分页基数推断无效")
        result = self.clone()
        parsed, pairs = result._query_pairs()
        result._set_query_pairs(
            parsed,
            [(key, str(target_value) if is_page_key(key) else value) for key, value in pairs],
        )
        kind, body = result._decoded_body()
        if kind == "json":
            mutate_pages_nested(body, target_value)
            result._set_body(kind, body)
        elif kind == "form":
            result._set_body(kind, [
                (key, str(target_value) if is_page_key(key) else value) for key, value in body
            ])
        return result


def try_json(value: str) -> Any:
    stripped = value.strip()
    if not stripped.startswith(("{", "[")):
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def walk_dict(value: Any) -> Iterable[Tuple[str, Any]]:
    if isinstance(value, dict):
        for key, item in value.items():
            yield str(key), item
            yield from walk_dict(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_dict(item)


def nested_nonempty_status(value: Any) -> bool:
    for key, item in walk_dict(value):
        if normalized_key(key).endswith("status") and not is_empty_filter(item):
            return True
    return False


def canonicalize_nested_filters(value: Any) -> None:
    if isinstance(value, dict):
        for key in list(value):
            normalized = normalized_key(key)
            if normalized in EMPTY_FILTER_KEYS:
                value[key] = [] if isinstance(value[key], list) else ""
            elif normalized == "updatetime":
                value[key] = []
            elif normalized == "recent":
                value[key] = 0
            else:
                canonicalize_nested_filters(value[key])
    elif isinstance(value, list):
        for item in value:
            canonicalize_nested_filters(item)


def date_key_kind(key: str) -> str:
    normalized = normalized_key(key)
    starts = ("starttime", "startdate", "begintime", "begindate", "fromtime", "fromdate", "createtimestart")
    ends = ("endtime", "enddate", "stoptime", "todate", "totime", "createtimeend")
    ranges = ("createtime", "createdate", "daterange", "timerange")
    if any(normalized.endswith(value) for value in starts):
        return "start"
    if any(normalized.endswith(value) for value in ends):
        return "end"
    if any(normalized.endswith(value) for value in ranges):
        return "range"
    return ""


def replace_date_bound(value: Any, window: DateWindow, bound: str) -> Tuple[Any, int, bool]:
    if not isinstance(value, str) or not DATE_TOKEN_RE.search(value):
        return value, 0, False
    is_end = bound == "end"
    # The confirmed GEMS filters are UTC ISO values. Preserve that transport
    # style while deriving the range from the requested business timezone.
    if "T" in value and (value.endswith("Z") or re.search(r"[+-]\d{2}:?\d{2}$", value)):
        replaced = window.utc_end if is_end else window.utc_start
    elif re.search(r"\d{2}:\d{2}:\d{2}", value):
        replaced = window.local_end if is_end else window.local_start
    else:
        replaced = window.local_day.isoformat()
    return replaced, 1, replaced != value


def rewrite_named_date(key: str, value: Any, window: DateWindow) -> Tuple[Any, int, bool]:
    kind = date_key_kind(key)
    if not kind:
        return value, 0, False
    bracket = re.search(r"\[(\d+)\]$", key)
    if bracket:
        kind = "start" if bracket.group(1) == "0" else "end"
    if kind == "range" and isinstance(value, list):
        output = []
        touched = 0
        changed = False
        for index, item in enumerate(value):
            new_item, count, item_changed = replace_date_bound(
                item, window, "start" if index == 0 else "end"
            )
            output.append(new_item)
            touched += count
            changed = changed or item_changed
        return output, touched, changed
    return replace_date_bound(value, window, "end" if kind == "end" else "start")


def rewrite_dates_nested(value: Any, window: DateWindow) -> Tuple[Any, int, bool]:
    if isinstance(value, list):
        output = []
        touched = 0
        changed = False
        for item in value:
            new_item, count, item_changed = rewrite_dates_nested(item, window)
            output.append(new_item)
            touched += count
            changed = changed or item_changed
        return output, touched, changed
    if not isinstance(value, dict):
        return value, 0, False
    output: Dict[str, Any] = {}
    touched = 0
    changed = False
    for key, item in value.items():
        new_item, count, item_changed = rewrite_named_date(str(key), item, window)
        if count == 0:
            new_item, count, item_changed = rewrite_dates_nested(item, window)
        output[key] = new_item
        touched += count
        changed = changed or item_changed
    return output, touched, changed


def is_page_key(key: Any) -> bool:
    normalized = normalized_key(key)
    return normalized in PAGE_KEYS or any(normalized.endswith(value) for value in PAGE_KEYS if value != "page")


def numeric_page(value: Any) -> int:
    if isinstance(value, bool):
        raise RuntimeError("分页字段不是整数")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("分页字段不是整数") from exc
    if str(result) != str(value).strip() and not isinstance(value, int):
        raise RuntimeError("分页字段不是规范整数")
    return result


def mutate_pages_nested(value: Any, target: int) -> None:
    if isinstance(value, dict):
        for key in list(value):
            if is_page_key(key):
                value[key] = str(target) if isinstance(value[key], str) else target
            else:
                mutate_pages_nested(value[key], target)
    elif isinstance(value, list):
        for item in value:
            mutate_pages_nested(item, target)


def mutate_page_size_nested(value: Any, target: int) -> int:
    touched = 0
    if isinstance(value, dict):
        for key in list(value):
            if normalized_key(key) in PAGE_SIZE_KEYS:
                value[key] = str(target) if isinstance(value[key], str) else target
                touched += 1
            else:
                touched += mutate_page_size_nested(value[key], target)
    elif isinstance(value, list):
        for item in value:
            touched += mutate_page_size_nested(item, target)
    return touched


class CDPClient:
    def __init__(self, ws_url: str, timeout: int = 30):
        if websocket is None:
            raise RuntimeError("缺少 websocket-client，请执行 pip3 install websocket-client")
        self.ws = websocket.create_connection(ws_url, timeout=timeout, suppress_origin=True)
        self.ws.settimeout(timeout)
        self.message_id = 0
        self.events: List[Dict[str, Any]] = []

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass

    def call(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: int = 60) -> Dict[str, Any]:
        self.message_id += 1
        message_id = self.message_id
        deadline = time.monotonic() + timeout
        self.ws.settimeout(timeout)
        self.ws.send(json.dumps({"id": message_id, "method": method, "params": params or {}}, ensure_ascii=True).encode("utf-8"))
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CollectorError(f"Chrome 调试请求超时：{method}", retryable=True)
            self.ws.settimeout(remaining)
            data = json.loads(self.ws.recv())
            if data.get("id") == message_id:
                if "error" in data:
                    raise CollectorError(f"Chrome 调试请求失败：{method}", retryable=True)
                return data.get("result", {})
            if data.get("method"):
                self.events.append(data)
                if len(self.events) > 200:
                    del self.events[:-200]

    def eval(self, expression: str, await_promise: bool = True, timeout: int = 60) -> Any:
        result = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": await_promise},
            timeout,
        ).get("result", {})
        if "value" in result:
            return result["value"]
        raise RuntimeError("Chrome 页面执行没有返回值")

    def wait_event(self, method: str, predicate: Any, timeout: int) -> Optional[Dict[str, Any]]:
        deadline = time.monotonic() + timeout
        self.ws.settimeout(1)
        while time.monotonic() < deadline:
            for index, event in enumerate(self.events):
                if event.get("method") == method and predicate(event):
                    return self.events.pop(index)
            try:
                data = json.loads(self.ws.recv())
            except Exception:
                continue
            if data.get("method") == method and predicate(data):
                return data
            if data.get("method"):
                self.events.append(data)
        return None

    def drain_events(self, seconds: float = 2.0) -> None:
        """Briefly drain CDP events without logging request or response content."""
        deadline = time.monotonic() + max(0.0, seconds)
        self.ws.settimeout(0.25)
        while time.monotonic() < deadline:
            try:
                data = json.loads(self.ws.recv())
            except Exception:
                continue
            if data.get("method"):
                self.events.append(data)


def http_json(url: str, timeout: int = 10) -> Any:
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.get(url, timeout=timeout)
        response.raise_for_status()
        return response.json()
    finally:
        try:
            response.close()
        except UnboundLocalError:
            pass
        session.close()


def cdp_targets(cdp_http: str) -> List[Dict[str, Any]]:
    payload = http_json(cdp_http.rstrip("/") + "/json")
    if not isinstance(payload, list):
        raise RuntimeError("Chrome 调试目标列表格式无效")
    return [item for item in payload if isinstance(item, dict) and item.get("type") == "page" and item.get("webSocketDebuggerUrl")]


def safe_target_label(target: Dict[str, Any]) -> str:
    parsed = urlparse(text(target.get("url")))
    host = (parsed.hostname or "-").lower()
    title = re.sub(r"[\r\n\t]+", " ", text(target.get("title")))[:80]
    return f"host={host} title={title or '-'}"


def choose_target(platform: Platform, cdp_http: str) -> Dict[str, Any]:
    matches = []
    for target in cdp_targets(cdp_http):
        parsed = urlparse(text(target.get("url")))
        if parsed.scheme == "https" and (parsed.hostname or "").lower() == platform.host:
            score = 10 + (0 if "login" in text(target.get("url")).lower() else 20)
            if (AUTOLOGIN_MANAGER is not None and
                    target.get("id") == AUTOLOGIN_MANAGER.preferred_targets.get(platform.name)):
                score += 100
            matches.append((score, target))
    if not matches:
        raise LoginRequired(f"固定 Chrome 找不到 {platform.name} 页面；需要打开已绑定登录页")
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1]


def discover_origin(name: str, cdp_http: str) -> str:
    needle = name.lower()
    matches: List[str] = []
    for target in cdp_targets(cdp_http):
        raw_url = text(target.get("url"))
        parsed = urlparse(raw_url)
        title = text(target.get("title")).lower()
        host = (parsed.hostname or "").lower()
        if parsed.scheme == "https" and (needle in host or needle in title):
            matches.append(f"https://{host}")
    unique = sorted(set(matches))
    if len(unique) != 1:
        reason = "没有候选页" if not unique else "候选 host 不唯一"
        raise RuntimeError(f"{name} 未配置 URL，Chrome {reason}；请用 --platform-url {name}=https://host")
    return unique[0]


def platform_from_url(name: str, raw_url: str, platform_id: str = "") -> Platform:
    parsed = urlparse(raw_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError(f"{name} URL 必须是无用户名密码的 HTTPS 地址")
    origin = f"https://{parsed.hostname.lower()}"
    if parsed.port:
        origin += f":{parsed.port}"
    if platform_id:
        try:
            uuid.UUID(platform_id)
        except ValueError as exc:
            raise RuntimeError(f"{name} platform_id 不是 UUID") from exc
    return Platform(name=name, origin=origin, host=(parsed.hostname or "").lower(), platform_id=platform_id)


def decode_login_token(raw: Any) -> str:
    """Decode the one token value stored by the logged-in admin page."""
    if not isinstance(raw, str) or not raw.strip():
        raise LoginRequired("现有页面没有 token，请先在该平台重新登录")
    candidate = raw.strip()
    try:
        decoded = json.loads(candidate)
    except json.JSONDecodeError:
        decoded = None
    if isinstance(decoded, str):
        candidate = decoded.strip()
    if candidate.lower().startswith("bearer "):
        candidate = candidate[7:].strip()
    if not JWT_RE.fullmatch(candidate):
        raise LoginRequired("现有页面 token 格式无效，请重新登录")
    try:
        segment = candidate.split(".")[1]
        padded = segment + "=" * (-len(segment) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        expires_at = float(claims.get("exp"))
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise LoginRequired("现有页面 token 无法验证，请重新登录") from exc
    if not math.isfinite(expires_at) or expires_at <= time.time() + 5:
        raise LoginRequired("现有页面登录已过期，请重新登录")
    return candidate


def existing_tab_state(client: CDPClient, platform: Platform) -> Tuple[str, str]:
    """Read only token/origin from an already-open tab; never navigate it."""
    state = client.eval("""(() => ({
      origin: location.origin,
      localToken: localStorage.getItem('token'),
      sessionToken: sessionStorage.getItem('token'),
      userAgent: navigator.userAgent
    }))()""", await_promise=False, timeout=15)
    if not isinstance(state, dict) or text(state.get("origin")).rstrip("/").lower() != platform.origin.rstrip("/").lower():
        raise RuntimeError(f"{platform.name} 现有页面来源不匹配")
    raw_token = state.get("localToken") or state.get("sessionToken")
    return decode_login_token(raw_token), text(state.get("userAgent"))


def attach_existing_tab(platform: Platform, cdp_http: str) -> Tuple[CDPClient, str]:
    """Attach to the user's existing tab without creating or changing pages."""
    descriptor = choose_target(platform, cdp_http)
    client = CDPClient(text(descriptor.get("webSocketDebuggerUrl")), timeout=30)
    try:
        _, user_agent = existing_tab_state(client, platform)
        return client, user_agent
    except Exception:
        client.close()
        raise


def static_request_template(platform: Platform, data_type: str) -> RequestTemplate:
    """Build the confirmed list request independently of the visible UI state."""
    seed = build_date_window(date(2026, 9, 16))
    start, end = seed.utc_start, seed.utc_end
    headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh_CN",
        "content-type": "application/json;charset=UTF-8",
    }
    if data_type == "charge":
        query = [
            ("page", "1"), ("pageSize", "2000"),
            ("create_time[0]", start), ("create_time[1]", end),
            ("uid", ""), ("first_pay", ""), ("order_num", ""),
            ("charge_id", ""), ("charge_type", ""),
            ("pay_channel_type", ""), ("pay_channel_name", ""),
            ("pay_method", ""), ("pay_type", ""), ("out_trade_no", ""),
            ("status", ""), ("recent", "0"),
        ]
        template = RequestTemplate(
            data_type, "GET",
            platform.origin + ORDER_SPECS[data_type]["api_path"] + "?" + urlencode(query),
            headers, None,
        )
    elif data_type == "withdraw":
        body = {
            "page": 1, "pageSize": 2000, "create_time": [start, end],
            "uid": "", "channel": [], "pay_channel_name": "",
            "pay_channel": "", "order_num": "", "out_trade_no": "",
            "is_first": "", "update_time": [], "status": "",
            "not_to_back_cash": "", "recent": 0,
        }
        template = RequestTemplate(
            data_type, "POST", platform.origin + ORDER_SPECS[data_type]["api_path"],
            headers, json.dumps(body, ensure_ascii=False, separators=(",", ":")),
        )
    else:
        raise RuntimeError("data_type 只允许 charge/withdraw")
    template.validate(platform)
    return template


class ReplayClient:
    """Execute same-origin fetches inside an existing logged-in browser tab."""
    def __init__(self, platform: Platform, cdp_http: str, timeout: int, deadline: Optional[float] = None):
        self.platform = platform
        self.cdp_http = cdp_http
        self.timeout = timeout
        self.deadline = deadline
        self.background: Optional[CDPClient] = None
        # Attach lazily inside the bounded retry loop, including the first attach.

    def _attach(self) -> None:
        self.close()
        self.background, _ = attach_existing_tab(self.platform, self.cdp_http)

    def close(self) -> None:
        if self.background is not None:
            self.background.close()
            self.background = None

    def _headers(self, template: RequestTemplate) -> Dict[str, str]:
        if self.background is None:
            raise RuntimeError("Chrome 页面连接已关闭")
        token, _ = existing_tab_state(self.background, self.platform)
        headers = {
            key: value for key, value in template.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS
            and key.lower() != "authorization"
            and not key.startswith(":")
        }
        headers["authorization"] = "Bearer " + token
        return headers

    def _fetch_once(self, template: RequestTemplate, expected_path: str) -> Dict[str, Any]:
        parsed = urlparse(template.url)
        allowed = {ORDER_SPECS[template.data_type]["api_path"], f"/api/operate/{template.data_type}Order/payChannel"}
        if (f"{parsed.scheme}://{parsed.netloc}".lower() != self.platform.origin.lower()
                or parsed.username or parsed.password or parsed.path != expected_path
                or expected_path not in allowed or template.method not in {"GET", "POST"}):
            raise CollectorError(f"{self.platform.name} 静态请求不在允许列表")
        if self.background is None:
            self._attach()
        headers = self._headers(template)
        remaining = self.timeout if self.deadline is None else min(self.timeout, self.deadline - time.monotonic())
        if remaining <= 0:
            raise CollectorError("单项任务达到时间预算，留待下轮；其它任务继续", retryable=True)
        # CDP socket timeout alone does not cancel an outstanding browser fetch.
        expression = """
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), __TIMEOUT__);
      try {
        const response = await fetch(__URL__, {
          method: __METHOD__, headers: __HEADERS__, body: __BODY__,
          credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal
        });
        return {ok: response.ok, status: response.status, text: await response.text()};
      } catch (error) {
        return {ok: false, status: 0};
      } finally { clearTimeout(timer); }
    })()
    """.replace("__URL__", json.dumps(template.url, ensure_ascii=True))
        expression = expression.replace("__METHOD__", json.dumps(template.method, ensure_ascii=True))
        expression = expression.replace("__HEADERS__", json.dumps(headers, ensure_ascii=True))
        expression = expression.replace("__BODY__", "null" if template.post_data is None else json.dumps(template.post_data, ensure_ascii=True))
        expression = expression.replace("__TIMEOUT__", str(max(1, int(remaining * 1000))))
        result = self.background.eval(expression, timeout=remaining + 5)
        if not isinstance(result, dict):
            raise CollectorError("浏览器请求没有返回 HTTP 结果", retryable=True)
        status = int(result.get("status") or 0)
        if not result.get("ok") or not 200 <= status < 300:
            raise SourceHTTPError(status)
        try:
            payload = json.loads(text(result.get("text")))
        except json.JSONDecodeError as exc:
            raise CollectorError("GEMS API 返回非 JSON（正文不记录）", retryable=True) from exc
        if not isinstance(payload, dict):
            raise CollectorError("GEMS API JSON 顶层不是对象")
        if payload.get("success") is not True and text(payload.get("code")) in {"401", "403", "408", "429", "500", "502", "503", "504"}:
            raise SourceHTTPError(int(payload["code"]))
        return payload

    def _fetch(self, template: RequestTemplate, expected_path: str) -> Dict[str, Any]:
        last_error: Optional[Exception] = None
        for attempt in range(1, 5):
            try:
                if self.deadline is not None and time.monotonic() >= self.deadline:
                    raise CollectorError("单项任务达到时间预算，留待下轮", retryable=True)
                return self._fetch_once(template, expected_path)
            except (LoginRequired, SourceHTTPError) as exc:
                needs_login = isinstance(exc, LoginRequired) or exc.status == 401
                if needs_login and AUTOLOGIN_MANAGER is not None and AUTOLOGIN_MANAGER.enabled(self.platform.name):
                    self.close()
                    AUTOLOGIN_MANAGER.recover(self.platform, template.data_type, self.deadline)
                    # Do not combine pages obtained before and after relogin.
                    raise SessionRecovered() from None
                if not exc.retryable:
                    raise
                last_error = exc
            except CollectorError as exc:
                if not exc.retryable:
                    raise
                last_error = exc
            except RuntimeError as exc:
                if any(word in str(exc) for word in ("登录", "token", "允许列表", "来源不匹配")):
                    raise CollectorError(redact_text(exc), scope="platform") from exc
                last_error = exc
            except Exception as exc:
                last_error = exc
            self.close()
            if attempt < 4:
                delay = attempt * 2
                if self.deadline is not None and time.monotonic() + delay >= self.deadline:
                    break
                log(f"现有页面请求失败 {attempt}/4：{safe_error(last_error)}；{delay} 秒后重试", self.platform.name)
                time.sleep(delay)
        raise CollectorError(f"现有页面请求重试用尽：{safe_error(last_error or RuntimeError('unknown'))}", retryable=True)

    def request(self, template: RequestTemplate) -> Dict[str, Any]:
        template.validate(self.platform)
        return self._fetch(template, ORDER_SPECS[template.data_type]["api_path"])

    def channel_dictionary(self, data_type: str) -> Dict[str, str]:
        path = f"/api/operate/{data_type}Order/payChannel"
        template = RequestTemplate(
            data_type, "GET", self.platform.origin + path,
            {
                "accept": "application/json, text/plain, */*",
                "accept-language": "zh_CN",
                "content-type": "application/json;charset=UTF-8",
            },
            None,
        )
        return parse_channel_dictionary(self._fetch(template, path), self.platform, data_type)


def parse_page(payload: Dict[str, Any], data_type: str) -> ParsedPage:
    if payload.get("success") is not True or payload.get("code") != 200:
        raise RuntimeError("GEMS API 业务状态不是 success=true/code=200")
    expected_path = ORDER_SPECS[data_type]["api_path"]
    response_paths = {expected_path, expected_path.removeprefix("/api")}
    if payload.get("path") not in (None, *response_paths):
        raise RuntimeError("GEMS API 响应 path 不匹配")
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("items"), list) or not isinstance(data.get("pageInfo"), dict):
        raise RuntimeError("GEMS API 缺少 data.items/pageInfo")
    items: List[Dict[str, Any]] = []
    for index, item in enumerate(data["items"]):
        if not isinstance(item, dict):
            raise RuntimeError(f"GEMS data.items[{index}] 不是对象")
        items.append(item)
    info = data["pageInfo"]
    return ParsedPage(
        items=items,
        total=strict_int(info.get("total"), "data.pageInfo.total"),
        current_page=strict_int(info.get("currentPage"), "data.pageInfo.currentPage"),
        total_page=strict_int(info.get("totalPage"), "data.pageInfo.totalPage"),
    )


def validate_item_date(item: Dict[str, Any], window: DateWindow) -> None:
    """Validate by the requested UTC interval, not by the raw date prefix.

    Runtime windows use the India backend calendar day. Explicitly offset
    timestamps are compared by instant, not by an arbitrary raw date prefix.
    Naive backend timestamps are interpreted in the same fixed India zone.
    """
    field = "update_time" if window.basis == "success" else "create_time"
    normalized = db_datetime(item.get(field))
    if not normalized:
        raise RuntimeError(f"订单 {field} 缺失，拒绝写入")
    try:
        created = datetime.fromisoformat(normalized.replace("Z", "+00:00")).astimezone(timezone.utc)
        start = datetime.fromisoformat(window.utc_start.replace("Z", "+00:00"))
        end = datetime.fromisoformat(window.utc_end.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RuntimeError(f"订单 {field} 无法转换为带时区时间") from exc
    if not start <= created <= end:
        raise RuntimeError(f"订单 {field} 不在所选后台日期范围；检查源接口筛选，未丢弃后冒充完整数据")
    if window.basis == "success":
        origin = db_datetime(item.get("create_time"))
        if not origin:
            raise CollectorError("成功订单缺少创建时间")
        origin_at = datetime.fromisoformat(origin.replace("Z", "+00:00"))
        if origin_at > created:
            raise CollectorError("成功时间早于创建时间，拒绝写入")
        if window.created_since and origin_at < datetime.fromisoformat(window.created_since.replace("Z", "+00:00")):
            raise CollectorError("源接口未遵守创建时间下限")


def fetch_all_pages(
    client: ReplayClient,
    template: RequestTemplate,
    data_type: str,
    window: DateWindow,
    use_captured_filters: bool,
    platform_name: str,
    page_size: int,
) -> Tuple[List[Dict[str, Any]], int]:
    if not use_captured_filters:
        template = template.canonical_filters()
    template = template.with_page_size(page_size)
    status_filters = template.nonempty_status_filters()
    if status_filters and not use_captured_filters:
        raise RuntimeError("捕获请求带非空 status 筛选；请先把后台状态设为“全部”")
    dated, touched, changed = template.rewrite_date(window)
    if touched == 0 and not use_captured_filters:
        raise RuntimeError("捕获请求没有可识别日期字段；拒绝猜测日期参数")
    if changed and template.dynamic_markers():
        raise RuntimeError("请求含动态签名/时间戳，修改日期后不能安全重放")

    log(f"{window.local_day} {data_type} 请求目标：{window.timezone_name} "
        f"{window.local_start} .. {window.local_end}；UTC {window.utc_start} .. {window.utc_end}；"
        f"源无偏移时间按 {SOURCE_TIMEZONE_NAME} 解释", platform_name)
    page_started = time.monotonic()
    initial = parse_page(client.request(dated), data_type)
    log(f"{window.local_day} {data_type} 分页 {initial.current_page}/{initial.total_page}，"
        f"本页={len(initial.items)} 总数={initial.total} 耗时={time.monotonic()-page_started:.1f}s", platform_name)
    for item in initial.items:
        validate_item_date(item, window)
        if window.basis == "success" and str(item.get("status")) != ("1" if data_type == "charge" else "3"):
            raise CollectorError("成功时间请求返回非成功订单，拒绝记为完整采集")
    if initial.total_page == 0:
        if initial.total != 0 or initial.items:
            raise RuntimeError("空分页的 total/items 不一致")
        return [], 1

    if initial.current_page < 1 or initial.current_page > initial.total_page:
        raise RuntimeError("响应 currentPage 超出 totalPage")
    page_values = dated.page_values()
    if initial.total_page > 1 and not page_values:
        raise RuntimeError("响应有多页但请求没有可修改的页码字段")
    if initial.total_page > 1 and dated.dynamic_markers():
        raise RuntimeError("请求含动态签名/时间戳，不能安全生成第二页请求")

    pages: Dict[int, ParsedPage] = {initial.current_page: initial}
    for page_number in range(1, initial.total_page + 1):
        if page_number in pages:
            continue
        page_template = dated.with_page(page_number, initial.current_page)
        page_started = time.monotonic()
        page = parse_page(client.request(page_template), data_type)
        if page.current_page != page_number:
            raise RuntimeError("分页重放返回的 currentPage 与请求不一致")
        if page.total != initial.total or page.total_page != initial.total_page:
            raise RuntimeError("分页期间 total/totalPage 变化，拒绝写入不完整快照")
        for item in page.items:
            validate_item_date(item, window)
            if window.basis == "success" and str(item.get("status")) != ("1" if data_type == "charge" else "3"):
                raise CollectorError("成功时间请求返回非成功订单，拒绝记为完整采集")
        pages[page_number] = page
        log(f"{data_type} 分页 {page_number}/{initial.total_page}，本页={len(page.items)} 耗时={time.monotonic()-page_started:.1f}s", platform_name)

    unique: Dict[str, Dict[str, Any]] = {}
    for page_number in sorted(pages):
        for item in pages[page_number].items:
            vendor_id = identifier(item.get("id"), f"{data_type}.id")
            if vendor_id in unique:
                raise RuntimeError("分页出现重复订单 ID，拒绝把不稳定分页当完整数据")
            unique[vendor_id] = item
    if len(unique) != initial.total:
        raise RuntimeError(f"分页完整性失败：唯一订单={len(unique)}，API total={initial.total}")
    return list(unique.values()), len(pages)


def provider_code(value: Any, field: str) -> Optional[str]:
    source = scalar(value, field)
    return None if source is None or source == "" else str(source)


def valid_channel_name(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate or len(candidate) > 80 or candidate.isdigit():
        return None
    if "@" in candidate or re.fullmatch(r"[\d .+()_-]{6,}", candidate):
        return None
    return candidate


def read_verified_channel_map(name: str, data_type: str) -> Dict[str, str]:
    """Return the audited baseline; charge/withdraw are isolated by caller."""
    if name not in PLATFORM_NAMES or data_type not in ORDER_SPECS:
        return {}
    return dict(VERIFIED_CHANNEL_MAPS.get(name, {}))


def parse_channel_dictionary(payload: Any, platform: Platform, data_type: str) -> Dict[str, str]:
    """Validate the exact payChannel response without accepting generic IDs."""
    if not isinstance(payload, dict) or payload.get("success") is not True or payload.get("code") != 200:
        raise RuntimeError(f"{platform.name} {data_type} 渠道字典业务状态无效")
    expected_path = f"/api/operate/{data_type}Order/payChannel"
    response_paths = {expected_path, expected_path.removeprefix("/api")}
    if payload.get("path") not in (None, *response_paths):
        raise RuntimeError(f"{platform.name} {data_type} 渠道字典 path 不匹配")
    source = payload.get("data")
    if isinstance(source, dict):
        source = source["list"] if "list" in source else source.get("items")
    if not isinstance(source, list) or len(source) > 5_000:
        raise RuntimeError(f"{platform.name} {data_type} 渠道字典 data 不是有效列表")
    result: Dict[str, str] = {}
    conflicts: set = set()
    for index, item in enumerate(source):
        if not isinstance(item, dict):
            raise RuntimeError(f"{platform.name} 渠道字典第 {index + 1} 项不是对象")
        raw_code = item.get("value", item.get("id", item.get("code")))
        code = provider_code(raw_code, f"{data_type}.payChannel.value")
        name = valid_channel_name(item.get("label", item.get("name")))
        if not code or not name:
            raise RuntimeError(f"{platform.name} 渠道字典第 {index + 1} 项缺少 value/label")
        if code in result and result[code] != name:
            conflicts.add(code)
        result[code] = name
    if conflicts:
        raise DictionaryConflict({k: v for k, v in result.items() if k not in conflicts}, conflicts)
    return result


def capture_channel_dictionary(
    client: CDPClient,
    platform: Platform,
    data_type: str,
    timeout: int = 8,
) -> Dict[str, str]:
    """Read only the exact dictionary XHR already loaded by the admin page."""
    expected_path = f"/api/operate/{data_type}Order/payChannel"

    def matches(event: Dict[str, Any]) -> bool:
        params = event.get("params", {})
        response = params.get("response", {}) if isinstance(params, dict) else {}
        parsed = urlparse(text(response.get("url")))
        return (
            parsed.scheme == "https"
            and (parsed.hostname or "").lower() == platform.host
            and parsed.path == expected_path
            and text(params.get("type")) in {"XHR", "Fetch"}
        )

    event = client.wait_event("Network.responseReceived", matches, timeout)
    if event is None:
        return {}
    request_id = text(event.get("params", {}).get("requestId"))
    if not request_id:
        return {}
    client.wait_event(
        "Network.loadingFinished",
        lambda item: text(item.get("params", {}).get("requestId")) == request_id,
        3,
    )
    try:
        body_result = client.call("Network.getResponseBody", {"requestId": request_id}, 10)
        body = body_result.get("body") if isinstance(body_result, dict) else None
        if body_result.get("base64Encoded") or not isinstance(body, str) or len(body) > 5_000_000:
            return {}
        payload = json.loads(body)
    except (RuntimeError, json.JSONDecodeError):
        return {}
    return parse_channel_dictionary(payload, platform, data_type)


def add_channel_candidate(
    candidates: Dict[str, set], codes: set, code_value: Any, name_value: Any,
) -> None:
    if isinstance(code_value, bool) or not isinstance(code_value, (str, int)):
        return
    code = str(code_value).strip()
    name = valid_channel_name(name_value)
    if code in codes and name is not None:
        candidates.setdefault(code, set()).add(name)


def extract_channel_candidates(
    value: Any,
    codes: set,
    candidates: Dict[str, set],
    context: str = "",
) -> None:
    if isinstance(value, list):
        for item in value:
            extract_channel_candidates(item, codes, candidates, context)
        return
    if not isinstance(value, dict):
        return

    # Explicit routing pairs are safe even when the surrounding response has
    # no descriptive path. Generic id/name pairs require a channel-like
    # ancestor so an order/user id can never become a provider name by chance.
    explicit_pairs = (
        ("pay_channel", "pay_channel_name"),
        ("pay_channel_id", "pay_channel_name"),
        ("pay_method", "pay_method_name"),
        ("pay_method", "pay_channel_name"),
        ("pay_method_id", "pay_method_name"),
        ("channel_id", "channel_name"),
        ("channel_code", "channel_name"),
    )
    for code_key, name_key in explicit_pairs:
        if code_key in value and name_key in value:
            add_channel_candidate(candidates, codes, value[code_key], value[name_key])

    clue = normalized_key(context)
    if any(token in clue for token in ("channel", "paymethod", "payment", "provider")):
        for code_key in ("id", "code", "value"):
            for name_key in ("name", "label", "title", "channel_name", "pay_channel_name", "pay_method_name"):
                if code_key in value and name_key in value:
                    add_channel_candidate(candidates, codes, value[code_key], value[name_key])

    for key, item in value.items():
        extract_channel_candidates(item, codes, candidates, context + "/" + str(key))


def learn_channel_names(
    client: CDPClient,
    platform: Platform,
    codes: set,
) -> Dict[str, str]:
    """Learn unambiguous ID/name pairs from same-origin Fetch/XHR JSON only."""
    if not codes:
        return {}
    client.drain_events(2.0)
    response_events = [
        event for event in list(client.events)
        if event.get("method") == "Network.responseReceived"
    ]
    candidates: Dict[str, set] = {}
    seen_request_ids = set()
    for event in response_events[:100]:
        params = event.get("params", {})
        response = params.get("response", {}) if isinstance(params, dict) else {}
        parsed = urlparse(text(response.get("url")))
        request_id = text(params.get("requestId"))
        resource_type = text(params.get("type"))
        mime = text(response.get("mimeType")).lower()
        if (
            not request_id
            or request_id in seen_request_ids
            or parsed.scheme != "https"
            or (parsed.hostname or "").lower() != platform.host
            or resource_type not in {"XHR", "Fetch"}
            or ("json" not in mime and mime not in {"", "text/plain"})
        ):
            continue
        seen_request_ids.add(request_id)
        try:
            result = client.call("Network.getResponseBody", {"requestId": request_id}, 10)
            body = result.get("body") if isinstance(result, dict) else None
            if result.get("base64Encoded") or not isinstance(body, str) or len(body) > 5_000_000:
                continue
            payload = json.loads(body)
        except Exception:
            continue
        extract_channel_candidates(payload, codes, candidates, parsed.path)
    return {
        code: next(iter(names)) for code, names in candidates.items()
        if len(names) == 1
    }


def learn_table_channel_names(
    client: CDPClient,
    items: List[Dict[str, Any]],
    data_type: str,
) -> Dict[str, str]:
    """Read only identifier/channel cells from the rendered table, never full rows."""
    expression = r"""
(() => {
  const clean = value => String(value || '').replace(/\s+/g, '').toLowerCase();
  return Array.from(document.querySelectorAll('table')).flatMap(table => {
    // Fixed-column components clone tables. Index headers and rows only inside
    // the same table so cells from different clones can never be cross-paired.
    const headers = Array.from(table.querySelectorAll('thead th')).map(el => clean(el.textContent));
    const find = names => headers.findIndex(header => names.some(name => header === clean(name) || header.includes(clean(name))));
    const idIndex = headers.findIndex(header => ['id', '订单id', '订单编号'].includes(header));
    const orderIndex = find(['订单号', '商户订单号']);
    const channelIndex = find(['支付渠道名称', '付款渠道名称', '支付渠道', '付款渠道']);
    if (channelIndex < 0 || (idIndex < 0 && orderIndex < 0)) return [];
    return Array.from(table.querySelectorAll('tbody tr')).slice(0, 500).map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const get = index => index >= 0 && cells[index] ? String(cells[index].innerText || cells[index].textContent || '').trim() : '';
      return {id: get(idIndex), order: get(orderIndex), channel: get(channelIndex)};
    }).filter(row => row.channel && (row.id || row.order));
  });
})()
"""
    try:
        rows = client.eval(expression, await_promise=False, timeout=15)
    except Exception:
        return {}
    if not isinstance(rows, list):
        return {}
    by_id = {identifier(item.get("id"), f"{data_type}.id"): item for item in items}
    by_order = {
        text(item.get("order_num")).strip(): item for item in items
        if text(item.get("order_num")).strip()
    }
    code_field = "pay_method" if data_type == "charge" else "pay_channel"
    candidates: Dict[str, set] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        item = by_id.get(text(row.get("id")).strip()) or by_order.get(text(row.get("order")).strip())
        if not item:
            continue
        code = provider_code(item.get(code_field), f"{data_type}.{code_field}")
        name = valid_channel_name(row.get("channel"))
        if code and name and name != code:
            candidates.setdefault(code, set()).add(name)
    return {code: next(iter(names)) for code, names in candidates.items() if len(names) == 1}


def read_channel_map(name: str, data_type: str, origin: str = "") -> Dict[str, str]:
    try:
        payload = json.loads(CHANNEL_MAP_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    platforms = payload.get("platforms", {})
    entry = platforms.get(name, {}) if isinstance(platforms, dict) else {}
    if not isinstance(entry, dict):
        return {}
    # Legacy v1 caches lacked origin proof; do not trust their non-baseline names.
    if origin and (payload.get("version") != 2 or entry.get("origin") != origin):
        return {}
    source = entry.get(data_type, {})
    if not isinstance(source, dict):
        return {}
    return {code: valid for code, value in source.items()
            if isinstance(code, str) and code and (valid := valid_channel_name(value))}


def read_channel_conflicts(name: str, data_type: str, origin: str) -> set:
    try:
        payload = json.loads(CHANNEL_MAP_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return set()
    except (OSError, ValueError) as exc:
        raise CollectorError("渠道缓存损坏/不可读；未覆盖缓存，未回退到可能已冲突的旧映射") from exc
    if not isinstance(payload, dict) or payload.get("version") != 2:
        return set()
    platforms = payload.get("platforms", {})
    entry = platforms.get(name, {}) if isinstance(platforms, dict) else {}
    if not isinstance(entry, dict) or entry.get("origin") != origin:
        return set()
    blocked = entry.get("blocked_" + data_type, [])
    if not isinstance(blocked, list) or not all(isinstance(x, str) for x in blocked):
        raise CollectorError("渠道冲突记录格式损坏，未自动忽略")
    return set(blocked)


def write_channel_map(name: str, data_type: str, mapping: Dict[str, str], origin: str = "", blocked: Optional[set] = None) -> None:
    try:
        payload = json.loads(CHANNEL_MAP_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        payload = {}
    if not isinstance(payload, dict) or payload.get("version") != 2:
        payload = {"version": 2, "platforms": {}}
    if not isinstance(payload.get("platforms"), dict):
        payload["platforms"] = {}
    entry = payload["platforms"].get(name)
    if not isinstance(entry, dict) or entry.get("origin") != origin:
        entry = {"origin": origin}
    entry[data_type] = dict(sorted(mapping.items()))
    entry["blocked_" + data_type] = sorted(blocked or set())
    payload["platforms"][name] = entry
    atomic_json(CHANNEL_MAP_PATH, payload)


def channel_identity(name: str) -> str:
    """Only ignore explicit trailing operational annotations/case/punctuation.

    Provider/method changes (e.g. 原生 vs 唤醒) stay conflicts, never inferred aliases.
    """
    value = unicodedata.normalize("NFKC", name).strip().casefold()
    annotations = r"(?:已停用|系统禁用|停用|已暂停|暂停|测试中勿开|测试中|勿开)"
    previous = None
    while previous != value:
        previous = value
        value = re.sub(r"\s*[（(【\[]\s*" + annotations + r"\s*[）)】\]]\s*$", "", value).strip()
        value = re.sub(r"[\s_-]*" + annotations + r"\s*$", "", value).strip()
    return re.sub(r"[\s()（）\[\]【】_-]+", "", value)

def resolve_channel_names(
    platform: Platform, data_type: str, codes: set,
    live_names: Dict[str, str], saved_names: Dict[str, str],
    learned_json: Dict[str, str], learned_table: Dict[str, str],
) -> Tuple[Dict[str, str], Dict[str, str], set]:
    """Resolve observed codes only; quarantine a conflicting code, not the task.

    Baseline/live material conflicts are not silently accepted. Cosmetic live
    annotations are accepted and cached. A live non-baseline mapping wins over
    stale cache; weak learned candidates must agree. All caches are origin scoped.
    """
    baseline = read_verified_channel_map(platform.name, data_type)
    resolved: Dict[str, str] = {}
    conflicts: set = set()
    persisted = dict(saved_names)
    for code in sorted(codes):
        reference = baseline.get(code)
        current = valid_channel_name(live_names.get(code))
        if current:
            if reference and channel_identity(reference) != channel_identity(current):
                conflicts.add(code)
                persisted.pop(code, None)
                continue
            resolved[code] = current
            if current != reference:
                persisted[code] = current
            else:
                persisted.pop(code, None)
            continue
        if reference:
            cached = valid_channel_name(saved_names.get(code))
            resolved[code] = cached if cached and channel_identity(cached) == channel_identity(reference) else reference
            continue
        candidates = {valid for source in (saved_names, learned_json, learned_table)
                      if (valid := valid_channel_name(source.get(code)))}
        if len(candidates) == 1:
            resolved[code] = next(iter(candidates))
            persisted[code] = resolved[code]
        elif len(candidates) > 1:
            conflicts.add(code)
            persisted.pop(code, None)
    return resolved, persisted, conflicts


def normalize_charge(
    platform_id: str,
    item: Dict[str, Any],
    channel_names: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    vendor_id = identifier(item.get("id"), "charge.id")
    code = status_code(item.get("status"), "charge.status")
    amount = major_to_minor(item.get("amount"), "charge.amount")
    extra = major_to_minor(item.get("extra"), "charge.extra")
    balance = major_to_minor(item.get("balance"), "charge.balance")
    if amount + extra != balance:
        raise RuntimeError(f"charge {vendor_id} 金额不平：amount + extra != balance")
    pay_code = provider_code(item.get("pay_method"), "charge.pay_method")
    rule = STATUS_RULES["charge"].get(code, {})
    safe_payload = {
        "id": vendor_id,
        "uid": optional_order_identifier(item.get("uid"), "charge.uid"),
        "out_trade_no": optional_order_identifier(item.get("out_trade_no"), "charge.out_trade_no"),
        "order_num": optional_text(item.get("order_num")),
        "amount": minor_display(amount),
        "extra": minor_display(extra),
        "balance": minor_display(balance),
        "status": scalar(item.get("status"), "charge.status"),
        "charge_id": scalar(item.get("charge_id"), "charge.charge_id"),
        "pay_method": scalar(item.get("pay_method"), "charge.pay_method"),
        "pay_channel_name": scalar(item.get("pay_channel_name"), "charge.pay_channel_name"),
        "pay_type": scalar(item.get("pay_type"), "charge.pay_type"),
        "channel": scalar(item.get("channel"), "charge.channel"),
        "from": scalar(item.get("from"), "charge.from"),
        "fill_order_admin": optional_text(item.get("fill_order_admin")),
        "notified": scalar(item.get("notified"), "charge.notified"),
        "create_time": db_datetime(item.get("create_time")),
        "pay_time": db_datetime(item.get("pay_time")),
        "update_time": db_datetime(item.get("update_time")),
        "_source_times": {field: scalar(item.get(field), "charge." + field)
                          for field in ("create_time", "pay_time", "update_time")},
        "_source_timezone": BACKEND_TIMEZONE_NAME,
    }
    row = {
        "platform_id": platform_id,
        "vendor_id": vendor_id,
        "uid": safe_payload["uid"],
        "out_trade_no": safe_payload["out_trade_no"],
        "order_num": optional_text(item.get("order_num")),
        "source": "gems7-cdp-v1",
        "amount_minor": amount,
        "amount_display": minor_display(amount),
        "balance_minor": balance,
        "balance_display": minor_display(balance),
        "status_code": code,
        "status_text": rule.get("status_text"),
        "status_group": rule.get("status_group", "unknown"),
        "pay_method_code": pay_code,
        # Numeric routing IDs remain codes; no unconfirmed channel name is stored.
        "pay_method_name": (channel_names or {}).get(pay_code or ""),
        "pay_mode": provider_code(item.get("pay_type"), "charge.pay_type"),
        "channel": provider_code(item.get("channel"), "charge.channel"),
        "extra_payload": {
            "extra_minor": extra,
            "extra_display": minor_display(extra),
            "fill_order_admin": optional_text(item.get("fill_order_admin")),
            "charge_id": scalar(item.get("charge_id"), "charge.charge_id"),
            "pay_type": scalar(item.get("pay_type"), "charge.pay_type"),
        },
        "create_time": safe_payload["create_time"],
        # Backend completion filter is update_time; preserve both source values
        # in raw_payload, expose its completion instant in the query column.
        "pay_time": (safe_payload["update_time"] or safe_payload["pay_time"]) if code == "1" else safe_payload["pay_time"],
        "raw_payload": safe_payload,
        "payload_hash": stable_hash(safe_payload),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }
    return row


def normalize_withdraw(
    platform_id: str,
    item: Dict[str, Any],
    channel_names: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    vendor_id = identifier(item.get("id"), "withdraw.id")
    code = status_code(item.get("status"), "withdraw.status")
    amount = major_to_minor(item.get("amount"), "withdraw.amount")
    fee = major_to_minor(item.get("fee"), "withdraw.fee")
    real_amount = major_to_minor(item.get("real_amount"), "withdraw.real_amount")
    if amount - fee != real_amount:
        raise RuntimeError(f"withdraw {vendor_id} 金额不平：amount - fee != real_amount")
    pay_code = provider_code(item.get("pay_channel"), "withdraw.pay_channel")
    rule = STATUS_RULES["withdraw"].get(code, {})
    safe_payload = {
        "id": vendor_id,
        "uid": optional_order_identifier(item.get("uid"), "withdraw.uid"),
        "out_trade_no": optional_order_identifier(item.get("out_trade_no"), "withdraw.out_trade_no"),
        "order_num": optional_text(item.get("order_num")),
        "amount": minor_display(amount),
        "fee": minor_display(fee),
        "real_amount": minor_display(real_amount),
        "status": scalar(item.get("status"), "withdraw.status"),
        "country": scalar(item.get("country"), "withdraw.country"),
        "pay_channel": scalar(item.get("pay_channel"), "withdraw.pay_channel"),
        "pay_channel_name": scalar(item.get("pay_channel_name"), "withdraw.pay_channel_name"),
        "pay_type": scalar(item.get("pay_type"), "withdraw.pay_type"),
        "channel": scalar(item.get("channel"), "withdraw.channel"),
        "audit_admin": optional_text(item.get("audit_admin")),
        "auto_commit": scalar(item.get("auto_commit"), "withdraw.auto_commit"),
        "create_time": db_datetime(item.get("create_time")),
        "submit_time": db_datetime(item.get("submit_time")),
        "update_time": db_datetime(item.get("update_time")),
        "_source_times": {field: scalar(item.get(field), "withdraw." + field)
                          for field in ("create_time", "submit_time", "update_time")},
        "_source_timezone": BACKEND_TIMEZONE_NAME,
    }
    row = {
        "platform_id": platform_id,
        "vendor_id": vendor_id,
        "uid": safe_payload["uid"],
        "out_trade_no": safe_payload["out_trade_no"],
        "order_num": optional_text(item.get("order_num")),
        "source": "gems7-cdp-v1",
        "country": provider_code(item.get("country"), "withdraw.country"),
        "amount_minor": amount,
        "amount_display": minor_display(amount),
        "fee_minor": fee,
        "fee_display": minor_display(fee),
        "real_amount_minor": real_amount,
        "real_amount_display": minor_display(real_amount),
        "status_code": code,
        "status_text": rule.get("status_text"),
        "status_group": rule.get("status_group", "unknown"),
        "payout_mode": provider_code(item.get("pay_type"), "withdraw.pay_type"),
        "payout_processed": rule.get("payout_processed", False),
        "payout_success": rule.get("payout_success", False),
        "payout_confirmed": rule.get("payout_confirmed", False),
        "in_payout": rule.get("in_payout", False),
        "pay_method_code": pay_code,
        "pay_method_name": (channel_names or {}).get(pay_code or ""),
        # Existing dashboard SQL reads pay_channel before pay_method_name.
        # Use the learned name when it is unambiguous, otherwise keep the code.
        "pay_channel": (channel_names or {}).get(pay_code or "") or pay_code,
        "channel": provider_code(item.get("channel"), "withdraw.channel"),
        "auto_commit": provider_code(item.get("auto_commit"), "withdraw.auto_commit"),
        "audit_admin": optional_text(item.get("audit_admin")),
        "create_time": safe_payload["create_time"],
        "submit_time": safe_payload["submit_time"],
        "update_time": safe_payload["update_time"],
        "raw_payload": safe_payload,
        "payload_hash": stable_hash(safe_payload),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }
    return row


ORDER_WRITE_COLUMNS = {'game66_charge_orders': ['platform_id', 'vendor_id', 'uid', 'out_trade_no', 'order_num', 'source', 'amount_minor', 'amount_display', 'balance_minor', 'balance_display', 'status_code', 'status_text', 'status_group', 'pay_method_code', 'pay_method_name', 'pay_mode', 'channel', 'extra_payload', 'create_time', 'pay_time', 'raw_payload', 'payload_hash', 'last_seen_at'], 'game66_withdraw_orders': ['platform_id', 'vendor_id', 'uid', 'out_trade_no', 'order_num', 'source', 'country', 'amount_minor', 'amount_display', 'fee_minor', 'fee_display', 'real_amount_minor', 'real_amount_display', 'status_code', 'status_text', 'status_group', 'payout_mode', 'payout_processed', 'payout_success', 'payout_confirmed', 'in_payout', 'pay_method_code', 'pay_method_name', 'pay_channel', 'channel', 'auto_commit', 'audit_admin', 'create_time', 'submit_time', 'update_time', 'raw_payload', 'payload_hash', 'last_seen_at']}

class Supabase:
    def __init__(self, batch_size: int):
        raw_url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL).strip().rstrip("/")
        key = load_supabase_key()
        if not raw_url or not key:
            raise CollectorError("找不到 Supabase key；请设置 SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY，或沿用 macOS 钥匙串 game66-sync-supabase", scope="global")
        parsed = urlparse(raw_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise CollectorError("SUPABASE_URL 必须是无用户名密码/查询参数的 HTTPS 地址", scope="global")
        self.base = raw_url + "/rest/v1"
        self.batch_size = batch_size
        self.trust_env = os.environ.get("SUPABASE_TRUST_ENV", "").strip().lower() in {"1", "true", "yes", "on"}
        self.http_retries = max(1, min(int(os.environ.get("SUPABASE_HTTP_RETRIES", "3")), 10))
        self.verified_tables: set = set()
        self.deadline: Optional[float] = None
        self.session = self._new_session()
        self.headers = {"apikey": key, "content-type": "application/json"}
        if not key.startswith("sb_"):
            self.headers["authorization"] = "Bearer " + key

    def _new_session(self) -> requests.Session:
        session = requests.Session()
        session.trust_env = self.trust_env
        return session

    def _reset_session(self) -> None:
        self.session.close()
        self.session = self._new_session()

    @staticmethod
    def _transport_error(exc: requests.RequestException) -> str:
        # requests errors do not include request headers, but keep the message
        # short and single-line so a secret can never leak through a nested repr.
        detail = re.sub(r"[\r\n\t]+", " ", str(exc)).strip()
        detail = re.sub(r"(?i)(apikey|authorization)=?[^ ,;]+", r"\1=<redacted>", detail)
        return f"{type(exc).__name__}: {detail[:240]}" if detail else type(exc).__name__

    def close(self) -> None:
        self.session.close()

    def call(self, method: str, table: str, payload: Any = None, query: str = "", extra: Optional[Dict[str, str]] = None) -> Any:
        if table not in {"game66_platforms", *ORDER_WRITE_COLUMNS}:
            raise CollectorError("Supabase 表不在本采集器允许列表")
        retry_safe = method in {"GET", "HEAD", "PATCH"} or (
            method == "POST" and "on_conflict=" in query
            and "resolution=merge-duplicates" in (extra or {}).get("prefer", ""))
        for attempt in range(1, self.http_retries + 1):
            response: Optional[requests.Response] = None
            delay = min(2 ** attempt, 30)
            try:
                remaining = 100.0 if self.deadline is None else self.deadline - time.monotonic()
                if remaining <= 1:
                    raise CollectorError("单项任务达到时间预算；数据库未确认的批次留待补录", retryable=True)
                response = self.session.request(
                    method, f"{self.base}/{table}{query}",
                    headers={**self.headers, **(extra or {})}, json=payload,
                    timeout=(min(10.0, max(0.5, remaining / 4)), min(90.0, max(0.5, remaining * 0.75))),
                    allow_redirects=False,
                )
                if not 200 <= response.status_code < 300:
                    try:
                        error_payload = response.json()
                    except ValueError:
                        error_payload = None
                    code, label = safe_db_summary(error_payload)
                    error = SupabaseError(
                        f"Supabase {method} {table} HTTP {response.status_code} code={code or '-'}：{label}",
                        status=response.status_code, code=code, table=table,
                    )
                    retry_after = text(response.headers.get("retry-after")).strip()
                    try:
                        delay = min(30.0, max(1.0, float(retry_after))) if retry_after else delay
                    except ValueError:
                        pass
                    # Size/cancel errors go straight to bounded batch splitting.
                    if error.splittable or not error.retryable or not retry_safe or attempt == self.http_retries:
                        raise error
                else:
                    if not response.content:
                        return None
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise SupabaseError(f"Supabase {method} {table} 成功响应不是有效 JSON（正文不记录）",
                                            status=response.status_code, code="BAD_RESPONSE", table=table) from exc
            except requests.RequestException as exc:
                # Avoid logging arbitrary transport text: it can include URLs/secrets.
                error = SupabaseError(f"Supabase {method} {table} 连接异常：{type(exc).__name__}", table=table)
                if not retry_safe or attempt == self.http_retries:
                    raise error from exc
            finally:
                if response is not None:
                    response.close()
            if self.deadline is not None and time.monotonic() + delay >= self.deadline:
                raise CollectorError("单项任务时间预算不足，停止本次数据库重试", retryable=True)
            log(f"{safe_error(error)}；{delay:g} 秒后重试 {attempt}/{self.http_retries}")
            self._reset_session()
            time.sleep(delay)
        raise CollectorError("Supabase 请求未确认", retryable=True, scope="global")

    def verify_tables(self, data_type: Optional[str] = None) -> None:
        """Read-only column compatibility check, not a UNIQUE-constraint audit.

        Runtime calls this per order type, never blocks withdrawals for a charge
        schema error. Platform identity is checked separately by ensure_platform.
        """
        tables = [ORDER_SPECS[data_type]["table"]] if data_type else list(ORDER_WRITE_COLUMNS)
        for table in tables:
            if table in self.verified_tables:
                continue
            result = self.call("GET", table, query="?" + urlencode({"select": ",".join(ORDER_WRITE_COLUMNS[table]), "limit": 0}))
            if not isinstance(result, list):
                raise SupabaseError(f"Supabase {table} 列检查没有返回数组", status=200, code="BAD_RESPONSE", table=table)
            self.verified_tables.add(table)

    def _platform_rows(self, platform: Platform) -> List[Dict[str, Any]]:
        filters: List[Tuple[str, str]] = []
        if platform.platform_id:
            filters.append(("id", "eq." + platform.platform_id))
        else:
            filters.extend([
                ("platform_code", "eq." + platform.name.lower()),
                ("team_code", "eq." + TEAM_CODE),
            ])
        query = "?" + urlencode([
            ("select", "id,team_code,team_name,platform_code,platform_name,base_url,enabled,request_config,auth_secret_name,metadata"),
            *filters,
            ("limit", "2"),
        ])
        result = self.call("GET", "game66_platforms", query=query)
        if not isinstance(result, list):
            raise RuntimeError("Supabase 平台查询没有返回数组")
        return [row for row in result if isinstance(row, dict)]

    def _platform_rows_by_url(self, platform: Platform) -> List[Dict[str, Any]]:
        query = "?" + urlencode([
            ("select", "id,team_code,platform_code,base_url"),
            ("base_url", "eq." + platform.origin),
            ("limit", "2"),
        ])
        result = self.call("GET", "game66_platforms", query=query)
        if not isinstance(result, list):
            raise RuntimeError("Supabase 平台 URL 查询没有返回数组")
        return [row for row in result if isinstance(row, dict)]

    def ensure_platform(self, platform: Platform) -> str:
        rows = self._platform_rows(platform)
        if len(rows) > 1:
            raise RuntimeError(f"{platform.name} 平台登记不唯一")
        placeholder = f"GEMS7_BROWSER_SESSION_{platform.name}"
        desired = {
            "team_code": TEAM_CODE,
            "team_name": TEAM_NAME,
            "platform_code": platform.name.lower(),
            "platform_name": platform.name,
            "base_url": platform.origin,
            # Must stay disabled so the unrelated sync-66game job never loads it.
            "enabled": False,
            "request_config": {},
            "auth_secret_name": placeholder,
            "metadata": {
                "source": "gems-single-python-cdp",
                "order_only": True,
                "configuration_status": "not_applicable",
                "cdp_port": 9555,
            },
        }
        if not rows:
            url_rows = self._platform_rows_by_url(platform)
            if url_rows:
                raise RuntimeError(
                    f"{platform.name} host 已被其它平台登记，拒绝重复创建"
                )
            try:
                created = self.call(
                    "POST", "game66_platforms", desired,
                    extra={"prefer": "return=representation"},
                )
            except RuntimeError:
                # A concurrent first run may have inserted the same unique key.
                # Re-read once; never blindly repeat a write with an unknown result.
                rows = self._platform_rows(platform)
                if len(rows) != 1:
                    raise
                created = rows
            if not isinstance(created, list) or len(created) != 1:
                raise RuntimeError(f"{platform.name} 平台登记失败")
            row = created[0]
        else:
            row = rows[0]
            row_id = text(row.get("id"))
            if not row_id:
                raise RuntimeError(f"{platform.name} 平台登记缺少 ID")
            if row.get("team_code") != TEAM_CODE or row.get("platform_code") != platform.name.lower():
                raise RuntimeError(f"{platform.name} 已有 UUID 属于其它团队/平台，拒绝转移")
            if text(row.get("base_url")).rstrip("/").lower() != platform.origin.rstrip("/").lower():
                raise RuntimeError(f"{platform.name} 已登记 URL 与当前 host 不同，拒绝自动覆盖")
            if row.get("enabled") is not False or row.get("request_config") != {}:
                raise RuntimeError(
                    f"{platform.name} 已有平台配置不是 enabled=false/request_config={{}}，拒绝自动覆盖"
                )
            # Existing rows are identity/config records.  Only harmless display
            # labels may be corrected automatically; auth/config/URL stay owned
            # by the existing registration.
            display_values = {"team_name": TEAM_NAME, "platform_name": platform.name}
            changes = {
                key: value for key, value in display_values.items()
                if row.get(key) != value
            }
            if changes:
                updated = self.call(
                    "PATCH", "game66_platforms", changes,
                    query="?" + urlencode({"id": "eq." + row_id}),
                    extra={"prefer": "return=representation"},
                )
                if not isinstance(updated, list) or len(updated) != 1:
                    raise RuntimeError(f"{platform.name} 平台安全配置更新未确认")
                row = updated[0]
        if (row.get("team_code") != TEAM_CODE or row.get("platform_code") != platform.name.lower()
                or text(row.get("base_url")).rstrip("/").lower() != platform.origin.rstrip("/").lower()):
            raise CollectorError(f"{platform.name} 平台登记身份/host 不匹配，拒绝写入", scope="platform")
        row_id = text(row.get("id"))
        try:
            uuid.UUID(row_id)
        except ValueError as exc:
            raise RuntimeError(f"{platform.name} 平台 ID 无效") from exc
        if row.get("enabled") is not False or row.get("request_config") != {}:
            raise RuntimeError(f"{platform.name} 必须保持 enabled=false/request_config={{}}")
        platform.platform_id = row_id
        return row_id

    def upsert(self, table: str, rows: List[Dict[str, Any]]) -> int:
        written = 0
        def write_batch(batch: List[Dict[str, Any]], depth: int = 0) -> None:
            nonlocal written
            try:
                self.call("POST", table, batch,
                          query="?" + urlencode({"on_conflict": "platform_id,vendor_id"}),
                          extra={"prefer": "resolution=merge-duplicates,return=minimal"})
                written += len(batch)
            except SupabaseError as exc:
                if not exc.splittable or len(batch) <= 25 or depth >= 4:
                    raise
                middle = len(batch) // 2
                log(f"Supabase {table} 批次={len(batch)} code={exc.code or exc.status}，有限拆分为 {middle}+{len(batch)-middle}")
                write_batch(batch[:middle], depth + 1)
                write_batch(batch[middle:], depth + 1)
        try:
            for offset in range(0, len(rows), self.batch_size):
                batch = rows[offset:offset + self.batch_size]
                started = time.monotonic()
                write_batch(batch)
                log(f"Supabase {table} 确认批次={len(batch)} 累计={written}/{len(rows)} 耗时={time.monotonic()-started:.1f}s")
        except Exception as exc:
            # Some earlier batches may have committed. Keep the task pending and
            # replay idempotently later, never claim transaction-wide rollback.
            log(f"Supabase {table} 本项中断：已确认={written}/{len(rows)}；未确认部分待补；{safe_error(exc)}")
            raise
        return written


def parse_assignments(values: Sequence[str], label: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for raw in values:
        if "=" not in raw:
            raise RuntimeError(f"{label} 必须使用 NAME=value")
        name, value = raw.split("=", 1)
        name = name.strip().upper()
        value = value.strip()
        if name not in PLATFORM_NAMES or not value:
            raise RuntimeError(f"{label} 平台只允许 GEM7/MAX7/EK7")
        result[name] = value
    return result


def resolve_platform_name(name: str, args: argparse.Namespace) -> Platform:
    if AUTOLOGIN_MANAGER is not None and name in AUTOLOGIN_MANAGER.configuration_errors:
        raise LoginProblem(AUTOLOGIN_MANAGER.configuration_errors[name])
    urls = parse_assignments(args.platform_url, "--platform-url")
    ids = parse_assignments(args.platform_id, "--platform-id")
    raw_url = urls.get(name) or os.environ.get(f"GEMS7_{name}_URL", "").strip()
    if not raw_url and AUTOLOGIN_MANAGER is not None:
        raw_url = AUTOLOGIN_MANAGER.configured_origin(name)
    if not raw_url and name == "GEM7":
        raw_url = DEFAULT_GEM7_URL
    if not raw_url:
        raw_url = getattr(args, "_known_origins", {}).get(name, "") or discover_origin(name, args.cdp_http)
    platform_id = ids.get(name) or os.environ.get(f"GEMS7_{name}_PLATFORM_ID", "").strip()
    return platform_from_url(name, raw_url, platform_id)

def resolve_platforms(args: argparse.Namespace) -> List[Platform]:
    selected = list(PLATFORM_NAMES) if args.platform == "all" else [args.platform]
    result, errors = [], {}
    for name in selected:
        try:
            result.append(resolve_platform_name(name, args))
        except Exception as exc:
            errors[name] = safe_error(exc)
            log(f"平台暂未就绪，其它平台继续：{errors[name]}", name)
    args._resolution_errors = errors
    return result


@dataclass
class CollectionResult:
    rows: List[Dict[str, Any]]
    pages: int
    total: int
    issues: List[Dict[str, Any]]


def row_issue(item: Dict[str, Any], reason: str, stage: str) -> Dict[str, Any]:
    # IDs identify what to fix; no user, account, bank, token or original payload.
    raw_id = item.get("id")
    vendor_id = str(raw_id)[:80] if isinstance(raw_id, (str, int)) and not isinstance(raw_id, bool) else "<无效ID>"
    return {"vendor_id": vendor_id, "stage": stage, "reason": redact_text(reason)}


def explicit_item_channel_names(items: List[Dict[str, Any]], data_type: str, codes: set) -> Dict[str, str]:
    field = "pay_method" if data_type == "charge" else "pay_channel"
    candidates: Dict[str, set] = {}
    for item in items:
        add_channel_candidate(candidates, codes, item.get(field), item.get("pay_channel_name"))
    return {code: next(iter(names)) for code, names in candidates.items() if len(names) == 1}


def is_zero_channel_placeholder(item: Dict[str, Any], data_type: str) -> bool:
    """Recognize only the observed withdrawal raw 0/no-name shape.

    Keep raw code 0 and a NULL provider name. Do not infer a provider, payment
    result or the meaning of an unrecognized status. Nonzero missing providers,
    boolean/structured codes, and explicit dictionary conflicts stay protected.
    """
    if data_type != "withdraw":
        return False
    raw_code = item.get("pay_channel")
    if not ((type(raw_code) is int and raw_code == 0) or
            (isinstance(raw_code, str) and raw_code == "0")):
        return False
    raw_name = item.get("pay_channel_name")
    return (raw_name is None or (type(raw_name) is int and raw_name == 0) or
            (isinstance(raw_name, str) and raw_name.strip() in {"", "0"}))


def summarize_time_coverage(items: List[Dict[str, Any]], window: DateWindow) -> Dict[str, Any]:
    """Describe returned records only; never claim absent hours mean lost rows."""
    zone = ZoneInfo(window.timezone_name)
    start = datetime.fromisoformat(window.utc_start.replace("Z", "+00:00"))
    end = datetime.fromisoformat(window.utc_end.replace("Z", "+00:00"))
    counts = [0] * 24
    observed: List[datetime] = []
    for item in items:
        value = db_datetime(item.get("update_time" if window.basis == "success" else "create_time"))
        if not value:
            raise CollectorError("时间覆盖检查发现缺少 create_time")
        instant = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        if not start <= instant <= end:
            raise CollectorError("时间覆盖检查发现目标日期外订单")
        observed.append(instant)
        counts[instant.astimezone(zone).hour] += 1
    first = min(observed) if observed else None
    last = max(observed) if observed else None
    empty_leading_seconds = int((first - start).total_seconds()) if first else None
    # This warning targets the dense 22:30..23:59-only shape found in the DB.
    # It is intentionally not a hard failure: legitimate sparse days exist.
    tail_only_warning = (len(items) >= 100 and first is not None and last is not None
                         and empty_leading_seconds is not None
                         and empty_leading_seconds >= 21 * 3600
                         and (end - first).total_seconds() <= 3 * 3600)
    # After aligning the day to India, a former UTC+4 tail can become an
    # India-day head. Warn for dense narrow snapshots at either end or middle.
    span_seconds = (last - first).total_seconds() if first and last else None
    narrow_span_warning = (len(items) >= 100 and span_seconds is not None
                           and span_seconds <= 3 * 3600)
    return {"orders": len(items), "timezone": window.timezone_name,
            "first": first.astimezone(zone).isoformat() if first else None,
            "last": last.astimezone(zone).isoformat() if last else None,
            "hour_counts": counts, "empty_leading_seconds": empty_leading_seconds,
            "tail_only_warning": bool(tail_only_warning),
            "narrow_span_warning": bool(narrow_span_warning),
            "observed_span_seconds": span_seconds}


def log_time_coverage(items: List[Dict[str, Any]], window: DateWindow,
                      data_type: str, platform_name: str) -> Dict[str, Any]:
    result = summarize_time_coverage(items, window)
    buckets = " ".join(f"{hour:02d}:{count}" for hour, count in enumerate(result["hour_counts"]))
    log(f"{window.local_day} {data_type} {window.basis}时间覆盖（{window.timezone_name}）："
        f"最早={result['first'] or '-'} 最晚={result['last'] or '-'}；逐小时笔数 {buckets}", platform_name)
    if result["narrow_span_warning"]:
        span_hours = result["observed_span_seconds"] / 3600
        log(f"WARNING 时间覆盖待核实：{len(items)} 笔集中在约 {span_hours:.2f} 小时范围。"
            "当前按印度后台自然日请求；分页数量匹配只证明本次接口快照一致，"
            "不能单独证明全天完整。请以后台同日全部状态的总笔数对照；"
            "不根据空白小时推算漏单、不改时间、不补造数据。", platform_name)
    return result


def task_window(day: date, args: argparse.Namespace) -> DateWindow:
    base = build_date_window(day, args.timezone)
    start = getattr(args, "_window_start", "") or base.local_start
    end = getattr(args, "_window_end", "") or base.local_end
    zone = ZoneInfo(args.timezone)
    a = datetime.fromisoformat(start).replace(tzinfo=zone)
    b = datetime.fromisoformat(end).replace(tzinfo=zone)
    # UI/CLI end second is inclusive, including sub-second source records.
    b = b.replace(microsecond=999000)
    utc = lambda value: value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    since = getattr(args, "created_since", None)
    since_at = utc(datetime.combine(parse_day(since), datetime.min.time(), zone)) if since else ""
    return DateWindow(args.timezone, day, a.isoformat(), b.isoformat(), utc(a), utc(b),
                      getattr(args, "_time_basis", "created"), since_at)


def partition_orders(platform: Platform, data_type: str, items: List[Dict[str, Any]],
                     names: Dict[str, str], conflicts: set) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    rows, issues = [], []
    field = "pay_method" if data_type == "charge" else "pay_channel"
    normalizer = normalize_charge if data_type == "charge" else normalize_withdraw
    for item in items:
        try:
            code = provider_code(item.get(field), f"{data_type}.{field}")
            if code in conflicts:
                raise CollectorError(f"渠道 ID {code} 的名称存在实质冲突，未自动替换")
            if (code is not None and code not in names
                    and not is_zero_channel_placeholder(item, data_type)):
                raise CollectorError(f"渠道 ID {code} 尚未可靠识别，未用数字假充名称")
            rows.append(normalizer(platform.platform_id, item, names))
        except (RuntimeError, ValueError, TypeError, OverflowError) as exc:
            issues.append(row_issue(item, safe_error(exc), "normalize"))
    return rows, issues

def collect_type(platform: Platform, data_type: str, window: DateWindow, args: argparse.Namespace) -> CollectionResult:
    template = static_request_template(platform, data_type)
    replay = ReplayClient(platform, args.cdp_http, args.request_timeout, getattr(args, "_task_deadline", None))
    try:
        # Fetch/validate the complete snapshot first. Empty days need no dictionary.
        items, pages = fetch_all_pages(replay, template, data_type, window,
                                       args.use_captured_filters, platform.name, args.page_size)
        log_time_coverage(items, window, data_type, platform.name)
        if not items:
            return CollectionResult([], pages, 0, [])
        field = "pay_method" if data_type == "charge" else "pay_channel"
        codes = set()
        for item in items:
            try:
                code = provider_code(item.get(field), f"{data_type}.{field}")
                if code is not None:
                    codes.add(code)
            except RuntimeError:
                pass  # Will be quarantined, not silently dropped, by partition_orders.
        live_names: Dict[str, str] = {}
        dictionary_conflicts: set = set()
        try:
            live_names = replay.channel_dictionary(data_type)
        except SessionRecovered:
            raise
        except DictionaryConflict as exc:
            live_names, dictionary_conflicts = exc.mapping, exc.conflicts
            log(f"{data_type} 实时字典有 {len(dictionary_conflicts)} 个冲突 ID，仅隔离相关订单", platform.name)
        except Exception as exc:
            log(f"{data_type} 实时字典暂未取得，尝试内置/同 host 缓存；{safe_error(exc)}", platform.name)
        saved_blocked = read_channel_conflicts(platform.name, data_type, platform.origin)
        saved = read_channel_map(platform.name, data_type, platform.origin)
        learned = explicit_item_channel_names(items, data_type, codes)
        names, persisted, conflicts = resolve_channel_names(platform, data_type, codes, live_names, saved, learned, {})
        blocked = saved_blocked | conflicts | dictionary_conflicts
        for code in codes:
            if code in live_names and code in names and code not in conflicts | dictionary_conflicts:
                blocked.discard(code)  # A valid live dictionary explicitly cleared it.
        conflicts = blocked & codes
        for code in conflicts:
            names.pop(code, None)
            persisted.pop(code, None)
        zero_rows = [item for item in items if (
            (type(item.get(field)) is int and item.get(field) == 0) or item.get(field) == "0")]
        zero_placeholder_only = bool(zero_rows) and all(is_zero_channel_placeholder(item, data_type) for item in zero_rows)
        placeholder_codes = {"0"} if zero_placeholder_only else set()
        missing = codes - set(names) - conflicts - placeholder_codes
        # Only read table cells when route/type and origin are verified. Cross-type
        # numeric IDs can overlap, so never learn from an unrelated visible table.
        if missing and replay.background is not None:
            try:
                page_state = replay.background.eval("({origin:location.origin,hash:location.hash})", await_promise=False, timeout=10)
                route = "/operate/" + data_type + "Order"
                valid_page = (isinstance(page_state, dict) and page_state.get("origin") == platform.origin
                              and text(page_state.get("hash")).split("?", 1)[0].rstrip("/") == "#" + route)
                if valid_page:
                    table_names = learn_table_channel_names(replay.background, items, data_type)
                    resolved, cache, new_conflicts = resolve_channel_names(platform, data_type, missing, {}, saved, learned, table_names)
                    names.update(resolved)
                    persisted.update({code: name for code, name in cache.items() if code in missing})
                    conflicts.update(new_conflicts)
                    blocked.update(new_conflicts)
                    for code in new_conflicts:
                        persisted.pop(code, None)
            except Exception as exc:
                log(f"{data_type} 表格辅助识别未成功：{safe_error(exc)}", platform.name)
        if persisted != saved or blocked != saved_blocked:
            try:
                write_channel_map(platform.name, data_type, persisted, platform.origin, blocked)
            except OSError as exc:
                if blocked != saved_blocked:
                    raise CollectorError("渠道冲突变更无法保存；停止本项，避免下轮错误回退") from exc
                log(f"渠道缓存未保存，本轮已解析结果仍可使用：{safe_error(exc)}", platform.name)
        log(f"{data_type} 渠道：实时={len(live_names)} 已匹配={len(names)} 冲突={len(conflicts)} "
            f"未识别={len(codes-set(names)-conflicts-placeholder_codes)}", platform.name)
        if zero_placeholder_only and "0" not in names and "0" not in conflicts:
            log(f"{data_type} 源渠道0且无名称={len(zero_rows)}笔；保留代码0/空名称，不作为三方映射失败", platform.name)
        rows, issues = partition_orders(platform, data_type, items, names, conflicts)
        missing_uid = sum(row.get("uid") is None for row in rows)
        log(f"{data_type} 订单明细：有效={len(rows)}笔，含会员ID={len(rows)-missing_uid}笔，"
            f"缺会员ID={missing_uid}笔；缺失值不推断，不输出会员ID到日志", platform.name)
        return CollectionResult(rows, pages, len(items), issues)
    finally:
        replay.close()


def status_rule_summary() -> str:
    return (
        "charge:1=已支付(success),0=待支付(pending)；"
        "withdraw:1=已提交(in_payout),2=代付失败(failed),3=付款成功(success),-1=审核拒绝(rejected)；"
        "其它=unknown(原码保留)"
    )


def sample_test() -> None:
    envelope = {
        "path": "/api/operate/chargeOrder/index", "success": True, "code": 200,
        "data": {"items": [{"id": 1}], "pageInfo": {"total": 1, "currentPage": 1, "totalPage": 1}},
    }
    parsed = parse_page(envelope, "charge")
    assert parsed.total == 1 and len(parsed.items) == 1
    window = build_date_window(date(2026, 9, 16))
    assert window.utc_start == "2026-09-15T18:30:00.000Z"
    assert window.utc_end == "2026-09-16T18:29:59.999Z"
    fixed_now = datetime(2026, 9, 17, 12, 0, tzinfo=ZoneInfo(BACKEND_TIMEZONE_NAME))
    assert recent_complete_days(BACKEND_TIMEZONE_NAME, 7, fixed_now) == [
        date(2026, 9, 10), date(2026, 9, 11), date(2026, 9, 12),
        date(2026, 9, 13), date(2026, 9, 14), date(2026, 9, 15),
        date(2026, 9, 16),
    ]
    static_platform = Platform("GEM7", "https://example.test", "example.test")
    static_charge = static_request_template(static_platform, "charge")
    static_charge_query = dict(parse_qsl(urlparse(static_charge.url).query, keep_blank_values=True))
    assert static_charge_query["pageSize"] == "2000"
    assert static_charge_query["status"] == "" and static_charge_query["recent"] == "0"
    static_withdraw = static_request_template(static_platform, "withdraw")
    static_withdraw_body = json.loads(static_withdraw.post_data or "{}")
    assert static_withdraw_body["pageSize"] == 2000
    assert static_withdraw_body["status"] == "" and static_withdraw_body["recent"] == 0
    charge_template = RequestTemplate(
        "charge", "GET",
        "https://example.test/api/operate/chargeOrder/index?page=1&pageSize=10&"
        "create_time%5B0%5D=2026-09-14T20%3A00%3A00.000Z&"
        "create_time%5B1%5D=2026-09-15T19%3A59%3A59.000Z&status=1&pay_type=6&recent=1",
        {}, None,
    )
    canonical_charge = charge_template.canonical_filters()
    canonical_query = dict(parse_qsl(urlparse(canonical_charge.url).query, keep_blank_values=True))
    assert canonical_query["status"] == "" and canonical_query["pay_type"] == ""
    assert canonical_query["recent"] == "0"
    rewritten, touched, changed = canonical_charge.rewrite_date(window)
    rewritten_query = dict(parse_qsl(urlparse(rewritten.url).query, keep_blank_values=True))
    assert touched == 2 and changed
    assert rewritten_query["create_time[0]"] == window.utc_start
    assert rewritten_query["create_time[1]"] == window.utc_end
    withdraw_template = RequestTemplate(
        "withdraw", "POST", "https://example.test/api/operate/withdrawOrder/index",
        {"Content-Type": "application/json"},
        json.dumps({"page": 1, "pageSize": 10, "create_time": [
            "2026-09-14T20:00:00.000Z", "2026-09-15T19:59:59.000Z"
        ], "status": ""}),
    )
    rewritten_withdraw, touched, _ = withdraw_template.rewrite_date(window)
    assert touched == 2
    assert json.loads(rewritten_withdraw.post_data or "{}")["create_time"] == [window.utc_start, window.utc_end]
    assert major_to_minor(100, "sample") == 10000
    assert major_to_minor("10.05", "sample") == 1005
    for bad in ("1.001", "1e3", -1):
        try:
            major_to_minor(bad, "sample")
            raise AssertionError("invalid money accepted")
        except RuntimeError:
            pass

    charge = {
        "id": 101, "uid": "member-secret", "account": "account-secret", "ip": "192.0.2.8",
        "order_num": "charge-101", "amount": 100, "extra": 5, "balance": 105,
        "status": "unmapped-charge", "charge_id": 7, "pay_method": 1018,
        "pay_channel_name": 1018, "pay_type": 5, "channel": "app", "from": "source",
        "fill_order_admin": "operator-c", "notified": 0,
        "create_time": "2026-09-16 10:00:00", "pay_time": 0, "update_time": 0,
    }
    validate_item_date(charge, window)
    validate_item_date({**charge, "create_time": "2026-09-16 00:00:00"}, window)
    validate_item_date({**charge, "create_time": "2026-09-16 23:59:59.999"}, window)
    try:
        validate_item_date({**charge, "create_time": "2026-09-17 00:00:00"}, window)
        raise AssertionError("out-of-window source timestamp accepted")
    except RuntimeError:
        pass
    withdraw = {
        "id": 202, "uid": "withdraw-secret", "bank_account": "bank-secret", "mobile": "mobile-secret",
        "info": {"account": "nested-secret"}, "audit_remark": "free-text-secret",
        "order_num": "withdraw-202", "amount": 110, "fee": 9, "real_amount": 101,
        "status": 3, "country": 1, "pay_channel": 118, "pay_channel_name": 118,
        "pay_type": 0, "channel": "app", "audit_admin": "operator-w", "auto_commit": 2,
        "create_time": "2026-09-16 11:00:00", "submit_time": "2026-09-16 11:01:00",
        "update_time": "2026-09-16 11:02:00",
    }
    platform_id = "00000000-0000-0000-0000-000000000001"
    gem_platform = Platform("GEM7", "https://example.test", "example.test", platform_id)
    gem_names = read_verified_channel_map("GEM7", "charge")
    max_names = read_verified_channel_map("MAX7", "charge")
    ek_names = read_verified_channel_map("EK7", "charge")
    assert (len(gem_names), len(max_names), len(ek_names)) == (74, 56, 249)
    assert gem_names["1018"] == "In4Pay跑分" and gem_names["1104"] == "NewbPay唤醒"
    assert max_names["978"] == "T3Pay唤醒(978)测试中勿开"
    assert ek_names["978"] == "T3Pay唤醒"
    dictionary = parse_channel_dictionary({
        "path": "/api/operate/chargeOrder/payChannel", "success": True, "code": 200,
        "data": [{"value": 1018, "label": "In4Pay跑分"}],
    }, gem_platform, "charge")
    assert dictionary == {"1018": "In4Pay跑分"}
    resolved, persisted, conflicts = resolve_channel_names(
        gem_platform, "charge", {"1018"}, dictionary,
        {"1018": "wrong-cache"}, {"1018": "wrong-learned"}, {},
    )
    assert resolved == {"1018": "In4Pay跑分"} and persisted == {} and conflicts == set()
    unresolved, _, conflicts = resolve_channel_names(
        gem_platform, "charge", {"1018"}, {"1018": "conflicting-live-name"}, {}, {}, {},
    )
    assert unresolved == {} and conflicts == {"1018"}
    charge_row = normalize_charge(platform_id, charge)
    withdraw_row = normalize_withdraw(platform_id, withdraw)
    assert charge_row["status_group"] == "unknown" and charge_row["pay_method_code"] == "1018"
    assert charge_row["pay_method_name"] is None
    assert withdraw_row["amount_minor"] == 11000 and withdraw_row["fee_minor"] == 900
    assert withdraw_row["real_amount_minor"] == 10100 and withdraw_row["payout_success"] is True
    assert withdraw_row["pay_method_code"] == "118" and withdraw_row["pay_method_name"] is None
    assert withdraw_row["audit_admin"] == "operator-w"
    candidates: Dict[str, set] = {}
    extract_channel_candidates(
        {"data": {"payChannels": [
            {"id": 118, "name": "CedarPay跑分"},
            {"id": 119, "name": "unobserved"},
        ], "users": [{"id": 118, "name": "must-not-be-used"}]}},
        {"118"}, candidates,
    )
    assert candidates == {"118": {"CedarPay跑分"}}
    mapped_charge = normalize_charge(platform_id, charge, gem_names)
    assert mapped_charge["pay_method_name"] == "In4Pay跑分"
    mapped = normalize_withdraw(platform_id, withdraw, gem_names)
    assert mapped["pay_method_name"] == "RushPay跑分" and mapped["pay_channel"] == "RushPay跑分"
    assert str(mapped["create_time"]).endswith("+05:30")
    pending = normalize_withdraw(platform_id, {**withdraw, "id": 203, "status": 1})
    unknown = normalize_withdraw(platform_id, {**withdraw, "id": 204, "status": "new-state"})
    assert pending["in_payout"] is True and pending["payout_success"] is False
    assert unknown["status_code"] == "new-state" and unknown["status_group"] == "unknown"
    serialized = json.dumps([charge_row, withdraw_row], ensure_ascii=False)
    for secret in (
        "account-secret", "192.0.2.8", "bank-secret",
        "mobile-secret", "nested-secret", "free-text-secret",
    ):
        assert secret not in serialized
    assert charge_row["uid"] == "member-secret" and withdraw_row["uid"] == "withdraw-secret"
    assert "fill_order_admin" in charge_row["raw_payload"]
    assert "audit_admin" in withdraw_row["raw_payload"]
    print("sample-test PASS: static requests, pageSize=2000, parser, statuses, provider names, operators, PII allow-list")
    print("status rules:", status_rule_summary())


def list_targets(args: argparse.Namespace) -> None:
    targets = cdp_targets(args.cdp_http)
    if not targets:
        print("没有 Chrome page target")
        return
    for target in targets:
        print(safe_target_label(target))


def check_channel_dictionaries(args: argparse.Namespace) -> int:
    """Diagnostic only. Differences are reported independently per platform/type."""
    platforms = resolve_platforms(args)
    failures = len(getattr(args, "_resolution_errors", {}))
    for platform in platforms:
        replay = ReplayClient(platform, args.cdp_http, args.request_timeout)
        try:
            for data_type in selected_types(args):
                try:
                    mapping = replay.channel_dictionary(data_type)
                    baseline = read_verified_channel_map(platform.name, data_type)
                    changed = {code for code in set(baseline) & set(mapping) if baseline[code] != mapping[code]}
                    material = {code for code in changed if channel_identity(baseline[code]) != channel_identity(mapping[code])}
                    print(f"{platform.name} {data_type}: 当前={len(mapping)} 内置={len(baseline)} "
                          f"新增={len(set(mapping)-set(baseline))} 缺少={len(set(baseline)-set(mapping))} "
                          f"显示变化={len(changed-material)} 实质变化={len(material)}")
                    if material:
                        print("  需核对的 ID：" + ",".join(sorted(material)))
                        failures += 1
                except Exception as exc:
                    failures += 1
                    log(f"{data_type} 字典检查未完成：{safe_error(exc)}", platform.name)
        finally:
            replay.close()
    return 2 if failures else 0


def parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise RuntimeError("--date 必须是 YYYY-MM-DD") from exc


def recent_complete_days(
    timezone_name: str,
    count: int,
    now: Optional[datetime] = None,
) -> List[date]:
    """Return the last N fully completed local calendar days, oldest first."""
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(f"未知时区：{timezone_name}") from exc
    current = now.astimezone(zone) if now is not None else datetime.now(zone)
    yesterday = current.date() - timedelta(days=1)
    return [yesterday - timedelta(days=offset) for offset in range(count - 1, -1, -1)]


def next_daily_run(timezone_name: str, hour: int, minute: int) -> Tuple[datetime, float]:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(f"未知时区：{timezone_name}") from exc
    now = datetime.now(zone)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target, max(1.0, (target - now).total_seconds())


def safe_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {redact_text(exc, 650)}"


def run_collection_task(
    platform: Platform, data_type: str, day: date, args: argparse.Namespace,
    db: Optional[Supabase], ensured_platforms: Dict[str, str],
) -> Dict[str, int]:
    started = time.monotonic()
    args._task_deadline = started + args.task_timeout
    if db:
        db.deadline = args._task_deadline
    basis = getattr(args, "_time_basis", "created")
    log(f"{day} {data_type} {basis}开始；单项预算={args.task_timeout}s", platform.name)
    try:
        window = task_window(day, args)
        identity = platform.name + "|" + platform.origin
        if db:
            if identity not in ensured_platforms:
                ensured_platforms[identity] = db.ensure_platform(platform)
            else:
                platform.platform_id = ensured_platforms[identity]
            db.verify_tables(data_type)
        elif not platform.platform_id:
            platform.platform_id = "00000000-0000-0000-0000-000000000000"
        for recovery_pass in range(2):
            try:
                result = collect_type(platform, data_type, window, args)
                break
            except SessionRecovered:
                if recovery_pass:
                    raise LoginProblem("本项已恢复一次登录但再次掉线，暂停本项以免会话互踢", retryable=True)
                log(f"{day} {data_type} 登录已恢复，丢弃旧会话未完成快照，从第一页重抓", platform.name)
        if len(result.rows) + len(result.issues) != result.total:
            raise CollectorError("转换计数不一致，拒绝标记成功")
        issue_path = issue_file(args, platform.name, data_type, day)
        if result.issues:
            # Persist before writing good rows: never lose the rejected-ID ledger.
            atomic_json(issue_path, {
                "version": SCRIPT_VERSION, "platform": platform.name, "origin": platform.origin,
                "data_type": data_type, "date": day.isoformat(), "no_write": db is None,
                "collected": result.total, "accepted": len(result.rows), "rejected": len(result.issues),
                "updated_at": datetime.now(timezone.utc).isoformat(), "issues": result.issues,
            })
        written = db.upsert(ORDER_SPECS[data_type]["table"], result.rows) if db else 0
        if db and written != len(result.rows):
            raise CollectorError(f"数据库写入确认不完整：应写={len(result.rows)}，已确认={written}", retryable=True)
        if result.issues:
            raise PartialTaskError(len(result.rows), len(result.issues), written, str(issue_path))
        if issue_path.exists():
            issue_path.unlink()
        mode_label = f"确认写入={written}" if db else "只检查，未写入"
        earlier = sum(1 for row in result.rows if row.get("create_time") and
                      datetime.fromisoformat(row["create_time"].replace("Z", "+00:00")).astimezone(ZoneInfo(args.timezone)).date() < day)
        log(f"{day} {data_type} {basis}完成：页数={result.pages} 订单={result.total} 以前创建={earlier} {mode_label} 耗时={time.monotonic()-started:.1f}s", platform.name)
        return {"total": result.total, "accepted": len(result.rows), "rejected": 0, "written": written, "pages": result.pages}
    finally:
        args._task_deadline = None
        if db:
            db.deadline = None


def run_daily_cycle(platforms: Sequence[Platform], days: Sequence[date], data_types: Sequence[str],
                    args: argparse.Namespace, db: Optional[Supabase]) -> List[Tuple[date, Platform, str]]:
    """One bounded pass only. Caller owns retry scheduling; never loops on pending."""
    failed = []
    ensured: Dict[str, str] = {}
    for day in sorted(days, reverse=True):
        for platform in platforms:
            for data_type in data_types:
                try:
                    run_collection_task(platform, data_type, day, args, db, ensured)
                except Exception as exc:
                    failed.append((day, platform, data_type))
                    log(f"{day} {data_type} 未完成，其它任务继续：{safe_error(exc)}", platform.name)
    return failed


def selected_names(args: argparse.Namespace) -> List[str]:
    return list(PLATFORM_NAMES) if args.platform == "all" else [args.platform]


def selected_types(args: argparse.Namespace) -> List[str]:
    return list(ORDER_SPECS) if args.data_type == "all" else [args.data_type]


def selected_bases(args: argparse.Namespace) -> List[str]:
    basis = getattr(args, "time_basis", "both")
    return ["created", "success"] if basis == "both" else [basis]


def connection_identity(args: argparse.Namespace) -> str:
    cdp = args.cdp_http.rstrip("/").lower().replace("://localhost:", "://127.0.0.1:")
    database = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL).strip().rstrip("/").lower()
    return stable_hash([cdp, database])[:20]


def state_namespace(args: argparse.Namespace) -> str:
    # Different semantics from v5/v5.1: do not reuse their done/audit markers.
    return stable_hash([connection_identity(args), "india-day-v5.2", BACKEND_TIMEZONE_NAME, args.no_write])[:20]


def queue_file(args: argparse.Namespace) -> Path:
    return Path(args.state_dir).expanduser().resolve() / ("queue-" + state_namespace(args) + ".json")


def issue_file(args: argparse.Namespace, platform: str, data_type: str, day: date) -> Path:
    variant = stable_hash([getattr(args, "_time_basis", "created"), getattr(args, "_window_start", ""),
                           getattr(args, "_window_end", ""), getattr(args, "created_since", "")])[:12]
    return Path(args.state_dir).expanduser().resolve() / "issues" / state_namespace(args) / f"{day}_{platform}_{data_type}_{variant}.json"


def job_key(platform: str, data_type: str, day: date, basis: str = "created",
            start: str = "", end: str = "", created_since: str = "") -> str:
    base = "|".join((platform, data_type, day.isoformat()))
    suffix = ("|success" if basis == "success" else "")
    if start or end or created_since:
        suffix += "|" + stable_hash([start, end, created_since])[:16]
    return base + suffix


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TaskStore:
    """Only task metadata/diagnostics, never tokens or source-order payloads.

    Pending jobs survive restart and aging beyond the lookback window. Successful
    jobs are refreshed at the next audit. A job is done only after full acceptance.
    """
    def __init__(self, path: Path, recover_running: bool = True):
        self.path = path
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
                if (not isinstance(self.data, dict) or self.data.get("version") != 1
                        or not all(isinstance(self.data.get(k), dict) for k in ("jobs", "audits", "origins"))):
                    raise ValueError("invalid structure")
                for key, job in self.data["jobs"].items():
                    day = date.fromisoformat(job["day"])
                    if (job["platform"] not in PLATFORM_NAMES or job["data_type"] not in ORDER_SPECS
                            or job.get("basis", "created") not in {"created", "success"}
                            or key != job_key(job["platform"], job["data_type"], day, job.get("basis", "created"),
                                              job.get("start", ""), job.get("end", ""), job.get("created_since", ""))
                            or job["status"] not in {"pending", "running", "failed", "partial", "done"}
                            or not isinstance(job["attempts"], int) or job["attempts"] < 0
                            or not all(isinstance(job[k], (int, float)) and math.isfinite(job[k])
                                       for k in ("next_try", "last_attempt"))):
                        raise ValueError("invalid job")
                for name, origin in self.data["origins"].items():
                    if name not in PLATFORM_NAMES:
                        raise ValueError("invalid platform")
                    platform_from_url(name, origin)
            except (OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
                raise CollectorError(f"本地队列文件损坏/版本不匹配：{path}；已停止，未覆盖原待补记录") from exc
        else:
            self.data = {"version": 1, "jobs": {}, "audits": {}, "origins": {}}
        if recover_running:
            for job in self.jobs.values():
                if job["status"] == "running":
                    job["status"], job["next_try"] = "pending", 0.0

    @property
    def jobs(self) -> Dict[str, Dict[str, Any]]:
        return self.data["jobs"]

    def save(self) -> None:
        atomic_json(self.path, self.data)

    def enroll(self, platform: str, data_type: str, day: date, refresh: bool = False,
               basis: str = "created", start: str = "", end: str = "", created_since: str = "") -> str:
        key = job_key(platform, data_type, day, basis, start, end, created_since)
        if key not in self.jobs:
            self.jobs[key] = {"platform": platform, "data_type": data_type, "day": day.isoformat(),
                              "basis": basis, "start": start, "end": end, "created_since": created_since,
                              "status": "pending", "attempts": 0, "last_attempt": 0.0, "next_try": 0.0,
                              "error": "", "counts": {}}
        elif refresh and self.jobs[key]["status"] == "done":
            self.jobs[key].update(status="pending", attempts=0, last_attempt=0.0, next_try=0.0, error="", counts={})
        return key

    def active(self, args: argparse.Namespace) -> List[Tuple[str, Dict[str, Any]]]:
        names, types = set(selected_names(args)), set(selected_types(args))
        return [(key, job) for key, job in self.jobs.items()
                if job["platform"] in names and job["data_type"] in types and job["status"] != "done"
                and job.get("basis", "created") in selected_bases(args)]

    def due(self, args: argparse.Namespace, now: float) -> List[str]:
        india_today = datetime.fromtimestamp(now, ZoneInfo(BACKEND_TIMEZONE_NAME)).date().isoformat()
        eligible = [(key, job) for key, job in self.active(args)
                    if job["next_try"] <= now and
                    (args.mode != "daily" or job["day"] < india_today)]
        # A legacy UTC+4 interval overlaps the following India day. Its new
        # full-day job must wait until that India day is complete.
        # New dates first; previously attempted jobs are ordered by oldest attempt.
        eligible.sort(key=lambda pair: (pair[1]["attempts"] != 0, pair[1]["last_attempt"],
                                         -date.fromisoformat(pair[1]["day"]).toordinal(), pair[0]))
        return [key for key, _ in eligible]

    def enroll_audit(self, args: argparse.Namespace, now: datetime, force: bool = False) -> bool:
        zone = ZoneInfo(args.timezone)
        local = now.astimezone(zone)
        scheduled = local.replace(hour=args.daily_hour, minute=args.daily_minute, second=0, microsecond=0)
        if scheduled > local:
            scheduled -= timedelta(days=1)
        stamp = scheduled.date().isoformat()
        changed = False
        # On startup preserve the old behavior: audit last N complete days immediately.
        days = recent_complete_days(args.timezone, args.lookback_days, now)
        for name in selected_names(args):
            for dtype in selected_types(args):
                audit_key = name + "|" + dtype + "|" + ",".join(selected_bases(args))
                if not force and self.data["audits"].get(audit_key) == stamp:
                    continue
                for day in days:
                    for basis in selected_bases(args):
                        self.enroll(name, dtype, day, refresh=True, basis=basis)
                self.data["audits"][audit_key] = stamp
                changed = True
        if force:
            for _, job in self.active(args):
                job["next_try"] = 0.0
        # Prune old completed metadata only. Never age out unfinished tasks.
        cutoff = (local.date() - timedelta(days=60)).isoformat()
        stale = [key for key, job in self.jobs.items() if job["status"] == "done" and job["day"] < cutoff]
        for key in stale:
            del self.jobs[key]
        if changed or stale:
            self.save()
        return changed

    def begin(self, key: str, now: float) -> None:
        job = self.jobs[key]
        job.update(status="running", attempts=job["attempts"] + 1, last_attempt=now, error="")
        self.save()  # Written before any external action; restart replays safely.

    def finish(self, key: str, counts: Dict[str, int]) -> None:
        self.jobs[key].update(status="done", next_try=0.0, error="", counts=counts)
        self.save()

    def fail(self, key: str, exc: Exception, args: argparse.Namespace, now: float) -> float:
        job = self.jobs[key]
        transient = bool(getattr(exc, "retryable", False))
        login = isinstance(exc, SourceHTTPError) and exc.status in {401, 403}
        login = login or "请重新登录" in str(exc) or "token" in str(exc).lower()
        delay = (min(args.retry_seconds * 2 ** min(job["attempts"] - 1, 6), 3600)
                 if transient or login else max(args.retry_seconds, args.permanent_retry_seconds))
        job.update(status="partial" if isinstance(exc, PartialTaskError) else "failed",
                   next_try=now + delay, error=safe_error(exc))
        if isinstance(exc, PartialTaskError):
            job["counts"] = {"accepted": exc.accepted, "rejected": exc.rejected, "written": exc.written}
        self.save()
        return float(delay)

    def defer_scope(self, args: argparse.Namespace, key: str, exc: Exception, until: float) -> None:
        scope = getattr(exc, "scope", "task")
        if scope == "task":
            return
        source = self.jobs[key]
        for other_key, job in self.active(args):
            same = (scope == "global" or (scope == "platform" and job["platform"] == source["platform"])
                    or (scope == "table" and (getattr(exc, "table", "") == "game66_platforms"
                                             or job["data_type"] == source["data_type"])))
            if same and other_key != key:
                job["next_try"] = max(job["next_try"], until)
        self.save()



def legacy_queue_candidates(args: argparse.Namespace) -> List[Tuple[Path, str, str]]:
    """Recognize exact v5/v5.1 namespaces for this CDP/database and write mode.

    Never sweep unrelated queue files or import check progress as production.
    Environment values are used ONLY to locate prior files, never as new policy.
    """
    business_zones = {"Asia/Yerevan", "Asia/Dubai", "UTC", "Asia/Kolkata", "Asia/Calcutta"}
    business_zones.update(os.environ.get(k, "") for k in ("GEMS7_TIMEZONE", "TZ"))
    source_zones = {"Asia/Kolkata", "Asia/Calcutta", os.environ.get("GEMS7_SOURCE_TIMEZONE", "")}
    root = Path(args.state_dir).expanduser().resolve()
    result = []
    for business in sorted(business_zones - {""}):
        for source in sorted(source_zones - {""}):
            try:
                ZoneInfo(business)
                ZoneInfo(source)
            except (ZoneInfoNotFoundError, ValueError):
                continue
            namespace = stable_hash([connection_identity(args), business, source, args.no_write])[:20]
            path = root / ("queue-" + namespace + ".json")
            if path != queue_file(args) and path.is_file():
                result.append((path, business, source))
    return result


def india_days_overlapping(day: date, old_business_zone: str) -> List[date]:
    """Convert an old query interval to every India calendar day it touches."""
    old_zone, india = ZoneInfo(old_business_zone), ZoneInfo(BACKEND_TIMEZONE_NAME)
    old_start = datetime(day.year, day.month, day.day, tzinfo=old_zone)
    old_end = old_start + timedelta(days=1) - timedelta(microseconds=1)
    first, last = old_start.astimezone(india).date(), old_end.astimezone(india).date()
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def migrate_legacy_queues(store: TaskStore, args: argparse.Namespace) -> int:
    """Retain legacy files; import selected dates, never their done/audit flags.

    This runs under InstanceLock before live collection. Valid legacy jobs older
    than the lookback remain eligible. Future/current India days wait in daily.
    Only origins for selected imported jobs are copied; conflicts fail explicitly.
    """
    selected = set(selected_names(args)), set(selected_types(args))
    original = copy.deepcopy(store.data)
    added = 0
    touched = False
    try:
        imports = store.data.setdefault("legacy_imports", {})
        if not isinstance(imports, dict):
            raise CollectorError("新版队列的旧进度迁移记录格式无效；未覆盖原文件")
        for path, business, source in legacy_queue_candidates(args):
            legacy = TaskStore(path, recover_running=False)
            previous = imports.get(path.name, [])
            if not isinstance(previous, list) or not all(isinstance(k, str) for k in previous):
                raise CollectorError("旧进度迁移标记格式无效；未覆盖原文件")
            seen = set(previous)
            imported_jobs = 0
            for key, job in legacy.jobs.items():
                name, dtype = job["platform"], job["data_type"]
                if key in seen or name not in selected[0] or dtype not in selected[1]:
                    continue
                old_origin = legacy.data["origins"].get(name)
                current_origin = store.data["origins"].get(name)
                if old_origin and current_origin and old_origin.rstrip("/").lower() != current_origin.rstrip("/").lower():
                    raise CollectorError(f"{name} 旧/新队列 host 不一致，未自动转移该平台记录")
                if old_origin and not current_origin:
                    store.data["origins"][name] = old_origin
                for day in india_days_overlapping(date.fromisoformat(job["day"]), business):
                    new_key = job_key(name, dtype, day)
                    if new_key not in store.jobs:
                        store.enroll(name, dtype, day)
                        added += 1
                    # Existing NEW-basis done markers remain trustworthy for
                    # this request basis; legacy markers are never copied.
                seen.add(key)
                imported_jobs += 1
                touched = True
            if imported_jobs:
                imports[path.name] = sorted(seen)
                log(f"旧队列日期已转为印度完整日待复查：来源={path.name} 原任务={imported_jobs}；"
                    "旧完成状态不沿用，旧文件保留，未改数据库。")
        if touched:
            store.save()
    except Exception:
        store.data = original
        raise
    return added


def execute_queued_task(store: TaskStore, key: str, args: argparse.Namespace,
                        db: Optional[Supabase], ensured: Dict[str, str], platforms: Dict[str, Platform]) -> Optional[Exception]:
    job = store.jobs[key]
    store.begin(key, utc_now().timestamp())
    try:
        name = job["platform"]
        if name not in platforms:
            args._known_origins = store.data["origins"]
            try:
                platforms[name] = resolve_platform_name(name, args)
            except Exception as exc:
                temporary = isinstance(exc, requests.RequestException) or "没有候选页" in str(exc)
                raise CollectorError(f"{name} 平台解析未完成：{safe_error(exc)}",
                                     retryable=temporary, scope="platform") from exc
            store.data["origins"][name] = platforms[name].origin
        task_args = copy.copy(args)
        task_args._time_basis = job.get("basis", "created")
        task_args._window_start, task_args._window_end = job.get("start", ""), job.get("end", "")
        task_args.created_since = job.get("created_since", "")
        counts = run_collection_task(platforms[name], job["data_type"], date.fromisoformat(job["day"]), task_args, db, ensured)
    except Exception as exc:
        now = utc_now().timestamp()
        delay = store.fail(key, exc, args, now)
        if args.mode == "daily":
            store.defer_scope(args, key, exc, now + delay)
        log(f"{job['day']} {job['data_type']} 未全部完成：{safe_error(exc)}；"
            + (f"本项 {delay:g}s 后重试，其它独立任务继续" if args.mode == "daily" else "已留待补记录；其它任务继续"), job["platform"])
        return exc
    store.finish(key, counts)
    return None


def show_status(args: argparse.Namespace) -> int:
    store = TaskStore(queue_file(args), recover_running=False)
    active = store.active(args)
    legacy_paths = [p.name for p, _, _ in legacy_queue_candidates(args)]
    if any(name not in store.data.get("legacy_imports", {}) for name in legacy_paths):
        print("提示：存在旧口径队列。status 只读、不迁移；启动新版 daily 后将登记旧日期复查，旧文件保留。")
    print(f"队列：{store.path}\n模式：{'仅检查（非生产写入记录）' if args.no_write else '写入'}；未完成={len(active)}")
    for _, job in sorted(active, key=lambda pair: (pair[1]["day"], pair[0]))[:80]:
        stamp = datetime.fromtimestamp(job["next_try"], ZoneInfo(args.timezone)).isoformat(timespec="seconds") if job["next_try"] else "可立即尝试"
        print(f"{job['platform']} {job['day']} {job['data_type']} {job.get('basis', 'created')} 状态={job['status']} 尝试={job['attempts']} 下次={stamp} {job['error']}")
    if len(active) > 80:
        print("仅显示前80项，其余保留在队列文件。")
    return 0


def run_selected(args: argparse.Namespace) -> int:
    day = parse_day(args.date) if args.date else recent_complete_days(args.timezone, 1)[0]
    window = build_date_window(day, args.timezone)
    if getattr(args, "start", None):
        print(f"后台时间段：{args.start} .. {args.end}（印度）；口径={','.join(selected_bases(args))}")
    else:
        print(f"后台日期：{window.local_start} .. {window.local_end}（印度）；API等价区间 {window.utc_start} .. {window.utc_end}")
    store = TaskStore(queue_file(args))
    migrate_legacy_queues(store, args)
    start = datetime.fromisoformat(args.start) if getattr(args, "start", None) else None
    end = datetime.fromisoformat(args.end) if getattr(args, "end", None) else None
    days = [day] if not start else [start.date() + timedelta(days=i) for i in range((end.date() - start.date()).days + 1)]
    keys = []
    for current in days:
        for name in selected_names(args):
            for dtype in selected_types(args):
                for basis in selected_bases(args):
                    a = start.isoformat() if start and current == start.date() else ""
                    b = end.isoformat() if end and current == end.date() else ""
                    keys.append(store.enroll(name, dtype, current, refresh=True, basis=basis, start=a, end=b,
                                             created_since=(getattr(args, "created_since", None) or "") if basis == "success" else ""))
    store.save()
    db: Optional[Supabase] = None
    ensured: Dict[str, str] = {}
    platforms: Dict[str, Platform] = {}
    failures = 0
    try:
        if not args.no_write:
            db = Supabase(args.db_batch_size)
        for key in keys:
            error = execute_queued_task(store, key, args, db, ensured, platforms)
            if error is not None:
                failures += 1
        log(f"本次结束：全部完成={len(keys)-failures} 未完成/部分完成={failures}；{'未写入数据库' if args.no_write else '未完成项已保留待补'}")
        return 2 if failures else 0
    finally:
        if db:
            db.close()

def run_daily(args: argparse.Namespace) -> int:
    store = TaskStore(queue_file(args))
    migrate_legacy_queues(store, args)
    store.enroll_audit(args, utc_now(), force=True)
    log(f"daily 启动：最近 {args.lookback_days} 个完整日 + 历史待补；队列={store.path}；"
        f"每日 {args.daily_hour:02d}:{args.daily_minute:02d} ({args.timezone}) 刷新；no_write={args.no_write}")
    db: Optional[Supabase] = None
    ensured: Dict[str, str] = {}
    platforms: Dict[str, Platform] = {}
    last_idle = 0.0
    global_until = 0.0
    try:
        while True:
            now = utc_now()
            # Executed BETWEEN EVERY TASK, including after a failure. Pending old
            # jobs can never trap the loop and prevent enrolling a new business day.
            if store.enroll_audit(args, now):
                log("已加入新一轮完整日审计；旧待补保留，优先处理新日期")
                ensured.clear()
                if db:
                    db.verified_tables.clear()
            due = store.due(args, now.timestamp())
            if due and now.timestamp() >= global_until:
                key = due[0]
                if not args.no_write and db is None:
                    try:
                        db = Supabase(args.db_batch_size)
                    except Exception as exc:
                        store.begin(key, now.timestamp())
                        delay = store.fail(key, exc, args, now.timestamp())
                        global_until = now.timestamp() + delay
                        log(f"数据库连接初始化未完成，{delay:g}s 后重试；新日期仍会登记：{safe_error(exc)}")
                        continue
                error = execute_queued_task(store, key, args, db, ensured, platforms)
                if error is not None and getattr(error, "scope", "task") == "global":
                    global_until = store.jobs[key]["next_try"]
                    if db:
                        db.close()
                        db = None
                    ensured.clear()
                continue
            if now.timestamp() - last_idle >= 300:
                active = store.active(args)
                log(f"调度正常：待补/部分完成={len(active)}；"
                    + ("等待各任务下次尝试，不阻塞新日期登记" if active else "本轮已全部完成，等待下一次日审计"))
                last_idle = now.timestamp()
            # Short sleep permits clock jumps, midnight and stop requests to be
            # observed. No long sleep until tomorrow, no busy loop on bad data.
            time.sleep(5)
    finally:
        if db:
            db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="GEM7/MAX7/EK7 v5.6：创建/成功时间双采，代码顶部配置自动登录（Python 3.9+）",
        epilog="日期、昨天、日志和日调度统一按印度后台；不需要 --timezone，也不读取电脑时区。")
    parser.add_argument("--version", action="version", version=SCRIPT_VERSION)
    parser.add_argument("--mode", choices=("once", "daily", "check", "channels", "list", "status", "setup-login", "login-test", "sample-test", "self-test"), default="check")
    parser.add_argument("--platform", choices=("all",) + PLATFORM_NAMES, default="GEM7")
    parser.add_argument("--data-type", choices=("all", "charge", "withdraw"), default="all")
    parser.add_argument("--date", default=None, help="once/check 的印度后台日期；省略为后台昨天；daily 请勿指定")
    parser.add_argument("--time-basis", choices=("both", "created", "success"), default="both", help="默认双采：创建日全部订单 + 当天成功的订单（包含以前创建）")
    parser.add_argument("--start", help="一次性时间段开始，例如 2026-09-01T00:00:00（印度时间）")
    parser.add_argument("--end", help="一次性时间段结束，例如 2026-09-18T23:59:59（含结束秒）")
    parser.add_argument("--created-since", help="成功时间补录时可选的创建日期下限；默认不限，包含上月订单")
    # Internal compatibility attribute, not a user setting or an environment override.
    parser.set_defaults(timezone=BACKEND_TIMEZONE_NAME)
    parser.add_argument("--platform-url", action="append", default=[], metavar="NAME=URL")
    parser.add_argument("--platform-id", action="append", default=[], metavar="NAME=UUID")
    parser.add_argument("--cdp-http", default=os.environ.get("GEMS7_CDP_HTTP", DEFAULT_CDP_HTTP))
    parser.add_argument("--request-timeout", type=int, default=int(os.environ.get("GEMS7_REQUEST_TIMEOUT", "90")))
    parser.add_argument("--page-size", type=int, default=int(os.environ.get("GEMS7_PAGE_SIZE", "2000")))
    parser.add_argument("--db-batch-size", type=int, default=int(os.environ.get("GEMS7_DB_BATCH_SIZE", "500")))
    parser.add_argument("--lookback-days", type=int, default=int(os.environ.get("GEMS7_LOOKBACK_DAYS", "7")), help="每日重读最近 N 个完整日；历史未完成项不受此限制")
    parser.add_argument("--retry-seconds", type=int, default=int(os.environ.get("GEMS7_RETRY_SECONDS", "60")), help="临时失败起始退避间隔")
    parser.add_argument("--permanent-retry-seconds", type=int, default=int(os.environ.get("GEMS7_PERMANENT_RETRY_SECONDS", "900")), help="数据/配置异常复查间隔（不重复轰炸接口）")
    parser.add_argument("--task-timeout", type=int, default=int(os.environ.get("GEMS7_TASK_TIMEOUT", "1800")), help="单项处理时间预算；到达后留待补录")
    parser.add_argument("--daily-hour", type=int, default=int(os.environ.get("GEMS7_DAILY_HOUR", "0")), help="印度后台日调度小时，默认0")
    parser.add_argument("--daily-minute", type=int, default=int(os.environ.get("GEMS7_DAILY_MINUTE", "15")), help="印度后台日调度分钟，默认15")
    parser.add_argument("--state-dir", default=os.environ.get("GEMS7_STATE_DIR", str(Path.cwd() / ".gems7_sync_state")), help="队列/异常清单目录；日常和补录须使用同一目录")
    parser.add_argument("--use-captured-filters", action="store_true", help="兼容旧参数；静态模板仍使用已确认接口，响应日期严格校验")
    parser.add_argument("--no-auto-login", action="store_true", help="本次禁用自动登录，仍可使用手动登录会话")
    parser.add_argument("--no-write", action="store_true", help="只检查，不写 Supabase；状态与正式写入隔离")
    return parser


def validate_time_args(args: argparse.Namespace) -> None:
    if bool(args.start) != bool(args.end):
        raise CollectorError("--start 与 --end 必须一起填写")
    if args.mode == "daily" and (args.start or args.end or args.created_since):
        raise CollectorError("daily 自动双采完整日；指定时间段/创建下限请用 once 或 check")
    if args.start and args.date:
        raise CollectorError("--date 与 --start/--end 不能同时使用")
    if args.start:
        pattern = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?"
        if not re.fullmatch(pattern, args.start) or not re.fullmatch(pattern, args.end):
            raise CollectorError("时间格式为 YYYY-MM-DDTHH:MM:SS，按印度后台时间")
        try:
            start, end = datetime.fromisoformat(args.start), datetime.fromisoformat(args.end)
        except ValueError as exc:
            raise CollectorError("无效日期或时间") from exc
        if start > end or (end - start).days > 366:
            raise CollectorError("时间段必须正序且不超过367个自然日")
    if args.created_since:
        since = parse_day(args.created_since)
        end_day = datetime.fromisoformat(args.end).date() if args.end else (parse_day(args.date) if args.date else recent_complete_days(args.timezone, 1)[0])
        if since > end_day:
            raise CollectorError("创建日期下限不能晚于成功时间段")


def main(argv: Optional[Sequence[str]] = None) -> int:
    global CHANNEL_MAP_PATH, AUTOLOGIN_MANAGER
    args = build_parser().parse_args(argv)
    if args.mode in {"sample-test", "self-test"}:
        return run_self_tests(full=args.mode == "self-test")
    validate_time_args(args)
    if args.mode == "list":
        list_targets(args)
        return 0
    if not 1 <= args.request_timeout <= 600:
        raise CollectorError("--request-timeout 必须在 1..600")
    if not 10 <= args.page_size <= 2000:
        raise CollectorError("--page-size 必须在 10..2000")
    if not 1 <= args.db_batch_size <= 1000:
        raise CollectorError("--db-batch-size 必须在 1..1000")
    if not 1 <= args.lookback_days <= 31:
        raise CollectorError("--lookback-days 必须在 1..31")
    if not 10 <= args.retry_seconds <= 3600:
        raise CollectorError("--retry-seconds 必须在 10..3600")
    if not 60 <= args.permanent_retry_seconds <= 86400:
        raise CollectorError("--permanent-retry-seconds 必须在 60..86400")
    if not 60 <= args.task_timeout <= 86400:
        raise CollectorError("--task-timeout 必须在 60..86400")
    if not 0 <= args.daily_hour <= 23 or not 0 <= args.daily_minute <= 59:
        raise CollectorError("--daily-hour/--daily-minute 超出有效时间")
    if args.mode == "daily" and args.date is not None:
        raise CollectorError("--mode daily 不接受 --date；指定日期补录请用 --mode once --date YYYY-MM-DD")
    try:
        ZoneInfo(args.timezone)
        ZoneInfo(SOURCE_TIMEZONE_NAME)
    except ZoneInfoNotFoundError as exc:
        raise CollectorError("系统缺少印度时区数据；请执行 python3 -m pip install tzdata") from exc
    parse_assignments(args.platform_url, "--platform-url")
    parse_assignments(args.platform_id, "--platform-id")
    if args.date is not None:
        parse_day(args.date)
    if args.mode == "check":
        args.no_write = True
    if args.mode == "status":
        return show_status(args)
    if sys.platform not in {"darwin", "linux"}:
        raise CollectorError("本版进程锁面向 macOS/Linux；请在这两个系统运行")
    print(f"version: {SCRIPT_VERSION}\nstatus rules: {status_rule_summary()}")
    print(f"按印度后台自然日采集：00:00:00—23:59:59.999；调度/日志=印度后台时间；CDP={args.cdp_http}")
    if any(os.environ.get(key) for key in ("GEMS7_TIMEZONE", "GEMS7_SOURCE_TIMEZONE", "TZ")):
        print("提示：已有时区环境变量不会改变本版采集口径；固定使用印度后台日期。")
    CHANNEL_MAP_PATH = Path(args.state_dir).expanduser().resolve() / ("channels-" + connection_identity(args) + ".json")
    lock_path = Path.home() / ".cache" / "gems7-sync" / ("collector-" + connection_identity(args) + ".lock")
    with InstanceLock(lock_path):
        if args.mode == "setup-login":
            return setup_login(args)
        AUTOLOGIN_MANAGER = AutoLoginManager(args)
        try:
            configured = [name for name in selected_names(args) if AUTOLOGIN_MANAGER.enabled(name)]
            print("自动登录（代码配置）：" + (",".join(configured) if configured else "未启用，沿用手动登录会话"))
            for name in selected_names(args):
                if name in AUTOLOGIN_MANAGER.configuration_errors:
                    log(AUTOLOGIN_MANAGER.configuration_errors[name], name)
            if configured:
                print("提示：登录资料来自本 PY 顶部；不会读取旧登录钥匙串。请勿分享填写后的代码。")
            if configured:
                validate_local_cdp(args.cdp_http)
            if args.mode == "login-test":
                return run_login_test(args)
            if args.mode == "channels":
                for attempt in range(2):
                    try:
                        return check_channel_dictionaries(args)
                    except SessionRecovered:
                        if attempt:
                            raise
            return run_daily(args) if args.mode == "daily" else run_selected(args)
        finally:
            AUTOLOGIN_MANAGER = None


def run_self_tests(full: bool = True) -> int:
    """Offline only: no Chrome, HTTP, real database or user state is accessed."""
    import contextlib
    import io
    import unittest
    from unittest.mock import Mock, patch

    module = sys.modules[__name__]

    class RegressionTests(unittest.TestCase):
        def setUp(self) -> None:
            self.tmp = tempfile.TemporaryDirectory(prefix="gems7-v5-test-")
            self.addCleanup(self.tmp.cleanup)
            self.root = Path(self.tmp.name)
            self.args = build_parser().parse_args(["--mode", "once", "--platform", "GEM7",
                                                   "--date", "2026-09-17", "--state-dir", str(self.root)])
            self.args.no_write = True
            self.platform = Platform("GEM7", "https://example.test", "example.test",
                                     "00000000-0000-0000-0000-000000000001")
            self.charge = {"id": 1, "order_num": "c-1", "amount": 100, "extra": 5, "balance": 105,
                           "status": 1, "pay_method": 1018, "pay_channel_name": 1018,
                           "create_time": "2026-09-17 10:00:00", "pay_time": 0, "update_time": 0}
            self.withdraw = {"id": 2, "amount": 110, "fee": 9, "real_amount": 101, "status": 3,
                             "pay_channel": 118, "pay_channel_name": 118,
                             "create_time": "2026-09-17 11:00:00", "submit_time": 0, "update_time": 0}
            self.window = build_date_window(date(2026, 9, 17))
            self.names = read_verified_channel_map("GEM7", "charge")
            self.addCleanup(patch.stopall)
            patch.object(module, "CHANNEL_MAP_PATH", self.root / "channels.json").start()
            patch.object(module, "log", lambda *a, **k: None).start()
            patch.object(module.time, "sleep", lambda *a: None).start()
            patch.object(requests.sessions.Session, "request", side_effect=AssertionError("测试禁止真实 HTTP")).start()
            if websocket is not None:
                patch.object(websocket, "create_connection", side_effect=AssertionError("测试禁止真实 Chrome")).start()

        def make_db(self, responses: Any = None) -> Supabase:
            db = object.__new__(Supabase)
            db.base = "https://example.test/rest/v1"
            db.batch_size = 500
            db.http_retries = 3
            db.deadline = None
            db.trust_env = False
            db.headers = {"apikey": "test-key"}
            db.verified_tables = set()
            db.session = Mock()
            db._reset_session = Mock()
            if responses is not None:
                db.session.request.side_effect = responses
            return db

        def response(self, status: int, payload: Any = None) -> requests.Response:
            response = requests.Response()
            response.status_code = status
            response._content = b"" if payload is None else json.dumps(payload).encode()
            response.headers["content-type"] = "application/json"
            return response

        def envelope(self, items: List[Dict[str, Any]], total: int, current: int = 1, pages: int = 1) -> Dict[str, Any]:
            return {"path": "/api/operate/chargeOrder/index", "success": True, "code": 200,
                    "data": {"items": items, "pageInfo": {"total": total, "currentPage": current, "totalPage": pages}}}

        def test_01_unobserved_dictionary_rename_does_not_stop(self):
            names, _, conflicts = resolve_channel_names(self.platform, "charge", {"1018"}, {"9": "DifferentPay"}, {}, {}, {})
            self.assertEqual(names, {"1018": self.names["1018"]})
            self.assertFalse(conflicts)

        def test_02_empty_day_ignores_dictionary_conflict(self):
            names, _, conflicts = resolve_channel_names(self.platform, "charge", set(), {"9": "DifferentPay"}, {}, {}, {})
            self.assertEqual((names, conflicts), ({}, set()))

        def test_03_cosmetic_name_change_allowed(self):
            current = self.names["1018"] + "（已停用）"
            names, saved, conflicts = resolve_channel_names(self.platform, "charge", {"1018"}, {"1018": current}, {}, {}, {})
            self.assertEqual(names["1018"], current)
            self.assertEqual(saved["1018"], current)
            self.assertFalse(conflicts)

        def test_04_material_conflict_is_per_code(self):
            names, _, conflicts = resolve_channel_names(self.platform, "charge", {"1018", "9"}, {"1018": "OtherPay"}, {}, {}, {})
            self.assertEqual(conflicts, {"1018"})
            self.assertEqual(names, {"9": self.names["9"]})

        def test_05_source_money_error_isolates_one_row(self):
            rows, issues = partition_orders(self.platform, "charge", [self.charge, {**self.charge, "id": 3, "balance": 106}], self.names, set())
            self.assertEqual((len(rows), len(issues)), (1, 1))
            self.assertEqual(issues[0]["vendor_id"], "3")

        def test_06_unknown_channel_is_not_silently_done(self):
            rows, issues = partition_orders(self.platform, "charge", [{**self.charge, "pay_method": 999999}], self.names, set())
            self.assertFalse(rows)
            self.assertEqual(len(issues), 1)

        def test_07_dictionary_outage_falls_back_for_known_code(self):
            replay = Mock(background=None)
            replay.channel_dictionary.side_effect = RuntimeError("字典暂不可用")
            with patch.object(module, "ReplayClient", return_value=replay), patch.object(module, "fetch_all_pages", return_value=([self.charge], 1)):
                result = collect_type(self.platform, "charge", self.window, self.args)
            self.assertEqual((len(result.rows), len(result.issues)), (1, 0))
            self.assertEqual(result.rows[0]["pay_method_name"], self.names["1018"])

        def test_08_empty_day_does_not_request_dictionary(self):
            replay = Mock(background=None)
            with patch.object(module, "ReplayClient", return_value=replay), patch.object(module, "fetch_all_pages", return_value=([], 1)):
                result = collect_type(self.platform, "charge", self.window, self.args)
            replay.channel_dictionary.assert_not_called()
            self.assertEqual(result.total, 0)

        def test_09_duplicate_dictionary_id_quarantined(self):
            payload = {"success": True, "code": 200, "data": [
                {"value": 9, "label": "OnePay"}, {"value": 9, "label": "TwoPay"}, {"value": 1018, "label": self.names["1018"]}]}
            with self.assertRaises(DictionaryConflict) as found:
                parse_channel_dictionary(payload, self.platform, "charge")
            self.assertEqual(found.exception.conflicts, {"9"})
            self.assertEqual(found.exception.mapping, {"1018": self.names["1018"]})

        def test_10_empty_nested_dictionary_is_valid(self):
            value = parse_channel_dictionary({"success": True, "code": 200, "data": {"list": []}}, self.platform, "charge")
            self.assertEqual(value, {})

        def test_11_cache_is_host_scoped(self):
            write_channel_map("GEM7", "charge", {"9999": "NewPay"}, self.platform.origin)
            self.assertEqual(read_channel_map("GEM7", "charge", "https://other.test"), {})
            self.assertEqual(read_channel_map("GEM7", "charge", self.platform.origin), {"9999": "NewPay"})

        def test_12_conflict_survives_dictionary_outage(self):
            write_channel_map("GEM7", "charge", {}, self.platform.origin, {"1018"})
            replay = Mock(background=None)
            replay.channel_dictionary.side_effect = RuntimeError("offline")
            with patch.object(module, "ReplayClient", return_value=replay), patch.object(module, "fetch_all_pages", return_value=([self.charge], 1)):
                result = collect_type(self.platform, "charge", self.window, self.args)
            self.assertEqual((len(result.rows), len(result.issues)), (0, 1))
            self.assertEqual(read_channel_conflicts("GEM7", "charge", self.platform.origin), {"1018"})

        def test_13_valid_live_dictionary_clears_old_conflict(self):
            write_channel_map("GEM7", "charge", {}, self.platform.origin, {"1018"})
            replay = Mock(background=None)
            replay.channel_dictionary.return_value = {"1018": self.names["1018"]}
            with patch.object(module, "ReplayClient", return_value=replay), patch.object(module, "fetch_all_pages", return_value=([self.charge], 1)):
                result = collect_type(self.platform, "charge", self.window, self.args)
            self.assertEqual(len(result.rows), 1)
            self.assertFalse(read_channel_conflicts("GEM7", "charge", self.platform.origin))

        def test_14_supabase_400_not_retried_or_split(self):
            db = self.make_db([self.response(400, {"code": "42P10"})])
            with self.assertRaises(SupabaseError) as found:
                db.upsert("game66_charge_orders", [{"vendor_id": str(i)} for i in range(500)])
            self.assertEqual(db.session.request.call_count, 1)
            self.assertFalse(found.exception.retryable)
            self.assertEqual(found.exception.scope, "table")

        def test_15_supabase_401_is_global_and_immediate(self):
            db = self.make_db([self.response(401, {"code": "PGRST301"})])
            with self.assertRaises(SupabaseError) as found:
                db.call("GET", "game66_platforms")
            self.assertEqual(db.session.request.call_count, 1)
            self.assertEqual(found.exception.scope, "global")

        def test_16_supabase_503_retries_then_success(self):
            db = self.make_db([self.response(503), self.response(204)])
            count = db.upsert("game66_charge_orders", [{"vendor_id": "1"}])
            self.assertEqual(count, 1)
            self.assertEqual(db.session.request.call_count, 2)

        def test_17_rate_limit_exhausts_one_retry_layer_only(self):
            db = self.make_db([self.response(429) for _ in range(3)])
            with self.assertRaises(SupabaseError):
                db.upsert("game66_charge_orders", [{"vendor_id": str(i)} for i in range(500)])
            self.assertEqual(db.session.request.call_count, 3)

        def test_18_statement_timeout_allows_bounded_split(self):
            db = self.make_db()
            sizes = []
            def call(method, table, payload=None, **kwargs):
                sizes.append(len(payload))
                if len(payload) > 25:
                    raise SupabaseError("timeout", status=500, code="57014", table=table)
            db.call = call
            count = db.upsert("game66_charge_orders", [{"vendor_id": str(i)} for i in range(50)])
            self.assertEqual(count, 50)
            self.assertEqual(sizes, [50, 25, 25])

        def test_19_size_split_depth_is_bounded(self):
            db = self.make_db()
            db.batch_size = 1000
            db.call = Mock(side_effect=SupabaseError("timeout", status=500, code="57014", table="game66_charge_orders"))
            with self.assertRaises(SupabaseError):
                db.upsert("game66_charge_orders", [{} for _ in range(1000)])
            self.assertLessEqual(db.call.call_count, 5)

        def test_20_nonidempotent_platform_post_not_blindly_retried(self):
            db = self.make_db([requests.ConnectionError("disconnect")])
            with self.assertRaises(SupabaseError):
                db.call("POST", "game66_platforms", {"platform_code": "gem7"})
            self.assertEqual(db.session.request.call_count, 1)

        def test_21_db_error_does_not_expose_row_or_secrets(self):
            payload = {"code": "23502", "message": 'null value in column "platform_id" of relation "game66_charge_orders" violates not-null constraint',
                       "details": "Failing row contains (bank-account-secret, password-secret)", "hint": "secret-hint"}
            code, message = safe_db_summary(payload)
            self.assertEqual(code, "23502")
            self.assertIn("platform_id", message)
            self.assertNotIn("secret", message)
            self.assertNotIn("key123", redact_text("authorization=key123 token=key123"))

        def test_22_reconnect_failure_stays_inside_retry_loop(self):
            client = ReplayClient(self.platform, self.args.cdp_http, 90)
            browser = Mock()
            browser.eval.return_value = {"ok": True, "status": 200, "text": '{"success":true,"code":200}'}
            with patch.object(module, "attach_existing_tab", side_effect=[RuntimeError("socket"), RuntimeError("attach"), (browser, "ua")]) as attach, patch.object(client, "_headers", return_value={}):
                result = client.request(static_request_template(self.platform, "charge"))
            self.assertTrue(result["success"])
            self.assertEqual(attach.call_count, 3)

        def test_23_auth_error_does_not_retry_four_times(self):
            client = ReplayClient(self.platform, self.args.cdp_http, 90)
            with patch.object(module, "attach_existing_tab", side_effect=RuntimeError("请重新登录")) as attach:
                with self.assertRaises(CollectorError):
                    client.request(static_request_template(self.platform, "charge"))
            self.assertEqual(attach.call_count, 1)

        def test_24_browser_fetch_has_abort_timeout(self):
            client = ReplayClient(self.platform, self.args.cdp_http, 90)
            browser = Mock()
            browser.eval.return_value = {"ok": True, "status": 200, "text": "{}"}
            client.background = browser
            with patch.object(client, "_headers", return_value={}):
                client.request(static_request_template(self.platform, "charge"))
            expression = browser.eval.call_args.args[0]
            self.assertIn("AbortController", expression)
            self.assertIn("clearTimeout", expression)

        def test_25_pagination_duplicate_ids_rejected(self):
            client = Mock()
            client.request.side_effect = [self.envelope([self.charge], 2, 1, 2), self.envelope([self.charge], 2, 2, 2)]
            with self.assertRaisesRegex(RuntimeError, "重复订单"):
                fetch_all_pages(client, static_request_template(self.platform, "charge"), "charge", self.window, False, "GEM7", 2000)

        def test_26_pagination_total_change_rejected(self):
            client = Mock()
            client.request.side_effect = [self.envelope([self.charge], 2, 1, 2), self.envelope([{**self.charge, "id": 3}], 3, 2, 2)]
            with self.assertRaisesRegex(RuntimeError, "total/totalPage"):
                fetch_all_pages(client, static_request_template(self.platform, "charge"), "charge", self.window, False, "GEM7", 2000)

        def test_27_out_of_window_data_still_rejected(self):
            with self.assertRaises(RuntimeError):
                validate_item_date({**self.charge, "create_time": "2026-09-18 03:00:00"}, self.window)
            with self.assertRaises(RuntimeError):
                validate_item_date({**self.charge, "create_time": "2026-09-18 00:30:00"}, self.window)
            validate_item_date({**self.charge, "create_time": "2026-09-17 00:00:00"}, self.window)

        def test_28_good_rows_written_before_partial_status(self):
            valid = normalize_charge(self.platform.platform_id, self.charge, self.names)
            result = CollectionResult([valid], 1, 2, [row_issue({"id": 3}, "金额不平", "normalize")])
            db = Mock()
            db.ensure_platform.return_value = self.platform.platform_id
            db.upsert.return_value = 1
            with patch.object(module, "collect_type", return_value=result):
                with self.assertRaises(PartialTaskError) as found:
                    run_collection_task(self.platform, "charge", date(2026, 9, 17), self.args, db, {})
            self.assertEqual(found.exception.written, 1)
            self.assertTrue(Path(found.exception.issue_path).exists())
            db.upsert.assert_called_once_with("game66_charge_orders", [valid])

        def test_29_issue_ledger_write_failure_prevents_untracked_partial(self):
            result = CollectionResult([{}], 1, 2, [{"vendor_id": "3"}])
            db = Mock()
            db.ensure_platform.return_value = self.platform.platform_id
            with patch.object(module, "collect_type", return_value=result), patch.object(module, "atomic_json", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    run_collection_task(self.platform, "charge", date(2026, 9, 17), self.args, db, {})
            db.upsert.assert_not_called()

        def test_30_failure_does_not_block_other_order_type(self):
            seen = []
            def task(platform, dtype, *args):
                seen.append(dtype)
                if dtype == "charge":
                    raise RuntimeError("金额不平")
                return {"total": 0, "written": 0}
            with patch.object(module, "run_collection_task", side_effect=task), patch.object(module, "resolve_platform_name", return_value=self.platform):
                code = run_selected(self.args)
            self.assertEqual(seen, ["charge", "charge", "withdraw", "withdraw"])
            self.assertEqual(code, 2)

        def test_31_missing_platform_does_not_block_others(self):
            self.args.platform = "all"
            seen = []
            def resolve(name, args):
                if name == "GEM7":
                    raise RuntimeError("missing tab")
                return Platform(name, "https://example.test", "example.test")
            def task(platform, dtype, *args):
                seen.append((platform.name, dtype))
                return {"total": 0, "written": 0}
            with patch.object(module, "resolve_platform_name", side_effect=resolve), patch.object(module, "run_collection_task", side_effect=task):
                code = run_selected(self.args)
            self.assertEqual(code, 2)
            self.assertEqual(len(seen), 8)
            self.assertEqual({name for name, _ in seen}, {"MAX7", "EK7"})

        def test_32_failed_task_survives_restart(self):
            store = TaskStore(queue_file(self.args))
            key = store.enroll("GEM7", "charge", date(2026, 9, 1))
            store.begin(key, 100.0)
            store.fail(key, RuntimeError("bad data"), self.args, 101.0)
            loaded = TaskStore(store.path)
            self.assertEqual(loaded.jobs[key]["status"], "failed")
            self.assertEqual(loaded.jobs[key]["attempts"], 1)

        def test_33_interrupted_running_job_recovers_as_pending(self):
            store = TaskStore(queue_file(self.args))
            key = store.enroll("GEM7", "charge", date(2026, 9, 17))
            store.begin(key, 100.0)
            loaded = TaskStore(store.path)
            self.assertEqual(loaded.jobs[key]["status"], "pending")
            self.assertEqual(loaded.jobs[key]["next_try"], 0)

        def test_34_old_failed_job_not_pruned_by_lookback(self):
            store = TaskStore(queue_file(self.args))
            key = store.enroll("GEM7", "charge", date(2025, 1, 1))
            store.jobs[key]["status"] = "failed"
            store.enroll_audit(self.args, datetime(2026, 9, 18, 12, tzinfo=timezone.utc), force=True)
            self.assertIn(key, store.jobs)

        def test_35_new_date_added_while_old_failure_pending(self):
            self.args.lookback_days = 1
            self.args.data_type = "charge"
            store = TaskStore(queue_file(self.args))
            zone = ZoneInfo(self.args.timezone)
            store.enroll_audit(self.args, datetime(2026, 9, 18, 12, tzinfo=zone), force=True)
            key = job_key("GEM7", "charge", date(2026, 9, 17))
            store.begin(key, 100.0)
            store.fail(key, RuntimeError("permanent"), self.args, 101.0)
            store.enroll_audit(self.args, datetime(2026, 9, 19, 0, 16, tzinfo=zone))
            new_key = job_key("GEM7", "charge", date(2026, 9, 18))
            self.assertIn(new_key, store.jobs)
            self.assertEqual(store.due(self.args, 9999999999)[0], new_key)

        def test_36_actual_daily_loop_crosses_day_after_failure(self):
            self.args.mode = "daily"
            self.args.date = None
            self.args.lookback_days = 1
            self.args.data_type = "charge"
            zone = ZoneInfo(self.args.timezone)
            clock = [datetime(2026, 9, 18, 12, tzinfo=zone)]
            seen = []
            def task(platform, dtype, day, *args):
                seen.append(day)
                if len(seen) == 1:
                    clock[0] = datetime(2026, 9, 19, 0, 16, tzinfo=zone)
                    raise RuntimeError("旧日数据异常")
                raise KeyboardInterrupt()
            with patch.object(module, "utc_now", side_effect=lambda: clock[0]), patch.object(module, "run_collection_task", side_effect=task), patch.object(module, "resolve_platform_name", return_value=self.platform):
                with self.assertRaises(KeyboardInterrupt):
                    run_daily(self.args)
            self.assertEqual(seen, [date(2026, 9, 17), date(2026, 9, 18)])

        def test_37_no_write_state_separate_from_production(self):
            first = queue_file(self.args)
            self.args.no_write = False
            self.assertNotEqual(first, queue_file(self.args))

        def test_38_corrupt_queue_not_overwritten(self):
            path = queue_file(self.args)
            path.write_text("{broken")
            with self.assertRaises(CollectorError):
                TaskStore(path)
            self.assertEqual(path.read_text(), "{broken")

        def test_39_instance_lock_rejects_second_process(self):
            path = self.root / "same.lock"
            with InstanceLock(path):
                with self.assertRaises(CollectorError):
                    with InstanceLock(path):
                        pass
            with InstanceLock(path):
                pass

        def test_40_daily_date_flag_rejected(self):
            with self.assertRaisesRegex(CollectorError, "不接受 --date"):
                main(["--mode", "daily", "--date", "2026-09-17"])

        def test_41_parser_defaults_still_no_implicit_write(self):
            parsed = build_parser().parse_args([])
            self.assertEqual(parsed.mode, "check")
            self.assertEqual(parsed.platform, "GEM7")
            self.assertIsNone(parsed.date)
            self.assertEqual(parsed.page_size, 2000)

        def test_42_table_error_only_defers_matching_type(self):
            self.args.mode = "daily"
            store = TaskStore(queue_file(self.args))
            charge = store.enroll("GEM7", "charge", date(2026, 9, 17))
            other_charge = store.enroll("GEM7", "charge", date(2026, 9, 16))
            withdraw = store.enroll("GEM7", "withdraw", date(2026, 9, 17))
            store.defer_scope(self.args, charge, SupabaseError("missing index", status=400, code="42P10", table="game66_charge_orders"), 999)
            self.assertEqual(store.jobs[other_charge]["next_try"], 999)
            self.assertEqual(store.jobs[withdraw]["next_try"], 0)

        def test_43_partial_task_not_recorded_done(self):
            store = TaskStore(queue_file(self.args))
            key = store.enroll("GEM7", "charge", date(2026, 9, 17))
            with patch.object(module, "resolve_platform_name", return_value=self.platform), patch.object(module, "run_collection_task", side_effect=PartialTaskError(9, 1, 9, "issues.json")):
                execute_queued_task(store, key, self.args, None, {}, {})
            self.assertEqual(store.jobs[key]["status"], "partial")
            self.assertEqual(store.jobs[key]["counts"]["rejected"], 1)

        def test_44_original_business_status_rules_preserved(self):
            self.assertEqual(normalize_withdraw(self.platform.platform_id, self.withdraw, self.names)["status_group"], "success")
            changed = {**self.withdraw, "status": 987}
            result = normalize_withdraw(self.platform.platform_id, changed, self.names)
            self.assertEqual(result["status_group"], "unknown")
            self.assertFalse(result["payout_success"])

        def test_45_sensitive_source_fields_not_saved(self):
            bad = {**self.charge, "uid": "user-secret", "bank_account": "bank-secret", "ip": "ip-secret", "mobile": "mobile-secret"}
            row = normalize_charge(self.platform.platform_id, bad, self.names)
            serialized = json.dumps(row)
            self.assertEqual(row["uid"], "user-secret")
            for value in ("bank-secret", "ip-secret", "mobile-secret"):
                self.assertNotIn(value, serialized)

        def test_46_read_only_preflight_checks_selected_columns(self):
            db = self.make_db()
            db.call = Mock(return_value=[])
            db.verify_tables("withdraw")
            self.assertEqual(db.call.call_count, 1)
            args, kwargs = db.call.call_args
            self.assertEqual(args, ("GET", "game66_withdraw_orders"))
            self.assertIn("vendor_id", kwargs["query"])
            self.assertNotIn("select=%2A", kwargs["query"])

        def test_47_cache_file_private_permissions(self):
            path = self.root / "private.json"
            atomic_json(path, {"safe": True})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

        def test_48_finite_task_budget_stops_request_attempt(self):
            client = ReplayClient(self.platform, self.args.cdp_http, 90, deadline=time.monotonic() - 1)
            with patch.object(client, "_fetch_once") as call:
                with self.assertRaises(CollectorError):
                    client.request(static_request_template(self.platform, "charge"))
            call.assert_not_called()

        def test_49_startup_retries_saved_cooldown_immediately(self):
            store = TaskStore(queue_file(self.args))
            key = store.enroll("GEM7", "charge", date(2026, 9, 1))
            store.jobs[key].update(status="failed", next_try=9999999999.0, attempts=3)
            store.enroll_audit(self.args, datetime(2026, 9, 18, 12, tzinfo=timezone.utc), force=True)
            self.assertEqual(store.jobs[key]["next_try"], 0.0)
            self.assertEqual(store.jobs[key]["attempts"], 3)

        def test_50_missing_platform_has_only_platform_scope(self):
            self.args.mode = "daily"
            self.args.platform = "all"
            store = TaskStore(queue_file(self.args))
            first = store.enroll("GEM7", "charge", date(2026, 9, 17))
            same = store.enroll("GEM7", "withdraw", date(2026, 9, 17))
            other = store.enroll("MAX7", "charge", date(2026, 9, 17))
            with patch.object(module, "resolve_platform_name", side_effect=RuntimeError("没有候选页")):
                error = execute_queued_task(store, first, self.args, None, {}, {})
            self.assertEqual(error.scope, "platform")
            self.assertGreater(store.jobs[same]["next_try"], 0)
            self.assertEqual(store.jobs[other]["next_try"], 0)

        def test_51_zero_rejected_withdraw_is_preserved(self):
            item = {**self.withdraw, "status": -1, "pay_channel": 0, "pay_channel_name": 0}
            rows, issues = partition_orders(self.platform, "withdraw", [item], self.names, set())
            self.assertFalse(issues)
            self.assertEqual(rows[0]["pay_method_code"], "0")
            self.assertIsNone(rows[0]["pay_method_name"])
            self.assertEqual(rows[0]["pay_channel"], "0")
            self.assertEqual(rows[0]["status_group"], "rejected")

        def test_52_zero_unknown_status_is_not_reclassified(self):
            item = {**self.withdraw, "status": 4, "pay_channel": 0, "pay_channel_name": 0}
            rows, issues = partition_orders(self.platform, "withdraw", [item], {}, set())
            self.assertFalse(issues)
            self.assertEqual(rows[0]["status_code"], "4")
            self.assertEqual(rows[0]["status_group"], "unknown")
            self.assertFalse(rows[0]["payout_success"])

        def test_53_string_zero_is_preserved(self):
            item = {**self.withdraw, "pay_channel": "0", "pay_channel_name": "0"}
            rows, issues = partition_orders(self.platform, "withdraw", [item], {}, set())
            self.assertEqual(len(rows), 1)
            self.assertFalse(issues)
            self.assertEqual(rows[0]["raw_payload"]["pay_channel"], "0")

        def test_54_nonzero_unmapped_stays_quarantined(self):
            item = {**self.withdraw, "pay_channel": 999999, "pay_channel_name": 0}
            rows, issues = partition_orders(self.platform, "withdraw", [item], {}, set())
            self.assertFalse(rows)
            self.assertEqual(len(issues), 1)

        def test_55_charge_zero_does_not_get_withdraw_exception(self):
            item = {**self.charge, "pay_method": 0, "pay_channel_name": 0}
            rows, issues = partition_orders(self.platform, "charge", [item], {}, set())
            self.assertFalse(rows)
            self.assertEqual(len(issues), 1)

        def test_56_zero_dictionary_conflict_stays_blocked(self):
            item = {**self.withdraw, "pay_channel": 0, "pay_channel_name": 0}
            rows, issues = partition_orders(self.platform, "withdraw", [item], {}, {"0"})
            self.assertFalse(rows)
            self.assertEqual(len(issues), 1)

        def test_57_zero_does_not_bypass_money_validation(self):
            item = {**self.withdraw, "pay_channel": 0, "pay_channel_name": 0, "real_amount": 999}
            rows, issues = partition_orders(self.platform, "withdraw", [item], {}, set())
            self.assertFalse(rows)
            self.assertIn("金额不平", issues[0]["reason"])

        def test_58_boolean_or_explicit_name_is_not_empty_placeholder(self):
            for channel, name in ((False, 0), (0.0, 0), (0, False), (0, "OtherGateway"), ([], 0)):
                self.assertFalse(is_zero_channel_placeholder({"pay_channel": channel, "pay_channel_name": name}, "withdraw"))

        def test_59_authoritative_zero_name_is_not_overwritten(self):
            item = {**self.withdraw, "pay_channel": 0, "pay_channel_name": 0}
            rows, issues = partition_orders(self.platform, "withdraw", [item], {"0": "ExplicitProvider"}, set())
            self.assertFalse(issues)
            self.assertEqual(rows[0]["pay_method_name"], "ExplicitProvider")

        def test_60_tail_only_time_shape_warns(self):
            items = [{"create_time": "2026-09-17 22:30:00"} for _ in range(100)]
            result = summarize_time_coverage(items, self.window)
            self.assertTrue(result["tail_only_warning"])
            self.assertEqual(result["empty_leading_seconds"], 22.5 * 3600)
            self.assertEqual(result["hour_counts"][22], 100)

        def test_61_full_range_shape_does_not_warn(self):
            items = [{"create_time": "2026-09-17 00:00:00"}] + [
                {"create_time": "2026-09-17 23:59:59.999"} for _ in range(100)]
            result = summarize_time_coverage(items, self.window)
            self.assertFalse(result["tail_only_warning"])
            self.assertEqual(result["hour_counts"][0], 1)
            self.assertEqual(result["hour_counts"][23], 100)

        def test_62_empty_coverage_is_not_false_failure(self):
            result = summarize_time_coverage([], self.window)
            self.assertFalse(result["tail_only_warning"])
            self.assertIsNone(result["first"])
            self.assertEqual(sum(result["hour_counts"]), 0)

        def test_63_sparse_late_day_is_not_dense_tail_warning(self):
            result = summarize_time_coverage([{"create_time": "2026-09-17 23:00:00"}], self.window)
            self.assertFalse(result["tail_only_warning"])

        def test_64_zero_placeholder_collection_keeps_row(self):
            item = {**self.withdraw, "status": -1, "pay_channel": 0, "pay_channel_name": 0}
            replay = Mock()
            replay.background = None
            replay.channel_dictionary.return_value = {}
            with patch.object(module, "ReplayClient", return_value=replay), patch.object(
                    module, "fetch_all_pages", return_value=([item], 1)):
                result = collect_type(self.platform, "withdraw", self.window, self.args)
            self.assertEqual(len(result.rows), 1)
            self.assertEqual(result.total, 1)
            self.assertFalse(result.issues)


        def make_legacy_store(self, business="Asia/Yerevan", source="Asia/Kolkata", write_mode=None):
            no_write = self.args.no_write if write_mode is None else write_mode
            namespace = stable_hash([connection_identity(self.args), business, source, no_write])[:20]
            return TaskStore(self.root / ("queue-" + namespace + ".json"))

        def test_65_india_default_ignores_environment(self):
            with patch.dict(os.environ, {"TZ": "Asia/Dubai", "GEMS7_TIMEZONE": "Asia/Yerevan",
                                         "GEMS7_SOURCE_TIMEZONE": "UTC"}):
                args = build_parser().parse_args([])
                self.assertEqual(args.timezone, "Asia/Kolkata")
                self.assertEqual(SOURCE_TIMEZONE_NAME, "Asia/Kolkata")
                self.assertFalse(any(action.dest == "timezone" for action in build_parser()._actions))

        def test_66_india_day_has_exact_millisecond_bounds(self):
            w = build_date_window(date(2026, 9, 17))
            self.assertEqual(w.local_start, "2026-09-17 00:00:00")
            self.assertEqual(w.local_end, "2026-09-17 23:59:59.999")
            self.assertEqual(w.utc_start, "2026-09-16T18:30:00.000Z")
            self.assertEqual(w.utc_end, "2026-09-17T18:29:59.999Z")
            start = datetime.fromisoformat(w.utc_start.replace("Z", "+00:00"))
            end = datetime.fromisoformat(w.utc_end.replace("Z", "+00:00"))
            self.assertEqual((end - start).total_seconds(), 86400 - .001)

        def test_67_both_backends_use_same_india_window(self):
            for dtype in ORDER_SPECS:
                request, touched, _ = static_request_template(self.platform, dtype).rewrite_date(self.window)
                self.assertEqual(touched, 2)
                if dtype == "charge":
                    q = dict(parse_qsl(urlparse(request.url).query))
                    bounds = [q["create_time[0]"], q["create_time[1]"]]
                else:
                    bounds = json.loads(request.post_data)["create_time"]
                self.assertEqual(bounds, [self.window.utc_start, self.window.utc_end])
                self.assertFalse(request.nonempty_status_filters())

        def test_68_first_and_last_india_instants_accepted(self):
            for stamp in ("2026-09-17 00:00:00", "2026-09-17 23:59:59", "2026-09-17 23:59:59.999"):
                validate_item_date({**self.charge, "create_time": stamp}, self.window)

        def test_69_neighboring_days_rejected(self):
            for stamp in ("2026-09-16 23:59:59.999", "2026-09-18 00:00:00"):
                with self.assertRaises(RuntimeError):
                    validate_item_date({**self.charge, "create_time": stamp}, self.window)

        def test_70_explicit_offsets_respected_not_overwritten(self):
            stamp = "2026-09-16T18:30:00Z"
            self.assertEqual(db_datetime(stamp), stamp)
            validate_item_date({**self.charge, "create_time": stamp}, self.window)
            validate_item_date({**self.charge, "create_time": "2026-09-16T22:30:00+04:00"}, self.window)

        def test_71_naive_source_clock_text_preserved_in_instant(self):
            self.assertEqual(db_datetime("2026-09-17 10:11:12"), "2026-09-17T10:11:12+05:30")
            self.assertEqual(db_datetime("2026-09-17 00:00:00"), "2026-09-17T00:00:00+05:30")

        def test_72_yesterday_rolls_at_india_midnight_not_host(self):
            before = datetime(2026, 9, 17, 18, 29, 59, tzinfo=timezone.utc)
            after = datetime(2026, 9, 17, 18, 30, 0, tzinfo=timezone.utc)
            self.assertEqual(recent_complete_days(BACKEND_TIMEZONE_NAME, 1, before), [date(2026, 9, 16)])
            self.assertEqual(recent_complete_days(BACKEND_TIMEZONE_NAME, 1, after), [date(2026, 9, 17)])

        def test_73_daily_audit_fires_at_india_0015(self):
            self.args.mode = "daily"
            self.args.data_type = "charge"
            self.args.lookback_days = 1
            store = TaskStore(queue_file(self.args))
            store.enroll_audit(self.args, datetime(2026, 9, 17, 17, tzinfo=timezone.utc), force=True)
            self.assertFalse(store.enroll_audit(self.args, datetime(2026, 9, 17, 18, 44, tzinfo=timezone.utc)))
            self.assertTrue(store.enroll_audit(self.args, datetime(2026, 9, 17, 18, 45, tzinfo=timezone.utc)))
            self.assertIn(job_key("GEM7", "charge", date(2026, 9, 17)), store.jobs)

        def test_74_raw_backend_timestamp_values_preserved_charge(self):
            row = normalize_charge(self.platform.platform_id, self.charge, self.names)
            self.assertEqual(row["raw_payload"]["_source_times"],
                             {"create_time": "2026-09-17 10:00:00", "pay_time": 0, "update_time": 0})
            self.assertEqual(row["raw_payload"]["_source_timezone"], "Asia/Kolkata")
            self.assertTrue(row["create_time"].endswith("+05:30"))
            self.assertEqual(row["payload_hash"], stable_hash(row["raw_payload"]))

        def test_75_raw_backend_timestamp_values_preserved_withdraw(self):
            row = normalize_withdraw(self.platform.platform_id, self.withdraw, self.names)
            self.assertEqual(row["raw_payload"]["_source_times"]["create_time"], self.withdraw["create_time"])
            self.assertEqual(row["raw_payload"]["_source_times"]["submit_time"], 0)
            self.assertEqual(row["payload_hash"], stable_hash(row["raw_payload"]))

        def test_76_no_new_top_level_database_columns(self):
            for dtype, item in (("charge", self.charge), ("withdraw", self.withdraw)):
                fn = normalize_charge if dtype == "charge" else normalize_withdraw
                row = fn(self.platform.platform_id, item, self.names)
                self.assertEqual(set(row), set(ORDER_WRITE_COLUMNS[ORDER_SPECS[dtype]["table"]]))
                self.assertNotIn("_source_times", row)

        def test_77_india_head_only_warns(self):
            items = [{"create_time": "2026-09-17 00:00:00"}] + [
                {"create_time": "2026-09-17 01:29:59"} for _ in range(100)]
            result = summarize_time_coverage(items, self.window)
            self.assertTrue(result["narrow_span_warning"])
            self.assertEqual(result["hour_counts"][0], 1)
            self.assertEqual(result["hour_counts"][1], 100)

        def test_78_dense_midday_cluster_warns(self):
            items = [{"create_time": "2026-09-17 12:30:00"} for _ in range(100)]
            self.assertTrue(summarize_time_coverage(items, self.window)["narrow_span_warning"])

        def test_79_spread_across_whole_day_does_not_warn(self):
            items = [{"create_time": f"2026-09-17 {h:02d}:00:00"} for h in range(24) for _ in range(5)]
            result = summarize_time_coverage(items, self.window)
            self.assertFalse(result["narrow_span_warning"])
            self.assertEqual(result["hour_counts"], [5] * 24)

        def test_80_sparse_day_not_declared_broken(self):
            result = summarize_time_coverage([self.charge], self.window)
            self.assertFalse(result["narrow_span_warning"])
            self.assertFalse(summarize_time_coverage([], self.window)["narrow_span_warning"])

        def test_81_legacy_done_not_treated_as_new_done(self):
            legacy = self.make_legacy_store()
            key = legacy.enroll("GEM7", "charge", date(2026, 9, 17))
            legacy.finish(key, {"written": 761})
            before = legacy.path.read_bytes()
            store = TaskStore(queue_file(self.args))
            self.assertEqual(migrate_legacy_queues(store, self.args), 2)
            self.assertTrue(all(job["status"] == "pending" for job in store.jobs.values()))
            self.assertEqual({j["day"] for j in store.jobs.values()}, {"2026-09-17", "2026-09-18"})
            self.assertEqual(legacy.path.read_bytes(), before)
            self.assertNotEqual(legacy.path, store.path)

        def test_82_legacy_failed_outside_lookback_is_retained(self):
            legacy = self.make_legacy_store()
            key = legacy.enroll("GEM7", "charge", date(2025, 1, 1))
            legacy.begin(key, 100.0)
            legacy.fail(key, RuntimeError("bad row"), self.args, 101.0)
            store = TaskStore(queue_file(self.args))
            migrate_legacy_queues(store, self.args)
            store.enroll_audit(self.args, datetime(2026, 9, 18, 12, tzinfo=timezone.utc), force=True)
            self.assertIn(job_key("GEM7", "charge", date(2025, 1, 1)), store.jobs)

        def test_83_legacy_read_only_and_production_never_mix(self):
            legacy = self.make_legacy_store(write_mode=False)
            legacy.enroll("GEM7", "charge", date(2026, 9, 17))
            legacy.save()
            store = TaskStore(queue_file(self.args))
            self.assertEqual(migrate_legacy_queues(store, self.args), 0)
            self.assertFalse(store.jobs)

        def test_84_import_only_selected_platform_and_type(self):
            self.args.data_type = "charge"
            legacy = self.make_legacy_store()
            for platform in ("GEM7", "MAX7"):
                for dtype in ORDER_SPECS:
                    legacy.enroll(platform, dtype, date(2026, 9, 17))
            legacy.save()
            store = TaskStore(queue_file(self.args))
            migrate_legacy_queues(store, self.args)
            self.assertTrue(all(j["platform"] == "GEM7" and j["data_type"] == "charge" for j in store.jobs.values()))
            self.args.platform = "all"
            self.args.data_type = "all"
            self.assertEqual(migrate_legacy_queues(store, self.args), 6)
            self.assertEqual(len(store.jobs), 8)

        def test_85_legacy_import_idempotent(self):
            legacy = self.make_legacy_store()
            legacy.enroll("GEM7", "charge", date(2026, 9, 17))
            legacy.save()
            store = TaskStore(queue_file(self.args))
            migrate_legacy_queues(store, self.args)
            key = job_key("GEM7", "charge", date(2026, 9, 17))
            store.finish(key, {"written": 20})
            reloaded = TaskStore(store.path)
            self.assertEqual(migrate_legacy_queues(reloaded, self.args), 0)
            self.assertEqual(reloaded.jobs[key]["status"], "done")

        def test_86_new_day_done_not_reset_by_another_legacy_source(self):
            legacy = self.make_legacy_store(business="UTC")
            legacy.enroll("GEM7", "charge", date(2026, 9, 17))
            legacy.save()
            store = TaskStore(queue_file(self.args))
            key = store.enroll("GEM7", "charge", date(2026, 9, 17))
            store.finish(key, {"written": 20})
            migrate_legacy_queues(store, self.args)
            self.assertEqual(store.jobs[key]["status"], "done")

        def test_87_corrupt_legacy_file_preserved_and_new_queue_not_written(self):
            legacy = self.make_legacy_store()
            legacy.path.write_text("{broken", encoding="utf-8")
            store = TaskStore(queue_file(self.args))
            original = copy.deepcopy(store.data)
            with self.assertRaises(CollectorError):
                migrate_legacy_queues(store, self.args)
            self.assertEqual(store.data, original)
            self.assertFalse(store.path.exists())
            self.assertEqual(legacy.path.read_text(), "{broken")

        def test_88_old_origin_carried_without_changing_database(self):
            legacy = self.make_legacy_store()
            legacy.enroll("GEM7", "charge", date(2026, 9, 17))
            legacy.data["origins"]["GEM7"] = "https://example.test"
            legacy.save()
            store = TaskStore(queue_file(self.args))
            migrate_legacy_queues(store, self.args)
            self.assertEqual(store.data["origins"]["GEM7"], "https://example.test")

        def test_89_conflicting_origins_do_not_auto_transfer_jobs(self):
            legacy = self.make_legacy_store()
            legacy.enroll("GEM7", "charge", date(2026, 9, 17))
            legacy.data["origins"]["GEM7"] = "https://first.test"
            legacy.save()
            store = TaskStore(queue_file(self.args))
            store.data["origins"]["GEM7"] = "https://second.test"
            with self.assertRaisesRegex(CollectorError, "host 不一致"):
                migrate_legacy_queues(store, self.args)
            self.assertFalse(store.jobs)
            self.assertEqual(store.data["origins"]["GEM7"], "https://second.test")

        def test_90_current_india_day_waits_in_daily_queue(self):
            self.args.mode = "daily"
            store = TaskStore(queue_file(self.args))
            yesterday = store.enroll("GEM7", "charge", date(2026, 9, 17))
            today = store.enroll("GEM7", "charge", date(2026, 9, 18))
            now = datetime(2026, 9, 18, 12, tzinfo=ZoneInfo(BACKEND_TIMEZONE_NAME)).timestamp()
            self.assertEqual(store.due(self.args, now), [yesterday])
            self.assertIn(today, store.due(self.args, now + 86400))

        def test_91_india_legacy_queue_does_not_expand_into_extra_day(self):
            self.assertEqual(india_days_overlapping(date(2026, 9, 17), "Asia/Kolkata"), [date(2026, 9, 17)])
            self.assertEqual(india_days_overlapping(date(2026, 9, 17), "Asia/Yerevan"),
                             [date(2026, 9, 17), date(2026, 9, 18)])

        def test_92_other_connection_queue_not_imported(self):
            with patch.dict(os.environ, {"SUPABASE_URL": "https://another-project.supabase.co"}):
                legacy = self.make_legacy_store()
                legacy.enroll("GEM7", "charge", date(2026, 9, 17))
                legacy.save()
            store = TaskStore(queue_file(self.args))
            self.assertEqual(migrate_legacy_queues(store, self.args), 0)
            self.assertFalse(store.jobs)

        def test_93_runtime_task_builds_india_window_without_flag(self):
            with patch.object(module, "collect_type", return_value=CollectionResult([], 1, 0, [])) as collect:
                run_collection_task(self.platform, "charge", date(2026, 9, 17), self.args, None, {})
            window = collect.call_args.args[2]
            self.assertEqual(window.timezone_name, "Asia/Kolkata")
            self.assertEqual(window.utc_start, "2026-09-16T18:30:00.000Z")

        def test_94_full_day_pagination_with_midnight_rows(self):
            first = {**self.charge, "create_time": "2026-09-17 00:00:00"}
            last = {**self.charge, "id": 3, "create_time": "2026-09-17 23:59:59.999"}
            client = Mock()
            client.request.side_effect = [self.envelope([first], 2, 1, 2), self.envelope([last], 2, 2, 2)]
            items, pages = fetch_all_pages(client, static_request_template(self.platform, "charge"),
                                          "charge", self.window, False, "GEM7", 2000)
            self.assertEqual((len(items), pages), (2, 2))

        def test_95_legacy_timezone_command_cannot_change_policy(self):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exc:
                build_parser().parse_args(["--timezone", "Asia/Yerevan"])
            self.assertEqual(exc.exception.code, 2)

        def test_96_month_and_year_boundary_windows(self):
            w = build_date_window(date(2027, 1, 1))
            self.assertEqual(w.utc_start, "2026-12-31T18:30:00.000Z")
            self.assertEqual(w.utc_end, "2027-01-01T18:29:59.999Z")
            self.assertEqual(india_days_overlapping(date(2026, 12, 31), "Asia/Yerevan"),
                             [date(2026, 12, 31), date(2027, 1, 1)])

        def test_97_unknown_files_not_silently_migrated(self):
            (self.root / "queue-unrelated.json").write_text("{broken", encoding="utf-8")
            store = TaskStore(queue_file(self.args))
            self.assertEqual(migrate_legacy_queues(store, self.args), 0)
            self.assertEqual((self.root / "queue-unrelated.json").read_text(), "{broken")

        def test_98_status_does_not_write_or_migrate(self):
            legacy = self.make_legacy_store()
            legacy.enroll("GEM7", "charge", date(2026, 9, 17))
            legacy.save()
            with contextlib.redirect_stdout(io.StringIO()) as output:
                show_status(self.args)
            self.assertIn("存在旧口径队列", output.getvalue())
            self.assertFalse(queue_file(self.args).exists())

        def test_99_new_source_times_do_not_expand_privacy_fields(self):
            item = {**self.charge, "password": "", "uid": "private-uid",
                    "account": "private-account", "ip": "192.0.2.123"}
            row = normalize_charge(self.platform.platform_id, item, self.names)
            serialized = json.dumps(row)
            self.assertEqual(row["uid"], "private-uid")
            for forbidden in ("private-password", "private-account", "192.0.2.123"):
                self.assertNotIn(forbidden, serialized)
            self.assertEqual(set(row["raw_payload"]["_source_times"]), {"create_time", "pay_time", "update_time"})

    old_source_zone = SOURCE_TIMEZONE_NAME
    old_inline_config = LOGIN_CONFIG
    old_manager = AUTOLOGIN_MANAGER
    try:
        setattr(module, "LOGIN_CONFIG", {})
        setattr(module, "AUTOLOGIN_MANAGER", None)
        # Sample fixtures have a fixed documented source zone, independent of
        # the operator's environment overrides for actual collection.
        setattr(module, "SOURCE_TIMEZONE_NAME", "Asia/Kolkata")
        sample_test()
        if not full:
            return 0
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(RegressionTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        print(f"self-test: tests={result.testsRun}, failures={len(result.failures)}, errors={len(result.errors)}; OFFLINE ONLY")
        return 0 if result.wasSuccessful() else 1
    finally:
        setattr(module, "SOURCE_TIMEZONE_NAME", old_source_zone)
        setattr(module, "LOGIN_CONFIG", old_inline_config)
        setattr(module, "AUTOLOGIN_MANAGER", old_manager)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("已取消", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        # Errors contain only sanitized metadata; no request headers, bodies or row data.
        print(f"ERROR: {safe_error(exc)}", file=sys.stderr)
        raise SystemExit(1)
