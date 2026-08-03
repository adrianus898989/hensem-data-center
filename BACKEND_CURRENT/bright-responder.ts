import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;

  const raw = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/笔/g, "")
    .trim();

  if (!raw) return 0;

  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function toPercent(
  value: unknown,
  fallback = 0,
): number {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return fallback;
  }

  const raw = String(value).trim();
  const hasPercentSymbol = raw.includes("%");
  const n = toNumber(value);

  if (!Number.isFinite(n)) return fallback;

  if (hasPercentSymbol) return n / 100;

  return n > 1 ? n / 100 : n;
}

function normalizeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCountryFromSheet(
  sheetName: string,
): string {
  const name = sheetName
    .replace(/盘口/g, "")
    .trim();

  if (name.includes("印度")) return "印度";
  if (name.includes("南美")) return "南美";
  if (name.includes("巴基斯坦")) return "巴基斯坦";
  if (name.includes("胖虎巴西")) return "胖虎巴西";
  if (name.includes("巴西")) return "巴西";
  if (name.includes("越南")) return "越南";
  if (name.includes("印尼")) return "印尼";
  if (name.includes("马来")) return "马来";
  if (name.includes("缅甸")) return "缅甸";
  if (name.includes("菲律宾")) return "菲律宾";

  return name || sheetName;
}


// ===== v239 原版 thirdPartyNameMap.ts =====
// 三方名称统一：严格按国家匹配，马来 TRUEPAY/TPAY 不再串到越南 FASTPAY。

function compactThirdParty(value: string): string {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/[\s_（）()\[\]【】]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");
}

function aliasKey(value: string): string {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[^a-z0-9一-龥]+/g, "");
}

function brazilPixAliasKey(value: string): string {
  // PIXPAY012 / PIXPAY013 / PIX 012 这类前面带 0 的编码，要先压成 PIXPAY12 / PIXPAY13，
  // 不然巴西会被错误显示成 PIXPAY012，而不是 WinWinPay / NanaPay。
  return aliasKey(value).replace(/^(pixpay|pix)0+(\d+)$/, "$1$2");
}

function currencyFreeAliasKey(value: string): string {
  // 三方量表常写 FASTPay(VND)、VNSPAY(VND)、TronPay(USDT)。
  // 费率表通常只写 FASTPAY / VNSPAY / TRONPAY，所以匹配前必须先去掉币种括号。
  return aliasKey(
    normalizeCell(value)
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/\((?:BRL|INR|PKR|PHP|VND|MMK|NGN|MXN|COP|CLP|BDT|USDT|TRX|二|2)\)/gi, "")
      .replace(/(?:BRL|INR|PKR|PHP|VND|MMK|NGN|MXN|COP|CLP|BDT|USDT|TRX)$/gi, "")
  );
}

function countryKey(value?: string): string {
  const raw = normalizeCell(value || "");
  if (!raw) return "";
  if (raw.includes("胖虎巴西")) return "巴西";
  if (raw.includes("巴西")) return "巴西";
  if (raw.includes("巴基斯坦")) return "巴基斯坦";
  if (raw.includes("菲律宾")) return "菲律宾";
  if (raw.includes("尼日利亚")) return "尼日利亚";
  if (raw.includes("哥伦比亚") || /colombia/i.test(raw)) return "哥伦比亚";
  if (raw.includes("墨西哥") || /mexico/i.test(raw)) return "墨西哥";
  if (raw.includes("智利") || /chile/i.test(raw)) return "智利";
  if (raw.includes("印度")) return "印度";
  if (raw.includes("越南")) return "越南";
  if (raw.includes("印尼")) return "印尼";
  if (raw.includes("缅甸")) return "缅甸";
  if (raw.includes("马来")) return "马来";
  if (raw.includes("埃及")) return "埃及";
  if (/USDT|U通道/i.test(raw)) return "USDT";
  return raw.replace(/原生|盘口|通道|国家|地区/g, "").trim();
}

function stripBusinessSuffix(value: string): string {
  const raw = normalizeCell(value);
  if (!raw) return raw;
  return raw
    .replace(/[（(]\s*(代收|代付|支付|出款|入款|收款)\s*[）)]$/i, "")
    .replace(/\s*[-_]?\s*(代收|代付|支付|出款|入款|收款)$/i, "")
    .trim();
}

type ThirdPartyAliasEntry = { country: string; canonical: string; aliases: string[] };

// 来自用户上传的「三方名称及类型.xlsx」。用于三方量 + 三方费率统一识别。
// 匹配时忽略大小写、空格、符号；显示时保留 canonical 的系统大小写。
const UPLOADED_THIRD_PARTY_ALIASES: ThirdPartyAliasEntry[] = [{"country":"印尼","canonical":"AiPay","aliases":["10360","10612","AIPAY","QRIS (AiPay)"]},{"country":"印尼","canonical":"BasePay","aliases":["10366","10624","BasePay","Nekpay","QRIS (Nekpay)"]},{"country":"印尼","canonical":"ClickPay","aliases":["10359","10611","CLICKPAY","QRIS (ClickPay)"]},{"country":"印尼","canonical":"CoverPay","aliases":["10216","10374","10377","10782","10783","10784","10785","10786","BNI-VA (Transafe)","BRI-VA (Transafe)","CIMB-VA (Transafe)","CoverPay","MANDIRI-VA (Transafe)","OVO (Transafe)","PERMATA-VA (Transafe)","QRIS (Transafe)","TRANSAFE"]},{"country":"印尼","canonical":"JayaPay","aliases":["10381","10382","10649","10669","10687","10688","10689","10690","B~JAYAPAY","BNI-VA (JayaPay)","BRI-VA (JayaPay)","DANA (JayaPay)","E~JAYAPAY","JayaPay","MANDIRI-VA (JayaPay)","QRIS (JayaPay)","QRIS (JayaPay)（已废弃）"]},{"country":"印尼","canonical":"KILIPAY","aliases":["KILIPAY","10442","10443","10788","2000092","2000094","2000110","2000154","2000167","B~KILIPAY","E~KILIPAY","QRIS (Kilipay)"]},{"country":"印尼","canonical":"PayIngPayI","aliases":["10434","10435","10757","10758","10759","10795","10796","10797","10798","BNI-VA (PayIng)","B~PAYING","BRI-VA (PayIngPay)","E~PAYING","LinkAja (PayIngPay)","MANDIRI -VA (PayIng)","OVO - (PayIng)","PayIngPayI","PERMATA -VA (PayIng)","QRIS (PayIngPay)"]},{"country":"印尼","canonical":"SafePay","aliases":["10362","10363","10614","SafePay","Safepay OLD","SAFEPAY WALLET OLD"]},{"country":"印尼","canonical":"SafePay2","aliases":["10430","10431","10748","10749","10750","10751","2000106","2000107","2000108","2000109","2000121","2000136","2000166","BANK- SafePayIDR","DANA (SafePay)","OVO (SafePay)","safe2pay03","SafePay2","VA (SafePay)","WALLET-SafePayIDR","印尼网银","印尼钱包LINKAJA","印尼钱包OVO"]},{"country":"印尼","canonical":"StarPay","aliases":["10170","10293","10474","10486","10487","10777","10778","10779","10780","2000122","BNI-VA (Sudalink)","BRI-VA (Sudalink)","CIMB-VA (Sudalink)","MANDIRI-VA (Sudalink)","OVO (StarPay)","Permata-VA (Sudalink)","StarPay"]},{"country":"印尼","canonical":"TDQRISPay","aliases":["10018","10045","QRIS (TDPay)","TDQRISPay"]},{"country":"印尼","canonical":"TodayPay","aliases":["TodayPay","10042","10043","10044","2000096","2000129","2000132","2000144","2000174","BCA-VA (TDPay)","DANA (TDPay)","DANA-uanggopay","OVO (TDPay)","TDPay"]},{"country":"印尼","canonical":"WanguPay","aliases":["10608","QRIS (WanguPay)","WanguPay"]},{"country":"印尼","canonical":"newbayarpay","aliases":["2000099","2000112","2000114","2000127","2000138","2000142","2000151","2000159","2000172","DANA-todaypay","LINKAJA-newbayarpay","newbayarpay","OVO-newbayarpay","QRIS-todaypay"]},{"country":"印尼","canonical":"uanggoPay","aliases":["uanggoPay","2000124","2000139","2000141","2000169","2000171","DANA-kilipay"]},{"country":"印度","canonical":"99Pay","aliases":["10086","10197","99Pay","99PAY-QR"]},{"country":"印度","canonical":"AYPayUSDT","aliases":["AYPayUSDT","10965","AYPayUSDTCU","USDT-5"]},{"country":"印度","canonical":"ArbPay","aliases":["10090","1015","10201","10444","10445","26000","26001","26003","Arb-BANK","ArbPay","ArbPayINR","Arb-UPI","FastUPI提现","Phonepe_QR"]},{"country":"印度","canonical":"DiDiPay","aliases":["DiDiPay","12053","12082","DiDiPayINR","DiDi-QR"]},{"country":"印度","canonical":"FFPay","aliases":["10181","10308","FFPAY","FFPay-QR"]},{"country":"印度","canonical":"GaayPay","aliases":["10252","10549","10559","GAAYPay","GaayPay-QR","QR-AGPay"]},{"country":"印度","canonical":"ICPay","aliases":["ICPay","12089","12150","ICPayINR","ICPay-QR"]},{"country":"印度","canonical":"IcePay","aliases":["10173","10221","10298","10384","Cloudspay-QR","ICEPAY"]},{"country":"印度","canonical":"MagicPay","aliases":["10320","10540","MagicPay","MagicPayINR","MagicPay-QR"]},{"country":"印度","canonical":"MovPay","aliases":["12022","MovPay","MovPay-QR"]},{"country":"印度","canonical":"NewWinPay","aliases":["12014","12079","NewWin","NewWinPay","NewWin-QR"]},{"country":"印度","canonical":"NinePay","aliases":["10425","10739","10743","NinePay","NinePay-QR","PAYTM-NinePay"]},{"country":"印度","canonical":"PailePay","aliases":["10141","10262","Paile","PailePay","Paile-QR"]},{"country":"印度","canonical":"PayBetPay","aliases":["10509","10929","PayBet","PayBetPay","PayBetPay-QR"]},{"country":"印度","canonical":"RUJIA","aliases":["RUJIA","10230","AGPayINR","QR-RuJia","RuJiaPay"]},{"country":"印度","canonical":"RsPay","aliases":["10081","10125","10142","10187","10246","10265","RsPay","RsPay-QR","TRANS","Transafe-QR"]},{"country":"印度","canonical":"SuperPay","aliases":["SuperPay"]},{"country":"印度","canonical":"SuperPay2","aliases":["SuperPay2"]},{"country":"印度","canonical":"TronPayUSDT","aliases":["TronPayUSDT","10626","TronPayUSDTCU","USDT-3"]},{"country":"印度","canonical":"TyPay3","aliases":["10830","10837","PAYTM-TyPay3","TyPay3","TyPay3-QR"]},{"country":"印度","canonical":"UPay13USDT","aliases":["UPay13USDT","12015","UPay13USDTCU","USDT-6"]},{"country":"印度","canonical":"UUPay","aliases":["10415","QR-UUPay","UUPay"]},{"country":"印度","canonical":"UmoneyPay","aliases":["10386","10656","10696","10697","PAYTM-Umoney","QR-Umoney","Umoney","UmoneyPay","Umoney-QR"]},{"country":"印度","canonical":"UniPay","aliases":["UniPay"]},{"country":"印度","canonical":"UniPayUSDT","aliases":["UniPayUSDT"]},{"country":"印度","canonical":"UpiPay","aliases":["10324","10545","UpiPay","UpiPayINR","UpiPay-QR"]},{"country":"印度","canonical":"VstarPay","aliases":["VstarPay"]},{"country":"印度","canonical":"WPay","aliases":["10167","10289","10453","10947","PAYTM-WPay","WPay","WPay-QR"]},{"country":"印度","canonical":"WandaPay","aliases":["10692","QR-WandaPay","WandaPay"]},{"country":"印度","canonical":"WePay","aliases":["10313","10525","10606","10607","10707","PAYTM-WePay","QR-WePay","WePay","WePay-QR"]},{"country":"印度","canonical":"YayaPay","aliases":["10300","10503","10504","10725","QR-YayaPay","YayaPay","YayaPay-QR"]},{"country":"印度","canonical":"三方名称","aliases":["三方名称","代付ID","代收ID","出款显示名称","前台显示名称"]},{"country":"哥伦比亚","canonical":"EPay","aliases":["EPay"]},{"country":"哥伦比亚","canonical":"LUCKYPAY","aliases":["LUCKYPAY"]},{"country":"哥伦比亚","canonical":"STARPAGO","aliases":["STARPAGO"]},{"country":"哥伦比亚","canonical":"Supefina","aliases":["Supefina"]},{"country":"哥伦比亚","canonical":"TodayPay","aliases":["TodayPay","todpay-new"]},{"country":"哥伦比亚","canonical":"starpay-TRANSFIYA","aliases":["starpay-TRANSFIYA"]},{"country":"墨西哥","canonical":"EPay","aliases":["EPay"]},{"country":"墨西哥","canonical":"MPAY","aliases":["MPAY"]},{"country":"墨西哥","canonical":"STARPAGO","aliases":["STARPAGO"]},{"country":"墨西哥","canonical":"Supefina","aliases":["Supefina"]},{"country":"墨西哥","canonical":"TodayPay","aliases":["TodayPay","TOD","todpay"]},{"country":"尼日利亚","canonical":"P24hrPay","aliases":["10368","10627","P24HR","P24hrPay"]},{"country":"尼日利亚","canonical":"ShPay","aliases":["10025","10070","SH","SHPAY"]},{"country":"尼日利亚","canonical":"TronPayUSDT","aliases":["TronPayUSDT","10367","10626","TronPayUSDTCU","USDT-3"]},{"country":"尼日利亚","canonical":"UPay2USDT","aliases":["UPay2USDT","10138","10155","UPay2USDTCU","USDT"]},{"country":"尼日利亚","canonical":"UUPayUSDT","aliases":["UUPayUSDT","10243","USDT - TRC20","UUPayUSDTCU"]},{"country":"尼日利亚","canonical":"UniPayUSDT","aliases":["UniPayUSDT","10729","UniPayUSDTCU","USDT-4"]},{"country":"尼日利亚","canonical":"WanguPay","aliases":["10028","10072","WanguPay","WP","WPPay"]},{"country":"巴基斯坦","canonical":"ATPay-EP","aliases":["12049","ATPay-EP","ATPay-Wallet2"]},{"country":"巴基斯坦","canonical":"ATPay-Jazz","aliases":["12050","ATPay-Jazz"]},{"country":"巴基斯坦","canonical":"Dee-EP","aliases":["12034","Dee-EP","DeePay-Wallet2"]},{"country":"巴基斯坦","canonical":"Dee-Jazz","aliases":["12035","Dee-Jazz"]},{"country":"巴基斯坦","canonical":"DeePayPKR-EASYPAISA","aliases":["DeePayPKR-EASYPAISA"]},{"country":"巴基斯坦","canonical":"DeePayPKR-JAZZCASH","aliases":["DeePayPKR-JAZZCASH"]},{"country":"巴基斯坦","canonical":"EPay","aliases":["10421","10734","10735","12031","12045","12046","EPay","EPay2PKR-Easy","EPay2PKR-Jazz","EPay2-Wallet2","EPay-EP","EPay-Jazz"]},{"country":"巴基斯坦","canonical":"Ok-EP","aliases":["Ok-EP","OkPay","OkPay-Wallet2"]},{"country":"巴基斯坦","canonical":"Ok-Jazz","aliases":["12032","Ok-Jazz"]},{"country":"巴基斯坦","canonical":"OkPayPKR-Easypaisa","aliases":["OkPayPKR-Easypaisa"]},{"country":"巴基斯坦","canonical":"OkPayPKR-jazzcash","aliases":["OkPayPKR-jazzcash"]},{"country":"巴基斯坦","canonical":"Open-EP","aliases":["10532","Open-EP","OpenPay","OpenPay-Wallet2"]},{"country":"巴基斯坦","canonical":"Open-Jazz","aliases":["Open-Jazz"]},{"country":"巴基斯坦","canonical":"OpenPayPKR-Easy","aliases":["OpenPayPKR-Easy"]},{"country":"巴基斯坦","canonical":"OpenPayPKR-JazzCash","aliases":["OpenPayPKR-JazzCash"]},{"country":"巴基斯坦","canonical":"Owen-EP","aliases":["12042","Owen-EP","OwenPay","OwenPay-Wallet2"]},{"country":"巴基斯坦","canonical":"Owen-Jazz","aliases":["12041","Owen-Jazz"]},{"country":"巴基斯坦","canonical":"OwenPayPKR-EASYPAISA","aliases":["OwenPayPKR-EASYPAISA"]},{"country":"巴基斯坦","canonical":"OwenPayPKR-JAZZCASH","aliases":["OwenPayPKR-JAZZCASH"]},{"country":"巴基斯坦","canonical":"P777-EP","aliases":["P777-EP","P777Pay"]},{"country":"巴基斯坦","canonical":"P777-Jazz","aliases":["P777-Jazz"]},{"country":"巴基斯坦","canonical":"P777PayPKR-Easy","aliases":["12030","P777PayPKR-Easy"]},{"country":"巴基斯坦","canonical":"P777PayPKR-Jazz","aliases":["P777PayPKR-Jazz"]},{"country":"巴基斯坦","canonical":"Pk-EP","aliases":["12037","Pk-EP","PkPay","PkPay-Wallet2"]},{"country":"巴基斯坦","canonical":"Pk-Jazz","aliases":["12038","Pk-Jazz"]},{"country":"巴基斯坦","canonical":"PkPayPKR-EASYPAISA","aliases":["PkPayPKR-EASYPAISA"]},{"country":"巴基斯坦","canonical":"PkPayPKR-JAZZCASH","aliases":["PkPayPKR-JAZZCASH"]},{"country":"巴基斯坦","canonical":"StarPago-EP","aliases":["10397","12040","StarPago","StarPago-EP"]},{"country":"巴基斯坦","canonical":"StarPago-Jazz","aliases":["12039","StarPago-Jazz"]},{"country":"巴基斯坦","canonical":"UniPayUSDT","aliases":["UniPayUSDT","12052","UniPayUSDT(2)","USDT"]},{"country":"巴西","canonical":"EPay","aliases":["EPay","EPayBRL","EPay(BRL)(二)","PIX-33","PIXPAY10"]},{"country":"巴西","canonical":"H88Pay","aliases":["H88Pay","H88Pay(BRL)","PIX-35"]},{"country":"巴西","canonical":"NanaPay","aliases":["NanaPay","NanaPayBRL","PIXPAY3"]},{"country":"巴西","canonical":"Pay4z","aliases":["PAY4Z","PIXPAY11"]},{"country":"巴西","canonical":"TodayPay","aliases":["EPay(BRL)(二)(编码:2364)","PIX-34","PIXPAY4","TDPayBRL","TodayPay"]},{"country":"巴西","canonical":"U2CPay","aliases":["U2CPay","PIXPAY16","U2CPAYBRL"]},{"country":"巴西","canonical":"UUPay","aliases":["UUPay","PIX-31","UUPay(BRL)"]},{"country":"巴西","canonical":"WinWinPay","aliases":["WinWinPay","PIX-32","PIXPAY12"]},{"country":"智利","canonical":"EPay","aliases":["EPay"]},{"country":"智利","canonical":"STARPAGO","aliases":["STARPAGO"]},{"country":"智利","canonical":"Supefina","aliases":["Supefina"]},{"country":"智利","canonical":"TodayPay","aliases":["TodayPay","todpay"]},{"country":"缅甸","canonical":"BcatPay","aliases":["10506","10927","10928","10991","BcatPay","KbzBank-Bcat","KBZ-Bcat","KBZPay-BCAT","WavePay-BCAT"]},{"country":"缅甸","canonical":"H88Pay","aliases":["10543","10966","10967","12078","H88Pay","KBZ-H88Pay","KBZPay-H88","WAVE-H88Pay","WavePay-H88"]},{"country":"缅甸","canonical":"HyPay","aliases":["12010","12011","12013","12014","HyPay","KBZ-HY","KBZPay-HY","WAVE-HY","WavePay-HY"]},{"country":"缅甸","canonical":"KingPay","aliases":["10478","10479","10842","10843","KBZ-KING","KBZPay-KING","KingPay","WAVE-KING","WavePay-KING"]},{"country":"缅甸","canonical":"MMKPay","aliases":["12042","12043","12064","12065","KBZ-MMK","KBZpay-MMK","MMKPay","WAVE-MMK","WavePay-MMK"]},{"country":"缅甸","canonical":"RmPay","aliases":["10502","10503","10867","10868","KBZPay-RM","KBZ-Rm","RmPay","WavePay-RM","WAVE-Rm"]},{"country":"缅甸","canonical":"TronPayUSDT","aliases":["TronPayUSDT","10367","10626","TronPayUSDTCU","USDT-TronPay"]},{"country":"缅甸","canonical":"UniPayUSDT","aliases":["UniPayUSDT","10416","10729","UniPayUSDTCU"]},{"country":"缅甸","canonical":"YTPay","aliases":["12075","12076","12131","12132","KBZPay-YT","KBZ-YTPay","WavePay-YT","WAVE-YTPay","YTPay"]},{"country":"菲律宾","canonical":"GECEPay","aliases":["GECEPay","GCASH-gecepay","gecepay-Bank","gecepay-GCash","gecepay-GOtyMe","gecepay-GrabPay","gecepay-PayMaya","MAYA-gecepay"]},{"country":"菲律宾","canonical":"JAYAPay","aliases":["JAYAPay","GCash-jayapay","jayapay-Bank","jayapay-GCash","jayapay-GOtyMe","jayapay-GrabPay","jayapay-PayMaya","Maya-jayapay"]},{"country":"菲律宾","canonical":"KILIPAY","aliases":["2000207","2000208","2000210","2000212","2000213","2000238","2000269","2000331","2000362","3158","3160","4911","4912","GCASH-kili2pay","GCASH-kilipay","GRAB-kili2pay","GRAB-kilipay","KILI2PAY","kili-GCASH","kili-MAYA","KILIPAY","kilipay-Bank","kilipay-Gcash","kilipay-GOtyMe","kilipay-GrabPay","kilipay-maya","kilipay-PayMaya","MAYA-kili2pay","MAYA-kilipay"]},{"country":"菲律宾","canonical":"PINOYPay","aliases":["PINOYPay","2000216","2000271","2000364","2406","3768","GCASH-pinoypay","novapay-gcash","pinoypay-Bank","pinoypay-gcash","pinoypay-GrabPay"]},{"country":"菲律宾","canonical":"SHIJIE","aliases":["SHIJIE","1731","1732","3175","3178","3179","3180","3181","shijie-gcash","shijie-maya","SHIJIEPAY","shijiepay-gcash-l原生","shijiepay-gcashQR","shijiepay-gcash原生","shijiepay-GotymeQR","shijiepay-maya"]},{"country":"菲律宾","canonical":"SHIJIEV3","aliases":["2000222","2000223","2000225","2000230","2000242","2000273","2000335","2000366","GCASH-L-shijiev3pay","GCASH-QR-shijiev3pay","GCASH-WAP-shijiev3pay","GOTYME-shijiev3pay","MAYA-shijiev3pay","SHIJIEV3","SHIJIEV3PAY","shijiev3pay-Bank","shijiev3pay-GCash","shijiev3pay-GOtyMe","shijiev3pay-GrabPay","shijiev3pay-PayMaya"]},{"country":"菲律宾","canonical":"UXPAY","aliases":["2000173","2000193","2000196","2000255","2000317","2000348","2430","2431","3824","3826","GCASH-uxpay","MAYA-uxpay","ux-gCash","UXPAY","uxpay-Bank","UXPAY Gcash","uxpay-GOtyMe","uxpay-GrabPay","UXPAY-Maya","uxpay-PayMaya"]},{"country":"菲律宾","canonical":"WIN2Pay","aliases":["WIN2Pay","2000189","2000190","2000201","2000232","2018","2019","4612","GCASH-QR-win2pay","MAYA-win2pay","MAYA直连","Win2 Gcash","Win2 Maya","win2pay-GCash","win2pay-PayMaya"]},{"country":"越南","canonical":"1VNPay","aliases":["10042","10330","10332","12061","12104","12105","12106","1VNPAY"]},{"country":"越南","canonical":"FASTPay","aliases":["FASTPay","10203","10351","10353","12055","12086","12087","Fast","Fast-QR"]},{"country":"越南","canonical":"PanPay","aliases":["10405","10407","12056","12089","12090","PanPay","PAN-QR"]},{"country":"越南","canonical":"QuickPay","aliases":["10043","10102","10104","QuickPay"]},{"country":"越南","canonical":"SHIJIE","aliases":["SHIJIE","10210","10363","10372","SHIJIEPAY","Shijie-QR"]},{"country":"越南","canonical":"UniPayUSDT","aliases":["10416","12036","12052","UniPayUSDT"]},{"country":"越南","canonical":"V8Pay","aliases":["10045","10113","10114","12059","12098","12100","V8Pay"]},{"country":"越南","canonical":"VNBANKPay","aliases":["VNBANKPay","10298","10501","10505","12060","12102"]},{"country":"越南","canonical":"VnsPay","aliases":["12070","12124","VnsPay"]},{"country":"越南","canonical":"三方名称","aliases":["三方名称","代付ID","代收ID","出款显示名称","前台显示名称"]},{"country":"马来","canonical":"BasePay","aliases":["10418","10419","10732","10819","BasePay","E-NekPay","FPX-NEKPAY","NekPay","Touch n Go-NEKpa..."]},{"country":"马来","canonical":"FPay","aliases":["10022","10051","10431","10432","DuitNow-Fpay","FPay","FPX-Fpay","Telcom-Fpay"]},{"country":"马来","canonical":"RapidPay","aliases":["12069","12121","12157","12158","12159","12160","12161","Boost-RapidPay","DuitNow-RapidPay","FPX-RapidPay","GrabPay-RapidPay","MaybankQR-RapidP...","RapidPay","Touch n Go-Rapid..."]},{"country":"马来","canonical":"Skl99Pay","aliases":["10464","10465","10828","10829","DuitNow-SKL99","FPX-Skl99Pay","Skl99Pay"]},{"country":"马来","canonical":"TruePay","aliases":["10023","10055","10056","10057","10058","10060","10066","10067","10266","10760","DuitNow-TP","FPXDUITNOW - TP","FPX-TP","FPX-TPAY","FPX-TruePay","GrabPay-TP","ShopeePay-TP","Tng-DuitNow-TP","Touch n Go -TP","TruePay"]},{"country":"马来","canonical":"UniPayUSDT","aliases":["UniPayUSDT","10416","10729","UniPay","UniPayUSDTCU"]},{"country":"马来","canonical":"WinPay","aliases":["10582","10585","FPX-WinfaPay","Touch N Go-WinfaPay","WinPay"]}];

const COUNTRY_ALIAS_MAP = new Map<string, string>();
const GLOBAL_ALIAS_CANDIDATES = new Map<string, Set<string>>();
const GLOBAL_ALIAS_MAP = new Map<string, string>();

for (const entry of UPLOADED_THIRD_PARTY_ALIASES) {
  const cKey = countryKey(entry.country);
  const names = [entry.canonical, ...entry.aliases].filter(Boolean);
  for (const alias of names) {
    const key = aliasKey(alias);
    if (!key) continue;
    COUNTRY_ALIAS_MAP.set(`${cKey}|||${key}`, entry.canonical);
    const set = GLOBAL_ALIAS_CANDIDATES.get(key) || new Set<string>();
    set.add(entry.canonical);
    GLOBAL_ALIAS_CANDIDATES.set(key, set);
  }
}

for (const [key, values] of GLOBAL_ALIAS_CANDIDATES.entries()) {
  if (values.size === 1) GLOBAL_ALIAS_MAP.set(key, Array.from(values)[0]);
}

