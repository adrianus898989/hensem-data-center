// 三方名称统一：严格按国家匹配，马来 TRUEPAY/TPAY 不再串到越南 FASTPAY。
import { normalizeCell } from "./format";

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
  { country: "菲律宾", canonical: "PAYRORO", aliases: ["roroPay", "RoroPay", "ROROPAY", "PAYRORO", "PayRoro"] },
  { country: "菲律宾", canonical: "DyPay", aliases: ["DyPayV2", "DYPAYV2", "DyPay", "DYPAY"] },
  { country: "巴基斯坦", canonical: "MCBPay", aliases: ["MCB", "MCBPay", "mcbPay", "MCB-JZ", "MCB_JZ", "MCB JZ", "MCB-Jazz"] },
  { country: "菲律宾", canonical: "PinoyPay", aliases: ["nova", "Nova", "NOVAPAY", "NovaPay", "PINOYPAY", "PinoyPay"] },
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
    // V7O：Arb-UPI / Arb-BANK 是 UPI-QR 的代付别名。Arb-BANK 名字里虽然有 BANK，但业务类型仍是 UPI。
    if (/arb[-_ ]?(upi|bank)/i.test(raw) || /arbupi|arbbank/.test(compact)) return "UPI";
    // 用户确认：印度线下表就是“印度”；印度三方量里的类型重点区分 UPI / 银行卡 / USDT。
    if (/usdt|trx|trc20|tron/i.test(raw) || /usdt|trx|trc20|tron/i.test(text)) return "USDT";
    if (/bank|银行卡|银行|card|cardpay|fastupi提现/i.test(raw) || /bank|card|arbpayinr/.test(text)) return "银行卡";
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

  // 用户确认：菲律宾主三方名称统一。
  if (c === "菲律宾") {
    if (/^(roropay|payroro)$/.test(key)) return "PAYRORO";
    if (/^(dypay|dypayv2)$/.test(key)) return "DyPay";
    if (/^(nova|novapay|pinoypay)$/.test(key)) return "PinoyPay";
  }

  // 用户确认：巴基斯坦三方别名统一。
  if (c === "巴基斯坦") {
    if (/^(mcb|mcbpay|mcbjz|mcbjazz|mcbjzpay)$/.test(key)) return "MCBPay";
    if (/^(owpay|owenpay|owenpayowpay)$/.test(key)) return "OwenPay";
    if (/^(op3pay|openpay|openpayop3pay)$/.test(key)) return "OpenPay";
    if (/^(omnipay|epay|epayomnipay)$/.test(key)) return "EPAY";
  }

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
      mcb: "MCBPay", mcbpay: "MCBPay", mcbjz: "MCBPay", mcbjazz: "MCBPay", mcbjzpay: "MCBPay",
      owpay: "OwenPay", owenpayowpay: "OwenPay",
      op3pay: "OpenPay", openpayop3pay: "OpenPay",
      omnipay: "EPAY", epayomnipay: "EPAY",
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
      roropay: "PAYRORO", payroro: "PAYRORO",
      dypay: "DyPay", dypayv2: "DyPay",
      nova: "PinoyPay", novapay: "PinoyPay", pinoypay: "PinoyPay"
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
  if (/dypay|dy-pay|pix-?20\b|pixpay0?20\b/.test(x)) return cKeyNow === "菲律宾" ? "DyPay" : "DyPayV2";

  // Existing cross-country mappings.
  if (/bfpay|bf-pay/.test(x)) return "BFPAY";
  if (/shijie|shije|shi-jie|世界/.test(x)) return cKeyNow === "菲律宾" ? "ShiJie" : "SHIJIE";
  if (/novapay|nova-pay|^nova$|^pinoypay$/.test(x)) return cKeyNow === "菲律宾" ? "PinoyPay" : "NOVAPAY";
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
