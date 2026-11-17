const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const base=path.join(__dirname,'admin-withdraw-team-reuse.test.cjs'),context=vm.createContext({__dirname,console,AbortController,setTimeout,clearTimeout,require:createRequire(base)});
vm.runInContext(fs.readFileSync(base,'utf8').split("test('all teams")[0]+';globalThis.h={fixture,totals,copy};',context);
const {fixture,totals,copy}=context.h;
function evidence(d){return {contract:'auto-team-duration-v1',direction:'withdraw',window:[d.windows.creationStartAt,d.windows.creationEndAt,d.previousStartDate],current:{rows:d.rows.map((r,index)=>({index,country:r.country,platform:r.platform,value:r.durationTotalSeconds==null?null:String(r.durationTotalSeconds)})),total:d.totals.durationTotalSeconds==null?null:String(d.totals.durationTotalSeconds)},previous:{total:d.previousTotals?.durationTotalSeconds==null?null:String(d.previousTotals.durationTotalSeconds)}};}
function enrich(d,L){
 const original=copy(d.rows),missing={id:'new-native',name:'NEW-UNASSIGNED',country:'印度',team:'Other',source:'newar',currency:'INR',timezone:'Asia/Kolkata'};L.catalog.push(missing);
 const unknown={country:'印度',platform:missing.name,source:'NEWAR',statisticBasis:'created_at_current_status',total:null,success:null,rejected:null,autoCount:null,manualCount:null,unclassifiedCount:null,durationSampleCount:0,durationTotalSeconds:null,avgSeconds:null,durationBasis:'source_submitted_to_handled',complete:false,coveredDays:0,expectedDays:1,dataDate:d.startDate,previous:{total:null,success:null,rejected:null,autoCount:null,manualCount:null,durationSampleCount:0,durationTotalSeconds:null,avgSeconds:null,durationBasis:null,coveredDays:1}};
 d.rows=[...d.rows.filter(r=>r.platform!=='HK'),unknown];d.total=d.rows.length;d.totals=totals(d.rows);
 const prior=[...original.map(r=>({...r.previous,country:r.country,platform:r.platform,dataDate:d.previousStartDate,unclassifiedCount:0})),{...unknown.previous,country:unknown.country,platform:unknown.platform,dataDate:d.previousStartDate,unclassifiedCount:0}];
 d.previousTotals=totals(prior);d.previousRows=prior.map(r=>({...r,durationTotalSeconds:r.durationTotalSeconds==null?null:String(r.durationTotalSeconds)}));d.previousRowsContract='auto-team-previous-v1';d.teamDurationExact=evidence(d);d.comparison.complete=false;
 d.secondary.rows.push({...copy(d.secondary.rows[0]),country:'印度',platform:missing.name,source:'newar',count:null,amount:null,observedCount:null,operatorRows:[]});d.creationAvailability.push({country:'印度',platform:missing.name,available:true});
 return d;
}
function setup(edit=()=>{}){return fixture({edit:(d,L,c)=>{enrich(d,L);edit(d,L,c);}});}
for(const [label,edit]of[
 ['old server lacks complete prior rows',d=>{delete d.previousRows;delete d.previousRowsContract;delete d.teamDurationExact;}],
 ['missing prior native',d=>d.previousRows.pop()],['duplicate prior native',d=>d.previousRows.push(copy(d.previousRows[0]))],
 ['unknown prior native',d=>d.previousRows[0].platform='UNAUTHORIZED'],['wrong prior day',d=>d.previousRows[0].dataDate='2026-10-01'],
 ['prior totals mismatch',d=>d.previousTotals.total++],['prior attachment differs',d=>d.rows[0].previous.total++],
 ['unknown metadata ABI',d=>d.previousRowsContract='future-version'],['wrong direction',d=>d.teamDurationExact.direction='deposit'],
 ['wrong window',d=>d.teamDurationExact.window[0]='2026-10-01T00:00:00.000Z'],
 ['missing duration evidence',d=>d.teamDurationExact.current.rows.pop()],['wrong duration index',d=>d.teamDurationExact.current.rows[0].index=1],
 ['wrong native duration binding',d=>d.teamDurationExact.current.rows[0].platform='M1'],['duration text mismatch',d=>d.teamDurationExact.current.rows[0].value='101'],
 ['duration text too long',d=>d.teamDurationExact.current.rows[0].value='1'.repeat(513)],['duration NULL changed to zero',d=>d.teamDurationExact.current.rows.at(-1).value='0'],
 ['nonnull statistic on unknown-count placeholder',d=>{d.rows.at(-1).success=1;d.totals.success++;}],['non-null duration placeholder',d=>{d.rows.at(-1).durationTotalSeconds=0;d.teamDurationExact=evidence(d);}],
 ['native permission drift',(_d,L,c)=>{c.hensemRoleAccess.version++;L.catalog.push({...L.catalog[0],timezone:'UTC'});}]
])test(label+' fails closed without another automatic request',async()=>{const f=setup(edit);await f.page.load();f.ctx.withdrawTeam('M8');assert.equal(f.calls.length,1);assert.equal(f.page.state.dirty,true);assert.equal(f.page.state.data,null);assert.equal(f.page.canExport(),false);});