// 手工补充：来自用户后续截图确认的主三方映射，优先修正巴西 / 巴基斯坦 / 马来这些容易被拆开的名称。
const MANUAL_THIRD_PARTY_ALIAS_FIXES: ThirdPartyAliasEntry[] = [
  { country: "印度", canonical: "ATPay", aliases: ["UPI-QR2", "UPI QR2", "UPIQR2"] },
  { country: "越南", canonical: "CGPay", aliases: ["CGPAY", "CGPay", "CGPAY VIETTELPay", "CGPAY-VIETTELPay", "CGPAY VIETTEL", "CGPay ViettelPay"] },
  { country: "越南", canonical: "KG-Pay", aliases: ["KG-Pay", "KG PAY", "KG-PAY MOMO", "KG PAY MOMO", "KG-PAY VIETTEL", "KG PAY VIETTEL", "KG-PAY ZALO", "KG PAY ZALO"] },
  { country: "越南", canonical: "PanPay", aliases: ["PanPay", "PANPAY 原生", "PANPAY原生", "PanPay 原生", "PANPAY"] },
  { country: "越南", canonical: "V8Pay", aliases: ["V8Pay", "V8BANK", "V8 BANK", "V8 MOMO BANK", "V8-MOMO-BANK", "V8 MOMO"] },
  { country: "巴西", canonical: "TransafePay", aliases: ["WD-TRAN", "WD TRAN", "WD_TRAN", "wd-tran", "wdtran", "DP-TRAN", "DP TRAN", "dp-tran", "TransafePay", "TransafePayBRL", "TransferPay", "TransferPayBRL", "PIX9", "PIX-9", "PIXPAY9"] },
  { country: "巴西", canonical: "NanaPay", aliases: ["NANA", "Nana", "NanaPay", "NanaPayBRL", "PIX13", "PIX-13", "PIXPAY13", "PIXPAY013", "PIXPAY3", "PIXPAY03", "PIXPAY3STOP", "PIXPAY3TOP"] },
  { country: "巴西", canonical: "WinWinPay", aliases: ["WinWinPay", "WinWinPayBRL", "PIX12", "PIX-12", "PIXPAY12", "PIXPAY012"] },
  { country: "巴西", canonical: "Pay4z", aliases: ["Pay4z", "Pay4zPay", "Pay4zPayBRL", "PIX17", "PIX-17", "PIXPAY17", "PIXPAY017", "PIXPAY11"] },
  { country: "巴西", canonical: "BetCatPay", aliases: ["BetCatPay", "BetCatPayBRL", "PIX8", "PIX-8", "PIXPAY8", "PIXPAY08"] },
  { country: "巴西", canonical: "U2CPay", aliases: ["U2CPay", "U2CPayBRL", "PIX16", "PIX-16", "PIXPAY16", "PIXPAY016"] },
  { country: "巴西", canonical: "EPay", aliases: ["EPay", "EPayBRL", "EPay(BRL)(二)", "PIX14", "PIX-14", "PIX33", "PIX-33", "PIXPAY10", "PIXPAY010"] },
  { country: "巴西", canonical: "TodayPay", aliases: ["TodayPay", "TDPay", "TDPayBRL", "PIX4", "PIX-4", "PIX34", "PIX-34", "PIXPAY4", "PIXPAY04"] },
  { country: "巴西", canonical: "H88Pay", aliases: ["H88Pay", "H88PayBRL", "PIX22", "PIX-22", "PIX35", "PIX-35", "PIXPAY22"] },
  { country: "巴西", canonical: "UUPay", aliases: ["UUPay", "UuPayBRL", "PIX11", "PIX-11", "PIX31", "PIX-31"] },
  { country: "巴西", canonical: "EyPay", aliases: ["EyPay", "EyPayBRL", "PIX21", "PIX-21"] },
  { country: "巴西", canonical: "DyPayV2", aliases: ["DyPayV2", "PIXPAY20", "PIX PAY20", "PIX-PAY20"] },
  { country: "马来", canonical: "TruePay", aliases: ["TNG DUTNOW ID", "TNG DUTINOW ID", "TNG DUITNOW ID", "TNG DUTNOW", "TNG DUTINOW", "TNG DUITNOW", "TNG-DUTNOW-ID", "TNG-DUITNOW-ID", "Tng-DuitNow-TP", "Touch n Go -TP", "Touch N Go TP", "DuitNow-TP", "FPXDUITNOW - TP", "FPX-TP", "FPX-TPAY", "FPX-TruePay", "TPAY", "TRUEPAY", "TruePay", "TP"] },
  { country: "马来", canonical: "RapidPay", aliases: ["RapidPay", "Touch n Go-RapidPay", "Touch n Go-Rapid...", "Touch N Go RapidPay", "MaybankQR-RapidPay", "MaybankQR-RapidP...", "DuitNow-RapidPay", "FPX-RapidPay", "GrabPay-RapidPay", "Boost-RapidPay"] },
  { country: "马来", canonical: "WinPay", aliases: ["WinPay", "WinFaPay", "WinfaPay", "FPX-WinfaPay", "Touch N Go-WinfaPay", "Touch n Go-WinfaPay"] },
  { country: "巴基斯坦", canonical: "OkPay", aliases: ["OKPAY", "OkPay", "okpay", "OKPAY-EP", "OKPAY-Jazz", "OKPAY-JAZZCASH", "OKPAY-EASYPAISA", "Ok-EP", "Ok-Jazz", "OkPay-Wallet2", "OkPayPKR-Easypaisa", "OkPayPKR-jazzcash"] },
  { country: "巴基斯坦", canonical: "OpenPay", aliases: ["OPENPAY", "OpenPay", "Open-EP", "Open-Jazz", "OpenPay-Wallet2", "OpenPayPKR-Easy", "OpenPayPKR-JazzCash"] },
  { country: "巴基斯坦", canonical: "OpenPay", aliases: ["OPPAY", "OpPay", "OPay", "OpPay-EP", "OpPay-Jazz", "OpPayPKR-Easy", "OpPayPKR-JazzCash", "OpPay-Wallet2"] },
  { country: "巴基斯坦", canonical: "OwenPay", aliases: ["OWEN", "Owen", "Own", "OWN", "OwenPay", "Owen-EP", "Owen-Jazz", "OwenPay-Wallet2", "OwenPayPKR-EASYPAISA", "OwenPayPKR-JAZZCASH"] },
  { country: "巴基斯坦", canonical: "GxPay", aliases: ["gxPay", "gxpay", "gxPay-Jazz", "gxPay-EP", "gxpay-Jazz", "gxpay-EP", "GxPayPKR-Easy", "GxPayPKR-JazzCash"] },
  { country: "巴基斯坦", canonical: "P777Pay", aliases: ["P777", "P777Pay", "P777-EP", "P777-Jazz", "P777PayPKR-Easy", "P777PayPKR-Jazz"] },
  { country: "巴基斯坦", canonical: "PkPay", aliases: ["PkPay", "PKPAY", "Pk-EP", "Pk-Jazz", "PkPayPKR-EASYPAISA", "PkPayPKR-JAZZCASH", "PkPayPKR-Jazz", "PkPayPKR-Easy"] },
  { country: "巴基斯坦", canonical: "StarPago", aliases: ["StarPago", "StarPago-EP", "StarPago-Jazz"] },
  { country: "巴基斯坦", canonical: "P777Pay", aliases: ["777Pay", "777-Pay", "P777", "P777Pay", "P777pay", "P777-EP", "P777-Jazz"] },
  { country: "巴基斯坦", canonical: "DeePay", aliases: ["DePay", "DeePay", "DeePay-Ablepay", "AblePay", "Dee-EP", "Dee-Jazz"] },
  { country: "印尼", canonical: "PayIngPay", aliases: ["PayIngPay", "PayIngPayI", "PayingPay", "PayingPayI", "PayIng", "PAYING", "SECPAY", "SECPAY-PAYING", "SEC PAY", "SecPay", "SecPay-PayIng", "QRIS (PayIngPay)"] },
  { country: "印尼", canonical: "SafePay", aliases: ["SafePay", "SAFEPAY", "SafePay2", "Safe2Pay", "safe2pay03", "Safepay OLD", "SAFEPAY WALLET OLD"] },
  { country: "印尼", canonical: "YerePay", aliases: ["YerePay", "yerePay", "YEREPAY", "Yere Pay", "yere pay", "QRIS (YerePay)", "QRIS YerePay", "QRIS-YerePay", "E~YerePay", "B~YerePay", "E-YerePay", "B-YerePay", "YerePay IDR-DANA", "YerePay IDR DANA", "YerePay-DANA", "DANA (YerePay)"] },
  // 用户确认：SudalinkPay 是独立三方，不属于 StarPay。所有 Sudalink 子通道统一显示 SudalinkPay。
  { country: "印尼", canonical: "SudalinkPay", aliases: ["sudalinkPay", "SudalinkPay", "SUDALINKPAY", "Sudalink", "SUDALINK", "QRIS (Sudalink)", "BNI-VA (Sudalink)", "BRI-VA (Sudalink)", "CIMB-VA (Sudalink)", "MANDIRI-VA (Sudalink)", "Permata-VA (Sudalink)"] },
  { country: "越南", canonical: "TopPay", aliases: ["TopPay", "TOPPAY", "TopPay(VND)", "TopPay(VND)(四)", "TopPay D(四)", "TopPayD", "TOP", "TOP PAY"] },
  { country: "印度", canonical: "RushPay", aliases: ["RushPay", "RushPay-QR"] },
  { country: "印度", canonical: "BussPay", aliases: ["BussPay", "BussPay-QR"] },
  { country: "印度", canonical: "TukPay", aliases: ["TukPay", "TukPay-QR"] },
  { country: "印度", canonical: "ICPay", aliases: ["ICPay", "ICPayINR", "ICPay-QR", "IC2Pay", "IC2Pay-QR", "PAYTM-IC2Pay", "PAYTM IC2Pay", "IC2PAY", "IC2PAY QR"] },
  { country: "印度", canonical: "Speed2Pay", aliases: ["Speed2Pay", "Speed2Pay-QR", "Speed2Pay1", "Speed2Pay2", "Speed2Pay-PAYTM", "PAYTM-Speed2Pay"] },
  { country: "印度", canonical: "OXPay", aliases: ["OXPay", "OXPay-QR", "PAYTM-OXPay", "PAYTM OXPay", "OX2Pay", "OX2Pay-QR", "PAYTM-OX2Pay", "PAYTM OX2Pay"] },
  { country: "印度", canonical: "WeePay", aliases: ["WeePay", "WeePay-QR", "PAYTM-WeePay", "PAYTM WeePay"] },
  { country: "印度", canonical: "ArbPay", aliases: ["ArbPay", "ArbPayINR"] },
  { country: "印度", canonical: "UPI-QR", aliases: ["Phonepe_QR", "Phonepe-QR", "UPI-QR", "ARUPI", "Arb-UPI", "Arb-BANK"] },
  { country: "印度", canonical: "VstarPay", aliases: ["VstarPay", "Vstar-QR", "VstarPay-QR", "Vstar QR", "VstarPay QR"] },
  { country: "印度", canonical: "SUPER", aliases: ["Super", "SUPER", "Super-QR", "Super QR", "SuperPay", "PAYTM-Super"] },
  { country: "印度", canonical: "WePay", aliases: ["WEPAY唤醒", "WEPAY 醒", "WEPAY醒", "PAYTM-WePay", "QR-WePay", "WePay-QR"] },
  { country: "印度", canonical: "MovPay", aliases: ["MOVPAY", "MovPay-QR", "MOV PAY"] },
  { country: "印度", canonical: "MagicPay", aliases: ["MAGICPAY", "MagicPay-QR", "MAGIC PAY"] },
  { country: "印度", canonical: "UpiPay", aliases: ["UPIPAY", "UpiPay-QR", "UPI Pay"] },
  { country: "印度", canonical: "NinePay", aliases: ["NinePay-QR", "NinePayINR 191", "NinePayINR191", "PAYTM-NinePay", "NinePayINR 213", "NinePayINR213"] },
  { country: "巴西", canonical: "TodayPay", aliases: ["TOD", "TODPAY", "TODPay", "TOD Pay", "TDPay Pay", "TDPayBRL(二)", "TDPay(BRL)"] },
  { country: "越南", canonical: "TopPay", aliases: ["TopPay D", "TopPay-D", "TopPay D(四)", "TopPayD(四)", "TOPPAYD", "TOPPAY D", "TOPPAY D(四)", "TopPay VN", "TopPayVND"] },
  { country: "越南", canonical: "FASTPay", aliases: ["FASTPAY", "FASTPay", "FastPay", "FASTPay(VND)", "FastPay(VND)", "FASTPAY(VND)", "FastPay D", "FastPayD"] },
  { country: "印尼", canonical: "PayIngPay", aliases: ["PayIngPayl", "PayingPayl", "PayingPayI", "PayIngPayI", "PAYINGPAYI", "PayIng Pay", "SecPay", "SECPAY", "SECPAY-PAYING", "SecPay PayIng", "SecPay-PayIng"] },
  { country: "印尼", canonical: "SafePay", aliases: ["SafePay2", "SafePay 2", "SAFEPAY2", "Safe2Pay", "SAFEPAY"] },
  { country: "印尼", canonical: "YerePay", aliases: ["yerePay", "YEREPAY", "Yere Pay", "yerepay", "QRIS (YerePay)", "QRIS YerePay", "QRIS-YerePay", "E~YerePay", "B~YerePay", "E-YerePay", "B-YerePay", "YerePay IDR-DANA", "YerePay IDR DANA", "YerePay-DANA", "DANA (YerePay)"] },
  { country: "越南", canonical: "TopPay", aliases: ["TopPay-QR", "TopPayQR", "TopPay QR", "TopPayVND-Bank", "TopPay VND Bank", "TopPay-Bank", "TopPay Bank", "TopPayVNDQR"] },
  { country: "菲律宾", canonical: "ShiJie", aliases: ["SHIJE", "SHIJIE", "ShiJie", "Shijie", "ShiJiePay", "SHIJIEPAY", "shijie-gcash", "shijie-maya", "shijiepay-gcashQR"] },
  { country: "菲律宾", canonical: "KiliPay", aliases: ["KILIPay", "KILIPAY", "KiliPay", "KILI2PAY", "Kili2Pay", "kili-GCASH", "kili-MAYA", "kilipay-Gcash", "kilipay-maya"] },
  { country: "菲律宾", canonical: "UxPay", aliases: ["UXPAY", "UxPay", "UX Pay", "uxpay", "ux-gCash", "UXPAY Gcash", "UXPAY-Maya"] },
  { country: "菲律宾", canonical: "Nova", aliases: ["nova", "Nova", "NOVAPAY", "NovaPay", "novaPay"] },
  { country: "哥伦比亚", canonical: "BeaconPay", aliases: ["BeaconPay", "BEACONPAY", "Beacon Pay", "Beaconpay", "OKEYPAY", "OkeyPay", "Okey Pay", "OKAYPAY", "OkayPay", "OKAY PAY", "OKPAY", "OkPay", "OK Pay"] },
  { country: "墨西哥", canonical: "BeaconPay", aliases: ["BeaconPay", "BEACONPAY", "Beacon Pay", "Beaconpay", "OKEYPAY", "OkeyPay", "Okey Pay", "OKAYPAY", "OkayPay", "OKAY PAY", "OKPAY", "OkPay", "OK Pay"] },
  { country: "智利", canonical: "TodayPay", aliases: ["TOD", "TODPAY", "TODPay", "TOD Pay", "TODPAY", "TODPAY-NEW", "TODPAY NEW", "TODPAYNEW", "TodayPay", "todpay"] },
  { country: "墨西哥", canonical: "TodayPay", aliases: ["TOD", "TODPAY", "TODPay", "TOD Pay", "TODPAY", "TOPPAY-NEW", "TODPAY-NEW", "TODPAY NEW", "TODPAYNEW", "TodayPay", "todpay"] },
  { country: "哥伦比亚", canonical: "TodayPay", aliases: ["TOD", "TODPAY", "TODPay", "TOD Pay", "TODPAY", "TODPAY-NEW", "TODPAY NEW", "TODPAYNEW", "TodayPay", "todpay"] },
  { country: "智利", canonical: "STARPAGO", aliases: ["STARPAGO", "StarPago", "starpago"] },
  { country: "墨西哥", canonical: "STARPAGO", aliases: ["STARPAGO", "StarPago", "starpago"] },
  { country: "哥伦比亚", canonical: "STARPAGO", aliases: ["STARPAGO", "StarPago", "starpago"] },
  { country: "智利", canonical: "EPay", aliases: ["EPAY", "Epay", "EPay", "epay"] },
  { country: "墨西哥", canonical: "EPay", aliases: ["EPAY", "Epay", "EPay", "epay", "EPAY-CLABE", "EPAY CLABE"] },
  { country: "哥伦比亚", canonical: "EPay", aliases: ["EPAY", "Epay", "EPay", "epay"] },
  { country: "哥伦比亚", canonical: "Supefina", aliases: ["SUPEFINA", "Supefina", "supefina", "SUPEFINAPAY", "SUPEFINA-transfiya", "supefina-transfiya"] },
  { country: "墨西哥", canonical: "Supefina", aliases: ["SUPEFINA", "Supefina", "supefina"] },
  { country: "智利", canonical: "Supefina", aliases: ["SUPEFINA", "Supefina", "supefina"] },
  { country: "越南", canonical: "AQFPay", aliases: ["AQFPay", "AQFPayVND-Bank", "AQFPay VND Bank", "AQFPay-QR", "AQFPay QR", "AQFPayVNDQR", "AQFPayVND"] },
  { country: "越南", canonical: "1VNPay", aliases: ["1VNPay", "1VNPay-MoMo", "1VNPay MoMo", "1vnpay - momo", "1vnpay-momo", "1vnpay_momo", "1vnpaymomo", "1VNPay-MOMO", "1VNPay QR", "1VNPay-QR", "1VNPayBank", "1VNPay-Bank"] },
  { country: "越南", canonical: "YesPay", aliases: ["YesPay", "YesPay-QR", "YESPAY", "YESPAY-QR"] },
  { country: "巴基斯坦", canonical: "EPay", aliases: ["newEPay", "new EPay", "new-EPay", "NewEPay", "NEWePay", "newEPay-EP", "newEPay-Jazz", "newEPay PKR"] },
  { country: "USDT", canonical: "UniPayUSDT", aliases: ["UNIPAY-USDT", "UNIPAY USDT", "UniPayUSDT", "UniPayUSDTCU", "UNIPAY", "UniPay", "USDT-UNIPAY"] },
  { country: "USDT", canonical: "TronPayUSDT", aliases: ["TRONPAY-USDT", "TRONPAY USDT", "TronPayUSDT", "TronPayUSDTCU", "TRONPAY", "TronPay", "USDT-TRONPAY"] },
  { country: "USDT", canonical: "UUPayUSDT", aliases: ["UUPAY-USDT", "UUPAY USDT", "UUPayUSDT", "UUPayUSDTCU", "USDT - TRC20", "TRC20", "USDT-TRC20"] },
  { country: "尼日利亚", canonical: "WanguPay", aliases: ["WPay", "W Pay", "WP", "WPPay", "WanguPay", "WangPay", "Wangu"] },
  { country: "巴西", canonical: "VpsPay", aliases: ["VpsPay", "VPSPay", "dp-vpsPay", "wd-vpsPay", "dp-vpspay", "wd-vpspay", "DP-VPSPAY", "WD-VPSPAY"] },
];
for (const entry of MANUAL_THIRD_PARTY_ALIAS_FIXES) {
  const cKey = countryKey(entry.country);
  for (const alias of [entry.canonical, ...entry.aliases]) {
    const key = aliasKey(alias);
    if (!key) continue;
    COUNTRY_ALIAS_MAP.set(`${cKey}|||${key}`, entry.canonical);
    const set = GLOBAL_ALIAS_CANDIDATES.get(key) || new Set<string>();
    set.add(entry.canonical);
    GLOBAL_ALIAS_CANDIDATES.set(key, set);
  }
}
GLOBAL_ALIAS_MAP.clear();
for (const [key, values] of GLOBAL_ALIAS_CANDIDATES.entries()) {
  if (values.size === 1) GLOBAL_ALIAS_MAP.set(key, Array.from(values)[0]);
}


function normalizeCanonicalByCountry(name: string, country?: string): string {
  const raw = normalizeCell(name);
  const key = aliasKey(raw);
  const cKey = countryKey(country);
  const bKey = cKey === "巴西" ? brazilPixAliasKey(raw) : key;

  if (cKey === "巴西") {
    const brazilPix: Record<string, string> = {
      pix9: "TransafePay",
      pix17: "Pay4z",
      pix13: "NanaPay",
      pix8: "BetCatPay",
      pix12: "WinWinPay",
      pix16: "U2CPay",
      pix14: "EPay",
      pix4: "TodayPay",
      pix22: "H88Pay",
      pix11: "UUPay",
      pix21: "EyPay",
      pixpay10: "EPay",
      pixpay11: "Pay4z",
      pixpay16: "U2CPay",
      pixpay4: "TodayPay",
      pixpay3: "NanaPay",
      pixpay12: "WinWinPay",
      pixpay012: "WinWinPay",
      pixpay013: "NanaPay",
      pixpay017: "Pay4z",
      wdtran: "TransafePay",
      dptran: "TransafePay",
      nana: "NanaPay",
      pixpay20: "DyPayV2",
      dypayv2: "DyPayV2"
    };
    if (brazilPix[bKey]) return brazilPix[bKey];
  }

  if (cKey === "越南") {
    const vietnamMain: Array<[RegExp, string]> = [
      [/^(1vnpay|1vnpayqr|1vnpaythecao|1vnpaythẻcào|1vnpaybank|1vnpaymomo|1vnpaymomoqr)$/, "1VNPay"],
      [/^(top|toppay|toppayd|toppayvnd|toppay四|toppayd四|toppayvnd四|toppayqr|toppaybank|toppayvndbank|toppayvndqr)$/, "TopPay"],
      [/^(fastpay|fast|fastqr|fastpayqr|fastpaybank)$/, "FASTPay"],
      [/^(panpay|panqr|panpayqr|panpaybank)$/, "PanPay"],
      [/^(quickpay|quickqr|quickpayqr|quickpaybank)$/, "QuickPay"],
      [/^(shijie|shijiepay|shijieqr|shijiepayqr)$/, "SHIJIE"],
      [/^(unipayusdt|unipayusdtu|unipay)$/, "UniPayUSDT"],
      [/^(v8pay|v8|v8qr|v8payqr|v8paybank)$/, "V8Pay"],
      [/^(vnbankpay|vnbank|vnbankpayqr|vnbankpaybank)$/, "VNBANKPay"],
      [/^(aqfpay|aqfpayvnd|aqfpayvndbank|aqfpaybank|aqfpayqr|aqfpayvndqr)$/, "AQFPay"],
      [/^(vnspay|vns|vnspayqr|vnspaybank)$/, "VnsPay"],
      [/^(yespay|yespayqr)$/, "YesPay"]
    ];
    for (const [re, canonical] of vietnamMain) {
      if (re.test(key)) return canonical;
    }
  }

  if (cKey === "巴基斯坦") {
    const pakistanMain: Array<[RegExp, string]> = [
      [/^(atpay|atpayep|atpayjazz|atpayjz|atpaywallet2|atpaypkrjazzcash|atpaypkrjazz|atpaypkreasypaisa|atpaypkreasy)$/, "ATPay"],
      [/^(deepay|deepayep|deeep|deejazz|deejz|deepaypkreasypaisa|deepaypkreasy|deepaypkrjazzcash|deepaypkrjazz|deepaywallet2)$/, "DeePay"],
      [/^(epay|epayep|epayjazz|epay2pkreasy|epay2pkrjazz|epay2pkrjazzcash|epay2wallet2)$/, "EPay"],
      [/^(okpay|okpayep|okpayjazz|okep|okjazz|okpaypkreasypaisa|okpaypkrjazzcash|okpaywallet2|okpaypkrjazz|okpkrjazz|okpkreasy)$/, "OkPay"],
      [/^(openpay|openpayep|openpayjazz|openjz|openep|openjazz|openpaypkreasy|openpaypkrjazz|openpaypkrjazzcash|openpaywallet2)$/, "OpenPay"],
      [/^(oppay|oppayep|oppayjazz|opay|opayep|opayjazz|oppaypkreasy|oppaypkrjazzcash|oppaypkreasy|oppaypkrjazz|oppaypkrjazzcash|oppaywallet2)$/, "OpenPay"],
      [/^(owenpay|owen|own|owenep|owenjazz|owenpaypkreasypaisa|owenpaypkrjazzcash|owenpaywallet2)$/, "OwenPay"],
      [/^(p777pay|p777|p777ep|p777jazz|p777paypkreasy|p777paypkrjazz|p777paypkrjazzcash)$/, "P777Pay"],
      [/^(gxpay|gxpayep|gxpayjazz|gxppay|gxppayep|gxppayjazz|gxpaypkreasy|gxpaypkrjazzcash)$/, "GxPay"],
      [/^(pkpay|pkpayep|pkpayjz|pkep|pkjazz|pkpaypkreasypaisa|pkpaypkreasy|pkpaypkrjazzcash|pkpaypkrjazz|pkpaywallet2)$/, "PkPay"],
      [/^(starpago|starpagoep|starpagojazz|starpagopkreasy|starpagopkrjazzcash)$/, "StarPago"],
      [/^(pay4z|pay4zep|pay4zjazz)$/, "Pay4z"],
      [/^(shan|shanep|shanjazz|shanpay)$/, "ShanPay"],
      [/^(megapay|megajazz|megaep|mega)$/, "MegaPay"],
      [/^(unipayusdt|usdt|unipayusdtu)$/, "UniPayUSDT"]
    ];
    for (const [re, canonical] of pakistanMain) {
      if (re.test(key)) return canonical;
    }
  }

  if (cKey === "马来") {
    if (/^(tngduitnowid|tngdutinowid|tngdutnowid|tngduitnow|tngdutinow|tngdutnow|duitnowtng|dutinowtng|dutnowtng|tngid|tngpay|truepaytng|truepayduitnow)$/.test(key)) return "TruePay";
    if (/^(fpay|fpayqr|fpxfpay|fpayfpx)$/.test(key)) return "FPay";
    if (/^(truepay|truepayqr|tpay|tp|fpxtpay|fpxtp|fpxtpay|fpxtruepay|fpxduitnowtp|touchngotp|touchngotp)$/.test(key)) return "TruePay";
    if (/rapidpay|touchngorapid|maybankqrrapid|duitnowrapid|fpxrapid|grabpayrapid|boostrapid/.test(key)) return "RapidPay";
    if (/winfapay|winpay|fpxwinfa|touchngowinfa/.test(key)) return "WinPay";
  }

  if (cKey === "印尼") {
    if (/paying|payingpay|secpay/.test(key) || /^(brivapaying|bnivapaying|mandirivapaying|permatavapaying|qrispaying|brivapayingpay|qrispayingpay)$/.test(key)) return "PayIngPay";
    if (/safepay|safe2pay/.test(key) || /^(qrissafepay|bsafepay|esafepay|paychn262|paychn_262)$/.test(key)) return "SafePay";
    if (/^(yerepay|yere|qrisyerepay|qrisyere|eyerepay|byerepay|eyere|byere|yerepayidrdana|yerepaydana|danayerepay)$/.test(key) || /yerepay/.test(key)) return "YerePay";
    if (/^(aipay|aipaypanda|alipaypanda)$/.test(key)) return "AiPay";
    if (/^(starpay|qrisstarpay|ovostarpay|starpayqris|starqris)$/.test(key)) return "StarPay";
    if (/^(sudalink|sudalinkpay|qrissudalink|bnisudalink|brisudalink|cimbvasudalink|cimbsudalink|mandirivasudalink|mandirisudalink|permatavasudalink|permatasudalink)$/.test(key)) return "SudalinkPay";
    if (/^(todaypay|tdpay|qristodaypay|danatodaypay|ovotdpay|danatdpay)$/.test(key)) return "TodayPay";
    if (/^(coverpay|transafe|qristransafe|ovotransafe|bnivatransafe|brivatransafe|mandirivatransafe|permatavatransafe|cimbvatransafe)$/.test(key)) return "CoverPay";
  }

  if (cKey === "哥伦比亚") {
    if (key === "payidae31ca74945f428aac53860ea88a2ed8") return "Supefina";
    if (key === "payidb1cee0053b4543e8b13c6312d81e8e94") return "STARPAGO";
  }

  if (cKey === "墨西哥") {
    if (key === "payid906c535c845a41d1945b47927495b8b6") return "STARPAGO";
    if (key === "payidf6f0deca63a9492fb4fdbcbcf1a258d4") return "Supefina";
  }

  if ((cKey === "哥伦比亚" || cKey === "墨西哥") && /^(beaconpay|beacon|okeypay|okey|okpay|okaypay|okay)$/.test(key)) return "BeaconPay";

  if (cKey === "印度" && ["super", "superq", "paytmsuper", "superpay", "superpay2", "paytmsuperq", "superqr"].includes(key)) return "SUPER";
  if (cKey === "印度" && ["vstarpay", "vstarpayqr", "vstar", "vstarqr"].includes(key)) return "VstarPay";

  // 通用：同一个主三方的 QR / BANK / UPI / Wallet 等显示后缀，不再拆成多个主名。
  let out = stripBusinessSuffix(raw)
    .replace(/\s*[-_]?\s*(QR|BANK|UPI|WALLET|WALLET2|EASYPAISA|JAZZCASH|JAZZ|EP|EASY)$/i, "")
    .replace(/\s*\((QR|BANK|UPI|WALLET|EASYPAISA|JAZZCASH|JAZZ|EP|EASY)\)$/i, "")
    .trim();
  if (!out) out = raw;
  if (/^super$/i.test(out)) return "SUPER";
  if (/pay$/i.test(out)) out = out.replace(/pay$/i, "Pay");
  return out;
}

function uploadedAliasMatch(value: string, country?: string): string {
  const key = aliasKey(value);
  if (!key) return "";
  const cKey = countryKey(country);
  if (cKey) {
    const exact = COUNTRY_ALIAS_MAP.get(`${cKey}|||${key}`);
    if (exact) return normalizeCanonicalByCountry(exact, country);
  }
  const global = GLOBAL_ALIAS_MAP.get(key) || "";
  return global ? normalizeCanonicalByCountry(global, country) : "";
}

function prettyFallbackName(raw: string): string {
  const key = aliasKey(raw);
  const explicit: Record<string, string> = {
    pix9: "TransafePay",
    pix17: "Pay4z",
    pix13: "NanaPay",
    pix8: "BetCatPay",
    pix12: "WinWinPay",
    pix16: "U2CPay",
    pix14: "EPay",
    pix4: "TodayPay",
    pix22: "H88Pay",
    pix11: "UAPay",
    pix21: "EyPay",
    pixpay10: "EPay",
    pixpay11: "Pay4z",
    pixpay16: "U2CPay",
    pixpay4: "TodayPay",
    pixpay3: "NanaPay",
    pixpay12: "WinWinPay",
    pixpay20: "DyPayV2",
    dypayv2: "DyPayV2",
    epaybrl: "EPay",
    epaybrl二: "EPay",
    epaybrl编码2364: "EPay",
    epay: "EPay",
    pay4z: "Pay4z",
    pay4zpaybrl: "Pay4z",
    u2cpaybrl: "U2CPay",
    u2cpay: "U2CPay",
    tdpaybrl: "TodayPay",
    tdpay: "TodayPay",
    todaypay: "TodayPay",
    todpay: "TodayPay",
    tod: "TodayPay",
    nanapaybrl: "NanaPay",
    nanapay: "NanaPay",
    winwinpaybrl: "WinWinPay",
    winwinpay: "WinWinPay",
    h88paybrl: "H88Pay",
    h88pay: "H88Pay",
    uupaybrl: "UUPay",
    uupay: "UUPay",
    fpay: "FPay",
    bfpay: "BFPAY",
    uxpay: "UXPAY",
    shijie: "SHIJIE",
    shijiepay: "SHIJIE",
    shijiev3: "SHIJIEV3",
    shijiev3pay: "SHIJIEV3",
    kilipay: "KILIPAY",
    kili2pay: "KILIPAY",
    rujia: "RUJIA",
    rujiapay: "RUJIA",
    starpago: "STARPAGO",
    okpay: "OKPAY",
    lucky: "LUCKYPAY",
    luckypay: "LUCKYPAY",
    usdt: "USDT",
    trc20: "USDT",
    erc20: "USDT"
  };
  if (explicit[key]) return explicit[key];

  let out = normalizeCell(raw)
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\((BRL|INR|PKR|PHP|VND|二|2)\)/gi, "")
    .replace(/(BRL|INR|PKR|PHP|VND)$/i, "")
    .replace(/USDTCU$/i, "USDT")
    .replace(/\s+/g, " ")
    .trim();
  if (/pay$/i.test(out)) out = out.replace(/pay$/i, "Pay");
  return out;
}


export function inferThirdPartyChannelType(value: string, country?: string, extraText = ""): string {
  const cKey = countryKey(country);
  const raw = `${normalizeCell(value)} ${normalizeCell(extraText)}`;
  const text = raw.toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s_：:]+/g, "-");
  const compact = aliasKey(raw);
  const brazilCompact = cKey === "巴西" ? brazilPixAliasKey(raw) : compact;

  if (cKey === "巴西") {
    // 巴西盘口只有 PIX 类型；PIX9 / PIX12 / PIX13 这些是三方别名，不能当钱包/通道类型。
    return "PIX";
  }

  if (cKey === "巴基斯坦") {
    if (/jazz|jazzcash/.test(text) || /jazz|jazzcash/.test(compact)) return "JAZZCASH";
    if (/easy|easypaisa|wallet2|\bep\b|-ep\b/.test(text) || /easy|easypaisa|wallet2|epay2pkreasy/.test(compact)) return "EASYPAISA";
    return "其他钱包";
  }
  if (cKey === "缅甸") {
    if (/kbz/.test(text)) return "KBZ";
    if (/wave/.test(text)) return "WAVE";
    return "其他钱包";
  }
  if (cKey === "马来") {
    if (/tng|touch\s*n\s*go|touchngo|touch-go|touchgo|duitnow|duit-now|qr|maybankqr|fpxduitnow/.test(text)) return "DUITNOW/QR";
    if (/shopee|grab|boost/.test(text)) return "Shopee/Grab/Boost";
    if (/fpx|bank|maybank|cimb|rhb|publicbank|ambank|hongleong/.test(text)) return "FPX-BANK";
    return "其他类型";
  }
  if (cKey === "印度") {
    // 用户确认：印度线下表就是“印度”；印度三方量里的类型重点区分 UPI / 银行卡 / USDT。
    if (/usdt|trx|trc20|tron/i.test(raw) || /usdt|trx|trc20|tron/i.test(text)) return "USDT";
    if (/bank|银行卡|银行|card|cardpay|arb[-_ ]?bank|fastupi提现/i.test(raw) || /bank|card|arb-bank|arbpayinr/.test(text)) return "银行卡";
    if (/upi|paytm|phonepe|qr|扫码/i.test(raw) || /upi|paytm|phonepe|qr/.test(text)) return "UPI";
    return "UPI";
  }
  if (cKey === "印尼") {
    // 印尼：具体钱包要单独显示和匹配费率；不要把 OVO/DANA/LINKAJA/GOPAY 统一丢进“其他类型/钱包代付”。
    if (/qris|qr-is/.test(text)) return "QRIS";
    if (/link\s*aja|link-aja|linkaja/.test(text) || /linkaja/.test(compact)) return "LINKAJA";
    if (/\bdana\b|(^|[-~_\s])dana([-~_\s]|$)/.test(text) || /dana/.test(compact)) return "DANA";
    if (/\bovo\b|(^|[-~_\s])ovo([-~_\s]|$)/.test(text) || /ovo/.test(compact)) return "OVO";
    if (/go\s*pay|go-pay|gopay|gojek/.test(text) || /gopay|gojek/.test(compact)) return "GOPAY";
    // B~YerePay / B-Click2Pay / BNIN / BMRI / BRIN / CENA 走银行代付；E~YerePay / E-Click2Pay 走泛钱包代付。
    if (/(^|-)b[~-]?yerepay|(^|-)b[~-]?paying|(^|-)b[~-]?kilipay|(^|-)b[~-]?click2?pay|bnin|bmri|brin|cena|bni|bri|mandiri|virtual|\bva\b|-va|permata|cimb|bca|bank/.test(text)) return "银行代付";
    if (/(^|-)e[~-]?yerepay|(^|-)e[~-]?paying|(^|-)e[~-]?kilipay|(^|-)e[~-]?click2?pay|ewallet|wallet/.test(text)) return "钱包代付";
    return "其他类型";
  }
  if (cKey === "越南") {
    if (/momo|mo-mo|ví\s*momo|vi\s*momo/i.test(raw) || /momo/.test(text) || /momo/.test(compact)) return "MOMO";
    if (/thẻ|the\s*cao|thecao|cào|cao|card|napthe|nạp\s*thẻ/.test(raw.toLowerCase())) return "THẺ CÀO";
    if (/bank|ngan|ngân|viet|vnbank|bidv|vietin|vietcom|acb|mbbank|techcom|tpbank/.test(text)) return "银行";
    return "其他类型";
  }
  if (cKey === "菲律宾") {
    const isPayoutText = /代付|提现|出款|付款|payout|withdraw/i.test(raw);
    if (/gcash/.test(text)) return "GCASH";
    if (/paymaya|maya/.test(text)) return "PAYMAYA";
    if (/gotyme|go-tyme/.test(text)) return "GOTYME";
    if (/grabpay|grab/.test(text)) return "GRABPAY";
    if (/bank|银行|代付/.test(text) || isPayoutText) return "代付";
    return "其他钱包";
  }
  if (cKey === "尼日利亚") {
    if (/usdt|tron|trc20|unipay/.test(text)) return "USDT";
    return "银行";
  }
  if (cKey === "墨西哥") {
    if (/spei/.test(text)) return "SPEI";
    if (/clabe/.test(text)) return "CLABE";
    if (/oxxo/.test(text)) return "OXXO";
    if (/codi/.test(text)) return "CoDi";
    if (/cash|efectivo/.test(text)) return "Cash";
    if (/bank-card|bankcard|bank|card|tarjeta/.test(text)) return "Bank Card";
    return "其他类型";
  }
  if (cKey === "哥伦比亚") {
    if (/bre[-_ ]?key|brekey/.test(text)) return "BRE-KEY";
    if (/bre[-_ ]?b|breb/.test(text)) return "BRE-B";
    if (/pse/.test(text)) return "PSE";
    if (/nequi/.test(text)) return "Nequi";
    if (/transfiya/.test(text)) return "Transfiya";
    if (/bank|banco/.test(text)) return "Bank";
    if (/cash|efectivo/.test(text)) return "Cash";
    return "其他类型";
  }
  if (cKey === "智利") {
    if (/webpay|card|tarjeta/.test(text)) return "Card(Webpay)";
    if (/khipu|bank|banco/.test(text)) return "Bank(Khipu)";
    if (/mach|e[-_ ]?wallet|ewallet|wallet/.test(text)) return "E-Wallet(Mach)";
    if (/pago46|cash|efectivo/.test(text)) return "Cash(Pago46)";
    return "其他类型";
  }
  return "";
}

export function isLikelyThirdPartyCodeOnly(value: string): boolean {
  const raw = normalizeCell(value);
  if (!raw) return true;
  const clean = raw.replace(/[\s_\-:：\/\\]/g, "");
  if (/^\d{3,}$/.test(clean)) return true;
  // Hash / mapping code only, not a readable third-party name.
  if (/^[a-f0-9]{18,}$/i.test(clean) && !/[g-z]/i.test(clean)) return true;
  if (/^[A-Z0-9]{24,}$/i.test(clean) && !/(pay|bank|pix|upi|maya|gcash|qr|usdt|fpx|jazz|ep|trans|safe|rujia|star|true|nova|kili|luck|tod)/i.test(raw)) return true;
  return false;
}

export function isIgnoredThirdPartyText(value: string): boolean {
  const raw = normalizeCell(value);
  if (!raw) return true;
  const x = raw.toLowerCase().replace(/[\s　:：_\-\/\\（）()【】\[\]，,。.!！?？]/g, "");
  if (!x) return true;
  if (/^(0|none|null|undefined|na|n\/a|无|未知|暂无|暂别名|暂无别名|-|—)$/.test(x)) return true;
  if (isLikelyThirdPartyCodeOnly(raw)) return true;

  // These are order result / manual handling texts, not third-party names.
  const ignored = [
    "人工确认",
    "人工充值",
    "人工",
    "cpf",
    "email",
    "商户余额不足",
    "余额不足",
    "收回调",
    "代付失败",
    "kycstatuserror",
    "kycerror",
    "badrequest",
    "bankcodeerror",
    "collectionaccount",
    "napaserror",
    "status码为fail",
    "fail",
    "failed",
    "success",
    "the recipient",
    "recipientinformation",
    "recipientname",
    "transactionprocessingfailed",
    "parameterconsumer",
    "invalidvalue",
    "会员kyc",
    "订单已提交",
    "等待处理",
    "系统自动",
    "返回"
  ];
  return ignored.some((word) => x.includes(word.replace(/[\s　:：_\-\/\\（）()【】\[\]，,。.!！?？]/g, "")));
}

function confirmedUserThirdPartyAlias(value: string, country?: string): string {
  const key = aliasKey(value);
  const c = countryKey(country);
  if (!key) return "";

  // 人工确认/人工充值是业务处理通道：需要在量表与费率表中保持原名，不能被“错误文本过滤”吃掉。
  if (key === "人工确认") return "人工确认";
  if (key === "人工充值") return "人工充值";

  // 用户确认：巴西 VPS / vps / VpsPay / PIXPAY21 都是同一个三方。
  if (c === "巴西" && /^(vps|vpspay|dpvpspay|wdvpspay|pixpay21|pixpay021)$/.test(key)) return "VPS";

  // 用户确认：SudalinkPay 是独立三方，不属于 StarPay。
  if (c === "印尼" && /sudalink/.test(key)) return "SudalinkPay";

  // 已确认的印度主三方别名。这里只统一名称，不写任何费率。
  if (c === "印度") {
    if (/^(ic2pay|ic2payqr|paytmic2pay|icpay|icpayqr|icpayinr)$/.test(key)) return "ICPay";
    if (/^(ox2pay|ox2payqr|paytmox2pay|oxpay|oxpayqr|paytmoxpay)$/.test(key)) return "OXPay";
    if (/^(arbpay|arbpayinr)$/.test(key)) return "ArbPay";
  }

  if (["墨西哥", "哥伦比亚", "智利"].includes(c)) {
    if (/^(starpago|starpaygo)$/.test(key)) return "STARPAGO";
    if (/^(todaypay|todpay|todpaynew|tod|tdpay)$/.test(key)) return "TodayPay";
  }

  return "";
}

