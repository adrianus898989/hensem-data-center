/* The bell checks received platform/day evidence, independently of business totals. */
(function(){
 const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const TTL=300000,SIZE=100,MAX=5000,statusNames={not_received:'未收到当日数据',failed:'采集任务失败',pending:'采集任务未结束',unverified:'尚未核实'};
 const notes={no_created_orders_received:'未收到该创建日期的订单；不能据此判断电脑掉线',only_success_day_records_received:'仅收到当日成功、其他日期创建的订单；当日创建订单尚未收到',no_daily_report_received:'未收到该平台当日日报',no_daily_configuration_snapshot:'未收到当日配置快照；不表示原有配置已删除',source_collection_failed:'来源任务记录失败；已有数据仍保留',source_task_not_finished:'来源任务尚无完成记录；当前在线状态未知',source_timezone_unknown:'来源时区未明确，暂不能判断当地日期',configuration_history_unavailable:'来源仅保留最新配置，无法逐日核查历史配置快照',source_full_day_not_published:'来源只有实时增量记录，尚无当日完整发布记录',source_snapshot_superseded:'该日来源快照已被替代，尚需核对最终发布记录',source_direction_unknown:'来源记录的业务方向未明确，暂不能逐日核对',unsupported_source:'该来源暂不能逐日核实'};
 let options=null,scope='',serial=0,timer=null,loading=false,error='',data=null,page=0,attemptedAt=0,readAt=0,opened=false;
 const ready=()=>!!options&&options.ready();
 function business(row){if(!['charge','withdraw','config'].includes(row.direction))return '业务方向待核实';if(row.direction==='config')return '自动出款配置';const d=row.direction==='withdraw'?'代付':'代收';if(row.dataset==='auto_report')return '自动出款日报';return d+(['orders','lg_orders'].includes(row.dataset)?'订单（创建日）':['panda_success','lg_success','collection_success'].includes(row.dataset)?'成功率日报':'金额日报')}
 function source(row){return (row.sourceKind==='google_sheets'?'Google 表格 → Supabase':row.sourceKind==='direct'?'采集器 → Supabase':'来源待核对')+' · '+String(row.source||'')}
 function valid(result){return result&&typeof result==='object'&&typeof result.checkedAt==='string'&&Number.isFinite(Date.parse(result.checkedAt))&&Number.isSafeInteger(result.total)&&result.total>=0&&result.days===7&&Array.isArray(result.rows)&&result.rows.length<=MAX&&result.rows.length<=result.total&&result.summary&&['checked','received','notReceived','failed','pending','unverified'].every(k=>Number.isSafeInteger(result.summary[k])&&result.summary[k]>=0)&&result.summary.checked===result.summary.received+result.summary.notReceived+result.summary.failed+result.summary.pending+result.summary.unverified&&result.total===result.summary.checked-result.summary.received&&result.rows.every(row=>row&&Object.hasOwn(statusNames,row.status)&&typeof row.platform==='string'&&typeof row.dataset==='string')}
 function update(){options?.onChange();if(opened)paint()}
 function panel(){
  const stamp=data?.checkedAt?new Date(data.checkedAt).toLocaleString():'尚未检查';
  const head='<div class="sync-health-title"><b>平台数据同步检查</b><button class="link" onclick="HensemLiveSyncHealth.close()">关闭</button></div><p class="sync-health-note">检查各平台最近 7 个已结束的当地日期。收到记录不等于整日采齐；未收到也不等于电脑掉线。</p>';
  const state=error?'<div class="live-status live-error">本次检查未完成：'+E(error)+(data?'。以下保留上次检查结果。':'。尚不能判断哪些平台缺少数据。')+'</div>':loading?'<div class="live-status">正在检查平台、业务和日期…</div>':!data?'<div class="live-status">'+(ready()?'等待检查…':'等待主页面读取完成后检查。')+'</div>':'';
  const action='<div class="sync-health-actions"><span>检查时间：'+E(stamp)+'</span><button class="btn small" '+(loading?'disabled':'')+' onclick="HensemLiveSyncHealth.refresh()">'+(error?'重试检查':'检查更新')+'</button></div>';
  if(!data)return head+state+action;
  const s=data.summary,counters='<div class="sync-health-counters"><span>未收到 '+s.notReceived+' 项</span><span>失败 '+s.failed+' 项</span><span>未结束 '+s.pending+' 项</span><span>未核实 '+s.unverified+' 项</span></div>';
  const rows=data.rows.slice(page*SIZE,(page+1)*SIZE).map(row=>'<tr><td>'+E(row.date||'待核实')+'</td><td>'+E(row.team||'待归类')+'<small>'+E(row.country)+'</small></td><td>'+E(row.platform)+'</td><td>'+E(business(row))+'<small>'+E(source(row))+'</small></td><td><b class="sync-health-'+E(row.status)+'">'+E(statusNames[row.status])+'</b><small>'+E(notes[row.evidence]||'请核对来源采集记录')+(row.received?'；数据库已有该日记录':'')+'</small></td></tr>').join('');
  const table=data.total?'<div class="sync-health-table"><table><thead><tr><th>当地日期</th><th>团队 / 地区</th><th>平台</th><th>业务 / 来源</th><th>状态及依据</th></tr></thead><tbody>'+rows+'</tbody></table></div>':s.checked===0?'<div class="live-status">当前授权范围没有可核查来源；暂不能判断数据同步情况。</div>':'<div class="live-status">本次检查的 '+s.checked+' 项平台日期均已收到数据。是否整日采齐仍以来源完成记录为准。</div>';
  const max=Math.max(1,Math.ceil(data.rows.length/SIZE)),pager='<div class="sync-health-actions"><span>'+data.total+' 项提醒'+(data.total>data.rows.length?'（显示前 '+data.rows.length+' 项）':'')+' · 第 '+(page+1)+' / '+max+' 页</span><span><button class="btn small" '+(loading||page===0?'disabled':'')+' onclick="HensemLiveSyncHealth.page('+(page-1)+')">上一页</button> <button class="btn small" '+(loading||page+1>=max?'disabled':'')+' onclick="HensemLiveSyncHealth.page('+(page+1)+')">下一页</button></span></div>';
  return head+state+action+counters+table+pager;
 }
 function paint(){let node=document.getElementById('live-sync-health-panel');if(!node){node=document.createElement('section');node.id='live-sync-health-panel';node.className='live-sync-health-pop';node.setAttribute('role','dialog');node.setAttribute('aria-label','平台数据同步检查');document.body.appendChild(node)}node.innerHTML=panel()}
 function reset(next){if(scope===next)return;scope=next;serial++;if(timer!==null){clearTimeout(timer);timer=null}loading=false;error='';data=null;page=0;attemptedAt=0;readAt=0;update()}
 async function load(force=false){
  if(!ready()||loading)return;if(timer!==null){clearTimeout(timer);timer=null}
  const now=Date.now();if(!force&&data&&now-readAt<TTL)return;
  const token=++serial,key=scope;loading=true;error='';attemptedAt=now;update();
  try{const result=await options.request({action:'syncHealth',offset:0,limit:MAX});if(token!==serial||key!==scope)return;if(!valid(result))throw Error('同步检查结果格式不完整');page=0;data=result;readAt=Date.now()}
  catch(e){if(token!==serial||key!==scope)return;error=e?.message||'连接失败，请重试'}
  finally{if(token===serial&&key===scope){loading=false;update()}}
 }
 const api={
  configure(value){options=value},
  schedule(nextScope){reset(String(nextScope||''));if(timer!==null){clearTimeout(timer);timer=null}if(!ready()||loading||(attemptedAt>0&&Date.now()-attemptedAt<TTL)||(data&&Date.now()-readAt<TTL))return;timer=setTimeout(()=>{timer=null;if(ready())void load(false)},250)},
  badge(){const count=data?.total||0;return error?'<span class="sync-health-badge sync-health-unknown" title="同步检查未完成">!</span>':count?'<span class="sync-health-badge" title="'+count+' 项平台日期需要核对">'+(count>99?'99+':count)+'</span>':''},
  open(){opened=true;paint();if(!loading&&ready())void load()},
  close(){opened=false;document.getElementById('live-sync-health-panel')?.remove()},
  refresh(){return load(true)},
  page(value){if(!Number.isInteger(value)||value<0||loading||!data||value>=Math.max(1,Math.ceil(data.rows.length/SIZE)))return;page=value;update()},
  cancel(){serial++;if(timer!==null)clearTimeout(timer);timer=null;loading=false;api.close()},
 };
 document.addEventListener?.('keydown',event=>{if(event.key==='Escape')api.close()});
 window.HensemLiveSyncHealth=api;
})();
