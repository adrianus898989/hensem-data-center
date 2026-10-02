/* Fully synthetic pending observations. No business identifiers, orders or credentials. */
const date='2026-10-01',previous='2026-09-30';
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const platform=n=>({id:id(n),name:'示例平台 '+String(n).padStart(2,'0'),sourceName:'SYNTHETIC_'+n,source:'ar',country:'印度',team:'示例团队',currency:'INR',timezone:'Asia/Kolkata'});
const group=(provider,amount,count)=>({provider,amount:String(amount),count});
function row(n,day=date,amount=n*1000,count=n,extra={}){return {...platform(n),state:'complete',timingState:'on_time',businessDate:day,targetAt:day+'T18:30:00Z',observedAt:day+'T18:32:00Z',snapshotAt:day+'T18:32:00Z',delaySeconds:120,toleranceSeconds:300,amount:String(amount),count,groups:[group('示例三方 '+(n%3+1),amount,count)],...extra};}
function day(day,rows){const valid=rows.filter(r=>r.state==='complete');return {basis:'seven_day_pending_snapshot',date:day,snapshotDate:day,currency:'INR',complete:valid.length===rows.length,expectedPlatformCount:rows.length,receivedPlatformCount:valid.length,amount:String(valid.reduce((n,r)=>n+Number(r.amount),0)),count:valid.reduce((n,r)=>n+r.count,0),rows};}
function sample({total=16,known=13,multi=false}={}){
 const platforms=Array.from({length:total},(_,i)=>platform(i+1));
 const rows=platforms.map((p,i)=>i<known?row(i+1):{...p,state:'missing',amount:null,count:null,groups:[]});
 const ages=rows.filter(r=>r.state==='complete').map((r,i)=>{const thresholds=[24,48,72,168].map((minHours,k)=>({minHours,count:Math.max(0,r.count-k*2),amount:String(Math.max(0,r.count-k*2)*1000)})),g={...r.groups[0],over24Count:r.count,over24Amount:r.amount,maxHours:24+i*12,thresholds};return {...r,state:'complete',matchedCount:r.count,unknownCount:0,over24Count:r.count,over24Amount:r.amount,maxHours:g.maxHours,thresholds,groups:[g]};});
 const totalCount=ages.reduce((n,r)=>n+r.count,0),aging={basis:'source_snapshot_age',snapshotDate:date,available:known>0,complete:known===total,count:totalCount,amount:String(totalCount*1000),expectedCount:totalCount,matchedCount:totalCount,unknownCount:0,avgHours:36,maxHours:Math.max(...ages.map(a=>a.maxHours)),over24Count:totalCount,over24Amount:String(totalCount*1000),thresholds:[24,48,72,168].map(minHours=>({minHours,count:ages.reduce((n,r)=>n+r.thresholds.find(t=>t.minHours===minHours).count,0),amount:String(ages.reduce((n,r)=>n+Number(r.thresholds.find(t=>t.minHours===minHours).amount),0))})),platforms:ages,missingPlatforms:rows.filter(r=>r.state==='missing'),buckets:[]};
 const prior=day(previous,rows.map((r,i)=>i<known?row(i+1,previous,(i+1)*800,i+1):{...r}));
 return {platforms,data:{version:1,basis:'seven_day_pending_snapshot',startDate:multi?previous:date,endDate:date,daily:multi?[prior,day(date,rows)]:[day(date,rows)],baseline:multi?null:prior,aging}};
}
module.exports={date,previous,id,platform,group,row,day,sample};