export function canonicalThirdPartyName(value: string, country?: string): string {
  const raw = normalizeCell(value);
  if (!raw) return "未知三方";

  const strippedRaw = stripBusinessSuffix(raw);
  const rawAliasKey = aliasKey(strippedRaw);
  const originalAliasKey = aliasKey(raw);
  const cKeyNow = countryKey(country);
  const rawBrazilKey = cKeyNow === "巴西" ? brazilPixAliasKey(strippedRaw) : rawAliasKey;
  const currencyKey = currencyFreeAliasKey(strippedRaw || raw);
  const confirmedAlias = confirmedUserThirdPartyAlias(strippedRaw || raw, country) || confirmedUserThirdPartyAlias(raw, country);
  if (confirmedAlias) return confirmedAlias;

  if (cKeyNow === "越南") {
    const vnStrict: Record<string, string> = {
      "1vnpay": "1VNPay", "1vnpayqr": "1VNPay", "1vnpaythecao": "1VNPay", "1vnpaythecaoqr": "1VNPay", "1vnpaythcao": "1VNPay", "1vnpaythco": "1VNPay", "1vnpaybank": "1VNPay", "1vnpaymomo": "1VNPay", "1vnpaymomoqr": "1VNPay", "1vnpaymomo钱包": "1VNPay", thecao: "1VNPay", thcao: "1VNPay", thco: "1VNPay", momo: "1VNPay",
      top: "TopPay", toppay: "TopPay", toppayd: "TopPay", toppayvnd: "TopPay", toppay四: "TopPay", toppayd四: "TopPay", toppayvnd四: "TopPay", toppayqr: "TopPay", toppaybank: "TopPay", toppayvndbank: "TopPay", toppayvndqr: "TopPay",
      fast: "FASTPay", fastpay: "FASTPay", fastqr: "FASTPay", fastpayqr: "FASTPay", fastmomo: "FASTPay", fastpaymomo: "FASTPay", fastpaymomoqr: "FASTPay", fastpaymo: "FASTPay", fastpaybank: "FASTPay",
      vnspay: "VnsPay", vns: "VnsPay", vnspayqr: "VnsPay", vnsqr: "VnsPay", vnspaybank: "VnsPay",
      vnbankpay: "VNBANKPay", vnbank: "VNBANKPay", vnbankpayqr: "VNBANKPay", vnbankqr: "VNBANKPay", vnbankpaybank: "VNBANKPay",
      v8: "V8Pay", v8pay: "V8Pay", v8qr: "V8Pay", v8payqr: "V8Pay", v8paybank: "V8Pay",
      shijie: "SHIJIE", shijiepay: "SHIJIE", shijieqr: "SHIJIE", worldpay: "SHIJIE", world: "SHIJIE",
      quick: "QuickPay", quickpay: "QuickPay", quickqr: "QuickPay", quickpayqr: "QuickPay",
      aqfpay: "AQFPay", aqfpayvnd: "AQFPay", aqfpayvndbank: "AQFPay", aqfpaybank: "AQFPay", aqfpayqr: "AQFPay", aqfpayvndqr: "AQFPay",
      tronpay: "TronPayUSDT", tronpayusdt: "TronPayUSDT", unipayusdt: "UniPayUSDT", unipay: "UniPayUSDT",
      localbank: "LocalBank", bank: "LocalBank", usdt: "USDT", yespay: "YesPay", yespayqr: "YesPay"
    };
    if (vnStrict[currencyKey] || vnStrict[rawAliasKey]) return vnStrict[currencyKey] || vnStrict[rawAliasKey];
  }

  if (cKeyNow === "印度") {
    const indiaExplicit: Record<string, string> = {
      paile: "PailePay", pailepay: "PailePay",
      super: "SUPER", superq: "SUPER", paytmsuper: "SUPER", superpay: "SUPER", superpay2: "SUPER", paytmsuperq: "SUPER", superqr: "SUPER",
      rspay: "RsPay", rspay唤醒: "RsPay", transafeqr: "RsPay", transafe: "RsPay",
      yayapay923: "YayaPay", yayapay924: "YayaPay", yayapay: "YayaPay",
      ice: "IcePay", icepay: "IcePay",
      gaaypay: "GaayPay", agpay: "GaayPay",
      umoney: "UmoneyPay", umoneypay: "UmoneyPay",
      wpayvvpay: "WPay", wpayvpay: "WPay", wpay: "WPay", vvpay: "WPay",
      wandanpay: "WandaPay", wandanpayjaiclub盘: "WandaPay", wandapay: "WandaPay",
      arbpay: "ArbPay", arbpayinr: "ArbPay",
      arbbank: "UPI-QR", arbupi: "UPI-QR", phonepeqr: "UPI-QR", upiqr: "UPI-QR", arupi: "UPI-QR",
      icpay: "ICPay", icpayinr: "ICPay", icpayqr: "ICPay", ic2pay: "ICPay", ic2payqr: "ICPay", paytmic2pay: "ICPay",
      speed2pay: "Speed2Pay", speed2payqr: "Speed2Pay", speed2pay1: "Speed2Pay", speed2pay2: "Speed2Pay", paytmspeed2pay: "Speed2Pay",
      oxpay: "OXPay", oxpayqr: "OXPay", paytmoxpay: "OXPay", ox2pay: "OXPay", ox2payqr: "OXPay", paytmox2pay: "OXPay",
      weepay: "WeePay", weepayqr: "WeePay", paytmweepay: "WeePay",
      newwinpay: "NewWinPay", newwin: "NewWinPay",
      uupayinr: "UUPay", uupay: "UUPay",
      unipayusdt: "UniPayUSDT", unipayusdtu: "UniPayUSDT", unipay: "UniPayUSDT",
      upay13usdt: "UPay13USDT", upay13: "UPay13USDT",
      tronpayusdt: "TronPayUSDT", tronpay: "TronPayUSDT",
      wepay: "WePay", wepay唤醒: "WePay", paytmwepay: "WePay", qrwepay: "WePay",
      movpay: "MovPay", movpayqr: "MovPay", rushpay: "RushPay", rushpayqr: "RushPay", busspay: "BussPay", busspayqr: "BussPay", tukpay: "TukPay", tukpayqr: "TukPay",
      magicpay: "MagicPay", magicpayqr: "MagicPay",
      upipay: "UpiPay", upipayqr: "UpiPay",
      ninepay: "NinePay", ninepayqr: "NinePay", paytmninepay: "NinePay", ninepayinr191: "NinePay", ninepayinr213: "NinePay",
      vstar: "VstarPay", vstarqr: "VstarPay", vstarpay: "VstarPay", vstarpayqr: "VstarPay"
    };
    if (indiaExplicit[currencyKey] || indiaExplicit[rawAliasKey]) return indiaExplicit[currencyKey] || indiaExplicit[rawAliasKey];
  }


  if (cKeyNow === "USDT") {
    const usdtExplicit: Record<string, string> = {
      unipay: "UniPayUSDT", unipayusdt: "UniPayUSDT", unipayusdtu: "UniPayUSDT",
      tronpay: "TronPayUSDT", tronpayusdt: "TronPayUSDT", tronpayusdtu: "TronPayUSDT", trc20: "UUPayUSDT",
      uupay: "UUPayUSDT", uupayusdt: "UUPayUSDT", uupayusdtu: "UUPayUSDT", usdt: "USDT"
    };
    if (usdtExplicit[rawAliasKey] || usdtExplicit[currencyKey]) return usdtExplicit[rawAliasKey] || usdtExplicit[currencyKey];
  }

  // 胖虎巴西/菲律宾等表经常把“支付/代付”写进名称，主三方必须合并成一个主名。
  if (strippedRaw !== raw && rawAliasKey) {
    const cleanUploaded = uploadedAliasMatch(strippedRaw, country);
    if (cleanUploaded) return cleanUploaded;
  }

  if (cKeyNow === "尼日利亚") {
    const ngExplicit: Record<string, string> = {
      wpay: "WanguPay", wp: "WanguPay", wppay: "WanguPay", wangpay: "WanguPay", wangu: "WanguPay", wangupay: "WanguPay",
      sh: "ShPay", shpay: "ShPay",
      p24: "P24hrPay", p24hr: "P24hrPay", p24hrpay: "P24hrPay"
    };
    if (ngExplicit[rawAliasKey] || ngExplicit[currencyKey]) return ngExplicit[rawAliasKey] || ngExplicit[currencyKey];
  }

  if (cKeyNow === "巴基斯坦") {
    const pkExplicit: Record<string, string> = {
      atpay: "ATPay", atpayep: "ATPay", atpayjazz: "ATPay", atpayjz: "ATPay", atpaywallet2: "ATPay", atpaypkrjazz: "ATPay", atpaypkreasy: "ATPay",
      deepay: "DeePay", depay: "DeePay", deepayablepay: "DeePay", ablepay: "DeePay", deepaypkreasypaisa: "DeePay", deepaypkrjazzcash: "DeePay", deepaypkrjazz: "DeePay", deepaypkreasy: "DeePay", deepayep: "DeePay", deepayjazz: "DeePay", deeep: "DeePay", deejazz: "DeePay", deejz: "DeePay", deepaywallet2: "DeePay",
      epay: "EPay", newepay: "EPay", newepayep: "EPay", newepayjazz: "EPay", epay2pkreasy: "EPay", epay2pkrjazz: "EPay", epay2pkrjazzcash: "EPay", epayep: "EPay", epayjazz: "EPay", epay2wallet2: "EPay",
      okpay: "OkPay", okpaypkreasypaisa: "OkPay", okpaypkrjazzcash: "OkPay", okep: "OkPay", okjazz: "OkPay", okpaywallet2: "OkPay", okpayep: "OkPay", okpayjazz: "OkPay",
      openpay: "OpenPay", openpaypkreasy: "OpenPay", openpaypkrjazzcash: "OpenPay", openpaypkrjazz: "OpenPay", openpayjazz: "OpenPay", openpayjz: "OpenPay", openpayep: "OpenPay", openep: "OpenPay", openjazz: "OpenPay", openjz: "OpenPay", openpaywallet2: "OpenPay",
      oppay: "OpenPay", oppayep: "OpenPay", oppayjazz: "OpenPay", opay: "OpenPay", opayep: "OpenPay", opayjazz: "OpenPay",
      owenpay: "OwenPay", owen: "OwenPay", own: "OwenPay", owenep: "OwenPay", owenjazz: "OwenPay", owenpaypkreasypaisa: "OwenPay", owenpaypkrjazzcash: "OwenPay", owenpaywallet2: "OwenPay",
      p777pay: "P777Pay", p777: "P777Pay", p777ep: "P777Pay", p777jazz: "P777Pay", p777paypkreasy: "P777Pay", p777paypkrjazz: "P777Pay", "777pay": "P777Pay",
      gxpay: "GxPay", gxpayep: "GxPay", gxpayjazz: "GxPay", gxppay: "GxPay", gxppayep: "GxPay", gxppayjazz: "GxPay",
      pkpay: "PkPay", pkep: "PkPay", pkjazz: "PkPay", pkjz: "PkPay", pkpayep: "PkPay", pkpayjazz: "PkPay", pkpayjz: "PkPay", pkpaypkreasypaisa: "PkPay", pkpaypkrjazzcash: "PkPay", pkpaypkrjazz: "PkPay", pkpaypkreasy: "PkPay", pkpaywallet2: "PkPay",
      starpago: "StarPago", starpagoep: "StarPago", starpagojazz: "StarPago", starpagojz: "StarPago",
      mega: "MegaPay", megapay: "MegaPay", megaep: "MegaPay", megajazz: "MegaPay", megajz: "MegaPay",
      unipayusdt: "UniPayUSDT", usdt: "UniPayUSDT"
    };
    if (pkExplicit[rawAliasKey]) return pkExplicit[rawAliasKey];
  }

  if (countryKey(country) === "越南") {
    const vnExplicit: Record<string, string> = {
      "1vnpay": "1VNPay", "1vnpayqr": "1VNPay", "1vnpaythecao": "1VNPay", "1vnpaythecaoqr": "1VNPay", "1vnpaythcao": "1VNPay", "1vnpaythco": "1VNPay", "1vnpaybank": "1VNPay", "1vnpaymomo": "1VNPay", "1vnpaymomoqr": "1VNPay", "1vnpaymomo钱包": "1VNPay", thecao: "1VNPay", thcao: "1VNPay", thco: "1VNPay", momo: "1VNPay",
      top: "TopPay", toppay: "TopPay", toppayd: "TopPay", toppayvnd: "TopPay", toppay四: "TopPay", toppayd四: "TopPay", toppayvnd四: "TopPay", toppayqr: "TopPay", toppaybank: "TopPay", toppayvndbank: "TopPay", toppayvndqr: "TopPay",
      fast: "FASTPay", fastpay: "FASTPay", fastqr: "FASTPay", fastpayqr: "FASTPay", fastmomo: "FASTPay", fastpaymomo: "FASTPay", fastpaymomoqr: "FASTPay", fastpaymo: "FASTPay",
      panpay: "PanPay", panqr: "PanPay", panpayqr: "PanPay",
      quickpay: "QuickPay", quickqr: "QuickPay", quickpayqr: "QuickPay",
      aqfpay: "AQFPay", aqfpayvnd: "AQFPay", aqfpayvndbank: "AQFPay", aqfpaybank: "AQFPay", aqfpayqr: "AQFPay", aqfpayvndqr: "AQFPay",
      shijie: "SHIJIE", shijiepay: "SHIJIE", shijieqr: "SHIJIE", worldpay: "SHIJIE",
      v8: "V8Pay", v8pay: "V8Pay", v8qr: "V8Pay", v8payqr: "V8Pay",
      vnbankpay: "VNBANKPay", vnbankpayqr: "VNBANKPay", vnbankqr: "VNBANKPay", vnbank: "VNBANKPay", vnspay: "VnsPay", vnspayqr: "VnsPay", vns: "VnsPay", vnsqr: "VnsPay",
      tronpay: "TronPayUSDT", tronpayusdt: "TronPayUSDT", unipayusdt: "UniPayUSDT", unipay: "UniPayUSDT", localbank: "LocalBank", yespay: "YesPay", yespayqr: "YesPay"
    };
    if (vnExplicit[currencyKey] || vnExplicit[rawAliasKey]) return vnExplicit[currencyKey] || vnExplicit[rawAliasKey];
  }

  if (cKeyNow === "马来") {
    if (/tng.*duitnow|duitnow.*tng|tngduitnowid/.test(rawAliasKey) || /tng.*duitnow|duitnow.*tng/i.test(strippedRaw)) return "TruePay";
    const myExplicit: Record<string, string> = { truepay: "TruePay", tpay: "TruePay", fpxtruepay: "TruePay", fpxtpay: "TruePay", truepayqr: "TruePay", fpay: "FPay", fpayqr: "FPay", fpxfpay: "FPay" };
    if (myExplicit[rawAliasKey]) return myExplicit[rawAliasKey];
  }

  if (cKeyNow === "印尼") {
    const idExplicit: Record<string, string> = {
      payingpay: "PayIngPay", payingpayi: "PayIngPay", payingpayl: "PayIngPay", paying: "PayIngPay", secpay: "PayIngPay", secpaypaying: "PayIngPay", secpaying: "PayIngPay", qrispayingpay: "PayIngPay", qrispaying: "PayIngPay", brivapaying: "PayIngPay", bnivapaying: "PayIngPay", mandirivapaying: "PayIngPay", permatavapaying: "PayIngPay", ovopaying: "PayIngPay", bpaying: "PayIngPay", epaying: "PayIngPay",
      safepay: "SafePay", safepay2: "SafePay", safe2pay: "SafePay", safe2pay03: "SafePay", safepayold: "SafePay", safepaywalletold: "SafePay", qrissafepay: "SafePay", bsafepay: "SafePay", esafepay: "SafePay", banksafepayidr: "SafePay", walletsafepayidr: "SafePay", paychn262: "SafePay",
      yerepay: "YerePay", yere: "YerePay", qrisyerepay: "YerePay", qrisyere: "YerePay", eyerepay: "YerePay", byerepay: "YerePay", eyere: "YerePay", byere: "YerePay", yerepayidrdana: "YerePay", yerepaydana: "YerePay", danayerepay: "YerePay",
      aipay: "AiPay", aipaypanda: "AiPay", alipaypanda: "AiPay",
      starpay: "StarPay", qrisstarpay: "StarPay", ovostarpay: "StarPay", starpayqris: "StarPay", starpayqr: "StarPay", qrstarpay: "StarPay",
      todaypay: "TodayPay", tdpay: "TodayPay", qristodaypay: "TodayPay", qristdpay: "TodayPay", danatodaypay: "TodayPay", ovotdpay: "TodayPay",
      clickpay: "Click2Pay", click2pay: "Click2Pay", qrisclickpay: "Click2Pay", qrisclick2pay: "Click2Pay", bclickpay: "Click2Pay", bclick2pay: "Click2Pay", eclickpay: "Click2Pay", eclick2pay: "Click2Pay",
      sudalink: "SudalinkPay", sudalinkpay: "SudalinkPay", qrissudalink: "SudalinkPay", bnisudalink: "SudalinkPay", brisudalink: "SudalinkPay", cimbsudalink: "SudalinkPay", mandirisudalink: "SudalinkPay", permatasudalink: "SudalinkPay",
      bayar: "NewBayarPay", bayarpay: "NewBayarPay", newbayar: "NewBayarPay", newbayarpay: "NewBayarPay", newbayarqr: "NewBayarPay", newbayarpayqr: "NewBayarPay",
      paychn382: "NupaPay"
    };
    if (idExplicit[rawAliasKey]) return idExplicit[rawAliasKey];
  }

  {
    const phLike: Record<string, string> = {
      haipay: "HAIPAY", kubao: "KUBAOPAY", kubaopay: "KUBAOPAY", cbpay: "CBPAY", kppay: "KPPAY", wodipay: "WODIPAY", best: "BEST", bestpay: "BEST", cepay: "CEPAY", donepay: "DONEPAY", winwinpay: "WinWinPay"
    };
    if (phLike[rawAliasKey]) return phLike[rawAliasKey];
  }

  if (countryKey(country) === "菲律宾") {
    const phExplicit: Record<string, string> = {
      gcash: "GCASH", paymaya: "PAYMAYA", maya: "PAYMAYA", gotyme: "GOTYME", grabpay: "GRABPAY", grab: "GRABPAY",
      shijie: "ShiJie", shije: "ShiJie", shijiev3: "ShiJie", shijiepay: "ShiJie", shijieqr: "ShiJie", shijiev3pay: "ShiJie",
      kili: "KiliPay", kilipay: "KiliPay", kilipaymaya: "KiliPay", kili2pay: "KiliPay", kilipay2: "KiliPay", kilimaya: "KiliPay",
      ux: "UxPay", uxpay: "UxPay", uxqr: "UxPay", uxpayqr: "UxPay",
      nova: "Nova", novapay: "Nova"
    };
    if (phExplicit[rawAliasKey]) return phExplicit[rawAliasKey];
  }
  if (countryKey(country) === "墨西哥") {
    const mxExplicit: Record<string, string> = { spei: "SPEI", oxxopay: "OXXO Pay", oxxo: "OXXO Pay", cash: "Cash", okpay: "BeaconPay", okeypay: "BeaconPay", okaypay: "BeaconPay", beaconpay: "BeaconPay", beacon: "BeaconPay", payid906c535c845a41d1945b47927495b8b6: "StarPago", payidf6f0deca63a9492fb4fdbcbcf1a258d4: "Supefina" };
    if (mxExplicit[rawAliasKey]) return mxExplicit[rawAliasKey];
  }
  if (countryKey(country) === "哥伦比亚") {
    const coExplicit: Record<string, string> = { pse: "PSE", nequi: "Nequi", breb: "BRE_B", brekey: "BRE_KEY", transfiya: "Transfiya", okpay: "BeaconPay", okeypay: "BeaconPay", okaypay: "BeaconPay", beaconpay: "BeaconPay", beacon: "BeaconPay", payidae31ca74945f428aac53860ea88a2ed8: "Supefina", payidb1cee0053b4543e8b13c6312d81e8e94: "StarPago" };
    if (coExplicit[rawAliasKey]) return coExplicit[rawAliasKey];
  }
  if (countryKey(country) === "智利") {
    const clExplicit: Record<string, string> = { webpay: "Card(Webpay)", cardwebpay: "Card(Webpay)", khipu: "Bank(Khipu)", bankkhipu: "Bank(Khipu)", mach: "E-Wallet(Mach)", ewalletmach: "E-Wallet(Mach)", pago46: "Cash(Pago46)", cashpago46: "Cash(Pago46)" };
    if (clExplicit[rawAliasKey]) return clExplicit[rawAliasKey];
  }

  // 巴西不能把 PIX 9 / PIX12 / PIX13 直接显示出来，必须按用户提供的巴西表映射为主三方名称。
  // 这里用 aliasKey 先处理，能兼容 PIX9、PIX 9、PIX-9、pixpay10 等不同写法。
  if (countryKey(country) === "巴西") {
    const brazilExplicit: Record<string, string> = {
      pix9: "TransafePay", pixpay9: "TransafePay", wdtran: "TransafePay", dptran: "TransafePay", transafepaybrl: "TransafePay", transafepay: "TransafePay", transferpaybrl: "TransafePay", transferpay: "TransafePay",
      pix17: "Pay4z", pixpay17: "Pay4z", pixpay017: "Pay4z", pixpay11: "Pay4z", pay4zbrl: "Pay4z", pay4zpaybrl: "Pay4z", pay4z: "Pay4z",
      pix13: "NanaPay", pixpay13: "NanaPay", pixpay013: "NanaPay", pixpay3: "NanaPay", pixpay03: "NanaPay", pixpay3stop: "NanaPay", pixpay3top: "NanaPay", nanapaybrl: "NanaPay", nanapay: "NanaPay", nana: "NanaPay",
      pix8: "BetCatPay", pixpay8: "BetCatPay", betcatpaybrl: "BetCatPay", betcatpay: "BetCatPay",
      pix12: "WinWinPay", pixpay12: "WinWinPay", pixpay012: "WinWinPay", winwinpaybrl: "WinWinPay", winwinpay: "WinWinPay",
      pix16: "U2CPay", pixpay16: "U2CPay", u2cpaybrl: "U2CPay", u2cpay: "U2CPay",
      pix14: "EPay", pix33: "EPay", pixpay10: "EPay", epaybrl: "EPay", epay: "EPay",
      pix4: "TodayPay", pix34: "TodayPay", pixpay4: "TodayPay", tdpaybrl: "TodayPay", tdpay: "TodayPay", todaypay: "TodayPay",
      pix22: "H88Pay", pix35: "H88Pay", h88paybrl: "H88Pay", h88pay: "H88Pay",
      pix11: "UUPay", pix31: "UUPay", uupaybrl: "UUPay", uupay: "UUPay",
      pix21: "EyPay", eypaybrl: "EyPay", eypay: "EyPay",
      bcpaybrl: "BetCatPay", bcpay: "BetCatPay", dpvpspay: "VPS", wdvpspay: "VPS", vpspay: "VPS", vps: "VPS", pixpay21: "VPS", pixpay021: "VPS", pix20: "DyPayV2", pixpay20: "DyPayV2", pixpay020: "DyPayV2", dypay: "DyPayV2", dypayv2: "DyPayV2", dypaybrl: "DyPayV2", dypayv2brl: "DyPayV2"
    };
    if (brazilExplicit[rawBrazilKey]) return brazilExplicit[rawBrazilKey];
  }

  // 先用上传的三方名称表。这样 EPayBRL / PIXPAY10 / epay 都会显示 EPay，且按国家区分。
  const uploaded = uploadedAliasMatch(strippedRaw, country) || uploadedAliasMatch(raw, country);
  if (uploaded) return uploaded;

  if (isIgnoredThirdPartyText(strippedRaw)) return "未知三方";
  const x = compactThirdParty(strippedRaw);

  // Brazil / 巴西 and common aliases.
  if (/transafe|transferpay|dp-tran|wd-tran|wd-transafe|pix-?9\b/.test(x)) return "TransafePay";
  if (/pay4z|pay4zpay|dp-pay4z|wd-pay4z|pix-?17\b|pixpay0?17\b|pixpay11\b/.test(x)) return "Pay4z";
  if (/nanapay|nana-pay|\bnana\b|dp-nanapay|wd-nanapay|pix-?13\b|pixpay0?13\b|pixpay0?3\b|pixpay3stop|pixpay3top/.test(x)) return "NanaPay";
  if (/betcat|betcatpay|pix-?8\b/.test(x)) return "BetCatPay";
  if (/winwin|winwinpay|dp-winwin|wd-winwinpay|pix-?12\b|pixpay0?12\b/.test(x)) return "WinWinPay";
  if (/u2c|u2cpay|dp-u2c|wd-u2c|pix-?16\b|pixpay0?16\b/.test(x)) return "U2CPay";
  if (/(^|-)epay|epaybrl|dp-epay|wd-epay|pix-?14\b|pixpay0?10\b/.test(x)) return "EPay";
  if (/tdpay|todaypay|todpay|dp-tod|wd-tod|pix-?4\b|pixpay0?4\b/.test(x)) return "TodayPay";
  if (/h88|h88pay|pix-?22\b/.test(x)) return "H88Pay";
  if (/uupay|uu-pay|dp-uupay|wd-uupay|pix-?11\b/.test(x)) return "UUPay";
  if (/eypay|ey-pay|pix-?21\b/.test(x)) return "EyPay";
  if (/bcpay|dp-bcpay|wd-bcpay/.test(x)) return "BetCatPay";
  if (/vpspay|dp-vpspay|wd-vpspay|^vps$|pixpay0?21\b/.test(x)) return "VPS";
  if (/dypay|dy-pay|pix-?20\b|pixpay0?20\b/.test(x)) return "DyPayV2";

  // Existing cross-country mappings.
  if (/bfpay|bf-pay/.test(x)) return "BFPAY";
  if (/shijie|shije|shi-jie|世界/.test(x)) return cKeyNow === "菲律宾" ? "ShiJie" : "SHIJIE";
  if (/novapay|nova-pay|^nova$/.test(x)) return cKeyNow === "菲律宾" ? "Nova" : "NOVAPAY";
  if (/uxpay|ux-pay|^ux$/.test(x)) return cKeyNow === "菲律宾" ? "UxPay" : "UXPAY";
  if (/kili2?pay|kili-maya|kili|kilipay/.test(x)) return cKeyNow === "菲律宾" ? "KiliPay" : "KILIPAY";
  if (/rujia|如家|qr-rujia|paytm-rujia/.test(x)) return "RUJIA";
  if (cKeyNow === "马来") {
    if (/truepay|tpay|fpx-tpay|fpx-truepay|fpx-tp|tng.*duitnow|tng.*dutinow|tng.*dutnow|duitnow.*tng|dutinow.*tng|dutnow.*tng|touch.*go.*tp|\btp\b/.test(x)) return "TruePay";
    if (/fpay|fpx-fpay/.test(x)) return "FPay";
    if (/rapidpay|touch.*go.*rapid|maybankqr.*rapid|duitnow.*rapid|boost.*rapid|grabpay.*rapid/.test(x)) return "RapidPay";
    if (/winfapay|fpx-winfa|touch.*go.*winfa/.test(x)) return "WinPay";
  }
  if (/yerepay|yere-pay|qris.*yere|yere.*dana|^[be][-~_]?yere/.test(x)) return "YerePay";
  if (/starpago|starpaygo|star-pago/.test(x)) return "STARPAGO";
  if (cKeyNow === "印尼" && /sudalink|sudalink-pay|qris.*sudalink|bni.*sudalink|bri.*sudalink|cimb.*sudalink|mandiri.*sudalink|permata.*sudalink/.test(x)) return "SudalinkPay";
  if (/starpay|qris-starpay|qrisstarpay|star-pay/.test(x)) return "StarPay";
  if (/newbayarpay|newbayar|bayarpay|bayar-pay/.test(x)) return "NewBayarPay";
  if (/okpay/.test(x)) return cKeyNow === "巴基斯坦" ? "OkPay" : "OKPAY";
  if (/openpay/.test(x)) return "OpenPay";
  if (/^(oppay|opay|opayep|opayjazz|oppayep|oppayjazz|oppaypkreasy|oppaypkrjazzcash)$/.test(x) || /(?:^|[^a-z0-9])op-pay(?:$|[^a-z0-9])/.test(x)) return "OpenPay";
  if (/owenpay|owen|\bown\b/.test(x)) return "OwenPay";
  if (/p777pay|p777/.test(x)) return "P777Pay";
  if (/gxpay|gxp-pay|gxppay/.test(x)) return "GxPay";
  if (/wepay|we-pay|wepay.*唤醒|wepay醒|paytm-wepay|qr-wepay/.test(x)) return "WePay";
  if (/movpay|mov-pay/.test(x)) return "MovPay";
  if (/magicpay|magic-pay/.test(x)) return "MagicPay";
  if (/upipay|upi-pay/.test(x)) return "UpiPay";
  if (/ninepay|nine-pay|paytm-ninepay|ninepayinr191|ninepayinr213/.test(x)) return "NinePay";
  if (/vstarpay|vstar-pay/.test(x)) return "VstarPay";
  if (/1vnpay|1vn-pay/.test(x)) return "1VNPay";
  if (/fast[-_ ]?pay[-_ ]?momo|fast[-_ ]?momo/.test(x)) return "FASTPay";
  if (cKeyNow === "巴基斯坦" && /new[-_ ]?epay|newepay/.test(x)) return "EPay";
  if (/lucky/.test(x)) return "LUCKYPAY";
  if (/usdt|trc20|erc20/.test(x)) return "USDT";
  return prettyFallbackName(strippedRaw);
}

export function sameThirdPartyName(a: string, b: string, country?: string): boolean {
  return canonicalThirdPartyName(a, country) === canonicalThirdPartyName(b, country);
}

// ===== v239 Volume types =====
type ThirdPartyVolumeRow = {
  id: string; sheetName: string; sourceRow: number; date: string; country: string; platform: string;
  channel: string; rawChannel: string; channelType?: string; direction: "代收" | "代付";
  amount: number; count: number; successCount: number; failedCount: number; successRate: number; status: string;
  raw?: Record<string, string>;
};

type ThirdPartyVolumePayload = {
  meta: { year: string; month: string; updatedAt: string; source: "google-sheet" | "demo"; message?: string; sheets: string[]; [key: string]: unknown };
  rows: ThirdPartyVolumeRow[]; aliasMap: Record<string, string[]>;
  summary: { rows: number; amount: number; count: number; successCount: number; failedCount: number; countries: number; platforms: number; channels: number };
  anomalies: string[];
};

// ===== v239 原版 parseThirdPartyVolume.ts =====
// 仅将内部 parseDate 改名为 parseVolumeDate，避免与当前批处理函数同名；解析逻辑不变。

type Values = string[][];

type Block = {
  headerRow: number;
  startCol: number;
  endCol: number;
  title: string;
  dateCol: number;
  systemCol: number;
  countryCol: number;
  platformCol: number;
  typeCol: number;
  thirdPartyCol: number;
  mapCodeCol: number;
  amountCol: number;
  countCol: number;
  updatedAtCol: number;
  successCol: number;
  failedCol: number;
  statusCol: number;
};

function get(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return "";
  return normalizeCell(row[index]);
}

