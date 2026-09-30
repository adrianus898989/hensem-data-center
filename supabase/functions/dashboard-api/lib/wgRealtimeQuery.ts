export function wgRealtimeQuery(params:URLSearchParams) {
  const site=params.get("site")||"",start=params.get("start")||"",end=params.get("end")||"";
  const business=params.get("business")||"withdraw",basis=params.get("basis")||"created",section=params.get("section")||"orders";
  const page=Number(params.get("page")||"1"),size=Number(params.get("size")||"50"),query=(params.get("query")||"").trim();
  const day=(value:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;
  if(!["278","8311","12588","3257","3605"].includes(site)||!day(start)||!day(end)||start>end||Date.parse(end)-Date.parse(start)>30*86400000
    ||!(business==="recharge"?["created","updated","success"].includes(basis):business==="withdraw"&&["created","operated"].includes(basis))
    ||!["orders","summary","providers","operators","reasons","config","midnight"].includes(section)
    ||!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(size)||size<1||size>100||query.length>128||/[\x00-\x1f\x7f]/.test(query))throw new Error("WG_INVALID_QUERY");
  return {p_site:site,p_start:start,p_end:end,p_business:business,p_basis:basis,p_section:section,p_page:page,p_size:size,p_query:query};
}
