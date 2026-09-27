export function validateDepositStatisticsRequest(value:Record<string,unknown>):Record<string,unknown>{
 const textKeys=['country','platform','provider','status','match','confirmation','orderNumber','utr','upiId','kycUpiId','reply','utrMatch','kycCorrect'];
 const allowed=new Set(['action','section','dateMode','startAt','endAt','offset','limit','amountMin','amountMax',...textKeys]);
 if(Object.keys(value).some(key=>!allowed.has(key)))throw Error('统计筛选字段无效');
 if(!['summary','details','providers','daily'].includes(String(value.section??'summary'))||!['all','range'].includes(String(value.dateMode??'all')))throw Error('统计视图无效');
 for(const key of textKeys)if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>200||/[\u0000-\u001f\u007f]/.test(value[key])))throw Error('统计筛选内容无效');
 if(value.country!==undefined&&!['','all','印度','IN'].includes(String(value.country)))throw Error('核对统计目前仅接入印度');
 if(value.offset!==undefined&&(!Number.isSafeInteger(value.offset)||Number(value.offset)<0||Number(value.offset)>1000000)||value.limit!==undefined&&(typeof value.limit!=='number'||![20,50,100].includes(value.limit)))throw Error('分页参数无效');
 for(const key of ['amountMin','amountMax'])if(value[key]!==undefined&&(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<0))throw Error('金额范围无效');
 if(value.amountMin!==undefined&&value.amountMax!==undefined&&Number(value.amountMin)>Number(value.amountMax))throw Error('金额范围无效');
 if(value.dateMode==='range'){
  for(const key of ['startAt','endAt']){const v=value[key];if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v.slice(0,10))throw Error('日期无效');}
  const span=Date.parse(String(value.endAt).slice(0,10))-Date.parse(String(value.startAt).slice(0,10));if(span<0||span>366*86400000)throw Error('日期范围最多367天');
 }
 return {...value};
}