function norm(value: string): string {
  return normalizeCell(value).replace(/[\s　:：_\-\/\\（）()【】\[\]#]/g, "").toLowerCase();
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseVolumeDate(value: string): string {
  const raw = normalizeCell(value);
  if (!raw) return "";
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 30000 && serial < 80000) {
    const base = Date.UTC(1899, 11, 30);
    const d = new Date(base + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = raw.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*(?:日)?/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = raw.match(/(20\d{2})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

function countryFromText(text: string): string {
  const value = normalizeCell(text);
  if (value.includes("胖虎巴西")) return "胖虎巴西";
  if (value.includes("巴基斯坦")) return "巴基斯坦";
  if (value.includes("菲律宾")) return "菲律宾";
  if (value.includes("尼日利亚")) return "尼日利亚";
  if (value.includes("哥伦比亚") || /colombia/i.test(value)) return "哥伦比亚";
  if (value.includes("墨西哥") || /mexico/i.test(value)) return "墨西哥";
  if (value.includes("智利") || /chile/i.test(value)) return "智利";
  if (value.includes("印度")) return "印度";
  if (value.includes("南美")) return "南美";
  if (value.includes("巴西")) return "巴西";
  if (value.includes("越南")) return "越南";
  if (value.includes("印尼")) return "印尼";
  if (value.includes("缅甸")) return "缅甸";
  if (value.includes("马来")) return "马来";
  if (value.includes("埃及")) return "埃及";
  return value || "";
}


function southAmericaCountryFromText(text: string): "哥伦比亚" | "墨西哥" | "智利" | "" {
  const value = normalizeCell(text).toLowerCase();
  if (!value) return "";
  // 南美盘口常见缩写：NPG-ME/MEX/MX=墨西哥，NPG-CO/COL/CO66=哥伦比亚，NPG-CL/CHL/CHILE=智利。
  if (value.includes("哥伦比亚") || /\bcolombia\b|\bcolombian\b|\bcol\b|\bnpg[-_\s]*(co|col)\b|\bco66\b/.test(value)) return "哥伦比亚";
  if (value.includes("墨西哥") || /\bmexico\b|\bmexican\b|\bmex\b|\bnpg[-_\s]*(me|mex|mx)\b|\bmx\b/.test(value)) return "墨西哥";
  if (value.includes("智利") || /\bchile\b|\bchl\b|\bnpg[-_\s]*(cl|chl|chi)\b|\bcl\b/.test(value)) return "智利";
  return "";
}
function normalizeSouthAmericaRow(country: string, platform: string, system: string, sheetName: string, title: string, typeText: string): { country: string; platform: string } {
  const combined = `${country} ${platform} ${system} ${sheetName} ${title} ${typeText}`;
  const detected = southAmericaCountryFromText(combined);
  if (!detected) return { country, platform };

  const isSouthAmericaBucket = country === "南美" || /南美|south\s*america|latam|拉美/i.test(combined) || ["哥伦比亚", "墨西哥", "智利"].includes(country);
  if (!isSouthAmericaBucket) return { country, platform };

  const platformByCountry: Record<string, string> = {
    哥伦比亚: "NPG哥伦比亚盘口",
    墨西哥: "NPG墨西哥盘口",
    智利: "NPG智利盘口"
  };
  return { country: detected, platform: platformByCountry[detected] || platform };
}


function normalizeSpecialPlatformCountry(country: string, platform: string, sheetName: string, title: string, system: string): string {
  const text = `${platform} ${sheetName} ${title} ${system}`.toLowerCase();
  // 234T 是胖虎巴西盘口，不能混到普通巴西盘口。
  if (/\b234\s*t\b|234t|胖虎巴西/.test(text)) return "胖虎巴西";
  return country;
}

function normalizeSouthAmericaChannelType(country: string, mapCode: string, typeText: string, rawChannel: string, channel: string): string {
  const c = countryFromText(country);
  const primary = normalizeCell(mapCode || typeText);
  const text = `${primary} ${mapCode} ${typeText} ${rawChannel} ${channel}`
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s_：:]+/g, "-");

  if (c === "墨西哥") {
    if (/spei/.test(text)) return "SPEI";
    if (/clabe/.test(text)) return "CLABE";
    if (/oxxo/.test(text)) return "OXXO";
    if (/codi/.test(text)) return "CoDi";
    if (/cash|efectivo/.test(text)) return "Cash";
    if (/bank-card|bankcard|bank|card|tarjeta/.test(text)) return "Bank Card";
  }

  if (c === "哥伦比亚") {
    if (/bre[-_]?key|brekey/.test(text)) return "BRE-KEY";
    if (/bre[-_]?b|breb/.test(text)) return "BRE-B";
    if (/nequi/.test(text)) return "Nequi";
    if (/pse/.test(text)) return "PSE";
    if (/transfiya/.test(text)) return "Transfiya";
    if (/bank|banco/.test(text)) return "Bank";
    if (/cash|efectivo/.test(text)) return "Cash";
  }

  if (c === "智利") {
    if (/webpay|card|tarjeta/.test(text)) return "Card(Webpay)";
    if (/khipu|bank|banco/.test(text)) return "Bank(Khipu)";
    if (/mach|e[-_ ]?wallet|ewallet|wallet/.test(text)) return "E-Wallet(Mach)";
    if (/pago46|cash|efectivo/.test(text)) return "Cash(Pago46)";
  }

  return "";
}

function findRelativeIndex(headers: string[], startCol: number, endCol: number, names: string[]): number {
  const wanted = names.map(norm);
  for (let c = startCol; c <= endCol; c++) {
    const x = norm(headers[c] || "");
    if (!x) continue;
    if (wanted.some((w) => x === w || x.includes(w) || w.includes(x))) return c;
  }
  return -1;
}

function findBlockTitle(values: Values, headerRow: number, startCol: number, endCol: number): string {
  for (let r = headerRow - 1; r >= Math.max(0, headerRow - 4); r--) {
    const row = values[r] || [];
    const pieces: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      const v = get(row, c);
      if (v) pieces.push(v);
    }
    const text = pieces.join(" ");
    if (/\d{4}[-年]?\d{1,2}|代收|代付|菲律宾|南美|哥伦比亚|墨西哥|智利|COLOMBIA|MEXICO|CHILE|印度|巴西|巴基斯坦|尼日利亚|马来|缅甸|越南|印尼/i.test(text)) return text;
  }
  return "";
}

function inferDirection(sheetName: string, title: string, typeText: string): "代收" | "代付" {
  const all = `${sheetName} ${title} ${typeText}`;
  if (/提现|出款|代付|withdraw|payout/i.test(all)) return "代付";
  return "代收";
}

function normalizeChannel(value: string, country?: string): string {
  return canonicalThirdPartyName(value, country);
}

function isCoinvidUsdtVolume(country: string, platform: string, rawChannel: string, sheetName: string, title: string, system: string): boolean {
  const text = `${country} ${platform} ${rawChannel} ${sheetName} ${title} ${system}`.toLowerCase();
  const channelKey = normalizeCell(rawChannel).replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return country.includes("越南") && /coinvid/.test(text) && (channelKey === "usdt" || /(^|[^a-z0-9])usdt([^a-z0-9]|$)/i.test(rawChannel));
}

function isPH19Text(value: string): boolean {
  const text = normalizeCell(value).toLowerCase();
  return /(^|[^a-z0-9])ph\s*[-_]?\s*19([^a-z0-9]|$)|菲律宾\s*19|菲\s*19/.test(text);
}

function normalizePhilippinesPH19Type(text: string, direction: "代收" | "代付"): string {
  const raw = normalizeCell(text).toLowerCase().replace(/（/g, "(").replace(/）/g, ")");
  const compact = raw.replace(/[^a-z0-9一-龥]+/g, "");
  if (/gcash/.test(raw) || compact.includes("gcash")) return "GCASH";
  if (/pay\s*maya|paymaya|\bmaya\b/.test(raw) || compact.includes("paymaya")) return "PAYMAYA";
  if (/go\s*tyme|gotyme/.test(raw) || compact.includes("gotyme")) return "GOTYME";
  if (/grab\s*pay|grabpay/.test(raw) || compact.includes("grabpay")) return "GRABPAY";
  if (/bank|银行|银行卡|bankcard/.test(raw)) return direction === "代付" ? "银行代付" : "BANK";
  return "";
}

function normalizeVolumeChannelType(country: string, platform: string, rawChannel: string, channel: string, typeText: string, mapCode: string, system: string, title: string, sheetName: string, direction: "代收" | "代付"): string {
  const text = `${platform} ${rawChannel} ${channel} ${typeText} ${mapCode} ${system} ${title} ${sheetName}`.toLowerCase();
  const southAmericaType = normalizeSouthAmericaChannelType(country, mapCode, typeText, rawChannel, channel);
  if (southAmericaType) return southAmericaType;
  const inferred = inferThirdPartyChannelType(rawChannel, country, `${platform} ${channel} ${typeText} ${mapCode} ${system} ${title} ${sheetName}`);

  if (country.includes("巴西")) return "PIX";

  if (country.includes("马来")) {
    if (/telcom|telco|telkom/.test(text)) return "Telcom";
    // 用户确认：马来代收 Touch n Go-TP 归 DuitNow/QR；代付 Tng-DuitNow-TP / 其他代付统一归银行。
    if (direction === "代付") return "银行";
    if (/tng|touch\s*n\s*go|touchngo|touch go|duitnow|duit-now|fpxduitnow|qr|maybankqr/.test(text)) return "DUITNOW/QR";
    if (/shopee|grab|boost/.test(text)) return "Shopee/Grab/Boost";
    if (/fpx|bank|maybank|cimb|rhb|publicbank|ambank|hongleong/.test(text)) return "FPX-BANK";
  }

  if (country.includes("印尼")) {
    // 印尼必须先识别具体钱包，不能把 OVO / DANA / LINKAJA / GOPAY 扔到“其他类型”或统一“钱包代付”。
    // 例：OVO-safe2pay、DANA-safe2pay 要分别显示 OVO、DANA，并各自匹配自己的费率。
    const rawTypeText = `${rawChannel} ${mapCode} ${typeText} ${channel}`.toLowerCase()
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/[\s_：:]+/g, "-");
    if (/qris|qr-is/.test(rawTypeText)) return "QRIS";
    if (/link\s*aja|link-aja|linkaja/.test(rawTypeText)) return "LINKAJA";
    if (/\bdana\b|(^|[-~_\s])dana([-~_\s]|$)/.test(rawTypeText)) return "DANA";
    if (/\bovo\b|(^|[-~_\s])ovo([-~_\s]|$)/.test(rawTypeText)) return "OVO";
    if (/go\s*pay|go-pay|gopay|gojek/.test(rawTypeText)) return "GOPAY";
    // B-Click2Pay / B~YerePay 这类是银行代付；E-Click2Pay / E~YerePay 这类是泛钱包代付。
    if (direction === "代付" && /(^|[^a-z0-9])b\s*[~_\-\s]/i.test(`${rawChannel} ${mapCode}`)) return "银行代付";
    if (direction === "代付" && /(^|[^a-z0-9])e\s*[~_\-\s]/i.test(`${rawChannel} ${mapCode}`)) return "钱包代付";
    if (/virtual|\bva\b|-va|bni|bri|mandiri|permata|bca|cimb|bank|brin|cena|bmri/.test(rawTypeText)) return direction === "代付" ? "银行代付" : "Virtual Account";
    if (direction === "代付" && (!inferred || inferred === "其他类型")) return "银行代付";
  }

  if (country.includes("菲律宾")) {
    // V110：PH19 已经在原始表里写入 payTypeSubName / PAYTYPE（例如 GCash、Maya、Bank）。
    // 只有 PH19 按钱包/银行分类；其他菲律宾盘口仍保持旧逻辑：代付统一显示「代付」，避免影响旧数据。
    if (isPH19Text(`${platform} ${system} ${title} ${sheetName}`)) {
      const ph19Type = normalizePhilippinesPH19Type(text, direction);
      if (ph19Type) return ph19Type;
      if (inferred && !["其他类型", "其他钱包", "代付"].includes(inferred)) return inferred;
    }
    if (direction === "代付") return "代付";
  }

  if (country.includes("尼日利亚")) {
    if (/usdt|tron|trc20/.test(text)) return "USDT";
    return "银行";
  }

  if (country.includes("越南")) {
    if (/momo|mo-mo|ví\s*momo|vi\s*momo/.test(text)) return "MOMO";
    if (/the\s*cao|thẻ|cào|cao|card|napthe/.test(text)) return "THẺ CÀO";
    if (/bank|vnbank|ngan|ngân/.test(text)) return "银行";
  }

  return inferred;
}

function findBlocks(sheetName: string, values: Values): Block[] {
  const blocks: Block[] = [];
  const seen = new Set<string>();

  for (let r = 0; r < Math.min(values.length, 200); r++) {
    const headers = values[r] || [];
    const dateCols: number[] = [];

    for (let c = 0; c < headers.length; c++) {
      const h = norm(get(headers, c));
      if (h === "日期" || h === "date" || h === "statdate" || h === "统计日期") dateCols.push(c);
    }

    if (!dateCols.length) continue;

    for (let i = 0; i < dateCols.length; i++) {
      const startCol = dateCols[i];
      const endCol = i + 1 < dateCols.length ? dateCols[i + 1] - 1 : Math.min(headers.length - 1, startCol + 18);
      const platformCol = findRelativeIndex(headers, startCol, endCol, ["平台", "盘口", "platform"]);
      const amountCol = findRelativeIndex(headers, startCol, endCol, ["金额", "amount", "total_amount", "success_amount", "订单金额", "到账金额", "总金额"]);
      const countCol = findRelativeIndex(headers, startCol, endCol, ["笔数", "count", "total_count", "订单数", "数量"]);
      if (platformCol < 0 || (amountCol < 0 && countCol < 0)) continue;

      const title = findBlockTitle(values, r, startCol, endCol);
      const key = `${r}-${startCol}-${endCol}`;
      if (seen.has(key)) continue;
      seen.add(key);

      blocks.push({
        headerRow: r,
        startCol,
        endCol,
        title,
        dateCol: startCol,
        systemCol: findRelativeIndex(headers, startCol, endCol, ["system", "系统"]),
        countryCol: findRelativeIndex(headers, startCol, endCol, ["国家", "country", "地区"]),
        platformCol,
        typeCol: findRelativeIndex(headers, startCol, endCol, ["类型", "direction", "业务类型"]),
        thirdPartyCol: findRelativeIndex(headers, startCol, endCol, ["三方", "三方名称", "通道", "支付名称", "third_party", "channel", "pay_channel"]),
        mapCodeCol: findRelativeIndex(headers, startCol, endCol, ["映射码", "映射", "mapping", "map_code", "代码"]),
        amountCol,
        countCol,
        updatedAtCol: findRelativeIndex(headers, startCol, endCol, ["更新时间", "updated_at", "update_time"]),
        successCol: findRelativeIndex(headers, startCol, endCol, ["成功笔数", "success_count", "成功"]),
        failedCol: findRelativeIndex(headers, startCol, endCol, ["失败笔数", "failed_count", "reject_count", "失败", "驳回"]),
        statusCol: findRelativeIndex(headers, startCol, endCol, ["状态", "status"])
      });
    }
  }

  return blocks;
}

function isManualHandlingChannel(value: string): boolean {
  const key = normalizeCell(value).replace(/[\s　_-]+/g, "");
  return key === "人工确认" || key === "人工充值";
}

function manualThirdPartyOverride(country: string, platform: string, rawChannel: string, direction: "代收" | "代付"): string {
  const c = countryFromText(country);
  const p = normalizeCell(platform).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const k = normalizeCell(rawChannel).toLowerCase().replace(/[^a-z0-9一-龥]+/g, "");
  if (c.includes("印度")) {
    // DhaniWin 代付 UPI 是人工确认；其它平台出现 UPI-QR2 用户确认归 ATPay。
    if (p === "DHANIWIN" && direction === "代付" && (k === "upi" || k === "upiqr" || k === "upiqr2")) return "人工确认";
    if (k === "upiqr2") return "ATPay";
    if (k === "manualrecharge" || k === "人工充值") return "人工充值";
    if (direction === "代付" && (k === "localbank" || k === "bankcard")) return "人工确认";
  }
  if (c.includes("越南")) {
    if (k === "yespay" || k === "yespayqr") return "YesPay";
  }
  return "";
}

function parseSheet(sheetName: string, values: Values): ThirdPartyVolumeRow[] {
  const rows: ThirdPartyVolumeRow[] = [];
  const blocks = findBlocks(sheetName, values);

  for (const block of blocks) {
    const headers = values[block.headerRow] || [];
    let blankStreak = 0;

    for (let rr = block.headerRow + 1; rr < values.length; rr++) {
      const row = values[rr] || [];
      const date = parseVolumeDate(get(row, block.dateCol));
      let platform = get(row, block.platformCol);
      const amount = block.amountCol >= 0 ? toNumber(get(row, block.amountCol)) : 0;
      const count = block.countCol >= 0 ? toNumber(get(row, block.countCol)) : 0;

      const rowHasAny = row.slice(block.startCol, Math.min(block.endCol + 1, row.length)).some((cell) => !!normalizeCell(cell));
      if (!rowHasAny) {
        blankStreak += 1;
        // V190：不同国家的横向区块数据起始行不完全一样，80 行太容易提前断开，导致后面的国家漏读。
        // 这里放大到 1500 行；仍然会在连续空白很长时停止，避免整列扫到 60000 行。
        if (blankStreak >= 1500) break;
        continue;
      }
      blankStreak = 0;

      if (!date || !platform) continue;
      if (count <= 0 && amount <= 0) continue;

      let country = block.countryCol >= 0 ? countryFromText(get(row, block.countryCol)) : countryFromText(block.title || sheetName);
      const typeText = block.typeCol >= 0 ? get(row, block.typeCol) : "";
      const mapCode = block.mapCodeCol >= 0 ? get(row, block.mapCodeCol) : "";
      const thirdParty = block.thirdPartyCol >= 0 ? get(row, block.thirdPartyCol) : "";
      const system = block.systemCol >= 0 ? get(row, block.systemCol) : "";
      const southAmericaNormalized = normalizeSouthAmericaRow(country, platform, system, sheetName, block.title, typeText);
      country = southAmericaNormalized.country;
      platform = southAmericaNormalized.platform;
      country = normalizeSpecialPlatformCountry(country, platform, sheetName, block.title, system);
      const statusText = block.statusCol >= 0 ? get(row, block.statusCol) : "";
      if (/商户余额不足|余额不足/.test(statusText)) continue;
      // 三方量必须优先使用“三方/通道名称”，不要优先用“映射码”。很多映射码是 hash/数字，会把别名识别搞乱。
      // “人工确认/人工充值”是业务处理通道，不是第三方支付商，但用户要求在三方量里正常保留显示。
      // 其它错误文本仍继续过滤，避免把状态、报错文字误当成三方。
      const validThirdParty = thirdParty && (isManualHandlingChannel(thirdParty) || (!isIgnoredThirdPartyText(thirdParty) && !isLikelyThirdPartyCodeOnly(thirdParty))) ? thirdParty : "";
      const validMapCode = mapCode && (isManualHandlingChannel(mapCode) || (!isIgnoredThirdPartyText(mapCode) && !isLikelyThirdPartyCodeOnly(mapCode))) ? mapCode : "";
      const rawChannel = validThirdParty || validMapCode;
      if (!rawChannel) continue;
      const direction = inferDirection(sheetName, block.title, typeText);
      let channel = isManualHandlingChannel(rawChannel)
        ? normalizeCell(rawChannel).replace(/[\s　_-]+/g, "")
        : manualThirdPartyOverride(country, platform, rawChannel, direction) || normalizeChannel(rawChannel, country);
      if (isCoinvidUsdtVolume(country, platform, rawChannel, sheetName, block.title, system)) channel = "Coinvid USDT";
      if (!channel || channel === "未知三方" || (!isManualHandlingChannel(channel) && isIgnoredThirdPartyText(channel))) continue;
      let channelType = normalizeVolumeChannelType(country, platform, rawChannel, channel, typeText, mapCode, system, block.title, sheetName, direction);
      if (channel === "人工确认" || channel === "人工充值") channelType = channel;
      const successCount = block.successCol >= 0 ? toNumber(get(row, block.successCol)) : count;
      const failedCount = block.failedCol >= 0 ? toNumber(get(row, block.failedCol)) : Math.max(0, count - successCount);

      // 不把整行 raw 对象塞进快照，避免三方量跨多个月时 JSON 过大导致 Netlify 接口空白/超时。
      rows.push({
        id: `${sheetName}-${block.headerRow}-${rr}-${block.startCol}-${date}-${country}-${platform}-${rawChannel}`,
        sheetName,
        sourceRow: rr + 1,
        date,
        country: country || "未知国家",
        platform,
        channel,
        rawChannel,
        channelType,
        direction,
        amount,
        count,
        successCount,
        failedCount,
        successRate: count ? successCount / count : 0,
        status: block.statusCol >= 0 ? get(row, block.statusCol) : ""
      });
    }
  }

  return rows;
}

function summarize(rows: ThirdPartyVolumeRow[]) {
  return {
    rows: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
    count: rows.reduce((s, r) => s + r.count, 0),
    successCount: rows.reduce((s, r) => s + r.successCount, 0),
    failedCount: rows.reduce((s, r) => s + r.failedCount, 0),
    countries: uniq(rows.map((r) => r.country)).length,
    platforms: uniq(rows.map((r) => r.platform)).length,
    channels: uniq(rows.map((r) => r.channel)).length
  };
}

function buildAliasMap(rows: ThirdPartyVolumeRow[]): Record<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.channel) || new Set<string>();
    if (row.rawChannel && row.rawChannel !== row.channel && !isIgnoredThirdPartyText(row.rawChannel) && !isLikelyThirdPartyCodeOnly(row.rawChannel)) set.add(row.rawChannel);
    map.set(row.channel, set);
  }
  return Object.fromEntries(Array.from(map.entries()).map(([key, set]) => [key, Array.from(set).sort()]));
}

function buildAnomalies(rows: ThirdPartyVolumeRow[]): string[] {
  const messages: string[] = [];
  const map = new Map<string, { count: number; success: number; amount: number }>();
  for (const row of rows) {
    const key = `${row.country} ${row.platform} ${row.channel} ${row.direction}`;
    const item = map.get(key) || { count: 0, success: 0, amount: 0 };
    item.count += row.count;
    item.success += row.successCount;
    item.amount += row.amount;
    map.set(key, item);
  }
  for (const [key, v] of Array.from(map.entries())) {
    if (v.count >= 20 && v.success / v.count < 0.9) messages.push(`${key}：成功率 ${((v.success / v.count) * 100).toFixed(2)}%，笔数 ${v.count}，金额 ${v.amount.toLocaleString("zh-CN")}`);
  }
  const aliasMap = buildAliasMap(rows);
  for (const [channel, aliases] of Object.entries(aliasMap)) {
    if (aliases.length >= 3) messages.push(`${channel}：识别到 ${aliases.length} 个别名（${aliases.slice(0, 5).join(" / ")}），建议统一命名。`);
  }
  return Array.from(new Set(messages)).slice(0, 100);
}



function compactVolumeRowId(key: string): string {
  // 两组 32-bit 稳定哈希拼接，避免数千条聚合行只用单个 32-bit key 时发生 React key 碰撞。
  let hash1 = 2166136261;
  let hash2 = 2246822519;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 16777619);
    hash2 ^= code + i;
    hash2 = Math.imul(hash2, 3266489917);
  }
  return `tpv-${(hash1 >>> 0).toString(36)}-${(hash2 >>> 0).toString(36)}`;
}

function compactThirdPartyVolumeRows(rows: ThirdPartyVolumeRow[]): ThirdPartyVolumeRow[] {
  // 三方 RAW 表可能有 5 万+ 行，但页面实际只按 日期/国家/平台/三方/类型/方向 汇总。
  // 同一读取分片内先聚合，可把快照从数万行压到几千行，显著减少 Netlify Blobs 写入和 API 返回时间。
  // sheetName 保留精确分片范围，保证增量刷新时仍只替换本次成功读取的那一片。
  const map = new Map<string, ThirdPartyVolumeRow & { _statuses?: Set<string>; _rawChannels?: Set<string> }>();
  for (const row of rows) {
    const key = [
      row.sheetName,
      row.date,
      row.country,
      row.platform,
      row.channel,
      row.channelType || "",
      row.direction
    ].join("|||");
    const current = map.get(key);
    if (!current) {
      const statuses = new Set<string>();
      const rawChannels = new Set<string>();
      if (row.status) statuses.add(row.status);
      if (row.rawChannel) rawChannels.add(row.rawChannel);
      map.set(key, {
        ...row,
        id: compactVolumeRowId(key),
        _statuses: statuses,
        _rawChannels: rawChannels
      });
      continue;
    }
    current.amount += Number(row.amount) || 0;
    current.count += Number(row.count) || 0;
    current.successCount += Number(row.successCount) || 0;
    current.failedCount += Number(row.failedCount) || 0;
    current.sourceRow = Math.min(current.sourceRow || row.sourceRow, row.sourceRow || current.sourceRow);
    if (row.status) current._statuses?.add(row.status);
    if (row.rawChannel) current._rawChannels?.add(row.rawChannel);
  }

  return Array.from(map.values()).map((row) => {
    const statuses = Array.from(row._statuses || []).filter(Boolean);
    const { _statuses: _internalStatuses, _rawChannels: _internalRawChannels, ...clean } = row;
    return {
      ...clean,
      // 聚合后统一保存 canonical 名称；原始别名继续保存在 payload.aliasMap，避免 OX2PAY/OXPay 被拆成两行。
      rawChannel: clean.channel,
      status: statuses.slice(0, 4).join(" / "),
      successRate: clean.count ? clean.successCount / clean.count : 0
    };
  });
}


/**
 * V230 低流量客户端快照：跨来源页签再次按页面真正需要的维度聚合。
 *
 * 月快照内部可能保留不同 sheetName 的同一组数据，方便旧版做分片替换；
 * 但浏览器只需要 日期/国家/平台/主三方/类型/方向。去掉 sheetName 维度后，
 * API 返回体会小很多，同时金额、笔数、成功/失败笔数保持不变。
 */
export function compactThirdPartyVolumePayloadForDashboard(payload: ThirdPartyVolumePayload): ThirdPartyVolumePayload {
  const normalized = normalizeThirdPartyVolumePayload(payload);
  const map = new Map<string, ThirdPartyVolumeRow & { _sheets?: Set<string>; _statuses?: Set<string> }>();

  for (const row of normalized.rows || []) {
    const key = [
      row.date,
      row.country,
      row.platform,
      row.channel,
      row.channelType || "",
      row.direction
    ].join("|||");
    const amount = Number(row.amount) || 0;
    const count = Number(row.count) || 0;
    const successCount = Number(row.successCount) || 0;
    const failedCount = Number(row.failedCount) || 0;
    const current = map.get(key);
    if (!current) {
      const sheets = new Set<string>();
      const statuses = new Set<string>();
      if (row.sheetName) sheets.add(row.sheetName);
      if (row.status) statuses.add(row.status);
      map.set(key, {
        ...row,
        id: compactVolumeRowId(`dashboard|||${key}`),
        amount,
        count,
        successCount,
        failedCount,
        rawChannel: row.channel,
        raw: undefined,
        _sheets: sheets,
        _statuses: statuses
      });
      continue;
    }
    current.amount += amount;
    current.count += count;
    current.successCount += successCount;
    current.failedCount += failedCount;
    current.sourceRow = Math.min(current.sourceRow || row.sourceRow, row.sourceRow || current.sourceRow);
    if (row.sheetName) current._sheets?.add(row.sheetName);
    if (row.status) current._statuses?.add(row.status);
  }

  const rows = Array.from(map.values()).map((row) => {
    const sheets = Array.from(row._sheets || []).filter(Boolean);
    const statuses = Array.from(row._statuses || []).filter(Boolean);
    const { _sheets: _internalSheets, _statuses: _internalStatuses, ...clean } = row;
    return {
      ...clean,
      sheetName: sheets.length <= 2 ? sheets.join(" + ") : `月度聚合(${sheets.length}页签)`,
      status: statuses.slice(0, 4).join(" / "),
      rawChannel: clean.channel,
      successRate: clean.count ? clean.successCount / clean.count : 0,
      raw: undefined
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.country.localeCompare(b.country, "zh-CN") || a.platform.localeCompare(b.platform, "zh-CN"));

  const visibleChannels = new Set(rows.map((row) => row.channel).filter(Boolean));
  const aliasMap = Object.fromEntries(Object.entries(normalized.aliasMap || {})
    .filter(([channel]) => visibleChannels.has(channel))
    .map(([channel, aliases]) => [channel, Array.from(new Set(aliases || [])).slice(0, 30)]));

  return {
    ...normalized,
    meta: {
      ...normalized.meta,
      message: [
        normalized.meta?.message,
        `V230 客户端轻量快照：${normalized.rows.length} 行压缩为 ${rows.length} 行，金额与笔数口径不变`
      ].filter(Boolean).join("；")
    },
    rows,
    aliasMap,
    summary: summarize(rows),
    anomalies: buildAnomalies(rows)
  };
}


function dashboardDateAdd(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * V230 按页面选择的日期裁剪 API 返回体。
 * 日表额外保留开始日期的前一天，供“昨日代收/代付、环比”计算；
 * 没传日期时只返回最新日期和前一天，避免首次打开就下载整个月。
 */
export function sliceThirdPartyVolumePayloadForDashboard(
  payload: ThirdPartyVolumePayload,
  startDate = "",
  endDate = ""
): ThirdPartyVolumePayload {
  const compact = compactThirdPartyVolumePayloadForDashboard(payload);
  const allRows = compact.rows || [];
  if (!allRows.length) return compact;

  const dates = Array.from(new Set(allRows.map((row) => row.date).filter(Boolean))).sort();
  const latest = dates[dates.length - 1] || "";
  const visibleStart = startDate || latest;
  const visibleEnd = endDate || visibleStart || latest;
  const lookupStart = visibleStart ? dashboardDateAdd(visibleStart, -1) : visibleStart;
  const rows = allRows.filter((row) => {
    if (lookupStart && row.date < lookupStart) return false;
    if (visibleEnd && row.date > visibleEnd) return false;
    return true;
  });

  const visibleChannels = new Set(rows.map((row) => row.channel).filter(Boolean));
  const aliasMap = Object.fromEntries(Object.entries(compact.aliasMap || {})
    .filter(([channel]) => visibleChannels.has(channel))
    .map(([channel, aliases]) => [channel, Array.from(new Set(aliases || [])).slice(0, 30)]));

  return {
    ...compact,
    meta: {
      ...compact.meta,
      message: [
        compact.meta?.message,
        `V230 按日期下发：${lookupStart || "最早"} 至 ${visibleEnd || "最新"}，共 ${rows.length} 行`
      ].filter(Boolean).join("；")
    },
    rows,
    aliasMap,
    summary: summarize(rows),
    anomalies: buildAnomalies(rows)
  };
}


export function normalizeThirdPartyVolumePayload(payload: ThirdPartyVolumePayload): ThirdPartyVolumePayload {
  const sourceRows = payload?.rows || [];
  if (!sourceRows.length) return payload;

  const normalizedRows: ThirdPartyVolumeRow[] = sourceRows.map((row) => {
    const rawChannel = normalizeCell(row.rawChannel || row.channel || "");
    const keepManual = ["人工确认", "人工充值", "Coinvid USDT"].includes(row.channel || "");
    let channel = keepManual ? row.channel : manualThirdPartyOverride(row.country, row.platform, rawChannel || row.channel, row.direction) || canonicalThirdPartyName(rawChannel || row.channel, row.country);
    if (!channel || channel === "未知三方" || isIgnoredThirdPartyText(channel)) {
      channel = row.channel || rawChannel || "未知三方";
    }
    let channelType = row.channelType || inferThirdPartyChannelType(rawChannel || channel, row.country, `${channel} ${rawChannel}`) || "其他类型";
    if (channel === "人工确认" || channel === "人工充值") channelType = channel;
    return {
      ...row,
      channel,
      channelType
    };
  });

  const compactRows = compactThirdPartyVolumeRows(normalizedRows)
    .sort((a, b) => b.date.localeCompare(a.date) || a.country.localeCompare(b.country, "zh-CN") || a.platform.localeCompare(b.platform, "zh-CN"));

  const discoveredAliases = buildAliasMap(normalizedRows);
  const aliasMap: Record<string, string[]> = { ...(payload.aliasMap || {}) };
  for (const [channel, aliases] of Object.entries(discoveredAliases)) {
    aliasMap[channel] = Array.from(new Set([...(aliasMap[channel] || []), ...aliases])).sort();
  }

  return {
    ...payload,
    rows: compactRows,
    aliasMap,
    summary: summarize(compactRows),
    anomalies: buildAnomalies(compactRows)
  };
}

export function buildThirdPartyVolumePayload(sheetValues: Record<string, Values>): ThirdPartyVolumePayload {
  const allRows = Object.entries(sheetValues).flatMap(([sheetName, values]) => parseSheet(sheetName, values || [])).filter((row) => row.country !== "埃及" && !row.platform.includes("埃及") && !row.sheetName.includes("埃及"));
  const rowMap = new Map<string, ThirdPartyVolumeRow>();
  for (const row of allRows) if (!rowMap.has(row.id)) rowMap.set(row.id, row);
  const rows = Array.from(rowMap.values()).sort((a, b) => b.date.localeCompare(a.date) || a.country.localeCompare(b.country, "zh-CN") || a.platform.localeCompare(b.platform, "zh-CN"));
  return normalizeThirdPartyVolumePayload({
    meta: {
      year: rows[0]?.date?.slice(0, 4) || String(new Date().getFullYear()),
      month: rows[0]?.date ? String(Number(rows[0].date.slice(5, 7))) : String(new Date().getMonth() + 1),
      updatedAt: new Date().toISOString(),
      source: "google-sheet",
      sheets: Object.keys(sheetValues)
    },
    rows,
    aliasMap: buildAliasMap(rows),
    summary: summarize(rows),
    anomalies: buildAnomalies(rows)
  });
}


// ===== v239 原版 parseThirdPartyRates.ts =====
// 为避免与三方量解析器的内部 helper 重名，这里只做作用域封装；原解析逻辑不改。
const { buildThirdPartyRatePayload, applyConfirmedRateRules } = (() => {

type ThirdPartyRateRow = {
  id: string;
  sheetName: string;
  country: string;
  category: string;
  thirdParty: string;
  collectFee: string;
  payoutFee: string;
  totalFee: string;
  collectSingleFee: string;
  payoutSingleFee: string;
  collectLimit: string;
  payoutLimit: string;
  channelInfo: string;
  leak: string;
  whitelist: string;
  status: string;
  sourceRow: number;
};

type ThirdPartyPlatformStatusRow = {
  id: string;
  sheetName: string;
  country: string;
  platform: string;
  thirdParty: string;
  status: string;
  rawStatus: string;
  collectFee: string;
  payoutFee: string;
  totalFee: string;
  collectSingleFee: string;
  payoutSingleFee: string;
  collectLimit: string;
  payoutLimit: string;
  category: string;
  sourceRow: number;
  sourceColumn: number;
};

type ThirdPartyRateSummary = {
  totalStatusCells: number;
  totalPlatforms: number;
  totalThirdParties: number;
  totalSheets: number;
  statusCounts: Record<string, number>;
  openCount: number;
  pauseCount: number;
  backupCount: number;
  disabledCount: number;
  notConnectedCount: number;
  maintenanceCount: number;
  unsupportedCount: number;
};

type ThirdPartyRatePayload = {
  meta: {
    year: string;
    month: string;
    updatedAt: string;
    source: "google-sheet" | "demo";
    sheets: string[];
    [key: string]: unknown;
  };
  summary: ThirdPartyRateSummary;
  rates: ThirdPartyRateRow[];
  platformStatuses: ThirdPartyPlatformStatusRow[];
  anomalies: string[];
};

// V98: 费率表按左右两列“三方”同时建立匹配，防止 Google 费率表改名/别名后页面费率空白。

type Values = string[][];

const BASE_HEADERS = [
  "类型",
  "三方名称",
  "三方",
  "费率合计",
  "合计费率",
  "代收手续费",
  "代付手续费",
  "代收",
  "代付",
  "代收费率",
  "代付费率",
  "代收限制",
  "代付限制",
  "代收限额",
  "代付限额",
  "状态",
  "通道情况",
  "是否有漏洞",
  "白名单",
  "白名单ip是否核对",
  "备注",
  "状态备注内容"
];

const RATE_COUNTRY_PRIORITY = ["印度", "巴基斯坦", "印尼", "越南", "菲律宾", "马来", "缅甸", "哥伦比亚", "墨西哥", "智利", "尼日利亚", "胖虎巴西", "巴西", "南美", "USDT通道", "USDT"];

function countryRankForSort(country: string): number {
  const text = String(country || "");
  const normalized = text.replace(/原生|盘口|线下|地区/g, "").trim();
  const index = RATE_COUNTRY_PRIORITY.findIndex((item) => normalized === item || text.includes(item));
  return index >= 0 ? index : RATE_COUNTRY_PRIORITY.length + 1;
}

function compareCountryForSort(a: string, b: string): number {
  return countryRankForSort(a) - countryRankForSort(b) || String(a || "").localeCompare(String(b || ""), "zh-CN", { numeric: true });
}

const STATUS_ORDER = ["开启", "正常", "暂停", "备用", "停用", "未接入", "维护", "不支持", "对接中", "未知"];

function get(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return "";
  return normalizeCell(row[index]);
}

function compact(value: string): string {
  return normalizeCell(value).replace(/[\s：:]/g, "");
}

function inferCountry(sheetName: string): string {
  const name = normalizeCell(sheetName);
  if (name.includes("USDT")) return "USDT通道";
  // 用户确认：费率表里的“印度线下”就是印度费率；“印度原始”不参与三方量费率匹配。
  if (name.includes("印度线下")) return "印度";
  if (name.includes("印度原生") || name.includes("印度原始")) return "印度原始";
  if (name.includes("埃及")) return "埃及";
  if (name.includes("越南")) return "越南";
  if (name.includes("巴西")) return "巴西";
  if (name.includes("巴基斯坦")) return "巴基斯坦";
  if (name.includes("缅甸")) return "缅甸";
  if (name.includes("菲律宾")) return "菲律宾";
  if (name.includes("印尼")) return "印尼";
  if (name.includes("马来")) return "马来";
  if (name.includes("南美")) return "南美";
  if (name.includes("尼日利亚")) return "尼日利亚";
  if (name.includes("墨西哥") || /mexico|mex|npg[-_\s]*(me|mx)/i.test(name)) return "墨西哥";
  if (name.includes("哥伦比亚") || /colombia|columbia|col|npg[-_\s]*(co|col)/i.test(name)) return "哥伦比亚";
  if (name.includes("智利") || /chile|chl|npg[-_\s]*(cl|chl|chi)/i.test(name)) return "智利";
  return name.replace(/盘口|通道/g, "").trim() || name;
}

function southAmericaCountryFromText(text: string): "哥伦比亚" | "墨西哥" | "智利" | "" {
  const value = normalizeCell(text).toLowerCase();
  if (!value) return "";
  if (value.includes("哥伦比亚") || /\bcolombia\b|\bcolumbia\b|\bcolombian\b|\bcol\b|npg[-_\s]*(co|col)\b|\bco66\b/.test(value)) return "哥伦比亚";
  if (value.includes("墨西哥") || /\bmexico\b|\bmexican\b|\bmex\b|npg[-_\s]*(me|mex|mx)\b|\bmx\b/.test(value)) return "墨西哥";
  if (value.includes("智利") || /\bchile\b|\bchl\b|npg[-_\s]*(cl|chl|chi)\b|\bcl\b/.test(value)) return "智利";
  return "";
}

function resolveRateRowCountry(baseCountry: string, rowCountry: string, sheetName: string): string {
  const raw = normalizeCell(rowCountry);
  const detected = southAmericaCountryFromText(`${raw} ${sheetName}`);
  if (baseCountry === "南美" && detected) return detected;
  if (["哥伦比亚", "墨西哥", "智利"].includes(baseCountry)) return baseCountry;
  if (baseCountry === "南美" && raw) return inferCountry(raw);
  return baseCountry;
}


function normalizeSouthAmericaRateCategory(country: string, category: string, rowText = ""): string {
  const c = inferCountry(country);
  const raw = `${category} ${rowText}`
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s_：:]+/g, "-");

  if (c === "墨西哥") {
    if (/spei/.test(raw)) return "SPEI";
    if (/clabe/.test(raw)) return "CLABE";
    if (/oxxo/.test(raw)) return "OXXO";
    if (/codi/.test(raw)) return "CoDi";
    if (/cash|efectivo/.test(raw)) return "Cash";
    if (/bank-card|bankcard|bank|card|tarjeta/.test(raw)) return "Bank Card";
  }

  if (c === "哥伦比亚") {
    if (/bre[-_]?key|brekey/.test(raw)) return "BRE-KEY";
    if (/bre[-_]?b|breb/.test(raw)) return "BRE-B";
    if (/pse/.test(raw)) return "PSE";
    if (/nequi/.test(raw)) return "Nequi";
    if (/transfiya/.test(raw)) return "Transfiya";
    if (/bank|banco/.test(raw)) return "Bank";
    if (/cash|efectivo/.test(raw)) return "Cash";
  }

  if (c === "智利") {
    if (/webpay|card|tarjeta/.test(raw)) return "Card(Webpay)";
    if (/khipu|bank|banco/.test(raw)) return "Bank(Khipu)";
    if (/mach|e[-_ ]?wallet|ewallet|wallet/.test(raw)) return "E-Wallet(Mach)";
    if (/pago46|cash|efectivo/.test(raw)) return "Cash(Pago46)";
  }

  return "";
}

function normalizeStatus(value: string): string {
  const raw = normalizeCell(value);
  const text = raw
    .replace(/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖/g, "")
    .trim();

  // 只有图标的单元格也要识别，避免出现“✅ / ❌”这种假盘口或假三方。
  if (!text) {
    if (/🟢|✅|☑|✔/.test(raw)) return "开启";
    if (/🟡/.test(raw)) return "备用";
    if (/⚠️|⚠/.test(raw)) return "暂停";
    if (/🛠️|🛠/.test(raw)) return "维护";
    if (/🚫|⛔/.test(raw)) return "停用";
    if (/🔴|⭕|❌|✖/.test(raw)) return "未接入";
    return "";
  }

  if (text.includes("不支持")) return "不支持";
  if (text.includes("暂时停") || text.includes("暂停")) return "暂停";
  if (text.includes("备用")) return "备用";
  if (text.includes("停用") || text.includes("已停")) return "停用";
  if (text.includes("未接入") || text.includes("未接")) return "未接入";
  if (text.includes("维护")) return "维护";
  if (text.includes("对接")) return "对接中";
  if (text.includes("开启") || text.includes("打开") || text.includes("正常")) return text.includes("正常") ? "正常" : "开启";
  return text;
}

function statusScore(status: string): number {
  const i = STATUS_ORDER.indexOf(status || "未知");
  return i >= 0 ? i : STATUS_ORDER.length;
}

function isStatusText(value: string): boolean {
  return !!normalizeStatus(value) && /开启|正常|暂停|暂时停|备用|停用|未接入|未接|维护|不支持|对接/.test(value);
}

function isPureIconOrLegend(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return true;
  const stripped = text
    .replace(/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖|🔧|🟩|🟥|🟨/g, "")
    .replace(/[\s\-_/|:：]/g, "");
  return !stripped || ["状态", "说明", "备注", "类型", "平台", "盘口", "国家", "地区"].includes(stripped);
}

function isColumnOrLegendText(text: string): boolean {
  const clean = compact(text);
  if (!clean) return true;
  if (isBaseHeader(text)) return true;
  // 右侧“状态说明 / 状态备注内容 / 使用盘口”等辅助说明不能当作真实盘口或三方。
  return /^(代收|代付|代收区间|代付区间|代收扫码|代付扫码|代收属性|代付属性|代收原生|代付原生|代付账号|代付备注|通道情况|是否有漏洞|白名单|白名单ip是否核对|状态|状态备注|状态备注内容|备注|说明|费率|手续费|合计费率|费率合计|代收限制|代付限制|代收限额|代付限额|三方名称|三方名|盘口|平台|使用盘口|国家|地区|正常|运行中|维护|波动|缓慢|技术还在对接中|盘口不支持接入|三方都正常的情况下不开|已经不再使用)$/i.test(clean);
}

function isValidPlatformName(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return false;
  if (isPureIconOrLegend(text)) return false;
  if (isStatusText(text)) return false;
  if (/^(无|是|否|-|—)$/.test(text)) return false;
  if (isColumnOrLegendText(text)) return false;
  if (/使用盘口|状态备注|状态说明|备注内容|三方名称|代收|代付|手续费|合计费率|费率合计|限额|限制|白名单|漏洞|通道情况|扫码|属性|区间|波动|缓慢|运行中|技术还在对接|盘口不支持|正常情况下不开|已经不再使用/.test(text)) return false;
  return /[A-Za-z0-9一-龥]/.test(text);
}

function isValidThirdPartyName(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return false;
  if (isPureIconOrLegend(text)) return false;
  if (isStatusText(text)) return false;
  if (/^(无|是|否|-|—)$/.test(text)) return false;
  if (isColumnOrLegendText(text)) return false;
  if (/使用盘口|状态备注|状态说明|备注内容|代收|代付|手续费|限制|限额|是否有漏洞|白名单|通道情况|扫码|属性|区间|波动|缓慢|支持|开启|暂停|备用|停用|未接入|维护|正常|运行中|技术还在对接|盘口不支持|正常情况下不开|已经不再使用/.test(text)) return false;
  return /[A-Za-z0-9一-龥]/.test(text);
}

function isBaseHeader(header: string): boolean {
  const text = compact(header);
  if (!text) return true;
  return BASE_HEADERS.some((h) => text.includes(compact(h)) || compact(h).includes(text));
}

function looksLikeEntityName(value: string): boolean {
  const text = normalizeCell(value);
  const clean = text.replace(/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖/g, "").trim();
  if (!clean) return false;
  if (isBaseHeader(clean)) return false;
  if (isStatusText(text)) return false;
  if (/^[-–—]+$/.test(clean)) return false;
  if (/^(是|否|无|正常|开启|暂停|备用|停用|未接入|维护|不支持|状态|状态备注内容)$/i.test(clean)) return false;
  if (/^\d+(\.\d+)?%?$/.test(clean)) return false;
  return true;
}

function findRateHeader(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 25); r++) {
    const cells = values[r].map(compact);
    // 必须是真正的表头行，不能把“越南三方 / 巴西三方”这种合并标题误判成三方名称。
    const hasNameHeader = cells.some((cell) => cell === "三方名称" || cell === "三方名" || cell === "三方");
    const hasFeeHeader = cells.some((cell) => /代收费率|代付费率|代收手续费|代付手续费|合计费率|费率合计|总手续费/.test(cell)) || cells.some((cell) => cell === "代收" || cell === "代付" || cell === "收款" || cell === "付款");
    const hasLimitHeader = cells.some((cell) => /代收限制|代付限制|代收限额|代付限额/.test(cell));
    const first = cells[0] || "";
    // 如果第一列是盘口/平台，通常是“盘口 × 三方状态矩阵”，交给 parsePlatformMatrixSheet 解析。
    if (first.includes("盘口") || first.includes("平台")) continue;
    if (hasNameHeader && (hasFeeHeader || hasLimitHeader)) return r;
  }
  return -1;
}

function headerMatches(header: string, keywords: string[]): boolean {
  const text = compact(header);
  return keywords.some((keyword) => {
    const key = compact(keyword);
    return text === key || text.includes(key);
  });
}

function findHeaderIndex(headers: string[], keywords: string[]): number {
  return headers.findIndex((header) => headerMatches(header, keywords));
}

function findHeaderIndexes(headers: string[], keywords: string[]): number[] {
  return headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => headerMatches(header, keywords))
    .map(({ index }) => index);
}

