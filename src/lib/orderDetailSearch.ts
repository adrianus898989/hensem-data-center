import {indiaDay,orderTimeRequest,type OrderTimeFilters} from "./orderTimeQuery";

export type OrderDetailSearchDraft=OrderTimeFilters&{amountMin:string;amountMax:string;provider:string};
export type OrderDetailCursor={at:string;direction:"charge"|"withdraw";id:string};
export type OrderDetailRow={
  id:string;order_number:string|null;member_id:string|null;third_party_order_number:string|null;
  direction:"charge"|"withdraw";provider:string;channel_type:string;status:string;status_group:string;succeeded:boolean;
  created_at:string|null;success_at:string|null;amount:number|string;actual_amount:number|string|null;withdraw_fee:number|string|null;
  synced_at:string;cross_day:boolean;
};
export type OrderDetailPage={rows:OrderDetailRow[];hasMore:boolean;nextCursor:OrderDetailCursor|null};

/** Detail amounts must never use the integer-rounded dashboard summary formatter. */
export function formatOrderDetailAmount(value:number|string|null|undefined):string {
  if(value===null||value===undefined)return "—";
  if(typeof value==="number")return Number.isFinite(value)?value.toLocaleString("en-US",{maximumFractionDigits:20}):"—";
  const text=value.trim();
  if(!/^-?\d+(?:\.\d+)?$/.test(text))return "—";
  const [integer,fraction]=text.split(".");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g,",")+(fraction===undefined?"":`.${fraction}`);
}
export function orderDetailAccessDenied(error:unknown):boolean {
  const value=error as {status?:number;code?:string};
  return [401,403].includes(Number(value?.status))||value?.code==="42501"||/^(28)/.test(String(value?.code||""));
}

export function initialOrderDetailSearch(day=indiaDay(-1)):OrderDetailSearchDraft {
  return {platform:"",basis:"created",start:`${day}T00:00:00`,end:`${day}T23:59:59`,direction:"all",
    createdStart:"",createdEnd:"",memberId:"",orderNumber:"",status:"all",crossDayOnly:false,
    amountMin:"",amountMax:"",provider:""};
}

/** Send decimals as strings: do not round an amount through JavaScript Number. */
function decimalAmount(value:string,label:string):string|null {
  const text=String(value??"").trim();if(!text)return null;
  if(!/^\d{1,18}(?:\.\d{1,8})?$/.test(text))throw new Error(`${label}请填写非负金额，最多8位小数，不使用逗号或科学计数法。`);
  const [integer,fraction=""]=text.split(".");
  const whole=integer.replace(/^0+(?=\d)/,"");
  const decimals=fraction.replace(/0+$/,"");
  return decimals?`${whole}.${decimals}`:whole;
}
function amountGreater(left:string,right:string):boolean {
  const [a,af=""]=left.split("."),[b,bf=""]=right.split(".");
  return a.length!==b.length?a.length>b.length:a!==b?a>b:af.padEnd(8,"0")>bf.padEnd(8,"0");
}
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function validOrderDetailCursor(value:unknown):value is OrderDetailCursor {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const cursor=value as Partial<OrderDetailCursor>;
  return typeof cursor.at==="string"&&Number.isFinite(Date.parse(cursor.at))
    &&(cursor.direction==="charge"||cursor.direction==="withdraw")&&typeof cursor.id==="string"&&UUID.test(cursor.id);
}

export function orderDetailSearchRequest(draft:OrderDetailSearchDraft,cursor:OrderDetailCursor|null=null) {
  if(typeof draft.platform!=="string"||!UUID.test(draft.platform))throw new Error("请先选择一个平台，订单明细不支持全部平台查询。");
  const base=orderTimeRequest(draft);
  const amountMin=decimalAmount(draft.amountMin,"最低订单金额"),amountMax=decimalAmount(draft.amountMax,"最高订单金额");
  if(amountMin!==null&&amountMax!==null&&amountGreater(amountMin,amountMax))throw new Error("最低订单金额不能高于最高订单金额。");
  const provider=draft.provider.trim();
  if(provider.length>200)throw new Error("三方通道名称过长。");
  if(cursor!==null&&!validOrderDetailCursor(cursor))throw new Error("分页位置无效，请重新查询。");
  return {...base,p_amount_min:amountMin,p_amount_max:amountMax,p_providers:provider?[provider]:null,
    p_cursor:cursor,p_limit:50};
}

export function validateOrderDetailPage(value:unknown):OrderDetailPage {
  const page=value as OrderDetailPage;
  if(!page||!Array.isArray(page.rows)||page.rows.length>50||typeof page.hasMore!=="boolean"
    ||(page.hasMore&&!validOrderDetailCursor(page.nextCursor)))throw new Error("订单明细返回不完整，请重试；未显示部分数据。");
  return {...page,nextCursor:page.hasMore?page.nextCursor:null};
}
