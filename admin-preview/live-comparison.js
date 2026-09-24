/* Pure comparison helpers. Call metrics only with identical dimensions, currency,
 * business direction and metric definitions. All local end bounds are inclusive seconds.
 * No DOM, network, global filters or business data are read by this module. */
(function(root){
 'use strict';
 const formatters=new Map();
 function formatter(timezone){
  if(typeof timezone!=='string'||!timezone.trim())throw Error('缺少平台时区');
  if(!formatters.has(timezone))formatters.set(timezone,new Intl.DateTimeFormat('en-CA',{timeZone:timezone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  return formatters.get(timezone);
 }
 function localClock(epoch,timezone){const p=Object.fromEntries(formatter(timezone).formatToParts(epoch).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second}
 function localInput(value){
  if(typeof value!=='string')throw Error('请输入当地日期和时间');
  const normalized=value.length===16?value+':00':value;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized))throw Error('日期时间格式无效');
  const epoch=Date.parse(normalized+'Z');
  if(!Number.isFinite(epoch)||new Date(epoch).toISOString().slice(0,19)!==normalized)throw Error('日期时间无效');
  return normalized;
 }
 // UTC is used here only as a floating Gregorian calendar, never to shift an IANA instant.
 function shiftCalendarDays(local,days){const date=new Date(local+'Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,19)}
 function calendarSpan(from,to){return Math.round((Date.parse(to.slice(0,10)+'T00:00:00Z')-Date.parse(from.slice(0,10)+'T00:00:00Z'))/86400000)+1}
 function uniqueInstant(local,timezone){
  const wall=Date.parse(local+'Z'),offsets=new Set([-48,-24,0,24,48].map(hours=>{const probe=wall+hours*3600000;return Date.parse(localClock(probe,timezone)+'Z')-probe}));
  const matches=[...offsets].map(offset=>wall-offset).filter(epoch=>localClock(epoch,timezone)===local);
  if(matches.length!==1)throw Error(matches.length?'时区存在重复钟点，请调整比较边界':'时区存在跳时，请调整比较边界');
  return matches[0];
 }
 function currentEpoch(now){
  if(typeof now==='string'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(now))throw Error('当前时间必须包含时区');
  const epoch=typeof now==='number'?now:typeof now==='string'?Date.parse(now):Object.prototype.toString.call(now)==='[object Date]'?Number(now):NaN;
  if(!Number.isFinite(epoch))throw Error('当前时间无效');
  return Math.floor(epoch/1000)*1000;
 }
 function unavailable(error){return {valid:false,currentFrom:null,currentTo:null,previousFrom:null,previousTo:null,label:'无法比较',calendarDays:null,clamped:false,error}}
 function windowFor(from,to,timezone,now=Date.now()){
  try{
   formatter(timezone);
   const requestedFrom=localInput(from),requestedTo=localInput(to),nowEpoch=currentEpoch(now),localNow=localClock(nowEpoch,timezone);
   if(requestedFrom>requestedTo)throw Error('起始时间不能晚于截止时间');
   if(requestedFrom>localNow)throw Error('起始时间晚于当前时间，暂无可比较数据');
   const days=calendarSpan(requestedFrom,requestedTo),currentTo=requestedTo>localNow?localNow:requestedTo,currentFrom=requestedFrom,clamped=currentTo!==requestedTo;
   // Preserve the selected full calendar-period length even when today's progress is partial.
   const previousFrom=shiftCalendarDays(currentFrom,-days),previousTo=shiftCalendarDays(currentTo,-days);
   const start=uniqueInstant(currentFrom,timezone),end=uniqueInstant(currentTo,timezone),priorStart=uniqueInstant(previousFrom,timezone),priorEnd=uniqueInstant(previousTo,timezone);
   if(start>nowEpoch||start>end||priorStart>priorEnd)throw Error('比较时段无效');
   return {valid:true,currentFrom,currentTo,previousFrom,previousTo,label:(days===1?'较前一日同一时段':'较前一周期（'+days+'天）')+(clamped?' · 同进度':''),calendarDays:days,clamped,error:null};
  }catch(error){return unavailable(error instanceof Error?error.message:'比较时段无效')}
 }
 function number(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))return null;
  const result=Number(value);return Number.isFinite(result)?result:null;
 }
 function unknown(basis){return {value:null,display:'—',trend:'unknown',basis}}
 function rounded(raw,suffix,basis){
  if(!Number.isFinite(raw))return unknown(basis);
  const value=Number(raw.toFixed(2)),trend=value>0?'up':value<0?'down':'flat';
  return {value,display:trend==='flat'?'持平':(value>0?'+':'')+value.toFixed(2)+suffix,trend,basis};
 }
 function delta(current,previous){
  const a=number(current),b=number(previous);if(a===null||b===null)return unknown('percent');
  if(b===0){if(a===0)return {value:0,display:'持平',trend:'flat',basis:'percent'};return {value:null,display:a>0?'新增 / 无基数':'无基数',trend:a>0?'up':'down',basis:'no_baseline'}}
  return rounded((a-b)/Math.abs(b)*100,'%','percent');
 }
 function rateDelta(success,total,priorSuccess,priorTotal){
  const values=[success,total,priorSuccess,priorTotal].map(number);
  if(values.some(v=>v===null||!Number.isSafeInteger(v)||v<0))return unknown('percentage_points');
  const [a,n,b,m]=values;if(n===0||m===0||a>n||b>m)return unknown('percentage_points');
  return rounded((a/n-b/m)*100,' 个百分点','percentage_points');
 }
 root.HensemLiveCompare=Object.freeze({windowFor,delta,rateDelta});
})(typeof window==='object'?window:globalThis);
