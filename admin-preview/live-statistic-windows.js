/* Independent metric clocks. Source update time is never an ingestion clock. */
(function(root){
 'use strict';
 const fields=['from','to','successFrom','successTo','successBasis'];
 const aggregatePages=new Set(['overview','collection','payout','merchants','providers','provider_payout','success_analysis','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms','daily_comparison']);
 function valid(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value))return false;
  const date=new Date(value+'Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,19)===value&&value>='2000-01-01T00:00:00';
 }
 function ensure(state){
  if(state.successFrom==null)state.successFrom='';
  if(state.successTo==null)state.successTo='';
  if(!state.successBasis)state.successBasis='success';
 }
 function reset(state){state.successFrom='';state.successTo='';state.successBasis='success';}
 function hasSuccessWindow(state){return !!(state.successFrom&&state.successTo);}
 function validate(state){
  ensure(state);
  if(!!state.successFrom!==!!state.successTo)throw Error('成功开始时间和结束时间须同时填写，或同时留空');
  for(const [from,to,label]of [['from','to','创建'],['successFrom','successTo',state.successBasis==='source_updated'?'源订单更新':'成功']]){
   if(from==='successFrom'&&!hasSuccessWindow(state))continue;
   if(!valid(state[from])||!valid(state[to])||state[from]>state[to])throw Error(label+'时间范围无效');
   const days=(Date.parse(state[to].slice(0,10)+'T00:00:00Z')-Date.parse(state[from].slice(0,10)+'T00:00:00Z'))/86400000;
   if(days>30)throw Error(label+'时间每次最多31个当地日');
  }
  if(!['success','source_updated'].includes(state.successBasis))throw Error('成功统计时间依据无效');
 }
 function request(state,platform,instant){
  validate(state);
  if(typeof platform?.timezone!=='string'||!platform.timezone.trim())throw Error('平台时区未提供');
  new Intl.DateTimeFormat('en',{timeZone:platform.timezone});
  const independent=hasSuccessWindow(state),basis=String(platform.source||'').toLowerCase().replaceAll('_','')==='duoli'?'source_updated':independent?state.successBasis:'success';
  return {startAt:instant(state.from,platform.timezone),endAt:instant(state.to,platform.timezone,true),successStartAt:instant(independent?state.successFrom:state.from,platform.timezone),successEndAt:instant(independent?state.successTo:state.to,platform.timezone,true),successBasis:basis};
 }
 function same(state){ensure(state);return state.successBasis==='success'&&(!state.successFrom&&!state.successTo||state.from===state.successFrom&&state.to===state.successTo);}
 function render(state,escape,zone){
  ensure(state);
  const endpoint=(key,label)=>'<label class="live-metric-endpoint" for="liveMetric-'+key+'"><span>'+label+'</span><input id="liveMetric-'+key+'" aria-label="'+label+'" type="datetime-local" step="1" value="'+escape(state[key]||'')+'" onchange="liveMetricTimeSet(\''+key+'\',this.value)"></label>';
  return '<div class="live-metric-windows" role="group" aria-label="统计时间范围"><div class="live-metric-window">'+endpoint('from','创建开始时间')+endpoint('to','创建结束时间')+'</div><div class="live-metric-window">'+endpoint('successFrom','成功开始时间（可选）')+endpoint('successTo','成功结束时间（可选）')+'</div><span class="live-metric-zone">'+escape(zone)+'</span></div>';
 }
 root.HensemStatisticWindows={fields,enabled:page=>aggregatePages.has(page),valid,ensure,reset,validate,hasSuccessWindow,request,same,render};
})(typeof window==='undefined'?globalThis:window);
