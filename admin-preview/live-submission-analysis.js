/* One platform/local-day cohort across every provider. Display filters never
 * decide whether a member paid; IDs are loaded only when the user opens them. */
(function(root){
 'use strict';
 const thresholds=[10,20,30,50,100],fields=['member_count','member_days','invalid_count','l0_members','new_members','funded_members','unknown_members'];
 const native=p=>!p.reportOnly&&['ar','newar','lg','game66'].includes(String(p.source||'').toLowerCase().replaceAll('_',''));
 const initial=()=>({key:'',status:'idle',results:[],failures:[],unsupported:[],items:[],error:''});
 const zero=()=>Object.fromEntries(fields.map(k=>[k,0]));
 function create(c){
  const {L,E,C,N}=c;let S=initial(),serial=0,pending=null,detailSerial=0,detail=null;
  function scope(){const platforms=[...new Map(c.selected().map(p=>[p.id,p])).values()].sort((a,b)=>a.id.localeCompare(b.id)),items=[],unsupported=[];
   for(const platform of platforms){if(!native(platform)){unsupported.push({id:platform.id,name:platform.name});continue}const q=c.query(platform,'aggregate');if(q.channelTypes?.length||q.status&&q.status!=='all'||['memberId','orderNumber','systemOrderId','utr','thirdPartyOrderNumber','amountMin','amountMax'].some(k=>q[k]))throw Error('刷单统计需使用全部订单状态，并清空单笔筛选');
    const request={action:'submissionAnalysis',operation:'summary',platformId:platform.id,startAt:q.startAt,endAt:q.endAt,direction:'charge',currency:platform.currency};if(q.providers?.length)request.providers=q.providers;items.push({platform,request});}
   return {items,unsupported,key:JSON.stringify([L.country,L.from,L.to,items.map(i=>i.request),unsupported.map(p=>p.id)])};
  }
  const currentKey=()=>{try{return scope().key}catch{return ''}};
  const view=()=>L.dirty||S.key!==currentKey()?initial():S;
  const valid=id=>id===serial&&!L.dirty&&S.key===currentKey();
  function validate(result,item){
   if(result?.platform?.id!==item.platform.id||result.basis!=='platform_local_day_all_providers_zero_success'||Date.parse(result.startAt)!==Date.parse(item.request.startAt)||Date.parse(result.endAt)!==Date.parse(item.request.endAt)||!Array.isArray(result.metrics))throw Error('刷单统计响应范围不一致');
   const keys=new Set();for(const r of result.metrics){const key=JSON.stringify([r.provider,r.threshold]);if(keys.has(key)||!thresholds.includes(r.threshold)||r.provider!==null&&typeof r.provider!=='string'||fields.some(k=>!Number.isSafeInteger(r[k])||r[k]<0)||r.member_count>r.member_days||r.member_count>r.invalid_count)throw Error('刷单统计响应不完整');keys.add(key);}
   if(thresholds.some(t=>!keys.has(JSON.stringify([null,t]))))throw Error('刷单统计缺少总计');
   return {...result,platform:{...item.platform,...result.platform}};
  }
  function cancel(){serial++;detailSerial++;detail=null;pending=null;if(S.status==='loading')S={...S,status:'paused'};}
  function ensure(force=false){if(L.dirty)return Promise.resolve();let q;try{q=scope()}catch(e){S={...initial(),status:'error',error:e.message};return Promise.resolve()}
   if(!force&&q.key===S.key&&S.status!=='idle'&&S.status!=='paused')return pending||Promise.resolve();
   const id=++serial;S={...initial(),...q,status:'loading'};c.render();let next=0;
   const run=(async()=>{async function worker(){while(next<q.items.length&&valid(id)){const item=q.items[next++];try{const value=validate(await c.request(item.request),item);if(!valid(id))return;S.results.push(value)}catch(e){if(!valid(id))return;S.failures.push({id:item.platform.id,name:item.platform.name,error:e.message||'读取失败'})}c.render();}}
    await Promise.all(Array.from({length:Math.min(2,q.items.length)},()=>worker()));if(valid(id)){S.status=S.failures.length&&!S.results.length?'error':'ready';c.render()}})();pending=run;run.finally(()=>{if(id===serial)pending=null});return run;
  }
  function metric(provider=null,ids=null,threshold=30){const s=view(),wanted=ids?[...new Set(ids)]:[...s.items.map(i=>i.platform.id),...s.unsupported.map(p=>p.id)],results=s.results.filter(r=>wanted.includes(r.platform.id)),total=zero();
   for(const r of results){const m=r.metrics.find(m=>m.provider===provider&&m.threshold===threshold)||zero();for(const k of fields)total[k]+=m[k];}
   const complete=wanted.length>0&&results.length===wanted.length&&!s.unsupported.some(p=>wanted.includes(p.id))&&!results.some(r=>Number(r.coverage?.missingMemberCount)>0||Number(r.coverage?.unknownStatusCount)>0);
   return {...total,complete,available:results.length>0,expected:wanted.length,received:results.length};
  }
  function note(){const s=view(),unknown=s.results.reduce((n,r)=>n+Number(r.coverage?.unknownStatusCount||0),0),history=s.results.reduce((n,r)=>n+Number(r.coverage?.missingRechargeCount||0),0),missing=s.results.reduce((n,r)=>n+Number(r.coverage?.missingMemberCount||0),0),levels=s.results.reduce((n,r)=>n+Number(r.coverage?.missingLevelCount||0),0);
   return '<div class="submission-coverage" role="status">刷单统计：'+(s.status==='loading'?'读取中 · ':s.status==='paused'?'读取已暂停 · ':'')+'已读取 '+C(s.results.length)+' / '+C(s.items.length+s.unsupported.length)+' 平台'+(missing?' · '+C(missing)+' 笔缺会员 ID':'')+(levels?' · '+C(levels)+' 笔等级未提供':'')+(history?' · '+C(history)+' 笔充值次数未提供':'')+(unknown?' · '+C(unknown)+' 笔订单状态未明确':'')+(s.unsupported.length?' · '+s.unsupported.map(p=>E(p.name)).join('、')+' 暂无此统计':'')+(s.failures.length?' · '+s.failures.map(p=>E(p.name+'：'+p.error)).join('；'):'')+(s.error?' · '+E(s.error):'')+' <button class="link" onclick="liveSubmissionRetry()">重读</button></div>';
  }
  const definition='按平台当地日，同一会员在所有三方累计提交达到门槛，且当天无成功充值；该日提交中后来已成功的会员也排除。多天逐日判断，人数按同平台 ID 在所选期间去重；无效笔数仅计符合条件日期的提交。≥10、≥20、≥30、≥50、≥100 为累计门槛，不能相加。统计仅基于已采集订单。';
  const button=(text,index,provider=null,t=30,level='all')=>'<button class="link" onclick="liveSubmissionMembers('+index+','+E(JSON.stringify(provider))+','+t+','+E(JSON.stringify(level))+')">'+text+'</button>';
  function render(){const s=view();if(L.dirty||s.status==='idle')return '<div class="live-status">选择国家、日期、平台和三方后点击查询，查看逐日刷单分析。</div>';
   const total=metric(),cards=thresholds.map(t=>{const m=metric(null,null,t);return '<article><label>单日 ≥'+t+' 笔 · 无成功充值</label><strong>'+(!m.available?'—':C(m.member_count))+' <small>个 ID'+(m.complete?'':' · 已读取部分')+'</small></strong><span>无效提交 '+(!m.available?'—':C(m.invalid_count))+' 笔</span></article>'}).join('');
   const heads=['平台 / 统一三方',...thresholds.map(t=>'≥'+t+' 笔人数'),'无效笔数（≥30）','L0 人数（≥30）','未充值 L0（≥30）','有充值记录（≥30）','充值情况未提供（≥30）'];
   const values=(r,index,provider=null)=>{const get=t=>r.metrics.find(m=>m.provider===provider&&m.threshold===t)||zero(),m=get(30);return [E(provider||r.platform.name),...thresholds.map(t=>button(C(get(t).member_count),index,provider,t)),button(C(m.invalid_count),index,provider),button(C(m.l0_members),index,provider,30,'l0'),button(C(m.new_members),index,provider,30,'new'),button(C(m.funded_members),index,provider,30,'funded'),button(C(m.unknown_members),index,provider,30,'unknown')];};
   let table='<div class="live-table submission-table"><table><thead><tr>'+heads.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>';
   s.results.forEach((r,index)=>{table+='<tr class="submission-platform">'+values(r,index).map(v=>'<td>'+v+'</td>').join('')+'</tr>';for(const provider of [...new Set(r.metrics.map(m=>m.provider).filter(Boolean))].sort()){if(!r.metrics.some(m=>m.provider===provider&&m.invalid_count>0))continue;table+='<tr>'+values(r,index,provider).map(v=>'<td>'+v+'</td>').join('')+'</tr>'}});table+='</tbody></table></div>';
   return '<div class="submission-analysis"><div class="live-definition">'+definition+'</div><div class="submission-kpis">'+cards+'</div>'+note()+c.box('各平台与归类三方 · 点击人数或笔数查看会员 ID',table,'L0 按源等级展示，不能等同从未充值。未充值 L0 需源充值次数为 0；有充值记录需源充值次数大于 0，其余单列未知。人数在三方之间可能重叠，平台总人数独立去重；同 ID 不同日等级变化时，等级分组也可能重叠。')+'</div>';
  }
  async function members(index,provider=null,threshold=30,level='all',offset=0){const s=view(),r=s.results[index],item=s.items.find(i=>i.platform.id===r?.platform?.id);if(!r||!item||!thresholds.includes(threshold)||!['all','new','funded','unknown','l0'].includes(level))return;
   const id=++detailSerial,query={...item.request,operation:'members',threshold,level,offset,limit:50};if(provider!==null)query.providers=[provider];
   const title=r.platform.name+' · '+(provider||'全部所选三方')+' · ≥'+threshold+' 笔会员';c.open(title,'<div class="live-status">正在读取具体会员 ID…</div>');
   try{const response=await c.request(query);if(id!==detailSerial||L.dirty||S.key!==currentKey())return;if(response?.platform?.id!==r.platform.id||response.basis!=='platform_local_day_all_providers_zero_success'||!Array.isArray(response.rows))throw Error('会员明细响应范围无效');detail={index,provider,threshold,level,offset};
    const rows=response.rows.map(x=>[E(x.day),E(x.member_id),E(x.member_level||'未提供'),x.recharge_count==null?'未提供':C(x.recharge_count),E(x.member_class==='funded'?'有充值记录':x.member_class==='new'?'L0 · 源充值次数 0':'未提供'),C(x.submitted_count),C(x.selected_count),N(x.submitted_amount),E((x.providers||[]).join(' / '))]);
    const filters='<div class="live-tabs">'+[['all','全部会员'],['l0','全部 L0'],['new','未充值 L0'],['funded','有充值记录'],['unknown','充值情况未提供']].map(([v,text])=>'<button class="btn small '+(level===v?'primary':'')+'" onclick="liveSubmissionMembers('+index+','+E(JSON.stringify(provider))+','+threshold+','+E(JSON.stringify(v))+')">'+text+'</button>').join('')+'</div>';
    c.open(title,filters+'<p class="live-definition">'+definition+'</p>'+c.table(['日期','会员 ID','会员 / 充值等级','源充值次数','充值情况','该平台当日提交','所选三方提交','所选三方金额','涉及三方'],rows)+'<div class="submission-pager">'+C(response.members)+' 个 ID · '+C(response.total)+' 个会员日 <button class="btn small" '+(offset===0?'disabled':'')+' onclick="liveSubmissionMemberPage(-1)">上一页</button> '+(Math.floor(offset/50)+1)+' <button class="btn small" '+(offset+50>=response.total?'disabled':'')+' onclick="liveSubmissionMemberPage(1)">下一页</button></div>');
   }catch(e){if(id===detailSerial)c.open(title,'<div class="live-status live-error">'+E(e.message||'读取失败')+'</div>');}
  }
  function providerCell(provider,ids,kind,success,all){const m=metric(provider,ids);if(!m.available||!m.complete)return '<span title="刷单统计尚未完整，请查看表上方的数据覆盖说明">—</span>';
   if(kind==='rate'){const denominator=Number(all)-m.invalid_count;if(all==null||success==null||!Number.isFinite(Number(all))||!Number.isFinite(Number(success))||denominator<=0||m.invalid_count>Number(all))return '—';return '<span title="本期成功笔数 ÷（本期创建笔数 − 符合单日条件的无效笔数）；保留原成功时间口径">'+(Number(success)/denominator*100).toFixed(2)+'%</span>'}
   return '<span title="'+E(definition)+'">'+C(kind==='members'?m.member_count:m.invalid_count)+'</span>';
  }
  root.liveSubmissionRetry=()=>{if(!L.dirty)ensure(true)};root.liveSubmissionMembers=members;
  root.liveSubmissionMemberPage=step=>{if(detail)members(detail.index,detail.provider,detail.threshold,detail.level,Math.max(0,detail.offset+step*50))};
  return {ensure,load:()=>ensure(true),cancel,render,note,metric,providerCell,members,capture:()=>JSON.parse(JSON.stringify(S)),restore:value=>{cancel();S=value?JSON.parse(JSON.stringify(value)):initial();if(S.status==='loading')S.status='paused'}};
 }
 root.HensemSubmissionAnalysis={create,thresholds};if(typeof module==='object'&&module.exports)module.exports=root.HensemSubmissionAnalysis;
})(typeof window!=='undefined'?window:globalThis);
