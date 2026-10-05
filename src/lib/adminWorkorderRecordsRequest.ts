// Dedicated collected-workorder contract: does not broaden other read actions.
const filterKeys=['team','platform','from','to','dateBasis','issueKind','statusCode','workorderId','workorderNo','orderNo','sourceOrderNo','utr','provider','operator','minAmount','maxAmount','kyc','utrMatch','registrationStatus','successBasis'];
export function validateWorkorderRecordsRequest(p:Record<string,unknown>):Record<string,unknown>{
 if(p.action!=='workorderRecords'||Object.keys(p).some(k=>!['action','view','operation','country','filters','offset','limit'].includes(k)))throw Error('工单记录参数无效');
 const view=p.view??'records',operation=p.operation??'list';
 // A small authorized directory for bounded India deposit reconciliation reads.
 // It cannot carry detail filters or pagination into the legacy reader.
 if(operation==='reconciliationPlatforms'){
  if(view!=='missing'||typeof p.country!=='string'||!['IN','印度'].includes(p.country)||'offset' in p||'limit' in p)throw Error('核对平台目录参数无效');
  const raw=p.filters;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('核对平台目录筛选无效');
  const filters:Record<string,string>={};
  for(const [k,v] of Object.entries(raw)){if(!['dateBasis','issueKind','platform'].includes(k)||typeof v!=='string'||v.length>200||/[\u0000-\u001f\u007f]/.test(v))throw Error('核对平台目录筛选无效');filters[k]=v.trim();}
  if(filters.dateBasis!=='submission'||filters.issueKind!=='deposit')throw Error('核对平台目录仅支持印度存款提交工单');
  return{action:'workorderRecords',view,operation,country:p.country,filters};
 }
 if(typeof view!=='string'||!['records','orders','missing','workload'].includes(view)||!['list','detail','summary','orderDetail'].includes(String(operation))||operation==='detail'&&view!=='records'||operation==='orderDetail'&&view!=='orders'||operation==='summary'&&!['records','orders'].includes(view))throw Error('工单记录页面无效');
 if(typeof p.country!=='string'||!['IN','印度','BR','巴西','PK','巴基斯坦','ID','印尼','VN','越南','PH','菲律宾','MY','马来','MM','缅甸','NG','尼日利亚','CO','哥伦比亚','MX','墨西哥','CL','智利'].includes(p.country))throw Error('请选择国家');
 const registration=view==='missing'&&['IN','印度'].includes(p.country)&&Boolean(p.filters&&typeof p.filters==='object'&&!Array.isArray(p.filters)&&(p.filters as Record<string,unknown>).dateBasis==='submission'&&['','deposit'].includes(String((p.filters as Record<string,unknown>).issueKind??'')));
 const raw=p.filters??{};if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('工单筛选无效');const f:Record<string,string>={};
 for(const [k,v] of Object.entries(raw)){if(!filterKeys.includes(k)||typeof v!=='string'||v.length>200||/[\u0000-\u001f\u007f]/.test(v))throw Error('工单筛选无效');f[k]=v.trim();}
 if('team' in f&&(!['records','orders'].includes(view)||!['list','summary'].includes(String(operation))))throw Error('该条件不适用于当前页面');
 if(operation==='detail'&&(!f.platform||!f.workorderId))throw Error('请选择工单');
 if(operation==='orderDetail'&&(!f.platform||!f.orderNo||!['deposit','withdraw'].includes(f.issueKind)||Object.keys(f).some(k=>!['platform','orderNo','issueKind'].includes(k))))throw Error('请选择完整原支付订单');
 for(const k of ['from','to'])if(f[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(f[k])||!Number.isFinite(Date.parse(f[k]+'T00:00Z'))||new Date(f[k]+'T00:00Z').toISOString().slice(0,10)!==f[k]))throw Error('日期无效');
 if(Boolean(f.from)!==Boolean(f.to)||f.from&&(f.from>f.to||Date.parse(f.to)-Date.parse(f.from)>92*86400000))throw Error('日期范围最多93天');
 for(const [k,choices] of Object.entries({dateBasis:['submission','operation'],issueKind:['deposit','withdraw'],statusCode:['1','2','3','4','5'],kyc:['yes','no','unknown'],utrMatch:['yes','no','unknown'],registrationStatus:['missing','matched','review']}))if(f[k]&&!choices.includes(f[k]))throw Error('工单筛选选项无效');
 if(view!=='missing'&&f.registrationStatus||view==='missing'&&!registration&&f.statusCode&&f.statusCode!=='3'||view==='workload'&&f.statusCode)throw Error('该条件不适用于当前页面');
 if('successBasis' in f&&(!registration||!['','receipt','processed'].includes(f.successBasis)))throw Error('成功排除口径无效');
 if(registration){if(f.dateBasis&&f.dateBasis!=='submission'||f.sourceOrderNo||f.operator||f.utrMatch)throw Error('漏登核对按提交日期和完整订单核对');f.dateBasis='submission';f.successBasis=f.successBasis||'processed';}
 for(const k of ['minAmount','maxAmount'])if(f[k]&&!/^\d{1,16}(\.\d{1,8})?$/.test(f[k]))throw Error('金额范围无效');
 if(f.minAmount&&f.maxAmount&&Number(f.minAmount)>Number(f.maxAmount))throw Error('金额范围无效');
 const offset=p.offset??0,limit=p.limit??50;if(!Number.isSafeInteger(offset)||Number(offset)<0||Number(offset)>1000000||typeof limit!=='number'||![20,50,100].includes(limit))throw Error('分页参数无效');
 return{action:'workorderRecords',view,operation,country:p.country,filters:f,offset,limit};
}
