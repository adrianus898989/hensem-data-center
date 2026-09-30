/* Source-day evidence is independent of a successful aggregate response. */
(function(root){
 'use strict';
 const statuses=new Set(['complete','zero_complete','received','partial','pending','failed','not_started','not_received','not_expected','unverified']);
 const messages={only_success_day_records_received:'仅收到该日成功记录，未收到该创建日订单；需要核查采集端并补同步',no_created_orders_received:'未收到该创建日订单，也没有完整零笔证明',records_received_completeness_unverified:'已收到创建订单，缺少完整日采集证明',source_collection_failed:'采集任务失败，已收到部分记录仍保留',source_task_not_finished:'采集任务尚未完成',no_collection_run_evidence:'未找到该日采集任务或创建订单',source_counts_not_verified:'创建日源总数尚未核对',source_created_counts_reconciled:'创建总数及渠道分组已核对',source_created_count_mismatch:'创建笔数与完整日快照不一致',source_created_channel_mismatch:'创建渠道分组与完整日快照不一致',source_snapshot_invalid:'日快照未通过完整性核验',source_completed_zero_rows:'完整采集回执确认当日零笔',source_day_task_completed:'当日完整采集回执与入库记录一致',before_verified_launch:'早于已确认接入日期，不计缺失',source_timezone_unknown:'来源时区未明确，不能确认当地日期',source_full_day_not_published:'尚未收到整日完整发布回执',published_records_not_received:'完整采集回执已有，订单记录未收到',completed_zero_conflicts_with_records:'零笔回执与现有记录冲突',unsupported_source:'该来源暂未提供逐日核对依据'};
 const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 function dates(from,to){if(!validDate(from)||!validDate(to)||to<from||Date.parse(to)-Date.parse(from)>92*86400000)throw Error('采集核对日期无效');const out=[];for(let d=Date.parse(from);d<=Date.parse(to);d+=86400000)out.push(new Date(d).toISOString().slice(0,10));return out;}
 function today(at,zone){if(typeof zone!=='string'||!zone.trim())return '';try{return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}catch{return '';}}
 function validate(result,feeds,from,to){
  if(result?.version!==1||result.complete!==true||result.startAt!==from||result.endAt!==to||!Array.isArray(result.feedIds)||result.feedIds.length!==feeds.length||new Set(result.feedIds).size!==feeds.length||!feeds.every(f=>result.feedIds.includes(f.id))||!Array.isArray(result.rows)||!Number.isFinite(Date.parse(result.checkedAt)))throw Error('采集核对响应不完整');
  const grouped=new Map(feeds.map(f=>[f.id,[]]));
  for(const row of result.rows){if(!grouped.has(row.feedId)||!statuses.has(row.status)||!['received','complete','zeroConfirmed','expected'].every(k=>typeof row[k]==='boolean')||row.date!==null&&(!validDate(row.date)||row.date<from||row.date>to)||row.complete&&!['complete','zero_complete'].includes(row.status)||row.status==='zero_complete'&&(!row.complete||!row.zeroConfirmed)||row.zeroConfirmed&&(row.status!=='zero_complete'||!row.complete)||row.status==='complete'&&(!row.complete||!row.received))throw Error('采集核对响应不完整');grouped.get(row.feedId).push(row);}
  for(const feed of feeds){const rows=grouped.get(feed.id),seen=rows.map(r=>r.date),cutoff=today(result.checkedAt,feed.timezone);
   if(new Set(seen).size!==seen.length)throw Error('采集核对返回重复日期');
   if(seen.includes(null)){if(rows.length!==1||rows[0].status!=='unverified'||rows[0].expected)throw Error('采集核对日期异常');continue;}
   const expected=dates(from,to).filter(d=>d<cutoff);if(!cutoff||seen.length!==expected.length||!expected.every(d=>seen.includes(d)))throw Error('采集核对缺少日期');
  }
  return grouped;
 }
 function summarize(platform,feed,rows,from,to){
  const byDay=new Map((rows||[]).map(r=>[r.date,r])),days=dates(from,to).map(date=>{
   let row=byDay.get(date)||{date,status:'unverified',received:false,complete:false,expected:true,evidence:byDay.get(null)?.evidence||'day_not_verified'};
   // Success-date rows are not creation-date intake, including older responses
   // that incorrectly marked the presence of success records as received.
   if(row.evidence==='only_success_day_records_received')row={...row,status:'not_received',received:false,complete:false,zeroConfirmed:false};
   return {...row,dataset:feed?.dataset||'orders',direction:feed?.direction||'',notes:row.message||messages[row.evidence]||(row.evidence==='day_not_verified'?'当日或未来日期尚无完整日核对结果':'采集完整性待核验')};
  });
  const expected=days.filter(d=>d.status!=='not_expected'),missing=expected.filter(d=>['not_received','not_started','partial','failed'].includes(d.status));
  const received=expected.length>0&&expected.every(d=>d.received||d.zeroConfirmed),complete=expected.length>0&&expected.every(d=>d.complete);
  return {id:platform.id,name:platform.name,source:platform.source,days,missingDates:missing.map(d=>d.date),received,complete,status:missing.length?'missing':complete?(expected.every(d=>d.zeroConfirmed)?'zero_complete':'complete'):received?'received':'unverified',message:missing.length?missing.map(d=>d.date+'：'+d.notes).join('；'):complete?'创建日数据已核对':received?'已收到创建数据，完整性待核验':'创建日采集证据尚未核验'};
 }
 function create({request}){
  let revision=0,catalog=null;
  const cancel=()=>{revision++;catalog=null;};
  async function load({platforms,direction,from,to}){
   const current=revision,check=()=>{if(current!==revision)throw Error('采集核对已暂停');};dates(from,to);
   if(!catalog)catalog=Promise.resolve(request({action:'intakeCoverage',operation:'catalog'})).then(r=>{if(r?.version!==1||r.complete!==true||!Array.isArray(r.feeds)||new Set(r.feeds.map(f=>f.id)).size!==r.feeds.length)throw Error('采集目录响应不完整');return r.feeds;});
   const feeds=await catalog;check();
   const scope=[...new Map(platforms.map(p=>[p.id,p])).values()],matched=new Map();
   for(const p of scope){const candidates=feeds.filter(f=>f.dataset==='orders'&&f.direction===direction&&f.platformId===p.id);if(candidates.length===1)matched.set(p.id,candidates[0]);}
   const selected=[...matched.values()],groups=new Map(),errors=new Map();
   // Small batches bound source scans. No provider/status/member filter is used.
   for(let i=0;i<selected.length;i+=4){check();const batch=selected.slice(i,i+4);try{
    const response=await request({action:'intakeCoverage',operation:'rows',feedIds:batch.map(f=>f.id),startAt:from,endAt:to});check();
    for(const [id,rows] of validate(response,batch,from,to))groups.set(id,rows);
   }catch(e){check();for(const f of batch)errors.set(f.id,e.message||'采集核对读取失败');}}
   check();const output=scope.map(p=>{const feed=matched.get(p.id),item=summarize(p,feed,groups.get(feed?.id),from,to);if(!feed||errors.has(feed.id)){item.message=!feed?'未找到当前平台和方向的采集核对来源':errors.get(feed.id);item.days=item.days.map(d=>({...d,notes:item.message}));}return item;});
   return {status:'ready',from,to,platforms:output,error:errors.size?'部分平台采集核对失败；尚未确认缺失':''};
  }
  return {load,cancel};
 }
 root.HensemProviderIntake={create,validate,summarize};
})(typeof window!=='undefined'?window:globalThis);
