// The browser carries its current backend session to one fixed read-only endpoint.
export function validatePortalOperationLogsRequest(value:Record<string,unknown>):Record<string,unknown>{
 const allowed=['action','country','filters','offset','limit'];
 if(Object.keys(value).some(k=>!allowed.includes(k))||!['印度','IN'].includes(String(value.country)))throw Error('工单操作日志目前仅接入印度');
 const filters=value.filters??{};
 if(!filters||typeof filters!=='object'||Array.isArray(filters))throw Error('日志筛选无效');
 const f=filters as Record<string,unknown>;
 if(Object.keys(f).some(k=>!['from','to','platform','operator','action','orderNo','workorderNo','utr'].includes(k)))throw Error('日志筛选字段无效');
 for(const v of Object.values(f))if(typeof v!=='string'||v.length>200||/[\u0000-\u001f\u007f]/.test(v))throw Error('日志筛选内容无效');
 if(f.action&&!['create','follow','approve','reopen','link','assign'].includes(String(f.action)))throw Error('日志操作类型无效');
 if(f.from||f.to){
  for(const day of [f.from,f.to])if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw Error('日志日期无效');
  const span=Date.parse(String(f.to))-Date.parse(String(f.from));if(span<0||span>92*86400000)throw Error('日志每次最多查询93天');
 }
 if(value.offset!==undefined&&(!Number.isSafeInteger(value.offset)||Number(value.offset)<0||Number(value.offset)>1000000)||value.limit!==undefined&&(typeof value.limit!=='number'||![20,50,100].includes(value.limit)))throw Error('日志分页无效');
 return {...value,filters:{...f}};
}