function findExactHeaderIndexes(headers: string[], keywords: string[]): number[] {
  const keys = keywords.map(compact);
  return headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => keys.includes(compact(header)))
    .map(({ index }) => index);
}

function findAllThirdPartyNameColumns(headers: string[]): number[] {
  const candidates = findExactHeaderIndexes(headers, ["三方名称", "三方名", "三方"]);
  return candidates.filter((index) => {
    const header = compact(headers[index] || "");
    if (!header) return false;
    const prev = compact(headers[index - 1] || "");
    const next = compact(headers[index + 1] || "");
    // 排除右侧说明/状态图例附近误判，保留左右两套真实三方列。
    if (/状态|备注|说明|白名单|漏洞|通道情况/.test(prev + next)) return false;
    return true;
  });
}

function isLegendStatusColumn(headers: string[], index: number): boolean {
  const header = compact(headers[index] || "");
  if (!header) return true;
  const next = compact(headers[index + 1] || "");
  const prev = compact(headers[index - 1] || "");
  // 右侧状态说明表通常是“状态 / 状态备注内容”，不能当成数据状态列。
  if (header === "状态" && /状态备注|备注内容|说明/.test(next)) return true;
  if (/状态备注|备注内容|说明/.test(header)) return true;
  if (/状态|状态备注/.test(prev) && /备注内容|说明/.test(header)) return true;
  return false;
}

function findUsableStatusColumn(headers: string[]): number {
  for (let index = 0; index < headers.length; index++) {
    const header = compact(headers[index] || "");
    if (!header) continue;
    if (isLegendStatusColumn(headers, index)) continue;
    if (header === "状态" || header === "当前状态" || header === "通道状态") return index;
  }
  return -1;
}

function uniqueIndexes(indexes: number[]): number[] {
  return Array.from(new Set(indexes.filter((index) => index >= 0)));
}

function findHeaderIndexesByRegex(headers: string[], regex: RegExp): number[] {
  return headers
    .map((header, index) => ({ clean: compact(header), index }))
    .filter(({ clean }) => regex.test(clean))
    .map(({ index }) => index);
}

