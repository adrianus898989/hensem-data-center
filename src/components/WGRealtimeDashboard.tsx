"use client";
import {useEffect,useRef,useState} from "react";
import {dashboardBusinessFetch} from "@/lib/dashboardDataClient";
import WGConfigSheet from "./WGConfigSheet";
import type {WGConfiguration} from "@/lib/wgConfigContract";
import "./WGRealtimeDashboard.css";

const sites=[{id:"278",name:"26BET",tz:"America/Sao_Paulo"},{id:"8311",name:"POPKKK",tz:"America/Sao_Paulo"},{id:"12588",name:"POPMIU",tz:"America/Sao_Paulo"},{id:"3257",name:"98VV",tz:"Asia/Ho_Chi_Minh"},{id:"3605",name:"XX98",tz:"Asia/Ho_Chi_Minh"}];
const tabs=[['orders','订单明细'],['summary','汇总'],['providers','三方'],['operators','操作人'],['reasons','业务原因'],['config','每日配置'],['midnight','零点快照']];
const labels:Record<string,string>={order_number:"订单号",third_order_number:"三方单号",provider:"三方",channel:"通道",status_group:"状态",event_at:"所选口径时间",created_at:"创建时间",success_at:"成功时间",updated_at:"更新时间",operated_at:"操作时间",captured_at:"采集时间",member_currency:"会员币种",member_amount:"会员金额",settlement_currency:"支付币种",settlement_amount:"支付金额",settlement_fee:"支付手续费",operator_name:"最后操作人",operator_class:"处理方式",note_state:"备注状态",remark:"脱敏业务备注",rejection_reason:"驳回原因",interception_reason:"出款拦截",front_note:"前台备注(脱敏)",back_note:"后台备注(脱敏)",count:"笔数",success:"支付成功",paying:"代付中",forced:"强制完成",rejected:"已驳回",failed:"失败",cancelled:"取消",pending:"待处理",auto:"自动",manual:"人工",unknown_operator:"操作人未知",missing_business_fields:"待补业务字段",kind:"原因类型",label:"原因／语言(脱敏)",date:"统计日期",scheduled_at:"应采零点",window_start:"近七日开始",window_end:"近七日结束",status:"采集状态",observed_started_at:"实际开始",observed_finished_at:"实际结束",record_count:"代付中笔数"};
const statuses:Record<string,string>={pending:"待处理",paying:"代付中",success:"支付成功",failed:"失败",cancelled:"取消",rejected:"已驳回",forced:"强制完成",unknown:"未知",auto:"自动",manual:"人工",complete:"已采完",capturing:"采集中",missed:"错过未采",empty:"无备注",withheld:"敏感原文已隐藏",template:"已识别模板",redacted:"已脱敏"};
Object.assign(labels,{success_member_amount:'成功会员金额',success_settlement_amount:'成功支付金额',unknown_status:'未知状态'});
type Row=Record<string,unknown>;
type Result={source:string;section:string;site_code:string;platform:string;timezone:string;start:string;end:string;business:string;basis:string;page:number;page_size:number;total:number;rows:Row[];coverage:{complete:boolean}};
function localDay(tz:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-');}

export default function WGRealtimeDashboard(){
  const [site,setSite]=useState(''),[section,setSection]=useState('orders'),[business,setBusiness]=useState('withdraw'),[basis,setBasis]=useState('created');
  const [start,setStart]=useState(()=>localDay('America/Sao_Paulo')),[end,setEnd]=useState(()=>localDay('America/Sao_Paulo')),[query,setQuery]=useState('');
  const [data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(''),[selected,setSelected]=useState<Row|null>(null);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const clear=()=>{controller.current?.abort();setBusy(false);setData(null);setSelected(null);setError('');};
  async function load(page=1){
    controller.current?.abort();const flight=new AbortController();controller.current=flight;setBusy(true);setError('');setData(null);
    try{
      if(!site||!start||!end||start>end||Date.parse(end)-Date.parse(start)>30*86400000)throw new Error('请先选择平台和最多 31 天的日期范围。');
      const params=new URLSearchParams({site,start,end,business,basis,section,page:String(page),size:'50',query});
      const response=await dashboardBusinessFetch('/api/wg-realtime?'+params,{signal:flight.signal});
      const value=await response.json();
      if(!response.ok)throw new Error(value.message||'读取失败，请重试。');
      if(value.source!=='wg_realtime_only'||value.section!==section||value.site_code!==site||value.start!==start||value.end!==end||value.business!==business||value.basis!==basis||!Array.isArray(value.rows)||value.rows.length>100||!Number.isSafeInteger(value.total)||value.total<0)throw new Error('返回数据范围不匹配，未展示。');
      if(!flight.signal.aborted)setData(value);
    }catch(e){if(!flight.signal.aborted)setError(e instanceof Error?e.message:'读取失败。');}
    finally{if(!flight.signal.aborted)setBusy(false);}
  }
  function valueText(row:Row,key:string){const v=row[key];if(v===null||v===undefined)return '—';if(typeof v==='object')return '—';const text=String(v);if(key.endsWith('_at')&&Number.isFinite(Date.parse(text)))return new Date(text).toLocaleString('zh-CN',{timeZone:data?.timezone||'UTC',hour12:false});return ['status','status_group','operator_class','note_state'].includes(key)?statuses[text]||text:text;}
  const columns=section==='orders'?['order_number','provider','status_group','event_at','member_currency','member_amount','settlement_currency','settlement_amount','operator_name','operator_class','remark','rejection_reason','interception_reason']:section==='midnight'?['date','scheduled_at','status','record_count','observed_started_at','observed_finished_at','window_start','window_end']:section==='reasons'?['kind','label','member_currency','count','success','rejected','auto','manual']:[...(section==='providers'?['provider','channel']:section==='operators'?['operator_name','operator_class']:[]),'member_currency','member_amount','success_member_amount','settlement_currency','settlement_amount','success_settlement_amount','count','success','paying','forced','rejected','failed','cancelled','pending','unknown_status','auto','manual','unknown_operator','missing_business_fields'];
  const columnLabel=(key:string)=>(labels[key]||key)+(['summary','providers','operators'].includes(section)&&['member_amount','settlement_amount'].includes(key)?'（全部状态）':'');
  return <section className="wg-rt"><header><h1>WG 实时数据</h1><p>仅显示新采集的五个平台数据；不与旧日报、谷歌汇总相加。巴西 UTC−3，越南 UTC＋7。</p></header>
    <nav aria-label="WG 数据分类">{tabs.map(([id,title])=><button key={id} type="button" aria-pressed={section===id} onClick={()=>{clear();setSection(id);}}>{title}</button>)}</nav>
    <form onSubmit={e=>{e.preventDefault();void load();}} className="wg-rt-filters">
      <label>平台（必选）<select required value={site} onChange={e=>{clear();setSite(e.target.value);const p=sites.find(p=>p.id===e.target.value);if(p){setStart(localDay(p.tz));setEnd(localDay(p.tz));}}}><option value="">请选择平台</option>{sites.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>业务<select value={business} disabled={['config','midnight'].includes(section)} onChange={e=>{clear();setBusiness(e.target.value);setBasis('created');}}><option value="withdraw">提现</option><option value="recharge">充值</option></select></label>
      <label>日期口径<select value={basis} disabled={['config','midnight'].includes(section)} onChange={e=>{clear();setBasis(e.target.value);}}><option value="created">创建时间</option>{business==='recharge'?<><option value="updated">更新时间</option><option value="success">成功时间（仅充值）</option></>:<option value="operated">操作时间（非成功时间）</option>}</select></label>
      <label>开始日期<input required type="date" value={start} onChange={e=>{clear();setStart(e.target.value);}}/></label><label>结束日期<input required type="date" value={end} onChange={e=>{clear();setEnd(e.target.value);}}/></label>
      <label>完整订单号／三方单号<input value={query} maxLength={128} disabled={['config','midnight'].includes(section)} onChange={e=>{clear();setQuery(e.target.value);}} placeholder="精确查找，不传会员资料"/></label><button disabled={busy||!site}>{busy?'读取中…':'查询 Supabase'}</button>
    </form>
    <p className="wg-rt-note">提现成功仅状态 4；代付中 3、强制完成 8 分开统计。充值成功仅状态 2。金额按会员币种与支付币种分开，不能跨币种相加。</p>
    {['summary','providers','operators'].includes(section)&&<p className="wg-rt-note">全部状态金额包含所选窗口内所有订单；成功金额只包含充值 2／提现 4，不包含代付中或强制完成。未知状态单列，不计成功。</p>}
    {section==='operators'&&<p className="wg-rt-note">操作人统计的是订单当前最后操作者（最新可得记录），不代表历史操作事件次数；未知操作者不算人工。</p>}
    {section==='reasons'&&<p className="wg-rt-note">驳回与出款拦截不是一回事。同一订单可有两类原因，原因笔数不能相加当订单总数；敏感自由文本只显示安全占位。</p>}
    {section==='config'&&<p className="wg-rt-note">日期按真实观察当天；每天一次，不伪造历史配置。仅展示所选品牌及父组默认设置，不推算继承关系。</p>}
    {section==='midnight'&&<p className="wg-rt-note">统计日期为零点前一天，范围为此前七个完整创建日的代付中订单；错过采集显示未采，不当作 0 笔。Supabase 保留快照逐笔数据，本页目前展示快照统计。</p>}
    {error&&<p role="alert" className="wg-rt-warning">{error}</p>}
    {data&&!['config','midnight'].includes(section)&&<p className={data.coverage?.complete?'wg-rt-note':'wg-rt-warning'}>{data.coverage?.complete?'所选查询时间窗口已采集完成；显示订单最新状态。':'所选窗口尚未确认完整覆盖（当日实时窗口也未结束）；以下仅为已入库记录，不代表完整全天。'}</p>}
    {!busy&&!error&&!data&&<div className="wg-rt-empty">请选择平台、日期及口径，再查询已入库数据。</div>}
    {data&&data.rows.length===0&&<div className="wg-rt-empty">{!['config','midnight'].includes(section)&&data.coverage?.complete?'已完成采集的范围内没有匹配记录。':'暂无已入库记录／尚未采集；不是确认 0 笔。'}</div>}
    {data&&section==='config'&&data.rows.map((row,i)=><details className="wg-rt-config" key={i} open={i===0}><summary>{String(row.date)} · 实际采集 {valueText(row,'observed_at')}</summary>{Boolean(row.configuration)&&<WGConfigSheet configuration={row.configuration as WGConfiguration} members={[{site_code:site,name:data.platform}]}/>}</details>)}
    {data&&section!=='config'&&data.rows.length>0&&<div className="wg-rt-table"><table><thead><tr>{columns.map(k=><th key={k} title={columnLabel(k)}>{columnLabel(k)}</th>)}{section==='orders'&&<th>详情</th>}</tr></thead><tbody>{data.rows.map((row,i)=><tr key={i}>{columns.map(k=>{const text=valueText(row,k);return <td key={k} title={text} onDoubleClick={()=>{if(text!=='—')void navigator.clipboard?.writeText(text).then(()=>setCopied('已复制完整内容')).catch(()=>setCopied('复制失败，请手动复制'));}}>{text}</td>;})}{section==='orders'&&<td><button onClick={()=>setSelected(row)}>查看</button></td>}</tr>)}</tbody></table></div>}
    {selected&&<div className="wg-rt-dialog" role="dialog" aria-modal="true" aria-label="WG 脱敏订单详情"><header><strong>脱敏订单详情</strong><button autoFocus onClick={()=>setSelected(null)}>关闭</button></header><dl>{Object.keys(labels).filter(k=>Object.prototype.hasOwnProperty.call(selected,k)).map(k=><div key={k}><dt>{labels[k]}</dt><dd>{valueText(selected,k)}</dd></div>)}</dl></div>}
    <span role="status">{copied}</span>{data&&<footer><span>共 {data.total.toLocaleString()} 行 · 每页 50 行 · 长字段悬停查看，双击复制</span><button disabled={busy||data.page<=1} onClick={()=>void load(data.page-1)}>上一页</button><span>第 {data.page} 页</span><button disabled={busy||data.page*data.page_size>=data.total} onClick={()=>void load(data.page+1)}>下一页</button></footer>}
  </section>;
}