function inferVariantLabel(header: string, fallback: string): string {
  let text = normalizeCell(header)
    .replace(/最低|最高|最小|最大|下限|上限|限制|限额|区间|范围/gi, "")
    .replace(/代收|代付|收款|付款|出款|入款|手续费|费率|合计|总计|总手续费|总费率/gi, "")
    .replace(/[()（）:_：\-\/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = fallback;
  if (/^easy$/i.test(text)) return "Easy";
  if (/^jazz$/i.test(text)) return "Jazz";
  if (/唤醒/i.test(text)) return "唤醒";
  if (/原生/i.test(text)) return "原生";
  return text;
}

function isUsdtCountry(country: string): boolean {
  return /USDT|U通道|USDT通道/i.test(country || "");
}

function looksLikeFeeOrLimitValue(value: string): boolean {
  const text = normalizeCell(value);
  if (!text || text === "-" || text === "—") return false;
  const status = normalizeStatus(text);
  if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/i.test(status)) return false;
  if (/代收手续费|代付手续费|代收费率|代付费率|代收限制|代付限制|代收限额|代付限额|状态|备注|白名单|漏洞|通道情况/.test(text)) return false;
  return /\d|%|TRX|USDT|VND|BDT|INR|MMK|PHP|PKR|BRL|USD|w|W|万|千|单笔|无/i.test(text);
}


function findFeeColumnIndexes(headers: string[], kind: "collect" | "payout"): number[] {
  return headers
    .map((header, index) => ({ header, index, clean: compact(header) }))
    .filter(({ clean }) => {
      if (!clean) return false;
      if (/限制|限额|区间|范围|上限|下限/.test(clean)) return false;
      if (kind === "collect") return /代收|收款|collect|deposit/i.test(clean);
      return /代付|付款|出款|payout|withdraw/i.test(clean);
    })
    .map(({ index }) => index);
}

function findTotalFeeColumnIndexes(headers: string[]): number[] {
  return headers
    .map((header, index) => ({ header, index, clean: compact(header) }))
    .filter(({ clean }) => {
      if (!clean) return false;
      if (/限制|限额|区间|范围|上限|下限/.test(clean)) return false;
      return /合计|总费率|总手续费|费率合计|总计|total/i.test(clean);
    })
    .map(({ index }) => index);
}


function isLimitHeader(header: string): boolean {
  const clean = compact(header);
  return /限制|限额|区间|范围|最低|最高|最小|最大|下限|上限/.test(clean);
}

function isSingleFeeHeader(header: string): boolean {
  const clean = compact(header);
  // “代收合计%+单笔 / 代付合计%+单笔”这类列同时含百分比与单笔，仍然要先当费率列读取，单笔由前端从 + 后面拆出。
  if (/费率|合计|%/.test(clean)) return false;
  // 兼容尼日利亚表头：代收单 / 代付单 = 单笔费用。
  return /单笔|每笔|笔费|代收单$|代付单$|收款单$|付款单$|出款单$|提现单$/.test(clean);
}

function isCollectHeader(header: string): boolean {
  const clean = compact(header);
  return /代收|收款|入款|充值|collect|deposit|easy代收|jazz代收/i.test(clean);
}

function isPayoutHeader(header: string): boolean {
  const clean = compact(header);
  return /代付|付款|出款|提款|提现|payout|withdraw|easy代付|jazz代付/i.test(clean);
}

function isTotalFeeHeader(header: string): boolean {
  const clean = compact(header);
  if (!clean || isLimitHeader(header) || isSingleFeeHeader(header)) return false;
  return /合计|总费率|总手续费|费率合计|总计|total/i.test(clean);
}

function filterFeeColumns(headers: string[], indexes: number[], kind: "collect" | "payout" | "total"): number[] {
  return uniqueIndexes(indexes).filter((index) => {
    const header = headers[index] || "";
    const clean = compact(header);
    if (!header || isLimitHeader(header) || isSingleFeeHeader(header)) return false;
    if (/状态|通道情况|漏洞|白名单|备注|说明|限制|限额|区间|范围/.test(clean)) return false;
    if (kind === "total") return isTotalFeeHeader(header);
    // “代收 / 代付”在用户表里经常只是 ✅/❌ 状态列，不是费率列。
    // 真正费率列一般写：代收费率、代收手续费、代收合计%+单笔、代付率等。
    const looksExplicitFeeHeader = /费率|手续费|合计|%|单笔|每笔|笔费|代收率|代付率|收款率|付款率|rate|fee/i.test(clean);
    if (!looksExplicitFeeHeader && (clean === "代收" || clean === "收款" || clean === "代付" || clean === "付款" || clean === "出款")) return false;
    if (kind === "collect") return isCollectHeader(header) || /扫码.*代收|代收.*扫码/i.test(header);
    return isPayoutHeader(header);
  });
}

function findSingleFeeColumnIndexes(headers: string[], kind: "collect" | "payout"): number[] {
  return headers
    .map((header, index) => ({ header, index, clean: compact(header) }))
    .filter(({ header, clean }) => {
      if (!clean || !isSingleFeeHeader(header) || isLimitHeader(header)) return false;
      if (kind === "collect") return isCollectHeader(header) || !isPayoutHeader(header);
      return isPayoutHeader(header);
    })
    .map(({ index }) => index);
}

function isBlankFeeValue(value: string): boolean {
  const text = normalizeCell(value);
  return !text || text === "-" || text === "—";
}

function isBadFormulaValue(value: string): boolean {
  return /^#(?:VALUE|DIV\/0|N\/A|REF|NAME|NUM|NULL)!?$/i.test(normalizeCell(value));
}

function feeVariantLabel(header: string, fallback: string): string {
  let text = normalizeCell(header)
    .replace(/手续费|费率|合计费率|费率合计|总手续费|总费率|合计|总计|单笔|每笔|笔费/gi, "")
    .replace(/代收|代付|收款|付款|出款|入款|easy扫码|扫码|collect|payout|deposit|withdraw/gi, "")
    .replace(/[%＋+]/g, " ")
    .replace(/[()（）:_：\-\/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = fallback;
  if (/^easy$/i.test(text)) return "Easy";
  if (/^jazz$/i.test(text)) return "Jazz";
  return text;
}

function normalizeFeeVariant(value: string): string {
  return normalizeCell(value)
    .replace(/✅|☑|✔|❌|✖|⭕|🟢|🟡|⚠️|⚠|🔴|🛠️|🛠|🚫|🔄/g, "")
    .trim();
}

function parsePercentFee(value: string): number | null {
  const text = normalizeCell(value);
  if (!text || text === "-" || /停用|未接入|暂停|备用|开启|正常/.test(text)) return null;
  if (text.includes("无")) return 0;
  if (!text.includes("%")) return null;
  const normalized = text.replace(/(\d),(\d)(?=\s*%|\s*$)/g, "$1.$2").replace(/,/g, "");
  // 必须取 % 前面的数字，不能把 2001以上 / 3000以下 这种金额门槛当作 2001%。
  const match = normalized.match(/-?\d+(?:\.\d+)?(?=\s*%)/);
  if (!match) return null;
  return Number(match[0]);
}

function extractFeeNumber(value: string): number {
  const text = normalizeCell(value).replace(/,/g, "");
  if (!text || text === "-" || text === "—" || text === "无") return 0;
  if (/停用|未接入|暂停|备用|开启|正常|限制|限额|区间|状态|备注|白名单|漏洞/.test(text)) return 0;
  const match = text.includes("%") ? text.match(/-?\d+(?:\.\d+)?(?=\s*%)/) : text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : 0;
}

function isHighFeeRow(row: Pick<ThirdPartyRateRow, "collectFee" | "payoutFee" | "totalFee" | "collectSingleFee" | "payoutSingleFee">): boolean {
  const values = [row.collectFee, row.payoutFee, row.totalFee, row.collectSingleFee, row.payoutSingleFee]
    .map(extractFeeNumber)
    .filter((value) => value > 0);
  return values.some((value) => value >= 2);
}

function formatPercentTotal(value: number): string {
  const fixed = value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${fixed}%`;
}

function inferTotalFee(collectFee: string, payoutFee: string, explicitTotal: string): string {
  if (explicitTotal) return explicitTotal;
  const collect = parsePercentFee(collectFee);
  const payout = parsePercentFee(payoutFee);
  if (collect === null && payout === null) return "";
  return formatPercentTotal((collect || 0) + (payout || 0));
}

function cleanFeeOrLimitValue(value: string): string {
  const text = normalizeCell(value);
  if (!text) return "";
  if (isBadFormulaValue(text)) return "";
  if (isColumnOrLegendText(text)) return "";
  const status = normalizeStatus(text);
  const hasAmountLikeText = /\d|%|TRX|USDT|VND|BDT|INR|MMK|PHP|PKR|BRL|USD|w|W|万|千/i.test(text);
  if (!hasAmountLikeText && /打款|到账|提交|更换|波动|时间|正常|白班|夜班|备注|状态|审核|人工|客服|投诉|说明/.test(text) && !/^(无|没有|暂无)$/.test(text)) return "";
  if (!hasAmountLikeText && (/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖/.test(text))) return "";
  if (!hasAmountLikeText && /^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) return "";
  return text;
}

function normalizeRateRowCategory(country: string, category: string, thirdParty: string, sheetName: string): string {
  const base = normalizeCell(category);
  const text = `${base} ${thirdParty} ${sheetName}`.toLowerCase();
  const southAmericaCategory = normalizeSouthAmericaRateCategory(country, base, `${thirdParty} ${sheetName}`);
  if (southAmericaCategory) return southAmericaCategory;
  if (country.includes("巴西")) return "PIX";
  if (country.includes("尼日利亚")) return /usdt|tron|trc20|unipay/.test(text) ? "USDT" : "银行";
  if (country.includes("菲律宾")) {
    // V110：菲律宾 PH19 费率表如果有钱包/银行分类，必须保留分类去匹配三方量。
    if (/gcash/.test(text)) return "GCASH";
    if (/pay\s*maya|paymaya|\bmaya\b/.test(text)) return "PAYMAYA";
    if (/go\s*tyme|gotyme/.test(text)) return "GOTYME";
    if (/grab\s*pay|grabpay/.test(text)) return "GRABPAY";
    if (/银行代付|bank|银行卡/.test(text)) return "银行代付";
    if (/代付/.test(base)) return "代付";
  }
  if (country.includes("印尼")) {
    // 印尼费率要按具体钱包匹配：OVO / DANA / LINKAJA / GOPAY 各自可能有自己的费率。
    // 没写具体钱包、只有 E~ / Wallet 的才归「钱包代付」。
    if (/qris/.test(text)) return "QRIS";
    if (/link\s*aja|link-aja|linkaja/.test(text)) return "LINKAJA";
    if (/\bdana\b|(^|[^a-z0-9])dana([^a-z0-9]|$)/.test(text)) return "DANA";
    if (/\bovo\b|(^|[^a-z0-9])ovo([^a-z0-9]|$)/.test(text)) return "OVO";
    if (/go\s*pay|go-pay|gopay|gojek/.test(text)) return "GOPAY";
    if (/(^|[^a-z0-9])b\s*[~_-]?\s*yerepay|(^|[^a-z0-9])b\s*[~_-]?\s*paying|(^|[^a-z0-9])b\s*[~_-]?\s*kilipay|(^|[^a-z0-9])b\s*[~_-]?\s*click2?pay|bnin|bmri|brin|cena|virtual|va|bank|bni|bri|mandiri|permata|cimb|bca/.test(text)) return "银行代付";
    if (/(^|[^a-z0-9])e\s*[~_-]?\s*yerepay|(^|[^a-z0-9])e\s*[~_-]?\s*paying|(^|[^a-z0-9])e\s*[~_-]?\s*kilipay|(^|[^a-z0-9])e\s*[~_-]?\s*click2?pay|ewallet|wallet/.test(text)) return "钱包代付";
  }
  if (country.includes("马来")) {
    if (/telcom|telco/.test(text)) return "Telcom";
    if (/shopee|grab|boost/.test(text)) return "Shopee/Grab/Boost";
    if (/tng|touch\s*n\s*go|touchngo|duitnow|duit-now|qr|maybankqr/.test(text)) return "DUITNOW/QR";
    if (/fpx|bank|银行卡|银行/.test(text)) return "FPX-BANK";
  }
  return base;
}

function looksLikeFeeValue(value: string): boolean {
  const text = cleanFeeOrLimitValue(value);
  if (!text || isColumnOrLegendText(text)) return false;
  const status = normalizeStatus(text);
  if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) return false;
  if (/^[-–—]+$/.test(text)) return false;
  const percent = parsePercentFee(text);
  if (percent !== null && Math.abs(percent) > 50) return false;
  // 费率/手续费常见：0.30%、2.9TRX、3%+6 单笔、无、0.2%+10trx。
  if (/无|%|TRX|trx|单笔|笔/i.test(text)) return true;
  // 纯数字多数来自限额，只有 0.003 / 1.5 / 3 这类小数字才当费率兜底。
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) <= 10;
  return false;
}

function looksLikeLimitValue(value: string): boolean {
  const text = cleanFeeOrLimitValue(value);
  if (!text || isColumnOrLegendText(text)) return false;
  if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(normalizeStatus(text))) return false;
  if (/^\d+(?:\.\d+)?$/.test(text)) return true;
  return /\d+\s*[-–~至]\s*\d|\d+\s*[-–~至]\s*\d*\s*[wW万]|VND|BDT|INR|MMK|PHP|PKR|BRL|USD|USDT/i.test(text);
}

function cellLooksLikeSection(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return false;
  if (isStatusText(text)) return false;
  if (/^\d+(\.\d+)?%?$/.test(text)) return false;
  if (/^\d+\s*-\s*\d+/.test(text)) return false;
  return text.length <= 40;
}

function columnHasFeeValues(values: Values, headerIndex: number, col: number): boolean {
  let feeCount = 0;
  let statusCount = 0;
  for (let r = headerIndex + 1; r < Math.min(values.length, headerIndex + 160); r++) {
    const cell = get(values[r], col);
    if (!cell) continue;
    if (looksLikeFeeValue(cell)) feeCount += 1;
    if (/✅|☑|✔|❌|✖|⭕|开启|正常|暂停|备用|停用|未接入|维护|不支持|对接/.test(cell)) statusCount += 1;
  }
  return feeCount > 0 && feeCount >= Math.ceil(statusCount * 0.15);
}

function valueAtFirstFeeColumn(row: string[], headers: string[], cols: number[], fallbackWords: RegExp): string {
  for (const col of uniqueIndexes(cols)) {
    const value = cleanFeeOrLimitValue(get(row, col));
    if (looksLikeFeeValue(value)) return value;
  }
  for (let col = 0; col < row.length; col++) {
    const header = compact(headers[col] || "");
    if (!fallbackWords.test(header)) continue;
    if (/限制|限额|区间|范围|状态|备注|说明|白名单|漏洞/.test(header)) continue;
    const value = cleanFeeOrLimitValue(get(row, col));
    if (looksLikeFeeValue(value)) return value;
  }
  return "";
}


function parseCountryRateSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = findRateHeader(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };

  const headers = values[headerIndex].map(normalizeCell);
  const baseCountry = inferCountry(sheetName);

  const countryCol = findHeaderIndex(headers, ["国家", "国家/地区", "地区"]);
  const categoryCol = findHeaderIndex(headers, ["类型", "分类", "通道类型"]);
  const nameCols = findAllThirdPartyNameColumns(headers);
  const nameCol = nameCols[0] ?? -1;
  let totalFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["费率合计", "合计费率", "总费率", "总手续费", "总计"]),
    ...findTotalFeeColumnIndexes(headers)
  ]);
  let collectFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代收手续费", "代收费率", "代收率", "唤醒代收率", "收款手续费", "收款费率", "收款率", "代收", "收款"]),
    ...findFeeColumnIndexes(headers, "collect")
  ]);
  let payoutFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代付手续费", "代付费率", "代付率", "唤醒代付率", "付款手续费", "付款费率", "付款率", "代付", "付款", "出款"]),
    ...findFeeColumnIndexes(headers, "payout")
  ]);
  const collectSingleFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代收单笔", "代收单", "收款单笔", "收款单", "入款单笔", "充值单笔"]),
    ...findSingleFeeColumnIndexes(headers, "collect")
  ]);
  const payoutSingleFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代付单笔", "代付单", "付款单笔", "付款单", "出款单笔", "出款单", "提现单笔", "提现单", "提款单笔"]),
    ...findSingleFeeColumnIndexes(headers, "payout")
  ]);

  totalFeeCols = filterFeeColumns(headers, totalFeeCols, "total").filter((col) => /费率|手续费|合计|%|total/i.test(compact(headers[col] || "")) || columnHasFeeValues(values, headerIndex, col));
  collectFeeCols = filterFeeColumns(headers, collectFeeCols, "collect").filter((col) => /费率|手续费|合计|%|单笔|每笔|笔费|代收率|代付率|收款率|付款率|rate|fee/i.test(compact(headers[col] || "")) || columnHasFeeValues(values, headerIndex, col));
  payoutFeeCols = filterFeeColumns(headers, payoutFeeCols, "payout").filter((col) => /费率|手续费|合计|%|单笔|每笔|笔费|代收率|代付率|收款率|付款率|rate|fee/i.test(compact(headers[col] || "")) || columnHasFeeValues(values, headerIndex, col));
  const collectLimitCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代收限制", "代收限额", "代收区间", "收款限制", "收款限额", "收款区间", "代收最低限制", "代收最高限制", "代收最低限额", "代收最高限额"]),
    ...findHeaderIndexesByRegex(headers, /(代收|收款).*(最低|最高|最小|最大|下限|上限).*(限制|限额|区间|范围)?|(最低|最高|最小|最大|下限|上限).*(代收|收款)/i)
  ]);
  const payoutLimitCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代付限制", "代付限额", "代付区间", "出款限制", "出款限额", "出款区间", "代付最低限制", "代付最高限制", "代付最低限额", "代付最高限额"]),
    ...findHeaderIndexesByRegex(headers, /(代付|付款|出款).*(最低|最高|最小|最大|下限|上限).*(限制|限额|区间|范围)?|(最低|最高|最小|最大|下限|上限).*(代付|付款|出款)/i)
  ]);
  const collectMinCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代收|收款).*(最低|最小|下限)|(最低|最小|下限).*(代收|收款)/i));
  const collectMaxCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代收|收款).*(最高|最大|上限)|(最高|最大|上限).*(代收|收款)/i));
  const payoutMinCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代付|付款|出款).*(最低|最小|下限)|(最低|最小|下限).*(代付|付款|出款)/i));
  const payoutMaxCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代付|付款|出款).*(最高|最大|上限)|(最高|最大|上限).*(代付|付款|出款)/i));
  const totalFeeCol = totalFeeCols[0] ?? -1;
  const collectFeeCol = collectFeeCols[0] ?? -1;
  const payoutFeeCol = payoutFeeCols[0] ?? -1;
  const collectLimitCol = collectLimitCols[0] ?? -1;
  const payoutLimitCol = payoutLimitCols[0] ?? -1;
  const channelCol = findHeaderIndex(headers, ["通道情况"]);
  const leakCol = findHeaderIndex(headers, ["是否有漏洞"]);
  const whitelistCol = findHeaderIndex(headers, ["白名单"]);
  const statusCol = findUsableStatusColumn(headers);

  if (nameCol < 0) return { rates: [], statuses: [] };

  const nonPlatformCols = new Set<number>([
    countryCol,
    categoryCol,
    ...nameCols,
    totalFeeCol,
    collectFeeCol,
    payoutFeeCol,
    collectLimitCol,
    payoutLimitCol,
    channelCol,
    leakCol,
    whitelistCol,
    statusCol,
    ...totalFeeCols,
    ...collectFeeCols,
    ...payoutFeeCols,
    ...collectSingleFeeCols,
    ...payoutSingleFeeCols,
    ...collectLimitCols,
    ...payoutLimitCols,
    ...collectMinCols,
    ...collectMaxCols,
    ...payoutMinCols,
    ...payoutMaxCols
  ].filter((index) => index >= 0));

  const platformColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      if (index <= nameCol) return false;
      if (nonPlatformCols.has(index)) return false;
      if (isLegendStatusColumn(headers, index)) return false;
      if (!isValidPlatformName(header)) return false;
      // 真正的盘口列下面必须出现至少 1 个状态值；避免把右侧图例/备注列、费率列误判成盘口。
      let statusCells = 0;
      for (let rowIndex = headerIndex + 1; rowIndex < values.length; rowIndex++) {
        const cell = get(values[rowIndex], index);
        if (!cell) continue;
        const status = normalizeStatus(cell);
        if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) statusCells += 1;
      }
      return statusCells > 0;
    });

  const rates: ThirdPartyRateRow[] = [];
  const statuses: ThirdPartyPlatformStatusRow[] = [];
  let currentCategory = "";
  const fillColumns = uniqueIndexes([...collectFeeCols, ...payoutFeeCols, ...totalFeeCols, ...collectSingleFeeCols, ...payoutSingleFeeCols, ...collectLimitCols, ...payoutLimitCols, ...collectMinCols, ...collectMaxCols, ...payoutMinCols, ...payoutMaxCols]).filter((col) => col >= 0);
  const lastValues = new Map<number, string>();

  function getFilled(row: string[], col: number): string {
    if (col < 0) return "";
    const raw = get(row, col);
    if (raw) {
      lastValues.set(col, raw);
      return raw;
    }
    return fillColumns.includes(col) ? (lastValues.get(col) || "") : "";
  }

  function pickBestFilled(row: string[], cols: number[], fallbackCol: number): string {
    const candidates = [...cols, fallbackCol].filter((col, index, arr) => col >= 0 && arr.indexOf(col) === index);
    for (const col of candidates) {
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      // 只接受真正像费率/限额的值，不能把“代收手续费/代付手续费”这种表头文字当成数据。
      if (looksLikeFeeOrLimitValue(value) && !isColumnOrLegendText(value)) return value;
    }
    return "";
  }

  function scanFeeCandidates(row: string[]): string[] {
    const excluded = new Set<number>([categoryCol, nameCol, statusCol, channelCol, leakCol, whitelistCol, ...collectSingleFeeCols, ...payoutSingleFeeCols, ...collectLimitCols, ...payoutLimitCols, ...collectMinCols, ...collectMaxCols, ...payoutMinCols, ...payoutMaxCols].filter((col) => col >= 0));
    const candidates: string[] = [];
    for (let col = 0; col < row.length; col++) {
      if (excluded.has(col)) continue;
      const header = headers[col] || "";
      if (/限制|限额|区间|状态|通道|漏洞|白名单|备注|说明/i.test(header)) continue;
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      if (looksLikeFeeValue(value) && !isColumnOrLegendText(value)) candidates.push(value);
    }
    return Array.from(new Set(candidates));
  }

  function scanLimitCandidates(row: string[]): string[] {
    const excluded = new Set<number>([categoryCol, nameCol, statusCol, channelCol, leakCol, whitelistCol, ...collectFeeCols, ...payoutFeeCols, ...totalFeeCols, ...collectSingleFeeCols, ...payoutSingleFeeCols].filter((col) => col >= 0));
    const candidates: string[] = [];
    for (let col = 0; col < row.length; col++) {
      if (excluded.has(col)) continue;
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      if (looksLikeLimitValue(value) && !isColumnOrLegendText(value)) candidates.push(value);
    }
    return Array.from(new Set(candidates));
  }


  function readLabeledFee(row: string[], cols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const col of uniqueIndexes(cols)) {
      if (col < 0) continue;
      const raw = normalizeFeeVariant(getFilled(row, col));
      const value = cleanFeeOrLimitValue(raw);
      if (!looksLikeFeeValue(value)) continue;
      const label = feeVariantLabel(headers[col] || "", fallback);
      const text = label && label !== fallback ? `${label} ${value}` : value;
      const key = `${label}|||${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" / ");
  }

  function readLabeledSingleFee(row: string[], cols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const col of uniqueIndexes(cols)) {
      if (col < 0) continue;
      const raw = normalizeFeeVariant(getFilled(row, col));
      const value = cleanFeeOrLimitValue(raw);
      if (!value || isBadFormulaValue(value) || isColumnOrLegendText(value)) continue;
      const header = headers[col] || "";
      const label = feeVariantLabel(header, fallback);
      const text = label && label !== fallback ? `${label} ${value}` : value;
      const key = `${label}|||${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" / ");
  }

  function readLabeledLimit(row: string[], cols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const col of uniqueIndexes(cols)) {
      if (col < 0) continue;
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      if (!looksLikeLimitValue(value)) continue;
      const label = feeVariantLabel(headers[col] || "", fallback);
      const text = label && label !== fallback ? `${label} ${value}` : value;
      const key = `${label}|||${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" / ");
  }

  function readPairedLimit(row: string[], minCols: number[], maxCols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    const maxByLabel = new Map<string, string>();

    for (const maxCol of uniqueIndexes(maxCols)) {
      const maxValue = cleanFeeOrLimitValue(getFilled(row, maxCol));
      if (!looksLikeLimitValue(maxValue)) continue;
      const label = inferVariantLabel(headers[maxCol] || "", fallback);
      maxByLabel.set(label, maxValue);
    }

    for (const minCol of uniqueIndexes(minCols)) {
      const minValue = cleanFeeOrLimitValue(getFilled(row, minCol));
      if (!looksLikeLimitValue(minValue)) continue;
      const label = inferVariantLabel(headers[minCol] || "", fallback);
      const maxValue = maxByLabel.get(label) || (maxCols.length === 1 ? cleanFeeOrLimitValue(getFilled(row, maxCols[0])) : "");
      const joined = maxValue && looksLikeLimitValue(maxValue) ? `${minValue}-${maxValue}` : minValue;
      const text = label && label !== fallback ? `${label} ${joined}` : joined;
      const key = `${label}|||${joined}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }

    if (!parts.length && minCols.length && maxCols.length) {
      const minValue = cleanFeeOrLimitValue(getFilled(row, minCols[0]));
      const maxValue = cleanFeeOrLimitValue(getFilled(row, maxCols[0]));
      if (looksLikeLimitValue(minValue) || looksLikeLimitValue(maxValue)) parts.push([minValue, maxValue].filter(Boolean).join("-"));
    }

    return parts.join(" / ");
  }

  let currentThirdParty = "";
  let currentCountryText = "";

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const nonEmpty = row.map(normalizeCell).filter(Boolean).length;
    if (!nonEmpty) continue;

    const maybeCategory = categoryCol >= 0 ? get(row, categoryCol) : "";
    const rawCountry = countryCol >= 0 ? get(row, countryCol) : "";
    if (rawCountry && !isColumnOrLegendText(rawCountry)) currentCountryText = rawCountry;
    const rowCountry = resolveRateRowCountry(baseCountry, currentCountryText, sheetName);
    const rawThirdParty = get(row, nameCol);

    if (rawThirdParty && !looksLikeEntityName(rawThirdParty)) continue;
    if (rawThirdParty && isValidThirdPartyName(rawThirdParty)) currentThirdParty = rawThirdParty;

    const rawCanonicalThirdParty = rawThirdParty && isValidThirdPartyName(rawThirdParty) ? rawThirdParty : currentThirdParty;
    const thirdParty = canonicalThirdPartyName(rawCanonicalThirdParty, rowCountry);
    const dataCols = uniqueIndexes([...collectFeeCols, ...payoutFeeCols, ...totalFeeCols, ...collectSingleFeeCols, ...payoutSingleFeeCols, ...collectLimitCols, ...payoutLimitCols, ...collectMinCols, ...collectMaxCols, ...payoutMinCols, ...payoutMaxCols]);
    const hasUsefulCells = dataCols.some((col) => cleanFeeOrLimitValue(get(row, col)));

    if (!thirdParty || !isValidThirdPartyName(thirdParty)) {
      if (cellLooksLikeSection(maybeCategory || get(row, 0))) currentCategory = maybeCategory || get(row, 0);
      continue;
    }

    if (!rawThirdParty && !maybeCategory && !hasUsefulCells) continue;
    if (maybeCategory) currentCategory = maybeCategory;
    const inferredCategory = inferThirdPartyChannelType(rawCanonicalThirdParty || thirdParty, rowCountry, `${currentCategory} ${channelCol >= 0 ? get(row, channelCol) : ""} ${sheetName}`);
    const finalCategory = normalizeRateRowCategory(rowCountry, inferredCategory || currentCategory, thirdParty, sheetName);

    const status = normalizeStatus(statusCol >= 0 ? get(row, statusCol) : "");
    let collectFee = readLabeledFee(row, collectFeeCols, "代收") || pickBestFilled(row, collectFeeCols, collectFeeCol);
    let payoutFee = readLabeledFee(row, payoutFeeCols, "代付") || pickBestFilled(row, payoutFeeCols, payoutFeeCol);
    let explicitTotalFee = readLabeledFee(row, totalFeeCols, "合计") || pickBestFilled(row, totalFeeCols, totalFeeCol);
    const collectSingleFee = readLabeledSingleFee(row, collectSingleFeeCols, "代收单笔");
    const payoutSingleFee = readLabeledSingleFee(row, payoutSingleFeeCols, "代付单笔");
    let collectLimit = readPairedLimit(row, collectMinCols, collectMaxCols, "代收") || readLabeledLimit(row, collectLimitCols, "代收限制") || pickBestFilled(row, collectLimitCols, collectLimitCol);
    let payoutLimit = readPairedLimit(row, payoutMinCols, payoutMaxCols, "代付") || readLabeledLimit(row, payoutLimitCols, "代付限制") || pickBestFilled(row, payoutLimitCols, payoutLimitCol);

    // 兼容部分国家页签：表头只写“代收/代付”或多层合并标题，Google API 读取后列名会变空。
    // 如果指定列没有读到，就从当前行的费率/限额形态自动补齐，避免明明表里有费率但后台显示空白。
    if (!collectFee) collectFee = valueAtFirstFeeColumn(row, headers, collectFeeCols, /(代收|收款|入款|充值).*(费率|手续费|合计|%|单笔|每笔|笔费)|(费率|手续费|合计|%).*(代收|收款|入款|充值)/i);
    if (!payoutFee) payoutFee = valueAtFirstFeeColumn(row, headers, payoutFeeCols, /(代付|付款|出款|提款|提现).*(费率|手续费|合计|%|单笔|每笔|笔费)|(费率|手续费|合计|%).*(代付|付款|出款|提款|提现)/i);
    if (!explicitTotalFee) explicitTotalFee = valueAtFirstFeeColumn(row, headers, totalFeeCols, /(总|合计|费率合计|总手续费|total).*(费率|手续费|%|单笔|每笔|笔费)|(费率|手续费|%).*(总|合计|total)/i);
    if (!collectFee || !payoutFee || !explicitTotalFee) {
      const feeCandidates = scanFeeCandidates(row);
      // 最后兜底必须保守：只在当前方向没有任何表头可用时才补，防止把代收费率误塞到代付。
      if (!collectFee && collectFeeCols.length === 0 && feeCandidates.length === 1) collectFee = feeCandidates[0];
      if (!payoutFee && payoutFeeCols.length === 0 && /代付|付款|出款|提现|提款|payout|withdraw/i.test(`${currentCategory} ${sheetName}`) && feeCandidates.length === 1) payoutFee = feeCandidates[0];
      if (!explicitTotalFee && totalFeeCols.length === 0 && feeCandidates.length >= 2) explicitTotalFee = "";
    }
    if (!collectLimit || !payoutLimit) {
      const limitCandidates = scanLimitCandidates(row);
      if (!collectLimit && limitCandidates[0]) collectLimit = limitCandidates[0];
      if (!payoutLimit && limitCandidates[1]) payoutLimit = limitCandidates[1];
    }

    const rateRow: ThirdPartyRateRow = {
      id: `${sheetName}-${r}-${thirdParty}`,
      sheetName,
      country: rowCountry,
      category: finalCategory,
      thirdParty,
      collectFee,
      payoutFee,
      totalFee: inferTotalFee(collectFee, payoutFee, explicitTotalFee),
      collectSingleFee,
      payoutSingleFee,
      collectLimit,
      payoutLimit,
      channelInfo: channelCol >= 0 ? get(row, channelCol) : "",
      leak: leakCol >= 0 ? get(row, leakCol) : "",
      whitelist: whitelistCol >= 0 ? get(row, whitelistCol) : "",
      status,
      sourceRow: r + 1
    };
    rates.push(rateRow);

    // 费率表经常左右各有一列“三方”：左边是展示名/旧名，右边是统一名。
    // 同一行的费率要同时挂到两个名称上，避免页面三方量用其中一个名字时匹配不到费率。
    for (const aliasName of uniqueIndexes(nameCols).map((col) => get(row, col)).filter((name) => name && isValidThirdPartyName(name))) {
      const aliasThirdParty = canonicalThirdPartyName(aliasName, rowCountry);
      if (!aliasThirdParty || aliasThirdParty === thirdParty || !isValidThirdPartyName(aliasThirdParty)) continue;
      rates.push({
        ...rateRow,
        id: `${sheetName}-${r}-${aliasThirdParty}`,
        thirdParty: aliasThirdParty,
        channelInfo: [rateRow.channelInfo, thirdParty].filter(Boolean).join(" / ")
      });
    }

    for (const { header: platform, index } of platformColumns) {
      const raw = get(row, index);
      const platformStatus = normalizeStatus(raw);
      if (!raw && !platformStatus) continue;
      statuses.push({
        id: `${sheetName}-${r}-${index}`,
        sheetName,
        country: rowCountry,
        platform,
        thirdParty,
        status: platformStatus || raw,
        rawStatus: raw,
        collectFee: rateRow.collectFee,
        payoutFee: rateRow.payoutFee,
        totalFee: rateRow.totalFee,
        collectSingleFee: rateRow.collectSingleFee,
        payoutSingleFee: rateRow.payoutSingleFee,
        collectLimit: rateRow.collectLimit,
        payoutLimit: rateRow.payoutLimit,
        category: rateRow.category,
        sourceRow: r + 1,
        sourceColumn: index + 1
      });
    }
  }

  return { rates, statuses };
}

function findPlatformHeader(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 20); r++) {
    const first = compact(get(values[r], 0));
    const joined = values[r].map(compact).join("|");
    if ((first.includes("盘口") || first.includes("平台")) && (joined.includes("代收手续费") || joined.includes("代付手续费") || joined.includes("状态"))) return r;
  }
  return -1;
}

function parsePlatformMatrixSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = findPlatformHeader(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };

  const header = values[headerIndex].map(normalizeCell);
  const country = inferCountry(sheetName);
  const platformCol = 0;

  const groups: Array<{ thirdParty: string; statusCol: number; collectFeeCol?: number; payoutFeeCol?: number; collectSingleFeeCol?: number; payoutSingleFeeCol?: number; collectLimitCol?: number; payoutLimitCol?: number }> = [];
  for (let c = 1; c < header.length; c++) {
    const title = normalizeCell(header[c]);
    if (!isValidThirdPartyName(title)) continue;

    let collectFeeCol: number | undefined;
    let payoutFeeCol: number | undefined;
    let collectSingleFeeCol: number | undefined;
    let payoutSingleFeeCol: number | undefined;
    let collectLimitCol: number | undefined;
    let payoutLimitCol: number | undefined;

    for (let j = c + 1; j < Math.min(header.length, c + 8); j++) {
      const h = normalizeCell(header[j]);
      if (!h) continue;
      if (isValidThirdPartyName(h)) break;
      if (isSingleFeeHeader(h) && isCollectHeader(h) && collectSingleFeeCol === undefined) collectSingleFeeCol = j;
      else if (isSingleFeeHeader(h) && isPayoutHeader(h) && payoutSingleFeeCol === undefined) payoutSingleFeeCol = j;
      else if (!isSingleFeeHeader(h) && headerMatches(h, ["代收手续费", "代收费率"]) && collectFeeCol === undefined) collectFeeCol = j;
      else if (!isSingleFeeHeader(h) && headerMatches(h, ["代付手续费", "代付费率"]) && payoutFeeCol === undefined) payoutFeeCol = j;
      else if (headerMatches(h, ["代收限制", "代收限额", "收款限制"]) && collectLimitCol === undefined) collectLimitCol = j;
      else if (headerMatches(h, ["代付限制", "代付限额", "出款限制"]) && payoutLimitCol === undefined) payoutLimitCol = j;
    }

    groups.push({ thirdParty: canonicalThirdPartyName(title, country), statusCol: c, collectFeeCol, payoutFeeCol, collectSingleFeeCol, payoutSingleFeeCol, collectLimitCol, payoutLimitCol });
  }

  const ratesByThirdParty = new Map<string, ThirdPartyRateRow>();
  const statuses: ThirdPartyPlatformStatusRow[] = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const platform = get(row, platformCol);
    if (!looksLikeEntityName(platform)) continue;
    // 避免右侧说明表、图例、状态说明也被读进来。
    if (["状态", "状态备注内容", "运行中", "技术还在对接中", "盘口不支持接入", "三方都正常的情况下不开", "已经不再使用"].includes(platform)) continue;
    if (isStatusText(platform) || isColumnOrLegendText(platform)) continue;

    for (const group of groups) {
      const raw = get(row, group.statusCol);
      const status = normalizeStatus(raw);
      const collectFee = cleanFeeOrLimitValue(group.collectFeeCol !== undefined ? get(row, group.collectFeeCol) : "");
      const payoutFee = cleanFeeOrLimitValue(group.payoutFeeCol !== undefined ? get(row, group.payoutFeeCol) : "");
      const collectSingleFee = cleanFeeOrLimitValue(group.collectSingleFeeCol !== undefined ? get(row, group.collectSingleFeeCol) : "");
      const payoutSingleFee = cleanFeeOrLimitValue(group.payoutSingleFeeCol !== undefined ? get(row, group.payoutSingleFeeCol) : "");
      const collectLimit = cleanFeeOrLimitValue(group.collectLimitCol !== undefined ? get(row, group.collectLimitCol) : "");
      const payoutLimit = cleanFeeOrLimitValue(group.payoutLimitCol !== undefined ? get(row, group.payoutLimitCol) : "");
      if (!raw && !collectFee && !payoutFee && !collectSingleFee && !payoutSingleFee && !collectLimit && !payoutLimit) continue;

      const existing = ratesByThirdParty.get(group.thirdParty);
      if (!existing && (collectFee || payoutFee || collectSingleFee || payoutSingleFee || collectLimit || payoutLimit || status)) {
        ratesByThirdParty.set(group.thirdParty, {
          id: `${sheetName}-${group.thirdParty}`,
          sheetName,
          country,
          category: "",
          thirdParty: group.thirdParty,
          collectFee,
          payoutFee,
          totalFee: inferTotalFee(collectFee, payoutFee, ""),
          collectSingleFee,
          payoutSingleFee,
          collectLimit,
          payoutLimit,
          channelInfo: "",
          leak: "",
          whitelist: "",
          status,
          sourceRow: headerIndex + 1
        });
      } else if (existing) {
        if (!existing.collectFee && collectFee) existing.collectFee = collectFee;
        if (!existing.payoutFee && payoutFee) existing.payoutFee = payoutFee;
        if (!existing.collectSingleFee && collectSingleFee) existing.collectSingleFee = collectSingleFee;
        if (!existing.payoutSingleFee && payoutSingleFee) existing.payoutSingleFee = payoutSingleFee;
        if (!existing.collectLimit && collectLimit) existing.collectLimit = collectLimit;
        if (!existing.payoutLimit && payoutLimit) existing.payoutLimit = payoutLimit;
        if (!existing.totalFee) existing.totalFee = inferTotalFee(existing.collectFee, existing.payoutFee, "");
        if (!existing.status && status) existing.status = status;
      }

      statuses.push({
        id: `${sheetName}-${r}-${group.statusCol}`,
        sheetName,
        country,
        platform,
        thirdParty: group.thirdParty,
        status: status || raw,
        rawStatus: raw,
        collectFee,
        payoutFee,
        totalFee: inferTotalFee(collectFee, payoutFee, ""),
        collectSingleFee,
        payoutSingleFee,
        collectLimit,
        payoutLimit,
        category: "",
        sourceRow: r + 1,
        sourceColumn: group.statusCol + 1
      });
    }
  }

  return { rates: Array.from(ratesByThirdParty.values()), statuses };
}


// V105: 直接按 Google 费率表表头读取费率。这个解析器只负责费率本身，避免旧矩阵/状态解析把费率列误判成盘口状态。
function directHeaderIndex(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 8); r++) {
    const cells = (values[r] || []).map(compact);
    const hasName = cells.some((cell) => cell === "三方" || cell === "三方名称" || cell === "三方名");
    const hasFee = cells.some((cell) => /代收合计|代付合计|代收费率|代付费率|代收手续费|代付手续费|费率合计|合计费率|easy代收|jazz代收/i.test(cell));
    if (hasName && hasFee) return r;
  }
  return -1;
}

function directHeaderLooksLikeName(header: string): boolean {
  const clean = compact(header);
  return clean === "三方" || clean === "三方名称" || clean === "三方名";
}

function directClean(value: string): string {
  const text = cleanFeeOrLimitValue(value);
  if (!text || isBadFormulaValue(text) || isColumnOrLegendText(text)) return "";
  return text;
}

function directHeaderFind(headers: string[], pattern: RegExp, reject?: RegExp): number[] {
  return headers
    .map((header, index) => ({ header, clean: compact(header), index }))
    .filter(({ clean }) => clean && pattern.test(clean) && !(reject && reject.test(clean)))
    .map(({ index }) => index);
}

function directPick(row: string[], headers: string[], patterns: RegExp[], reject?: RegExp): string {
  const seen = new Set<number>();
  for (const pattern of patterns) {
    for (const col of directHeaderFind(headers, pattern, reject)) {
      if (seen.has(col)) continue;
      seen.add(col);
      const value = directClean(get(row, col));
      if (value) return value;
    }
  }
  return "";
}

function directPickLimit(row: string[], headers: string[], minPattern: RegExp, maxPattern: RegExp, singlePattern: RegExp): string {
  const single = directPick(row, headers, [singlePattern]);
  const min = directPick(row, headers, [minPattern]);
  const max = directPick(row, headers, [maxPattern]);
  if (min || max) return [min, max].filter(Boolean).join("-");
  return single;
}

function directPickByHeader(row: string[], headers: string[], matcher: (clean: string) => boolean): string {
  for (let index = 0; index < headers.length; index++) {
    const clean = compact(headers[index] || "").toLowerCase();
    if (!clean || !matcher(clean)) continue;
    const value = directClean(get(row, index));
    if (value) return value;
  }
  return "";
}

function directPickByHeaderContains(row: string[], headers: string[], includes: string[], rejects: string[] = []): string {
  const wants = includes.map((item) => compact(item).toLowerCase()).filter(Boolean);
  const bads = rejects.map((item) => compact(item).toLowerCase()).filter(Boolean);
  return directPickByHeader(row, headers, (clean) => wants.every((item) => clean.includes(item)) && !bads.some((item) => clean.includes(item)));
}

function normalizePakistanWalletLabel(value: string): string {
  const text = normalizeCell(value).toLowerCase();
  if (/jazz/.test(text)) return "JAZZCASH";
  if (/easy|easypaisa|wallet2|\bep\b/.test(text)) return "EASYPAISA";
  return value;
}

function collectPakistanVariant(row: string[], headers: string[], variant: "easy" | "jazz") {
  const label = variant === "easy" ? "EASYPAISA" : "JAZZCASH";
  const token = variant;
  const totalFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /合计|总/.test(clean) && !/限制|限额|最低|最高|状态|备注|白名单|漏洞/.test(clean));
  let collectFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代收|收款|入款|充值/.test(clean) && !/限制|限额|最低|最高|状态|备注|白名单|漏洞/.test(clean));
  let payoutFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代付|付款|出款|提现|提款/.test(clean) && !/限制|限额|最低|最高|状态|备注|白名单|漏洞/.test(clean));
  // 有些巴基斯坦表只在 Easy/Jazz 合计列填值，代收/代付分列留空；列表总览先显示合计，展开再看钱包类型。
  if (!collectFee) collectFee = directPickByHeaderContains(row, headers, [token, "代收"]);
  if (!payoutFee) payoutFee = directPickByHeaderContains(row, headers, [token, "代付"]);
  const collectSingleFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代收.*单|收款.*单|入款.*单|充值.*单/.test(clean));
  const payoutSingleFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代付.*单|付款.*单|出款.*单|提现.*单|提款.*单/.test(clean));
  const collectLimit = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代收|收款|入款|充值/.test(clean) && /限制|限额|最低|最高|最小|最大|下限|上限/.test(clean));
  const payoutLimit = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代付|付款|出款|提现|提款/.test(clean) && /限制|限额|最低|最高|最小|最大|下限|上限/.test(clean));
  return { label, collectFee, payoutFee, totalFee, collectSingleFee, payoutSingleFee, collectLimit, payoutLimit };
}

function directNormalizeCategory(country: string, rawCategory: string, thirdParty: string, rowText: string, sheetName: string): string {
  const base = normalizeCell(rawCategory);
  const southAmericaCategory = normalizeSouthAmericaRateCategory(country, base, rowText);
  if (southAmericaCategory) return southAmericaCategory;
  if (country.includes("巴基斯坦")) {
    const pakistanText = `${base} ${rowText}`;
    if (/jazz|jazzcash/i.test(pakistanText)) return "JAZZCASH";
    if (/easy|easypaisa|wallet2|\bep\b/i.test(pakistanText)) return "EASYPAISA";
  }
  const inferred = inferThirdPartyChannelType(`${thirdParty} ${base}`, country, `${rowText} ${sheetName}`);
  return normalizeRateRowCategory(country, inferred || base, thirdParty, sheetName);
}

function directRateRow(
  sheetName: string,
  country: string,
  sourceRow: number,
  rawCategory: string,
  rawThirdParty: string,
  collectFee: string,
  payoutFee: string,
  totalFee: string,
  collectSingleFee: string,
  payoutSingleFee: string,
  collectLimit: string,
  payoutLimit: string,
  rowText: string,
  status: string
): ThirdPartyRateRow | null {
  if (!rawThirdParty || !isValidThirdPartyName(rawThirdParty)) return null;
  const thirdParty = canonicalThirdPartyName(rawThirdParty, country);
  if (!thirdParty || !isValidThirdPartyName(thirdParty)) return null;
  const category = directNormalizeCategory(country, rawCategory, thirdParty, rowText, sheetName);
  return {
    id: `${sheetName}-direct-${sourceRow}-${thirdParty}-${category || "all"}-${collectFee}-${payoutFee}`,
    sheetName,
    country,
    category,
    thirdParty,
    collectFee,
    payoutFee,
    totalFee: inferTotalFee(collectFee, payoutFee, totalFee),
    collectSingleFee,
    payoutSingleFee,
    collectLimit,
    payoutLimit,
    channelInfo: "Google费率表直读",
    leak: "",
    whitelist: "",
    status,
    sourceRow
  };
}

function parseDirectGoogleRateSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = directHeaderIndex(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };
  const headers = (values[headerIndex] || []).map(normalizeCell);
  const baseCountry = inferCountry(sheetName);
  const countryCol = findHeaderIndex(headers, ["国家", "国家/地区", "地区"]);
  const nameCols = headers.map((header, index) => directHeaderLooksLikeName(header) ? index : -1).filter((index) => index >= 0);
  if (!nameCols.length) return { rates: [], statuses: [] };

  const categoryCol = findHeaderIndex(headers, ["类型", "钱包", "通道类型", "分类"]);
  const statusCol = findUsableStatusColumn(headers);
  const rates: ThirdPartyRateRow[] = [];
  let currentCategory = "";
  let currentCountryText = "";

  const addRateWithAliases = (row: string[], sourceRow: number, rowCountry: string, category: string, rawName: string, collectFee: string, payoutFee: string, totalFee: string, collectSingleFee: string, payoutSingleFee: string, collectLimit: string, payoutLimit: string, status: string) => {
    const rowText = row.map(normalizeCell).filter(Boolean).join(" ");
    const base = directRateRow(sheetName, rowCountry, sourceRow, category, rawName, collectFee, payoutFee, totalFee, collectSingleFee, payoutSingleFee, collectLimit, payoutLimit, rowText, status);
    if (!base) return;
    rates.push(base);
    for (const col of nameCols) {
      const alias = get(row, col);
      if (!alias || alias === rawName || !isValidThirdPartyName(alias)) continue;
      const aliasName = canonicalThirdPartyName(alias, rowCountry);
      if (!aliasName || aliasName === base.thirdParty || !isValidThirdPartyName(aliasName)) continue;
      rates.push({ ...base, id: `${sheetName}-direct-${sourceRow}-${aliasName}-${base.category || "all"}`, thirdParty: aliasName, channelInfo: `Google费率表直读 / ${base.thirdParty}` });
    }
  };

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (!row.some((cell) => normalizeCell(cell))) continue;
    const rowText = row.map(normalizeCell).filter(Boolean).join(" ");
    const rawCountry = countryCol >= 0 ? get(row, countryCol) : "";
    if (rawCountry && !isColumnOrLegendText(rawCountry)) currentCountryText = rawCountry;
    const rowCountry = resolveRateRowCountry(baseCountry, currentCountryText, sheetName);
    const rawCategory = categoryCol >= 0 ? get(row, categoryCol) : "";
    if (rawCategory && !isColumnOrLegendText(rawCategory) && !isStatusText(rawCategory)) currentCategory = rawCategory;

    const names = nameCols.map((col) => get(row, col)).filter((name) => name && isValidThirdPartyName(name));
    if (!names.length) continue;
    const rawName = names[names.length - 1] || names[0];
    const status = normalizeStatus(statusCol >= 0 ? get(row, statusCol) : "");

    if (rowCountry.includes("巴基斯坦")) {
      const easy = collectPakistanVariant(row, headers, "easy");
      const jazz = collectPakistanVariant(row, headers, "jazz");
      const variants = [easy, jazz].filter((item) => item.collectFee || item.payoutFee || item.totalFee || item.collectSingleFee || item.payoutSingleFee || item.collectLimit || item.payoutLimit);

      if (variants.length) {
        for (const item of variants) {
          addRateWithAliases(
            row,
            r + 1,
            rowCountry,
            normalizePakistanWalletLabel(item.label),
            rawName,
            item.collectFee,
            item.payoutFee,
            item.totalFee,
            item.collectSingleFee,
            item.payoutSingleFee,
            item.collectLimit,
            item.payoutLimit,
            status
          );
        }
        continue;
      }
    }

    const collectFee = directPick(row, headers, [
      /代收合计.*单笔/i,
      /代收手续费|代收费率|收款手续费|收款费率|入款手续费|充值手续费/i
    ], /限制|限额|最低|最高/i);
    const payoutFee = directPick(row, headers, [
      /代付合计.*单笔/i,
      /代付手续费|代付费率|付款手续费|付款费率|出款手续费|提现手续费/i
    ], /限制|限额|最低|最高/i);
    const totalFee = directPick(row, headers, [/费率合计|合计费率|总费率|总手续费|合计.*单笔/i], /限制|限额|最低|最高/i);
    const collectSingleFee = directPick(row, headers, [/代收单笔|代收单$|收款单笔|收款单$|入款单笔|充值单笔/i]);
    const payoutSingleFee = directPick(row, headers, [/代付单笔|代付单$|付款单笔|付款单$|出款单笔|出款单$|提现单笔|提现单$/i]);
    const collectLimit = directPickLimit(row, headers, /代收.*(最低|最小|下限)|收款.*(最低|最小|下限)/i, /代收.*(最高|最大|上限)|收款.*(最高|最大|上限)/i, /代收.*(限制|限额|区间)|收款.*(限制|限额|区间)/i);
    const payoutLimit = directPickLimit(row, headers, /代付.*(最低|最小|下限)|付款.*(最低|最小|下限)|出款.*(最低|最小|下限)/i, /代付.*(最高|最大|上限)|付款.*(最高|最大|上限)|出款.*(最高|最大|上限)/i, /代付.*(限制|限额|区间)|付款.*(限制|限额|区间)|出款.*(限制|限额|区间)/i);

    if (!collectFee && !payoutFee && !totalFee && !collectSingleFee && !payoutSingleFee) continue;
    addRateWithAliases(row, r + 1, rowCountry, currentCategory, rawName, collectFee, payoutFee, totalFee, collectSingleFee, payoutSingleFee, collectLimit, payoutLimit, status);
  }

  return { rates, statuses: [] };
}

function dedupeRows<T extends { id: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, row);
  return Array.from(map.values());
}

function feeKey(country: string, thirdParty: string, category = ""): string {
  return `${country}|||${thirdParty}|||${category || ""}`;
}

function fillMissingFeeData(rates: ThirdPartyRateRow[], statuses: ThirdPartyPlatformStatusRow[]) {
  const map = new Map<string, { collectFee: string; payoutFee: string; totalFee: string; collectSingleFee: string; payoutSingleFee: string; collectLimit: string; payoutLimit: string; category: string; status: string }>();

  function remember(row: { country: string; thirdParty: string; collectFee: string; payoutFee: string; totalFee: string; collectSingleFee?: string; payoutSingleFee?: string; collectLimit: string; payoutLimit: string; category?: string; status?: string }) {
    const key = feeKey(row.country, row.thirdParty, row.category || "");
    const current = map.get(key) || { collectFee: "", payoutFee: "", totalFee: "", collectSingleFee: "", payoutSingleFee: "", collectLimit: "", payoutLimit: "", category: "", status: "" };
    if (!current.collectFee && row.collectFee) current.collectFee = row.collectFee;
    if (!current.payoutFee && row.payoutFee) current.payoutFee = row.payoutFee;
    if (!current.totalFee && row.totalFee) current.totalFee = row.totalFee;
    if (!current.collectSingleFee && row.collectSingleFee) current.collectSingleFee = row.collectSingleFee;
    if (!current.payoutSingleFee && row.payoutSingleFee) current.payoutSingleFee = row.payoutSingleFee;
    if (!current.collectLimit && row.collectLimit) current.collectLimit = row.collectLimit;
    if (!current.payoutLimit && row.payoutLimit) current.payoutLimit = row.payoutLimit;
    if (!current.category && row.category) current.category = row.category;
    if (!current.status && row.status) current.status = row.status;
    map.set(key, current);
  }

  rates.forEach(remember);
  statuses.forEach(remember);

  const filledRates = rates.map((row) => {
    const fee = map.get(feeKey(row.country, row.thirdParty, row.category || "")) || map.get(feeKey(row.country, row.thirdParty, ""));
    if (!fee) return row;
    const collectFee = row.collectFee || fee.collectFee;
    const payoutFee = row.payoutFee || fee.payoutFee;
    return {
      ...row,
      collectFee,
      payoutFee,
      totalFee: row.totalFee || fee.totalFee || inferTotalFee(collectFee, payoutFee, ""),
      collectSingleFee: row.collectSingleFee || fee.collectSingleFee,
      payoutSingleFee: row.payoutSingleFee || fee.payoutSingleFee,
      collectLimit: row.collectLimit || fee.collectLimit,
      payoutLimit: row.payoutLimit || fee.payoutLimit,
      category: row.category || fee.category,
      status: row.status || fee.status
    };
  });

  const filledStatuses = statuses.map((row) => {
    const fee = map.get(feeKey(row.country, row.thirdParty, row.category || "")) || map.get(feeKey(row.country, row.thirdParty, ""));
    if (!fee) return row;
    const collectFee = row.collectFee || fee.collectFee;
    const payoutFee = row.payoutFee || fee.payoutFee;
    return {
      ...row,
      collectFee,
      payoutFee,
      totalFee: row.totalFee || fee.totalFee || inferTotalFee(collectFee, payoutFee, ""),
      collectSingleFee: row.collectSingleFee || fee.collectSingleFee,
      payoutSingleFee: row.payoutSingleFee || fee.payoutSingleFee,
      collectLimit: row.collectLimit || fee.collectLimit,
      payoutLimit: row.payoutLimit || fee.payoutLimit,
      category: row.category || fee.category
    };
  });

  return { rates: filledRates, statuses: filledStatuses };
}

function summarizeStatuses(rows: ThirdPartyPlatformStatusRow[]) {
  const statusCounts: Record<string, number> = {};
  const platformSet = new Set<string>();
  const thirdPartySet = new Set<string>();
  const sheetSet = new Set<string>();

  for (const row of rows) {
    const status = row.status || "未知";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (row.platform) platformSet.add(`${row.country}|||${row.platform}`);
    if (row.thirdParty) thirdPartySet.add(row.thirdParty);
    if (row.sheetName) sheetSet.add(row.sheetName);
  }

  return {
    totalStatusCells: rows.length,
    totalPlatforms: platformSet.size,
    totalThirdParties: thirdPartySet.size,
    totalSheets: sheetSet.size,
    statusCounts,
    openCount: (statusCounts["开启"] || 0) + (statusCounts["正常"] || 0),
    pauseCount: statusCounts["暂停"] || 0,
    backupCount: statusCounts["备用"] || 0,
    disabledCount: statusCounts["停用"] || 0,
    notConnectedCount: statusCounts["未接入"] || 0,
    maintenanceCount: statusCounts["维护"] || 0,
    unsupportedCount: statusCounts["不支持"] || 0
  };
}

function buildAnomalies(rates: ThirdPartyRateRow[], statuses: ThirdPartyPlatformStatusRow[]): string[] {
  const anomalies: string[] = [];
  const statusSummary = new Map<string, { total: number; open: number; paused: number; stopped: number; notConnected: number }>();

  for (const row of statuses) {
    const key = `${row.country} ${row.platform}`;
    const item = statusSummary.get(key) || { total: 0, open: 0, paused: 0, stopped: 0, notConnected: 0 };
    item.total += 1;
    if (row.status === "开启" || row.status === "正常") item.open += 1;
    if (row.status === "暂停") item.paused += 1;
    if (row.status === "停用" || row.status === "维护" || row.status === "不支持") item.stopped += 1;
    if (row.status === "未接入") item.notConnected += 1;
    statusSummary.set(key, item);
  }

  for (const [key, item] of Array.from(statusSummary.entries())) {
    const country = key.split(" ")[0] || "";
    if (isUsdtCountry(country)) {
      // USDT 通道本来就只有 2-3 个渠道，不要因为“可用少”误报；只有一个可用渠道都没有才提醒。
      if (item.total > 0 && item.open <= 0) anomalies.push(`[USDT可用为0] ${key}：USDT 可用渠道为 0/${item.total}，需要马上检查。`);
      continue;
    }
    if (item.total >= 3 && item.open <= 2) anomalies.push(`[少接入] ${key}：可用三方仅 ${item.open}/${item.total} 个，建议补充备用通道。`);
    if (item.paused >= 3) anomalies.push(`[暂停较多] ${key}：暂停三方 ${item.paused} 个，需确认是否影响出入款。`);
    if (item.notConnected >= Math.max(3, Math.ceil(item.total * 0.5))) anomalies.push(`[未接入较多] ${key}：未接入较多 ${item.notConnected}/${item.total}。`);
  }

  for (const row of rates) {
    if (isUsdtCountry(row.country)) continue;
    if (isHighFeeRow(row)) {
      const feeSummary = [
        row.collectFee ? `代收 ${row.collectFee}` : "",
        row.payoutFee ? `代付 ${row.payoutFee}` : "",
        row.totalFee ? `合计 ${row.totalFee}` : "",
        row.collectSingleFee ? `代收单笔 ${row.collectSingleFee}` : "",
        row.payoutSingleFee ? `代付单笔 ${row.payoutSingleFee}` : ""
      ].filter(Boolean).join(" / ");
      anomalies.push(`[费率偏高] ${row.country} ${row.thirdParty}：费率偏高（${feeSummary}）。`);
    }
    if (row.status === "暂停" || row.status === "停用" || row.status === "维护") anomalies.push(`[状态异常] ${row.country} ${row.thirdParty}：当前状态为 ${row.status}。`);
  }

  return Array.from(new Set(anomalies)).slice(0, 200);
}


// V166: 全局费率表直读解析器。按 Google 费率表字段读取，不按国家猜列；支持 USDT/印度线下/巴西/越南/菲律宾/印尼/马来/巴基斯坦/南美/缅甸/尼日利亚。
function v166FindHeaderIndex(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 12); r++) {
    const cells = (values[r] || []).map(compact);
    const hasName = cells.some((cell) => cell === "三方" || cell === "三方名称" || cell === "三方名");
    const hasRate = cells.some((cell) => /合计%?\+?单笔|费率合计|合计费率|代收合计|代付合计|代收手续费|代付手续费|代收费率|代付费率|单笔|最低限制|最高限制|最低限额|最高限额/.test(cell));
    if (hasName && hasRate) return r;
  }
  return -1;
}

function v166HeaderKey(header: string): string {
  return compact(header).toLowerCase();
}

function v166HeaderExact(headers: string[], names: string[], maxIndex = Number.MAX_SAFE_INTEGER): number {
  const keys = names.map((name) => v166HeaderKey(name));
  for (let i = 0; i < headers.length && i <= maxIndex; i++) {
    const h = v166HeaderKey(headers[i] || "");
    if (keys.includes(h)) return i;
  }
  return -1;
}

function v166HeaderFind(headers: string[], matcher: (key: string, raw: string, index: number) => boolean, maxIndex = Number.MAX_SAFE_INTEGER): number {
  for (let i = 0; i < headers.length && i <= maxIndex; i++) {
    const raw = headers[i] || "";
    const key = v166HeaderKey(raw);
    if (key && matcher(key, raw, i)) return i;
  }
  return -1;
}

function v166HeaderFindAll(headers: string[], matcher: (key: string, raw: string, index: number) => boolean, maxIndex = Number.MAX_SAFE_INTEGER): number[] {
  const out: number[] = [];
  for (let i = 0; i < headers.length && i <= maxIndex; i++) {
    const raw = headers[i] || "";
    const key = v166HeaderKey(raw);
    if (key && matcher(key, raw, i)) out.push(i);
  }
  return out;
}

function v166IsSupportSwitchHeader(header: string): boolean {
  const key = v166HeaderKey(header);
  return /^(代收|代付|收款|付款|easy代收|jazz代收|easy代付|jazz代付|银行卡代收|银行卡代付)$/.test(key);
}

function v166IsDataHeader(header: string): boolean {
  const key = v166HeaderKey(header);
  if (!key) return false;
  if (v166IsSupportSwitchHeader(header)) return true;
  return /三方|类型|通道|费率|手续费|合计|单笔|最低|最高|限制|限额|结算|状态|备注|漏洞|白名单|授信|公户|打款|金额|通知|账号|utr|ifsc|小数点|转移资金|是否/.test(key);
}

function v166DataBoundary(headers: string[], headerIndex: number, values: Values): number {
  let maxData = 0;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] || "";
    if (v166IsDataHeader(h)) maxData = Math.max(maxData, i);
  }
  // 第一批真正盘口列之前通常就是费率资料区结束；若右侧还有“状态/备注”图例，不算主资料区。
  for (let i = 0; i < headers.length; i++) {
    if (!isValidPlatformName(headers[i] || "")) continue;
    if (v166IsDataHeader(headers[i] || "")) continue;
    let hits = 0;
    for (let r = headerIndex + 1; r < Math.min(values.length, headerIndex + 80); r++) {
      const status = normalizeStatus(get(values[r], i));
      if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) hits += 1;
    }
    if (hits > 0) return Math.max(0, i - 1);
  }
  return maxData || Math.min(headers.length - 1, 18);
}

function v166Pick(row: string[], col: number): string {
  if (col < 0) return "";
  const value = directClean(get(row, col));
  return value;
}

function v166PickFirst(row: string[], cols: number[]): string {
  for (const col of uniqueIndexes(cols)) {
    const value = v166Pick(row, col);
    if (value) return value;
  }
  return "";
}

function v166LimitPair(row: string[], minCol: number, maxCol: number, singleCol = -1): string {
  const single = v166Pick(row, singleCol);
  if (single) return single;
  const min = v166Pick(row, minCol);
  const max = v166Pick(row, maxCol);
  if (min || max) {
    if (min && max && min === max && /^(没有|无|-|—)$/.test(min)) return min;
    return [min, max].filter(Boolean).join("-");
  }
  return "";
}

function v166NormalizeCountry(baseCountry: string, rawCountry: string, sheetName: string): string {
  const country = resolveRateRowCountry(baseCountry, rawCountry, sheetName);
  if (country === "印度线下") return "印度";
  return country;
}

function v166NormalizeCategory(country: string, rawCategory: string, thirdParty: string, rowText: string, sheetName: string): string {
  const category = directNormalizeCategory(country, rawCategory, thirdParty, rowText, sheetName);
  if (country.includes("印度") && (!category || category.includes("线下") || category.includes("其他"))) return "UPI";
  return category;
}

function isShortNormalizedStatus(value: string): boolean {
  return /^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(normalizeCell(value));
}

function v166StatusFromRow(row: string[], headers: string[], preferredStatusCol: number, fallbackText = ""): string {
  const preferred = normalizeStatus(preferredStatusCol >= 0 ? get(row, preferredStatusCol) : "");
  if (isShortNormalizedStatus(preferred)) return preferred;
  const statusLike = v166HeaderFind(headers, (key) => key === "状态" || key === "当前状态" || key === "通道状态");
  const fallbackStatus = normalizeStatus(statusLike >= 0 ? get(row, statusLike) : "");
  if (isShortNormalizedStatus(fallbackStatus)) return fallbackStatus;
  const normalizedFallback = normalizeStatus(fallbackText);
  return isShortNormalizedStatus(normalizedFallback) ? normalizedFallback : "";
}

function v166ConcatInfo(parts: Array<[string, string]>): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [label, value] of parts) {
    const v = normalizeCell(value);
    if (!v) continue;
    const text = label ? `${label}: ${v}` : v;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.join(" / ");
}

function v166MainNameCols(headers: string[], dataBoundary: number): number[] {
  const max = Math.min(dataBoundary, 12);
  const cols = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => index <= max && directHeaderLooksLikeName(header))
    .map(({ index }) => index);
  return cols.length ? cols : headers.map((header, index) => directHeaderLooksLikeName(header) ? index : -1).filter((index) => index >= 0 && index <= dataBoundary);
}

function v166PlatformColumns(headers: string[], subHeaders: string[], dataBoundary: number, headerIndex: number, values: Values): Array<{ platform: string; col: number }> {
  const cols: Array<{ platform: string; col: number }> = [];
  let carryPlatform = "";
  for (let col = dataBoundary + 1; col < headers.length; col++) {
    const top = normalizeCell(headers[col] || "");
    const sub = normalizeCell(subHeaders[col] || "");
    if (top && isValidPlatformName(top) && !v166IsDataHeader(top)) carryPlatform = top;

    let platform = "";
    if (top && isValidPlatformName(top) && !v166IsDataHeader(top)) platform = top;
    else if (!top && carryPlatform && /^(代收|代付|收款|付款)$/i.test(sub)) platform = `${carryPlatform} ${sub}`;
    else if (top && carryPlatform && /^(代收|代付|收款|付款)$/i.test(sub)) platform = `${top} ${sub}`;

    if (!platform || !isValidPlatformName(platform)) continue;
    let statusHits = 0;
    for (let r = headerIndex + 1; r < Math.min(values.length, headerIndex + 180); r++) {
      const status = normalizeStatus(get(values[r], col));
      if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) statusHits += 1;
    }
    if (statusHits > 0) cols.push({ platform, col });
  }
  return cols;
}

function v166AddAliases(rates: ThirdPartyRateRow[], base: ThirdPartyRateRow, row: string[], nameCols: number[], country: string) {
  for (const col of uniqueIndexes(nameCols)) {
    const aliasRaw = get(row, col);
    if (!aliasRaw || !isValidThirdPartyName(aliasRaw)) continue;
    const alias = canonicalThirdPartyName(aliasRaw, country);
    if (!alias || alias === base.thirdParty || !isValidThirdPartyName(alias)) continue;
    rates.push({
      ...base,
      id: `${base.id}-alias-${col}-${alias}`,
      thirdParty: alias,
      channelInfo: [base.channelInfo, `别名: ${base.thirdParty}`].filter(Boolean).join(" / ")
    });
  }
}

function v166ParsePakistanSheet(sheetName: string, values: Values, headerIndex: number): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headers = (values[headerIndex] || []).map(normalizeCell);
  const subHeaders = (values[headerIndex + 1] || []).map(normalizeCell);
  const country = "巴基斯坦";
  const dataBoundary = v166DataBoundary(headers, headerIndex, values);
  const nameCols = v166MainNameCols(headers, dataBoundary);
  const nameCol = nameCols[nameCols.length - 1] ?? nameCols[0] ?? -1;
  if (nameCol < 0) return { rates: [], statuses: [] };

  const supportEasyCollectCol = v166HeaderExact(headers, ["Easy代收"], dataBoundary);
  const supportJazzCollectCol = v166HeaderExact(headers, ["Jazz代收"], dataBoundary);
  const supportEasyPayoutCol = v166HeaderExact(headers, ["Easy代付"], dataBoundary);
  const supportJazzPayoutCol = v166HeaderExact(headers, ["Jazz代付"], dataBoundary);

  const collectMinCol = v166HeaderFind(headers, (key) => /代收.*(最低|最小|下限)/.test(key), dataBoundary);
  const collectMaxCol = v166HeaderFind(headers, (key) => /代收.*(最高|最大|上限)/.test(key), dataBoundary);
  const payoutMinCol = v166HeaderFind(headers, (key) => /代付.*(最低|最小|下限)/.test(key), dataBoundary);
  const payoutMaxCol = v166HeaderFind(headers, (key) => /代付.*(最高|最大|上限)/.test(key), dataBoundary);
  const collectStatusCol = v166HeaderExact(headers, ["代收情况"], dataBoundary);
  const payoutStatusCol = v166HeaderExact(headers, ["代付情况"], dataBoundary);
  const leakCol = v166HeaderFind(headers, (key) => /漏洞/.test(key), dataBoundary);
  const whitelistCol = v166HeaderFind(headers, (key) => /白名单/.test(key), dataBoundary);
  const scanCollectCol = v166HeaderFind(headers, (key) => /easy.*扫码.*代收|扫码.*easy.*代收/.test(key), dataBoundary);
  const totalStatusCol = findUsableStatusColumn(headers);
  const noteCol = v166HeaderFind(headers, (key) => /状态备注/.test(key));
  const platformCols = v166PlatformColumns(headers, subHeaders, dataBoundary, headerIndex, values);

  const variants = [
    {
      label: "EASYPAISA",
      supportCollectCol: supportEasyCollectCol,
      supportPayoutCol: supportEasyPayoutCol,
      totalCol: v166HeaderFind(headers, (key) => /合计.*easy|easy.*合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectFeeCol: v166HeaderFind(headers, (key) => /代收合计.*easy|easy.*代收合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      payoutFeeCol: v166HeaderFind(headers, (key) => /代付合计.*easy|easy.*代付合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /easy.*代收/.test(key) && !/合计|单笔|扫码|限制|限额|最低|最高/.test(key), dataBoundary),
      payoutRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /easy.*代付/.test(key) && !/合计|单笔|限制|限额|最低|最高/.test(key), dataBoundary),
      collectSingleCol: v166HeaderFind(headers, (key) => /easy.*代收.*单笔|easy代收单笔/.test(key), dataBoundary),
      payoutSingleCol: v166HeaderFind(headers, (key) => /easy.*代付.*单笔|easy代付单笔/.test(key), dataBoundary)
    },
    {
      label: "JAZZCASH",
      supportCollectCol: supportJazzCollectCol,
      supportPayoutCol: supportJazzPayoutCol,
      totalCol: v166HeaderFind(headers, (key) => /合计.*jazz|jazz.*合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectFeeCol: v166HeaderFind(headers, (key) => /代收合计.*jazz|jazz.*代收合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      payoutFeeCol: v166HeaderFind(headers, (key) => /代付合计.*jazz|jazz.*代付合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /jazz.*代收/.test(key) && !/合计|单笔|扫码|限制|限额|最低|最高/.test(key), dataBoundary),
      payoutRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /jazz.*代付/.test(key) && !/合计|单笔|限制|限额|最低|最高/.test(key), dataBoundary),
      collectSingleCol: v166HeaderFind(headers, (key) => /jazz.*代收.*单笔|jazz代收单笔/.test(key), dataBoundary),
      payoutSingleCol: v166HeaderFind(headers, (key) => /jazz.*代付.*单笔|jazz代付单笔/.test(key), dataBoundary)
    }
  ];

  const rates: ThirdPartyRateRow[] = [];
  const statuses: ThirdPartyPlatformStatusRow[] = [];
  let currentThirdParty = "";

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (!row.some((cell) => normalizeCell(cell))) continue;
    const rawName = get(row, nameCol) || get(row, nameCols[0] ?? -1) || currentThirdParty;
    if (rawName && isValidThirdPartyName(rawName)) currentThirdParty = rawName;
    if (!currentThirdParty || !isValidThirdPartyName(currentThirdParty)) continue;
    const thirdParty = canonicalThirdPartyName(currentThirdParty, country);
    const collectLimit = v166LimitPair(row, collectMinCol, collectMaxCol);
    const payoutLimit = v166LimitPair(row, payoutMinCol, payoutMaxCol);
    const baseStatus = v166StatusFromRow(row, headers, totalStatusCol, `${get(row, collectStatusCol)} ${get(row, payoutStatusCol)}`);
    const note = noteCol >= 0 ? get(row, noteCol) : "";
    const leak = v166Pick(row, leakCol);
    const whitelist = v166Pick(row, whitelistCol);
    const baseInfo = [
      ["代收情况", get(row, collectStatusCol)],
      ["代付情况", get(row, payoutStatusCol)],
      ["easy扫码代收", get(row, scanCollectCol)],
      ["状态备注", note]
    ] as Array<[string, string]>;

    for (const variant of variants) {
      const collectFee = v166PickFirst(row, [variant.collectFeeCol, variant.collectRawFeeCol]);
      const payoutFee = v166PickFirst(row, [variant.payoutFeeCol, variant.payoutRawFeeCol]);
      const totalFee = v166Pick(row, variant.totalCol);
      const collectSingleFee = v166Pick(row, variant.collectSingleCol);
      const payoutSingleFee = v166Pick(row, variant.payoutSingleCol);
      const supportInfo = [
        [variant.label === "EASYPAISA" ? "Easy代收" : "Jazz代收", get(row, variant.supportCollectCol)],
        [variant.label === "EASYPAISA" ? "Easy代付" : "Jazz代付", get(row, variant.supportPayoutCol)]
      ] as Array<[string, string]>;
      if (!collectFee && !payoutFee && !totalFee && !collectSingleFee && !payoutSingleFee && !collectLimit && !payoutLimit) continue;
      const rateRow: ThirdPartyRateRow = {
        id: `${sheetName}-v166-${r}-${thirdParty}-${variant.label}`,
        sheetName,
        country,
        category: variant.label,
        thirdParty,
        collectFee,
        payoutFee,
        totalFee: inferTotalFee(collectFee, payoutFee, totalFee),
        collectSingleFee,
        payoutSingleFee,
        collectLimit,
        payoutLimit,
        channelInfo: v166ConcatInfo([...supportInfo, ...baseInfo]),
        leak,
        whitelist,
        status: baseStatus,
        sourceRow: r + 1
      };
      rates.push(rateRow);
      v166AddAliases(rates, rateRow, row, nameCols, country);

      for (const pc of platformCols) {
        const rawStatus = get(row, pc.col);
        const platformStatus = normalizeStatus(rawStatus);
        if (!platformStatus) continue;
        statuses.push({
          id: `${sheetName}-v166-status-${r}-${pc.col}-${variant.label}`,
          sheetName,
          country,
          platform: pc.platform,
          thirdParty,
          status: platformStatus,
          rawStatus,
          collectFee: rateRow.collectFee,
          payoutFee: rateRow.payoutFee,
          totalFee: rateRow.totalFee,
          collectSingleFee: rateRow.collectSingleFee,
          payoutSingleFee: rateRow.payoutSingleFee,
          collectLimit: rateRow.collectLimit,
          payoutLimit: rateRow.payoutLimit,
          category: rateRow.category,
          sourceRow: r + 1,
          sourceColumn: pc.col + 1
        });
      }
    }
  }
  return { rates, statuses };
}

function v166ParseUnifiedRateSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = v166FindHeaderIndex(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };
  const headers = (values[headerIndex] || []).map(normalizeCell);
  const subHeaders = (values[headerIndex + 1] || []).map(normalizeCell);
  const baseCountry = inferCountry(sheetName);
  if (baseCountry.includes("巴基斯坦")) return v166ParsePakistanSheet(sheetName, values, headerIndex);

  const dataBoundary = v166DataBoundary(headers, headerIndex, values);
  const nameCols = v166MainNameCols(headers, dataBoundary);
  const nameCol = nameCols[nameCols.length - 1] ?? nameCols[0] ?? -1;
  if (nameCol < 0) return { rates: [], statuses: [] };

  const countryCol = v166HeaderFind(headers, (key) => key === "国家" || key === "国家地区" || key === "地区", dataBoundary);
  const categoryCols = v166HeaderFindAll(headers, (key, raw, index) => index <= dataBoundary && (/^(类型|通道类型|分类|钱包)$/.test(key) || /三方代收通道|通道类型|结算周期/.test(key)), dataBoundary);
  const statusCol = findUsableStatusColumn(headers);
  const leakCol = v166HeaderFind(headers, (key) => /漏洞/.test(key), dataBoundary);
  const whitelistCol = v166HeaderFind(headers, (key) => /白名单/.test(key), dataBoundary);
  const channelInfoCols = v166HeaderFindAll(headers, (key) => /通道情况|通道情况状态|代收情况|代付情况|结算周期|打款时间|授信|公户|小数点|通知|账号|愿意升级|utr|ifsc|收款是/.test(key), dataBoundary);

  const totalFeeCol = v166HeaderFind(headers, (key) => /^(合计费率|费率合计|合计%\+单笔|费率合计%\+单笔|唤醒费率合计%?|原生代收总计%?)$/.test(key) || /合计.*单笔|总费率|总手续费/.test(key), dataBoundary);
  const collectFeeCol = v166HeaderFind(headers, (key) => /代收合计|收款合计|代收手续费|代收费率|收款手续费|收款费率|唤醒代收费率|原生代收费率|银行卡代收/.test(key) && !/最低|最高|限制|限额/.test(key), dataBoundary);
  const payoutFeeCol = v166HeaderFind(headers, (key) => /代付合计|付款合计|代付手续费|代付费率|付款手续费|付款费率|银行卡代付/.test(key) && !/最低|最高|限制|限额/.test(key), dataBoundary);
  const collectSingleFeeCol = v166HeaderFind(headers, (key) => /代收单笔|收款单笔|入款单笔|充值单笔|代收单$|收款单$/.test(key), dataBoundary);
  const payoutSingleFeeCol = v166HeaderFind(headers, (key) => /代付单笔|付款单笔|出款单笔|提现单笔|提款单笔|代付单$|付款单$|出款单$/.test(key), dataBoundary);
  const collectMinCol = v166HeaderFind(headers, (key) => /(代收|收款|入款|充值|原生代收|唤醒代收).*(最低|最小|下限)/.test(key), dataBoundary);
  const collectMaxCol = v166HeaderFind(headers, (key) => /(代收|收款|入款|充值|原生代收|唤醒代收).*(最高|最大|上限)/.test(key), dataBoundary);
  const payoutMinCol = v166HeaderFind(headers, (key) => /(代付|付款|出款|提款|提现|原生代付|唤醒代付).*(最低|最小|下限)/.test(key), dataBoundary);
  const payoutMaxCol = v166HeaderFind(headers, (key) => /(代付|付款|出款|提款|提现|原生代付|唤醒代付).*(最高|最大|上限)/.test(key), dataBoundary);
  const collectLimitCol = v166HeaderFind(headers, (key) => /(代收|收款|入款|充值).*(限制|限额|区间|范围)/.test(key) && !/最低|最高|最小|最大|下限|上限/.test(key), dataBoundary);
  const payoutLimitCol = v166HeaderFind(headers, (key) => /(代付|付款|出款|提款|提现).*(限制|限额|区间|范围)/.test(key) && !/最低|最高|最小|最大|下限|上限/.test(key), dataBoundary);
  const platformCols = v166PlatformColumns(headers, subHeaders, dataBoundary, headerIndex, values);

  const rates: ThirdPartyRateRow[] = [];
  const statuses: ThirdPartyPlatformStatusRow[] = [];
  let currentCountryText = "";
  let currentCategoryText = "";
  let currentThirdParty = "";

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (!row.some((cell) => normalizeCell(cell))) continue;

    const countryCell = get(row, countryCol);
    if (countryCell && !isColumnOrLegendText(countryCell)) currentCountryText = countryCell;
    const rowCountry = v166NormalizeCountry(baseCountry, currentCountryText, sheetName);

    const categoryValues = categoryCols.map((col) => get(row, col)).filter((value) => value && !isColumnOrLegendText(value) && !isStatusText(value));
    if (categoryValues[0]) currentCategoryText = categoryValues[0];
    const rawName = get(row, nameCol) || get(row, nameCols[0] ?? -1) || currentThirdParty;
    if (rawName && isValidThirdPartyName(rawName)) currentThirdParty = rawName;
    if (!currentThirdParty || !isValidThirdPartyName(currentThirdParty)) continue;

    const thirdParty = canonicalThirdPartyName(currentThirdParty, rowCountry);
    if (!thirdParty || !isValidThirdPartyName(thirdParty)) continue;
    const rowText = row.map(normalizeCell).filter(Boolean).join(" ");
    const categoryRaw = [currentCategoryText, ...categoryValues.slice(1)].filter(Boolean).join(" / ");
    const category = v166NormalizeCategory(rowCountry, categoryRaw, thirdParty, rowText, sheetName);
    const collectFee = v166Pick(row, collectFeeCol);
    const payoutFee = v166Pick(row, payoutFeeCol);
    const explicitTotalFee = v166Pick(row, totalFeeCol);
    const collectSingleFee = v166Pick(row, collectSingleFeeCol);
    const payoutSingleFee = v166Pick(row, payoutSingleFeeCol);
    const collectLimit = v166LimitPair(row, collectMinCol, collectMaxCol, collectLimitCol);
    const payoutLimit = v166LimitPair(row, payoutMinCol, payoutMaxCol, payoutLimitCol);
    const channelInfo = v166ConcatInfo(channelInfoCols.map((col) => [headers[col] || "", get(row, col)] as [string, string]));
    const status = v166StatusFromRow(row, headers, statusCol, channelInfo);
    const leak = v166Pick(row, leakCol);
    const whitelist = v166Pick(row, whitelistCol);

    if (!collectFee && !payoutFee && !explicitTotalFee && !collectSingleFee && !payoutSingleFee && !collectLimit && !payoutLimit && !status && !platformCols.length) continue;

    const rateRow: ThirdPartyRateRow = {
      id: `${sheetName}-v166-${r}-${thirdParty}-${category || "all"}`,
      sheetName,
      country: rowCountry,
      category,
      thirdParty,
      collectFee,
      payoutFee,
      totalFee: inferTotalFee(collectFee, payoutFee, explicitTotalFee),
      collectSingleFee,
      payoutSingleFee,
      collectLimit,
      payoutLimit,
      channelInfo: channelInfo || "Google费率表直读",
      leak,
      whitelist,
      status,
      sourceRow: r + 1
    };
    rates.push(rateRow);
    v166AddAliases(rates, rateRow, row, nameCols, rowCountry);

    for (const pc of platformCols) {
      const rawStatus = get(row, pc.col);
      const platformStatus = normalizeStatus(rawStatus);
      if (!platformStatus) continue;
      statuses.push({
        id: `${sheetName}-v166-status-${r}-${pc.col}`,
        sheetName,
        country: rowCountry,
        platform: pc.platform,
        thirdParty,
        status: platformStatus,
        rawStatus,
        collectFee: rateRow.collectFee,
        payoutFee: rateRow.payoutFee,
        totalFee: rateRow.totalFee,
        collectSingleFee: rateRow.collectSingleFee,
        payoutSingleFee: rateRow.payoutSingleFee,
        collectLimit: rateRow.collectLimit,
        payoutLimit: rateRow.payoutLimit,
        category: rateRow.category,
        sourceRow: r + 1,
        sourceColumn: pc.col + 1
      });
    }
  }

  return { rates, statuses };
}

function clearStatusFeeFields(row: ThirdPartyPlatformStatusRow): ThirdPartyPlatformStatusRow {
  // 费率表同一页通常既有“费率行”，又有右侧盘口接入状态矩阵。
  // 有 direct Google 表头可读时，费率必须以 direct 读取为准；状态行只保留接入状态，手续费后面由 direct 费率回填。
  return {
    ...row,
    collectFee: "",
    payoutFee: "",
    totalFee: "",
    collectSingleFee: "",
    payoutSingleFee: "",
    collectLimit: "",
    payoutLimit: ""
  };
}

function applyConfirmedRateRules(
  rateRows: ThirdPartyRateRow[],
  statusRows: ThirdPartyPlatformStatusRow[]
): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  // V232：Google 费率表是唯一费率来源。
  // 这里不再补写、覆盖或固定任何百分比和单笔费用；名称归并由 thirdPartyNameMap 负责。
  return { rates: rateRows, statuses: statusRows };
}

function buildThirdPartyRatePayload(sheetValues: Record<string, Values>): ThirdPartyRatePayload {
  const allRates: ThirdPartyRateRow[] = [];
  const allStatuses: ThirdPartyPlatformStatusRow[] = [];
  const sheets = Object.keys(sheetValues).filter(Boolean);

  for (const sheetName of sheets) {
    const values = sheetValues[sheetName] || [];

    // 用户确认：印度原始这个不要参与展示和匹配；印度线下表才是印度费率来源。
    if (normalizeCell(sheetName).includes("印度原始") || normalizeCell(sheetName).includes("印度原生")) continue;

    // V166：优先使用全局统一直读解析器，直接按 Google 费率表字段输出。
    // 这样不是只修某一个国家，而是所有费率页签都用同一套字段规则；如果没有命中，才回退旧解析。
    const unifiedParsed = v166ParseUnifiedRateSheet(sheetName, values);
    if (unifiedParsed.rates.length || unifiedParsed.statuses.length) {
      allRates.push(...unifiedParsed.rates);
      allStatuses.push(...unifiedParsed.statuses);
      continue;
    }

    const directParsed = parseDirectGoogleRateSheet(sheetName, values);
    const hasDirectRates = directParsed.rates.length > 0;
    const countryParsed = parseCountryRateSheet(sheetName, values);
    const platformParsed = parsePlatformMatrixSheet(sheetName, values);

    if (hasDirectRates) {
      allRates.push(...directParsed.rates);
      allStatuses.push(...countryParsed.statuses.map(clearStatusFeeFields));
      allStatuses.push(...platformParsed.statuses.map(clearStatusFeeFields));
      allStatuses.push(...directParsed.statuses.map(clearStatusFeeFields));
      continue;
    }

    if (countryParsed.rates.length || countryParsed.statuses.length) {
      allRates.push(...countryParsed.rates);
      allStatuses.push(...countryParsed.statuses);
    }

    if (platformParsed.rates.length || platformParsed.statuses.length) {
      allRates.push(...platformParsed.rates);
      allStatuses.push(...platformParsed.statuses);
    }

    if (directParsed.rates.length || directParsed.statuses.length) {
      allRates.push(...directParsed.rates);
      allStatuses.push(...directParsed.statuses);
    }
  }

  const visibleRates = allRates.filter((row) => !row.country.includes("埃及") && !row.sheetName.includes("埃及"));
  const visibleStatuses = allStatuses.filter((row) => !row.country.includes("埃及") && !row.sheetName.includes("埃及"));

  const dedupedRates = dedupeRows(visibleRates);
  const dedupedStatuses = dedupeRows(visibleStatuses);
  const filled = fillMissingFeeData(dedupedRates, dedupedStatuses);
  const confirmed = applyConfirmedRateRules(filled.rates, filled.statuses);

  const rates = confirmed.rates.sort((a, b) => compareCountryForSort(a.country, b.country) || a.thirdParty.localeCompare(b.thirdParty, "zh-CN"));
  const platformStatuses = confirmed.statuses.sort((a, b) => {
    return compareCountryForSort(a.country, b.country) || a.platform.localeCompare(b.platform, "zh-CN") || statusScore(a.status) - statusScore(b.status) || a.thirdParty.localeCompare(b.thirdParty, "zh-CN");
  });

  return {
    meta: {
      year: String(new Date().getFullYear()),
      month: String(new Date().getMonth() + 1),
      updatedAt: new Date().toISOString(),
      source: "google-sheet",
      sheets,
      parserVersion: "v234-fee-match"
    } as any,
    summary: summarizeStatuses(platformStatuses),
    rates,
    platformStatuses,
    anomalies: buildAnomalies(rates, platformStatuses)
  };
}

  return { buildThirdPartyRatePayload, applyConfirmedRateRules };
})();


// ============================================================================
// Supabase direct-Google sync runtime
// 目标：保留 v239 的原版三方名称归并、人工确认/人工充值、三方量解析、费率与盘口状态解析；
// 只把底层数据读取改为 Google Sheets -> Supabase，不再经过 Netlify 数据 API。
// ============================================================================

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizePrivateKeySecret(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importGooglePrivateKey(pem: string): Promise<CryptoKey> {
  const clean = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getGoogleAccessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await importGooglePrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data?.access_token) {
    throw new Error(`Google 登录失败：${JSON.stringify(data)}`);
  }
  return String(data.access_token);
}

type GSheetMeta = { title: string; rowCount: number; columnCount: number };
type GSpreadsheetMeta = { title: string; sheets: GSheetMeta[] };

async function googleJson(url: string, token: string): Promise<any> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const data = await res.json();
      if (res.ok) return data;
      const message = JSON.stringify(data);
      if (res.status < 500 && res.status !== 429) throw new Error(message);
      last = new Error(`HTTP ${res.status}: ${message}`);
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last || "Google API error"));
}

async function getSpreadsheetMeta(spreadsheetId: string, token: string): Promise<GSpreadsheetMeta> {
  const fields = encodeURIComponent(
    "properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))",
  );
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=${fields}`;
  const data = await googleJson(url, token);
  return {
    title: String(data?.properties?.title || ""),
    sheets: Array.isArray(data?.sheets)
      ? data.sheets.map((s: any) => ({
          title: String(s?.properties?.title || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim(),
          rowCount: Math.max(1, Number(s?.properties?.gridProperties?.rowCount || 0) || 1),
          columnCount: Math.max(1, Number(s?.properties?.gridProperties?.columnCount || 0) || 1),
        })).filter((x: GSheetMeta) => x.title)
      : [],
  };
}

function quoteSheet(name: string): string {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function batchGetValues(
  spreadsheetId: string,
  ranges: string[],
  token: string,
): Promise<string[][][]> {
  if (!ranges.length) return [];
  const params = new URLSearchParams();
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "FORMATTED_VALUE");
  for (const range of ranges) params.append("ranges", range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`;
  const data = await googleJson(url, token);
  const valueRanges = Array.isArray(data?.valueRanges) ? data.valueRanges : [];
  return ranges.map((_, i) => (Array.isArray(valueRanges[i]?.values) ? valueRanges[i].values : []));
}

function gChunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function gColumnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function isCompactThirdPartyRawSheetFinal(sheetName: string): boolean {
  return /^raw[_-]?20\d{2}[_-]\d{2}[_-]?(代收|代付|collect|payout|deposit|withdraw)/i.test(sheetName)
    || /^raw[_-]20\d{2}[_-]\d{2}/i.test(sheetName)
    || /raw[_-].*20\d{2}[_-]\d{2}.*(代收|代付|collect|payout|deposit|withdraw)/i.test(sheetName);
}

function monthKeyFromDateFinal(value: string): string {
  const m = String(value || "").match(/(20\d{2})-(\d{2})/);
  return m ? `${m[1]}_${m[2]}` : "";
}

function monthsBetweenFinal(start: string, end: string): string[] {
  const a = String(start || "").match(/(20\d{2})-(\d{2})/);
  const b = String(end || "").match(/(20\d{2})-(\d{2})/);
  if (!a || !b) return [];
  const cur = new Date(Date.UTC(Number(a[1]), Number(a[2]) - 1, 1));
  const last = new Date(Date.UTC(Number(b[1]), Number(b[2]) - 1, 1));
  const out: string[] = [];
  while (cur <= last && out.length < 24) {
    out.push(`${cur.getUTCFullYear()}_${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

function sheetMatchesMonthFinal(sheetName: string, monthKeys: string[]): boolean {
  if (!monthKeys.length) return true;
  const normalized = String(sheetName || "").replace(/[\s\-\/年月]/g, "_");
  return monthKeys.some((month) => {
    const [year, mm] = month.split("_");
    const m = String(Number(mm));
    return [`${year}_${mm}`, `${year}_${m}`, `${year}${mm}`, `${year}${m}`]
      .some((pattern) => normalized.includes(pattern));
  });
}

function compactRangesFinal(meta: GSheetMeta, maxRows = 60000): string[] {
  const colCount = Math.max(1, Math.min(512, Number(meta.columnCount || 0) || 120));
  const rowCount = Math.max(1, Math.min(maxRows, Number(meta.rowCount || 0) || maxRows));
  const chunkWidth = 72;
  const overlap = 12;
  const step = chunkWidth - overlap;
  const ranges: string[] = [];
  for (let start = 0; start < colCount; start += step) {
    const end = Math.min(colCount - 1, start + chunkWidth - 1);
    ranges.push(`${gColumnName(start)}1:${gColumnName(end)}${rowCount}`);
    if (end >= colCount - 1) break;
  }
  return ranges;
}

async function readRateSheetValuesFinal(
  spreadsheetId: string,
  token: string,
): Promise<{ values: Record<string, string[][]>; meta: GSpreadsheetMeta }> {
  const meta = await getSpreadsheetMeta(spreadsheetId, token);
  const configured = String(Deno.env.get("THIRD_PARTY_RATE_SHEETS") || "")
    .split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
  const names = configured.length
    ? configured.filter((name) => meta.sheets.some((s) => s.title === name))
    : meta.sheets.map((s) => s.title);
  const values: Record<string, string[][]> = {};
  for (const chunk of gChunk(names, 12)) {
    const ranges = chunk.map((name) => `${quoteSheet(name)}!A1:ZZ800`);
    const matrices = await batchGetValues(spreadsheetId, ranges, token);
    chunk.forEach((name, index) => { values[name] = matrices[index] || []; });
  }
  return { values, meta };
}

async function readVolumeSheetValuesFinal(
  spreadsheetIds: string[],
  token: string,
  start: string,
  end: string,
): Promise<{ values: Record<string, string[][]>; info: any[] }> {
  const monthKeys = monthsBetweenFinal(start, end);
  const result: Record<string, string[][]> = {};
  const info: any[] = [];

  for (let sourceIndex = 0; sourceIndex < spreadsheetIds.length; sourceIndex++) {
    const spreadsheetId = spreadsheetIds[sourceIndex];
    const meta = await getSpreadsheetMeta(spreadsheetId, token);
    const detected = meta.sheets.filter((s) => /^raw[_-]/i.test(s.title) || /raw.*(代收|代付|thirdparty|三方)/i.test(s.title));
    let targets = (detected.length ? detected : meta.sheets)
      .filter((s) => sheetMatchesMonthFinal(s.title, monthKeys))
      .filter((s) => !/历史|history|汇总|summary|总表|全部|all/i.test(s.title));

    // 与 v239 相同：明确传了月份时，没有对应月页签就跳过该来源，不回退巨大历史总表。
    info.push({
      source: sourceIndex + 1,
      spreadsheetTitle: meta.title,
      monthKeys,
      targetSheets: targets.map((s) => s.title),
    });

    for (const sheet of targets) {
      const ranges = isCompactThirdPartyRawSheetFinal(sheet.title)
        ? compactRangesFinal(sheet)
        : [`A1:${gColumnName(Math.min(sheet.columnCount, 120) - 1)}${Math.min(sheet.rowCount, 60000)}`];

      for (const rangeChunk of gChunk(ranges, 4)) {
        const fullRanges = rangeChunk.map((range) => `${quoteSheet(sheet.title)}!${range}`);
        const matrices = await batchGetValues(spreadsheetId, fullRanges, token);
        rangeChunk.forEach((range, index) => {
          const matrix = matrices[index] || [];
          if (!matrix.length) return;
          const baseKey = spreadsheetIds.length > 1 ? `[三方量表${sourceIndex + 1}] ${sheet.title}` : sheet.title;
          result[`${baseKey} ${range}`] = matrix;
        });
      }
    }
  }

  return { values: result, info };
}

function isIsoDateFinal(value: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(String(value || ""));
}

function addDaysFinal(value: string, days: number): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`日期无效：${value}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function upsertBatchesFinal(
  supabase: any,
  table: string,
  rows: any[],
  batchSize = 400,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`${table} 写入失败：${error.message}`);
    written += batch.length;
  }
  return written;
}

function mapRateRowsFinal(rows: any[], runAt: string) {
  return rows.map((r) => ({
    id: String(r.id),
    sheet_name: String(r.sheetName || ""),
    country: String(r.country || ""),
    category: String(r.category || ""),
    third_party: String(r.thirdParty || ""),
    collect_fee: String(r.collectFee || ""),
    payout_fee: String(r.payoutFee || ""),
    total_fee: String(r.totalFee || ""),
    collect_single_fee: String(r.collectSingleFee || ""),
    payout_single_fee: String(r.payoutSingleFee || ""),
    collect_limit: String(r.collectLimit || ""),
    payout_limit: String(r.payoutLimit || ""),
    channel_info: String(r.channelInfo || ""),
    leak: String(r.leak || ""),
    whitelist: String(r.whitelist || ""),
    status: String(r.status || ""),
    source_row: Number(r.sourceRow || 0),
    updated_at: runAt,
  }));
}

function mapStatusRowsFinal(rows: any[], runAt: string) {
  return rows.map((r) => ({
    id: String(r.id),
    sheet_name: String(r.sheetName || ""),
    country: String(r.country || ""),
    platform: String(r.platform || ""),
    third_party: String(r.thirdParty || ""),
    status: String(r.status || ""),
    raw_status: String(r.rawStatus || ""),
    collect_fee: String(r.collectFee || ""),
    payout_fee: String(r.payoutFee || ""),
    total_fee: String(r.totalFee || ""),
    collect_single_fee: String(r.collectSingleFee || ""),
    payout_single_fee: String(r.payoutSingleFee || ""),
    collect_limit: String(r.collectLimit || ""),
    payout_limit: String(r.payoutLimit || ""),
    category: String(r.category || ""),
    source_row: Number(r.sourceRow || 0),
    source_column: Number(r.sourceColumn || 0),
    updated_at: runAt,
  }));
}

function mapVolumeRowsFinal(rows: ThirdPartyVolumeRow[], runAt: string) {
  return rows.map((r) => ({
    id: String(r.id),
    sheet_name: String(r.sheetName || ""),
    source_row: Number(r.sourceRow || 0),
    data_date: String(r.date || ""),
    country: String(r.country || ""),
    platform: String(r.platform || ""),
    channel: String(r.channel || ""),
    raw_channel: String(r.rawChannel || ""),
    channel_type: String(r.channelType || ""),
    direction: r.direction === "代付" ? "代付" : "代收",
    amount: Number(r.amount || 0),
    count: Number(r.count || 0),
    success_count: Number(r.successCount || 0),
    failed_count: Number(r.failedCount || 0),
    success_rate: Number(r.successRate || 0),
    status: String(r.status || ""),
    raw: r.raw || null,
    updated_at: runAt,
  }));
}

function volumeDiagnosticsFinal(rows: ThirdPartyVolumeRow[]) {
  const countries = new Set(rows.map((r) => r.country).filter(Boolean));
  const platforms = new Set(rows.map((r) => r.platform).filter(Boolean));
  const channels = new Set(rows.map((r) => r.channel).filter(Boolean));
  const manualConfirm = rows.filter((r) => r.channel === "人工确认").length;
  const manualRecharge = rows.filter((r) => r.channel === "人工充值").length;
  return {
    rows: rows.length,
    amount: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
    count: rows.reduce((s, r) => s + Number(r.count || 0), 0),
    successCount: rows.reduce((s, r) => s + Number(r.successCount || 0), 0),
    failedCount: rows.reduce((s, r) => s + Number(r.failedCount || 0), 0),
    countries: countries.size,
    platforms: platforms.size,
    channels: channels.size,
    manualConfirmRows: manualConfirm,
    manualRechargeRows: manualRecharge,
  };
}


// ===== 轻量执行层：避免一次把费率 + 代收 + 代付全部塞进同一个 Edge Function =====
function volumeSheetDirectionFinal(title: string): "代收" | "代付" | "" {
  const text = String(title || "").toLowerCase();
  if (/代收|collect|deposit/.test(text)) return "代收";
  if (/代付|payout|withdraw/.test(text)) return "代付";
  return "";
}

function genericCurrentVolumeSheetFinal(title: string): boolean {
  const text = String(title || "").trim();
  return /^raw[_-]?20\d{2}[_-]?thirdparty$/i.test(text)
    || /^raw[_-]?20\d{2}[_-]?三方$/i.test(text);
}

async function readAndParseVolumeLightFinal(
  spreadsheetIds: string[],
  token: string,
  start: string,
  end: string,
  direction: "代收" | "代付",
): Promise<{ rows: ThirdPartyVolumeRow[]; info: any[] }> {
  const monthKeys = monthsBetweenFinal(start, end);
  const collected: ThirdPartyVolumeRow[] = [];
  const info: any[] = [];

  for (let sourceIndex = 0; sourceIndex < spreadsheetIds.length; sourceIndex++) {
    const spreadsheetId = spreadsheetIds[sourceIndex];
    const meta = await getSpreadsheetMeta(spreadsheetId, token);
    const detected = meta.sheets.filter((s) =>
      /^raw[_-]/i.test(s.title) || /raw.*(代收|代付|thirdparty|三方)/i.test(s.title)
    );
    const pool = detected.length ? detected : meta.sheets;

    let monthTargets = pool
      .filter((s) => sheetMatchesMonthFinal(s.title, monthKeys))
      .filter((s) => !/历史|history|汇总|summary|总表|全部|all/i.test(s.title));

    // 优先只读明确写着“代收”或“代付”的月页签。
    let targets = monthTargets.filter((s) => volumeSheetDirectionFinal(s.title) === direction);

    // 当前月有些表使用 raw_2026_thirdparty 这种通用页签；只有找不到明确月页签时才回退。
    if (!targets.length) {
      targets = pool
        .filter((s) => genericCurrentVolumeSheetFinal(s.title))
        .filter((s) => !/历史|history|汇总|summary|总表|全部|all/i.test(s.title));
    }

    info.push({
      source: sourceIndex + 1,
      spreadsheetTitle: meta.title,
      monthKeys,
      direction,
      targetSheets: targets.map((s) => s.title),
    });

    for (const sheet of targets) {
      const ranges = isCompactThirdPartyRawSheetFinal(sheet.title)
        ? compactRangesFinal(sheet)
        : [`A1:${gColumnName(Math.max(0, Math.min(sheet.columnCount || 1, 120) - 1))}${Math.min(sheet.rowCount || 60000, 60000)}`];

      // 关键：一次只拉一个横向分片，解析完马上只留下目标日期/方向的数据。
      // 不再把整月所有分片一起保存在内存里。
      for (const range of ranges) {
        const fullRange = `${quoteSheet(sheet.title)}!${range}`;
        const matrices = await batchGetValues(spreadsheetId, [fullRange], token);
        const matrix = matrices[0] || [];
        if (!matrix.length) continue;

        const sourceKey = spreadsheetIds.length > 1
          ? `[三方量表${sourceIndex + 1}] ${sheet.title} ${range}`
          : `${sheet.title} ${range}`;

        const partial = buildThirdPartyVolumePayload({ [sourceKey]: matrix });
        for (const row of partial.rows || []) {
          if (row.date < start || row.date > end) continue;
          if (row.direction !== direction) continue;
          collected.push(row);
        }
      }
    }
  }

  // 与 v239 页面口径一致：跨来源再按 日期/国家/平台/主三方/类型/方向 聚合。
  const compact = compactThirdPartyVolumePayloadForDashboard({
    meta: {
      year: start.slice(0, 4),
      month: String(Number(start.slice(5, 7))),
      updatedAt: new Date().toISOString(),
      source: "google-sheet",
      sheets: info.flatMap((x) => x.targetSheets || []),
    } as any,
    rows: collected,
    aliasMap: {},
    summary: {
      rows: 0, amount: 0, count: 0, successCount: 0, failedCount: 0,
      countries: 0, platforms: 0, channels: 0,
    },
    anomalies: [],
  } as any);

  return {
    rows: (compact.rows || []).filter((r) =>
      r.date >= start && r.date <= end && r.direction === direction
    ),
    info,
  };
}


// ============================================================
// ULTRA V2: 低内存直读 Google
// 核心：先只读取前 200 行识别横向区块，再按每个区块的实际列宽逐块读取。
// 不再一次把 72 列 × 整月 × 多分片全部塞进 Edge Function 内存。
// 解析规则本身继续复用上面的 v239 原版函数。
// ============================================================

function localCellFinal(row: string[], block: Block, globalCol: number): string {
  if (globalCol < block.startCol || globalCol > block.endCol) return "";
  return get(row, globalCol - block.startCol);
}

function parseKnownBlockLocalFinal(
  sheetName: string,
  block: Block,
  localRows: string[][],
  firstActualRowZeroBased: number,
): ThirdPartyVolumeRow[] {
  const rows: ThirdPartyVolumeRow[] = [];
  let blankStreak = 0;

  for (let i = 0; i < localRows.length; i++) {
    const rr = firstActualRowZeroBased + i;
    const row = localRows[i] || [];
    const cell = (col: number) => localCellFinal(row, block, col);

    const date = parseVolumeDate(cell(block.dateCol));
    let platform = cell(block.platformCol);
    const amount = block.amountCol >= 0 ? toNumber(cell(block.amountCol)) : 0;
    const count = block.countCol >= 0 ? toNumber(cell(block.countCol)) : 0;

    const rowHasAny = row.some((value) => !!normalizeCell(value));
    if (!rowHasAny) {
      blankStreak += 1;
      if (blankStreak >= 1500) break;
      continue;
    }
    blankStreak = 0;

    if (!date || !platform) continue;
    if (count <= 0 && amount <= 0) continue;

    let country = block.countryCol >= 0
      ? countryFromText(cell(block.countryCol))
      : countryFromText(block.title || sheetName);
    const typeText = block.typeCol >= 0 ? cell(block.typeCol) : "";
    const mapCode = block.mapCodeCol >= 0 ? cell(block.mapCodeCol) : "";
    const thirdParty = block.thirdPartyCol >= 0 ? cell(block.thirdPartyCol) : "";
    const system = block.systemCol >= 0 ? cell(block.systemCol) : "";

    const southAmericaNormalized = normalizeSouthAmericaRow(
      country,
      platform,
      system,
      sheetName,
      block.title,
      typeText,
    );
    country = southAmericaNormalized.country;
    platform = southAmericaNormalized.platform;
    country = normalizeSpecialPlatformCountry(country, platform, sheetName, block.title, system);

    const statusText = block.statusCol >= 0 ? cell(block.statusCol) : "";
    if (/商户余额不足|余额不足/.test(statusText)) continue;

    const validThirdParty = thirdParty && (
      isManualHandlingChannel(thirdParty) ||
      (!isIgnoredThirdPartyText(thirdParty) && !isLikelyThirdPartyCodeOnly(thirdParty))
    ) ? thirdParty : "";

    const validMapCode = mapCode && (
      isManualHandlingChannel(mapCode) ||
      (!isIgnoredThirdPartyText(mapCode) && !isLikelyThirdPartyCodeOnly(mapCode))
    ) ? mapCode : "";

    const rawChannel = validThirdParty || validMapCode;
    if (!rawChannel) continue;

    const direction = inferDirection(sheetName, block.title, typeText);
    let channel = isManualHandlingChannel(rawChannel)
      ? normalizeCell(rawChannel).replace(/[\s　_-]+/g, "")
      : manualThirdPartyOverride(country, platform, rawChannel, direction) || normalizeChannel(rawChannel, country);

    if (isCoinvidUsdtVolume(country, platform, rawChannel, sheetName, block.title, system)) {
      channel = "Coinvid USDT";
    }

    if (!channel || channel === "未知三方" || (!isManualHandlingChannel(channel) && isIgnoredThirdPartyText(channel))) {
      continue;
    }

    let channelType = normalizeVolumeChannelType(
      country,
      platform,
      rawChannel,
      channel,
      typeText,
      mapCode,
      system,
      block.title,
      sheetName,
      direction,
    );
    if (channel === "人工确认" || channel === "人工充值") channelType = channel;

    const successCount = block.successCol >= 0 ? toNumber(cell(block.successCol)) : count;
    const failedCount = block.failedCol >= 0
      ? toNumber(cell(block.failedCol))
      : Math.max(0, count - successCount);

    rows.push({
      id: `${sheetName}-${block.headerRow}-${rr}-${block.startCol}-${date}-${country}-${platform}-${rawChannel}`,
      sheetName,
      sourceRow: rr + 1,
      date,
      country: country || "未知国家",
      platform,
      channel,
      rawChannel,
      channelType,
      direction,
      amount,
      count,
      successCount,
      failedCount,
      successRate: count ? successCount / count : 0,
      status: block.statusCol >= 0 ? cell(block.statusCol) : "",
    });
  }

  return rows;
}

async function readAndParseVolumeUltraFinal(
  spreadsheetIds: string[],
  token: string,
  start: string,
  end: string,
  direction: "代收" | "代付",
): Promise<{ rows: ThirdPartyVolumeRow[]; info: any[] }> {
  const monthKeys = monthsBetweenFinal(start, end);
  const collected: ThirdPartyVolumeRow[] = [];
  const info: any[] = [];

  // V4：严格模拟 v239 parseSheet 的 blankStreak=1500 行停止逻辑，
  // 但不把整张表放进内存；改为 750 行一窗，所有国家区块一起 batchGet。
  const WINDOW_ROWS = 750;
  const BLANK_STOP = 1500;

  type BlockState = {
    block: Block;
    blankStreak: number;
    stopped: boolean;
    rowsSeen: number;
    matches: number;
    stopAtRow: number | null;
  };

  for (let sourceIndex = 0; sourceIndex < spreadsheetIds.length; sourceIndex++) {
    const spreadsheetId = spreadsheetIds[sourceIndex];
    const meta = await getSpreadsheetMeta(spreadsheetId, token);

    const detected = meta.sheets.filter((s) =>
      /^raw[_-]/i.test(s.title) || /raw.*(代收|代付|thirdparty|三方)/i.test(s.title)
    );
    const pool = detected.length ? detected : meta.sheets;

    const monthTargets = pool
      .filter((s) => sheetMatchesMonthFinal(s.title, monthKeys))
      .filter((s) => !/历史|history|汇总|summary|总表|全部|all/i.test(s.title));

    let targets = monthTargets.filter((s) => volumeSheetDirectionFinal(s.title) === direction);
    if (!targets.length) {
      targets = pool
        .filter((s) => genericCurrentVolumeSheetFinal(s.title))
        .filter((s) => !/历史|history|汇总|summary|总表|全部|all/i.test(s.title));
    }

    const sourceDiagnostic: any = {
      source: sourceIndex + 1,
      spreadsheetTitle: meta.title,
      monthKeys,
      direction,
      targetSheets: [] as any[],
    };
    info.push(sourceDiagnostic);

    for (const sheet of targets) {
      const baseSheetName = spreadsheetIds.length > 1
        ? `[三方量表${sourceIndex + 1}] ${sheet.title}`
        : sheet.title;

      // 1) 与 v239 一样，只在前 200 行识别横向区块。
      const headerEndCol = gColumnName(Math.max(0, Math.min(sheet.columnCount || 1, 512) - 1));
      const headerEndRow = Math.min(Math.max(sheet.rowCount || 1, 1), 200);
      const headerRange = `${quoteSheet(sheet.title)}!A1:${headerEndCol}${headerEndRow}`;
      const headerMatrices = await batchGetValues(spreadsheetId, [headerRange], token);
      const headerValues = headerMatrices[0] || [];
      const blocks = findBlocks(baseSheetName, headerValues);

      const sheetDirection = volumeSheetDirectionFinal(sheet.title);
      const candidateBlocks = blocks.filter((block) => {
        if (sheetDirection === direction) return true;
        const inferred = inferDirection(baseSheetName, block.title, "");
        return inferred === direction;
      });

      const states: BlockState[] = candidateBlocks.map((block) => ({
        block,
        blankStreak: 0,
        stopped: false,
        rowsSeen: 0,
        matches: 0,
        stopAtRow: null,
      }));

      const diag: any = {
        sheet: sheet.title,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        blocksDetected: blocks.length,
        blocksRead: candidateBlocks.length,
        blockWidths: candidateBlocks.map((b) => b.endCol - b.startCol + 1),
        mode: "v239-stream-exact",
        windowRows: WINDOW_ROWS,
        blankStop: BLANK_STOP,
        windowsRead: 0,
        cellsReadApprox: 0,
        matchedRawRows: 0,
        blockStates: [] as any[],
      };
      sourceDiagnostic.targetSheets.push(diag);

      if (!candidateBlocks.length) continue;

      const minFirstDataRow = Math.min(...candidateBlocks.map((b) => b.headerRow + 2));
      const maxRow = Math.min(sheet.rowCount || 60000, 60000);

      // 2) 按纵向小窗读取。每一窗同时读取仍未停止的国家区块。
      //    这样 rowHasAny 与 blankStreak 的行为和 v239 原 parseSheet 保持一致。
      for (let windowStart = minFirstDataRow; windowStart <= maxRow; windowStart += WINDOW_ROWS) {
        const windowEnd = Math.min(maxRow, windowStart + WINDOW_ROWS - 1);
        const active: { state: BlockState; fromRow: number; toRow: number; width: number }[] = [];
        const ranges: string[] = [];

        for (const state of states) {
          if (state.stopped) continue;
          const block = state.block;
          const firstDataRow = block.headerRow + 2;
          const fromRow = Math.max(windowStart, firstDataRow);
          if (fromRow > windowEnd) continue;
          const toRow = windowEnd;
          const startColName = gColumnName(block.startCol);
          const endColName = gColumnName(block.endCol);
          ranges.push(`${quoteSheet(sheet.title)}!${startColName}${fromRow}:${endColName}${toRow}`);
          active.push({
            state,
            fromRow,
            toRow,
            width: block.endCol - block.startCol + 1,
          });
        }

        if (!ranges.length) break;

        const matrices = await batchGetValues(spreadsheetId, ranges, token);
        diag.windowsRead += 1;

        for (let ai = 0; ai < active.length; ai++) {
          const { state, fromRow, toRow, width } = active[ai];
          const block = state.block;
          const matrix = matrices[ai] || [];
          const requestedRows = toRow - fromRow + 1;
          diag.cellsReadApprox += requestedRows * width;

          // Google Values API 会裁掉末尾全空行，所以这里按请求行数补空，
          // 才能准确复现原版 1500 连续空白行停止。
          for (let offset = 0; offset < requestedRows; offset++) {
            if (state.stopped) break;
            const actualRowOneBased = fromRow + offset;
            const rr = actualRowOneBased - 1;
            const row = matrix[offset] || [];
            state.rowsSeen += 1;

            const rowHasAny = row.some((value) => !!normalizeCell(value));
            if (!rowHasAny) {
              state.blankStreak += 1;
              if (state.blankStreak >= BLANK_STOP) {
                state.stopped = true;
                state.stopAtRow = actualRowOneBased;
              }
              continue;
            }
            state.blankStreak = 0;

            const cell = (col: number) => localCellFinal(row, block, col);
            const date = parseVolumeDate(cell(block.dateCol));
            let platform = cell(block.platformCol);
            const amount = block.amountCol >= 0 ? toNumber(cell(block.amountCol)) : 0;
            const count = block.countCol >= 0 ? toNumber(cell(block.countCol)) : 0;

            if (!date || !platform) continue;
            if (date < start || date > end) continue;
            if (count <= 0 && amount <= 0) continue;

            let country = block.countryCol >= 0
              ? countryFromText(cell(block.countryCol))
              : countryFromText(block.title || baseSheetName);
            const typeText = block.typeCol >= 0 ? cell(block.typeCol) : "";
            const mapCode = block.mapCodeCol >= 0 ? cell(block.mapCodeCol) : "";
            const thirdParty = block.thirdPartyCol >= 0 ? cell(block.thirdPartyCol) : "";
            const system = block.systemCol >= 0 ? cell(block.systemCol) : "";

            const southAmericaNormalized = normalizeSouthAmericaRow(
              country, platform, system, baseSheetName, block.title, typeText,
            );
            country = southAmericaNormalized.country;
            platform = southAmericaNormalized.platform;
            country = normalizeSpecialPlatformCountry(country, platform, baseSheetName, block.title, system);

            const statusText = block.statusCol >= 0 ? cell(block.statusCol) : "";
            if (/商户余额不足|余额不足/.test(statusText)) continue;

            const validThirdParty = thirdParty && (
              isManualHandlingChannel(thirdParty) ||
              (!isIgnoredThirdPartyText(thirdParty) && !isLikelyThirdPartyCodeOnly(thirdParty))
            ) ? thirdParty : "";
            const validMapCode = mapCode && (
              isManualHandlingChannel(mapCode) ||
              (!isIgnoredThirdPartyText(mapCode) && !isLikelyThirdPartyCodeOnly(mapCode))
            ) ? mapCode : "";
            const rawChannel = validThirdParty || validMapCode;
            if (!rawChannel) continue;

            const rowDirection = inferDirection(baseSheetName, block.title, typeText);
            if (rowDirection !== direction) continue;

            let channel = isManualHandlingChannel(rawChannel)
              ? normalizeCell(rawChannel).replace(/[\s　_-]+/g, "")
              : manualThirdPartyOverride(country, platform, rawChannel, rowDirection) || normalizeChannel(rawChannel, country);
            if (isCoinvidUsdtVolume(country, platform, rawChannel, baseSheetName, block.title, system)) {
              channel = "Coinvid USDT";
            }
            if (!channel || channel === "未知三方" || (!isManualHandlingChannel(channel) && isIgnoredThirdPartyText(channel))) {
              continue;
            }

            let channelType = normalizeVolumeChannelType(
              country, platform, rawChannel, channel, typeText, mapCode, system,
              block.title, baseSheetName, rowDirection,
            );
            if (channel === "人工确认" || channel === "人工充值") channelType = channel;

            const successCount = block.successCol >= 0 ? toNumber(cell(block.successCol)) : count;
            const failedCount = block.failedCol >= 0
              ? toNumber(cell(block.failedCol))
              : Math.max(0, count - successCount);

            collected.push({
              id: `${baseSheetName}-${block.headerRow}-${rr}-${block.startCol}-${date}-${country}-${platform}-${rawChannel}`,
              sheetName: baseSheetName,
              sourceRow: rr + 1,
              date,
              country: country || "未知国家",
              platform,
              channel,
              rawChannel,
              channelType,
              direction: rowDirection,
              amount,
              count,
              successCount,
              failedCount,
              successRate: count ? successCount / count : 0,
              status: block.statusCol >= 0 ? cell(block.statusCol) : "",
            });
            state.matches += 1;
            diag.matchedRawRows += 1;
          }
        }

        if (states.every((s) => s.stopped)) break;
      }

      diag.blockStates = states.map((s) => ({
        blockStartCol: s.block.startCol,
        blockEndCol: s.block.endCol,
        rowsSeen: s.rowsSeen,
        matches: s.matches,
        stoppedByBlankStreak: s.stopped,
        stopAtRow: s.stopAtRow,
        trailingBlankStreak: s.blankStreak,
      }));
    }
  }

  // V5 EXACT PIPELINE：严格复刻 v239 的 buildThirdPartyVolumePayload -> dashboard compact 顺序。
  // 原版并不是把 parseSheet 的结果直接送进 dashboard compact；中间还会：
  // 1) 过滤埃及；2) 按 raw row id 去重；3) 先 normalize/compact 一次；
  // 然后 API 层再做 dashboard 级跨来源 compact。
  const filteredCollected = collected.filter((row) =>
    row.country !== "埃及" &&
    !String(row.platform || "").includes("埃及") &&
    !String(row.sheetName || "").includes("埃及")
  );

  const rawRowMap = new Map<string, ThirdPartyVolumeRow>();
  for (const row of filteredCollected) {
    if (!rawRowMap.has(row.id)) rawRowMap.set(row.id, row);
  }
  const rawDedupedRows = Array.from(rawRowMap.values())
    .sort((a, b) => b.date.localeCompare(a.date) || a.country.localeCompare(b.country, "zh-CN") || a.platform.localeCompare(b.platform, "zh-CN"));

  const buildStage = normalizeThirdPartyVolumePayload({
    meta: {
      year: start.slice(0, 4),
      month: String(Number(start.slice(5, 7))),
      updatedAt: new Date().toISOString(),
      source: "google-sheet",
      sheets: info.flatMap((x) => (x.targetSheets || []).map((y: any) => y.sheet)),
    } as any,
    rows: rawDedupedRows,
    aliasMap: buildAliasMap(rawDedupedRows),
    summary: summarize(rawDedupedRows),
    anomalies: buildAnomalies(rawDedupedRows),
  } as any);

  // API 页面层：与 v239 的轻量快照逻辑一致，再做一次 dashboard 聚合。
  const compact = compactThirdPartyVolumePayloadForDashboard(buildStage);

  return {
    rows: (compact.rows || []).filter((r) =>
      r.date >= start && r.date <= end && r.direction === direction
    ),
    info,
  };
}

async function runRatesUltraFinal(token: string, rateSheetId: string) {
  const meta = await getSpreadsheetMeta(rateSheetId, token);
  const configured = String(Deno.env.get("THIRD_PARTY_RATE_SHEETS") || "")
    .split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
  const names = configured.length
    ? configured.filter((name) => meta.sheets.some((s) => s.title === name))
    : meta.sheets.map((s) => s.title);

  const allRates: ThirdPartyRateRow[] = [];
  const allStatuses: ThirdPartyPlatformStatusRow[] = [];
  const usedSheets: string[] = [];

  // 一张费率页签读完就解析并释放原始矩阵，不把 10+ 页 A:ZZ800 一起留在内存。
  for (const name of names) {
    if (normalizeCell(name).includes("印度原始") || normalizeCell(name).includes("印度原生")) continue;
    const sheetMeta = meta.sheets.find((s) => s.title === name);
    if (!sheetMeta) continue;

    const endCol = gColumnName(Math.max(0, Math.min(sheetMeta.columnCount || 1, 702) - 1));
    const endRow = Math.min(sheetMeta.rowCount || 800, 800);
    const range = `${quoteSheet(name)}!A1:${endCol}${endRow}`;
    const matrices = await batchGetValues(rateSheetId, [range], token);
    const values = matrices[0] || [];
    if (!values.length) continue;
    usedSheets.push(name);

    const unifiedParsed = v166ParseUnifiedRateSheet(name, values);
    if (unifiedParsed.rates.length || unifiedParsed.statuses.length) {
      allRates.push(...unifiedParsed.rates);
      allStatuses.push(...unifiedParsed.statuses);
      continue;
    }

    const directParsed = parseDirectGoogleRateSheet(name, values);
    const hasDirectRates = directParsed.rates.length > 0;
    const countryParsed = parseCountryRateSheet(name, values);
    const platformParsed = parsePlatformMatrixSheet(name, values);

    if (hasDirectRates) {
      allRates.push(...directParsed.rates);
      allStatuses.push(...countryParsed.statuses.map(clearStatusFeeFields));
      allStatuses.push(...platformParsed.statuses.map(clearStatusFeeFields));
      allStatuses.push(...directParsed.statuses.map(clearStatusFeeFields));
      continue;
    }

    if (countryParsed.rates.length || countryParsed.statuses.length) {
      allRates.push(...countryParsed.rates);
      allStatuses.push(...countryParsed.statuses);
    }
    if (platformParsed.rates.length || platformParsed.statuses.length) {
      allRates.push(...platformParsed.rates);
      allStatuses.push(...platformParsed.statuses);
    }
    if (directParsed.rates.length || directParsed.statuses.length) {
      allRates.push(...directParsed.rates);
      allStatuses.push(...directParsed.statuses);
    }
  }

  const visibleRates = allRates.filter((row) => !row.country.includes("埃及") && !row.sheetName.includes("埃及"));
  const visibleStatuses = allStatuses.filter((row) => !row.country.includes("埃及") && !row.sheetName.includes("埃及"));
  const dedupedRates = dedupeRows(visibleRates);
  const dedupedStatuses = dedupeRows(visibleStatuses);
  const filled = fillMissingFeeData(dedupedRates, dedupedStatuses);
  const confirmed = applyConfirmedRateRules(filled.rates, filled.statuses);

  const rates = confirmed.rates.sort((a, b) =>
    compareCountryForSort(a.country, b.country) || a.thirdParty.localeCompare(b.thirdParty, "zh-CN")
  );
  const platformStatuses = confirmed.statuses.sort((a, b) =>
    compareCountryForSort(a.country, b.country) ||
    a.platform.localeCompare(b.platform, "zh-CN") ||
    statusScore(a.status) - statusScore(b.status) ||
    a.thirdParty.localeCompare(b.thirdParty, "zh-CN")
  );

  const payload: ThirdPartyRatePayload = {
    meta: {
      year: String(new Date().getFullYear()),
      month: String(new Date().getMonth() + 1),
      updatedAt: new Date().toISOString(),
      source: "google-sheet",
      sheets: usedSheets,
      parserVersion: "v234-fee-match",
    } as any,
    summary: summarizeStatuses(platformStatuses),
    rates,
    platformStatuses,
    anomalies: buildAnomalies(rates, platformStatuses),
  };

  return { source: { meta, sheets: usedSheets }, payload };
}

async function runRatesLightFinal(token: string, rateSheetId: string) {
  // 费率表远小于三方量；单独执行时资源足够，而且保留 v239 完整跨页签费率匹配逻辑。
  const rateSource = await readRateSheetValuesFinal(rateSheetId, token);
  const payload = buildThirdPartyRatePayload(rateSource.values);
  return { source: rateSource, payload };
}

Deno.serve(async (req) => {
  try {
    const expectedSecret = Deno.env.get("SYNC_SECRET") || "";
    const receivedSecret = req.headers.get("x-sync-secret") || "";
    if (!expectedSecret || receivedSecret !== expectedSecret) {
      return json({ ok: false, message: "Unauthorized" }, 401);
    }

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const action = String(body?.action || "").trim().toLowerCase();
    const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") || "";
    const privateKey = normalizePrivateKeySecret(Deno.env.get("GOOGLE_PRIVATE_KEY") || "");
    const rateSheetId = Deno.env.get("THIRD_PARTY_RATE_SHEET_ID") || "";
    const volumeSheetIds = String(Deno.env.get("THIRD_PARTY_VOLUME_SHEET_IDS") || "")
      .split(",").map((x) => x.trim()).filter(Boolean);

    if (!email || !privateKey || !rateSheetId || !volumeSheetIds.length) {
      throw new Error("Google Secrets 不完整");
    }

    const token = await getGoogleAccessToken(email, privateKey);

    if (action === "ping") {
      return json({ ok: true, message: "V7 HISTORY AUTO 已部署，Google Auth OK" });
    }

    // =====================================================
    // 历史补齐：每次只处理 1 个日期 + 1 个方向。
    // 由 pg_cron 每 10 分钟触发，补完后快速返回，不会反复重读历史 Google Sheet。
    // =====================================================
    if (action === "sync-history-next") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase 内置环境变量缺失");
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      // 先找最早一个待补任务，再把同方向、同月份、连续的最多 3 天合并成一次 Google 读取。
      // 这样比“一天扫描一次整张月表”省很多 Google API / Edge Function 流量，同时仍保持低内存。
      const { data: firstRows, error: firstError } = await supabase
        .from("third_party_history_backfill")
        .select("data_date,direction,status,attempts")
        .in("status", ["pending", "retry"])
        .lt("attempts", 5)
        .order("data_date", { ascending: true })
        .order("direction", { ascending: true })
        .limit(1);
      if (firstError) throw new Error(`读取历史补齐队列失败：${firstError.message}`);

      const firstTask = Array.isArray(firstRows) ? firstRows[0] : null;
      if (!firstTask) {
        const { count: failedCount } = await supabase
          .from("third_party_history_backfill")
          .select("data_date", { count: "exact", head: true })
          .eq("status", "failed");
        const failed = Number(failedCount || 0);
        if (failed === 0) {
          // 全部完成后自动停掉历史 Cron，不让它长期空跑消耗 invocation。
          await supabase.rpc("stop_third_party_history_cron").catch(() => undefined);
        }
        return json({
          ok: true,
          action,
          complete: failed === 0,
          failed,
          message: failed > 0 ? "历史补齐队列已跑完，但仍有失败日期需要检查" : "历史补齐已经全部完成，历史 Cron 已自动停止",
        });
      }

      const firstDate = String(firstTask.data_date || "").slice(0, 10);
      const direction = firstTask.direction === "代付" ? "代付" : "代收";
      if (!isIsoDateFinal(firstDate)) throw new Error(`历史补齐日期格式错误：${firstDate}`);

      const { data: candidateRows, error: candidateError } = await supabase
        .from("third_party_history_backfill")
        .select("data_date,direction,status,attempts")
        .eq("direction", direction)
        .in("status", ["pending", "retry"])
        .lt("attempts", 5)
        .gte("data_date", firstDate)
        .order("data_date", { ascending: true })
        .limit(6);
      if (candidateError) throw new Error(`读取历史补齐连续任务失败：${candidateError.message}`);

      const selectedTasks: any[] = [];
      let expectedDate = firstDate;
      const firstMonth = monthKeyFromDateFinal(firstDate);
      for (const row of Array.isArray(candidateRows) ? candidateRows : []) {
        const date = String(row.data_date || "").slice(0, 10);
        if (!isIsoDateFinal(date) || monthKeyFromDateFinal(date) !== firstMonth || date !== expectedDate) break;
        selectedTasks.push(row);
        if (selectedTasks.length >= 3) break;
        const next = new Date(`${date}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        expectedDate = next.toISOString().slice(0, 10);
      }
      if (!selectedTasks.length) selectedTasks.push(firstTask);

      const startDate = String(selectedTasks[0].data_date).slice(0, 10);
      const endDate = String(selectedTasks[selectedTasks.length - 1].data_date).slice(0, 10);
      const parsed = await readAndParseVolumeUltraFinal(volumeSheetIds, token, startDate, endDate, direction);
      const rows = parsed.rows;
      const diagnostics = volumeDiagnosticsFinal(rows);
      const dayResults: any[] = [];
      let totalWritten = 0;

      for (const task of selectedTasks) {
        const date = String(task.data_date || "").slice(0, 10);
        const attempts = Number(task.attempts || 0);
        const dayRows = rows.filter((row) => row.date === date);
        if (!dayRows.length) {
          const nextAttempts = attempts + 1;
          const nextStatus = nextAttempts >= 5 ? "failed" : "retry";
          await supabase
            .from("third_party_history_backfill")
            .update({
              status: nextStatus,
              attempts: nextAttempts,
              last_error: `${date} ${direction} 解析为0行`,
              updated_at: new Date().toISOString(),
            })
            .eq("data_date", date)
            .eq("direction", direction);
          dayResults.push({ date, direction, ok: false, status: nextStatus, attempts: nextAttempts, rows: 0 });
          continue;
        }

        const runAt = new Date().toISOString();
        const written = await upsertBatchesFinal(
          supabase, "third_party_volume", mapVolumeRowsFinal(dayRows, runAt), 300,
        );
        totalWritten += written;

        const { error: cleanupError } = await supabase
          .from("third_party_volume")
          .delete()
          .eq("data_date", date)
          .eq("direction", direction)
          .lt("updated_at", runAt);
        if (cleanupError) throw new Error(`${date} ${direction} 历史旧数据清理失败：${cleanupError.message}`);

        const amount = dayRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const txnCount = dayRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
        const { error: taskUpdateError } = await supabase
          .from("third_party_history_backfill")
          .update({
            status: "success",
            attempts: attempts + 1,
            rows_written: written,
            amount,
            txn_count: txnCount,
            last_error: null,
            last_sync_at: runAt,
            updated_at: runAt,
          })
          .eq("data_date", date)
          .eq("direction", direction);
        if (taskUpdateError) throw new Error(`更新历史补齐状态失败：${taskUpdateError.message}`);

        dayResults.push({ date, direction, ok: true, rows: dayRows.length, written, amount, count: txnCount });
      }

      const finalRunAt = new Date().toISOString();
      await supabase.from("sync_status").upsert({
        module: "third_party_history_backfill",
        last_sync_at: finalRunAt,
        last_data_date: endDate,
        status: dayResults.some((item) => item.ok === false) ? "partial" : "success",
        message: `历史补齐 ${startDate}~${endDate} ${direction}：写入 ${totalWritten} 行`,
        updated_at: finalRunAt,
      }, { onConflict: "module" });

      return json({
        ok: true,
        action,
        complete: false,
        requested: { start: startDate, end: endDate, direction },
        parsed: { volume: diagnostics },
        written: { volume: totalWritten, days: dayResults },
        message: `${startDate}~${endDate} ${direction} 历史数据补齐完成`,
      });
    }

    // =====================================================
    // 费率：单独检查 / 单独同步
    // =====================================================
    if (action === "check-rates" || action === "sync-rates") {
      const { source, payload } = await runRatesUltraFinal(token, rateSheetId);
      const resultBase = {
        ok: true,
        action,
        google: { rateSpreadsheet: source.meta.title },
        parsed: {
          rates: payload.rates.length,
          platformStatuses: payload.platformStatuses.length,
          rateSummary: payload.summary,
        },
        compatibility: {
          canonicalNameMap: "v239 original",
          feeParser: "v239 original",
          platformStatusParser: "v239 original",
        },
      };

      if (action === "check-rates") {
        return json({
          ...resultBase,
          message: "费率检查完成，未写数据库",
          samples: {
            rates: payload.rates.slice(0, 3),
            platformStatuses: payload.platformStatuses.slice(0, 3),
          },
        });
      }

      if (!payload.rates.length || !payload.platformStatuses.length) {
        return json({ ...resultBase, ok: false, message: "费率或盘口状态为0，安全停止" }, 422);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase 内置环境变量缺失");
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const runAt = new Date().toISOString();

      const rateWritten = await upsertBatchesFinal(
        supabase, "third_party_rates", mapRateRowsFinal(payload.rates, runAt), 300,
      );
      const statusWritten = await upsertBatchesFinal(
        supabase, "third_party_platform_status", mapStatusRowsFinal(payload.platformStatuses, runAt), 300,
      );

      const { error: rateCleanupError } = await supabase
        .from("third_party_rates").delete().lt("updated_at", runAt);
      if (rateCleanupError) throw new Error(`费率清理失败：${rateCleanupError.message}`);

      const { error: statusCleanupError } = await supabase
        .from("third_party_platform_status").delete().lt("updated_at", runAt);
      if (statusCleanupError) throw new Error(`盘口状态清理失败：${statusCleanupError.message}`);

      await supabase.from("sync_status").upsert({
        module: "third_party_rates",
        last_sync_at: runAt,
        status: "success",
        message: `直读 Google / v239 原版：费率 ${rateWritten} / 盘口状态 ${statusWritten}`,
        updated_at: runAt,
      }, { onConflict: "module" });

      return json({
        ...resultBase,
        message: "费率 + 盘口状态同步完成",
        written: { rates: rateWritten, platformStatuses: statusWritten },
      });
    }

    // =====================================================
    // 三方量：代收、代付必须分开跑，避免资源超限
    // =====================================================
    if (action === "check-volume" || action === "sync-volume") {
      const directionRaw = String(body?.direction || "").trim();
      const direction: "代收" | "代付" | "" = directionRaw === "代收" || directionRaw === "代付"
        ? directionRaw as "代收" | "代付"
        : "";
      if (!direction) {
        return json({ ok: false, message: "direction 必须填 代收 或 代付" }, 400);
      }

      const start = String(body?.start || body?.date || "").trim();
      const end = String(body?.end || body?.date || start).trim();
      // 小时同步模式：只 UPSERT，不做清理。避免某个国家/平台暂时还没到数时，
      // 把数据库里上一轮已经存在的数据误删。手动/最终同步默认仍保留原来的清理逻辑。
      const hourlySafe = String(body?.mode || "").trim().toLowerCase() === "hourly" || body?.hourly === true;
      if (!isIsoDateFinal(start) || !isIsoDateFinal(end)) {
        return json({ ok: false, message: "请传 date，例如 2026-07-31" }, 400);
      }
      if (start > end) return json({ ok: false, message: "start 不能大于 end" }, 400);
      if (monthKeyFromDateFinal(start) !== monthKeyFromDateFinal(end)) {
        return json({ ok: false, message: "轻量版一次只能处理同一个月份" }, 400);
      }

      const parsed = await readAndParseVolumeUltraFinal(volumeSheetIds, token, start, end, direction);
      const rows = parsed.rows;
      const diagnostics = volumeDiagnosticsFinal(rows);
      const resultBase = {
        ok: true,
        action,
        requested: { start, end, direction },
        google: { volumeSources: parsed.info },
        parsed: { volume: diagnostics },
        compatibility: {
          canonicalNameMap: "v239 original",
          manualConfirmationKept: true,
          manualRechargeKept: true,
          uiContract: "v239 dashboard aggregation",
        },
      };

      if (action === "check-volume") {
        return json({
          ...resultBase,
          message: `${direction}检查完成，未写数据库`,
          samples: rows.slice(0, 3),
        });
      }

      if (!rows.length) {
        return json({ ...resultBase, ok: false, message: `${direction}目标日期解析为0行，安全停止，不删除旧数据` }, 422);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase 内置环境变量缺失");
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      let totalWritten = 0;
      const dayResults: any[] = [];
      const dates = Array.from(new Set(rows.map((r) => r.date))).sort();
      for (const date of dates) {
        const dayRows = rows.filter((r) => r.date === date);
        if (!dayRows.length) continue;
        const runAt = new Date().toISOString();
        const written = await upsertBatchesFinal(
          supabase, "third_party_volume", mapVolumeRowsFinal(dayRows, runAt), 300,
        );
        totalWritten += written;

        if (!hourlySafe) {
          // 最终/手动同步：只清理这一天的这个方向；另一个方向不会被误删。
          const { error: cleanupError } = await supabase
            .from("third_party_volume")
            .delete()
            .eq("data_date", date)
            .eq("direction", direction)
            .lt("updated_at", runAt);
          if (cleanupError) throw new Error(`${date} ${direction}旧数据清理失败：${cleanupError.message}`);
        }

        dayResults.push({ date, direction, rows: dayRows.length, written, cleanup: !hourlySafe });
      }

      const finalRunAt = new Date().toISOString();
      await supabase.from("sync_status").upsert({
        module: "third_party_volume",
        last_sync_at: finalRunAt,
        last_data_date: end,
        status: "success",
        message: `${start}~${end} ${direction} 直读 Google / v239 原版，写入 ${totalWritten} 行${hourlySafe ? "（小时安全模式：仅UPSERT不清理）" : ""}`,
        updated_at: finalRunAt,
      }, { onConflict: "module" });

      return json({
        ...resultBase,
        message: `${direction}同步完成${hourlySafe ? "（小时安全模式）" : ""}`,
        mode: hourlySafe ? "hourly-safe" : "final-cleanup",
        written: { volume: totalWritten, days: dayResults },
      });
    }

    return json({
      ok: false,
      message: "action 请使用：ping / check-rates / sync-rates / check-volume / sync-volume / sync-history-next",
      examples: {
        rates: { action: "check-rates" },
        collect: { action: "check-volume", date: "2026-07-31", direction: "代收" },
        payout: { action: "check-volume", date: "2026-07-31", direction: "代付" },
      },
    }, 400);
  } catch (error) {
    return json({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
