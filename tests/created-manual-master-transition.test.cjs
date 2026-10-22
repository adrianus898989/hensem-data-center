// Synthetic full-master publications only. The oracle is exact pre-migration
// production projection code, not the candidate's modified implementation.
const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'created-manual-transition.test.cjs'),'utf8');
const hooks={},scopedRequire=n=>n==='node:test'?{test(){},before:f=>hooks.before=f,beforeEach:f=>hooks.beforeEach=f,after:f=>hooks.after=f}:require(n);
const {f,scalar,call,q,db:database}=new Function('require','__dirname',source.slice(0,source.indexOf("test('authorized"))+';return {f,scalar,call,q,db:()=>db};')(scopedRequire,__dirname);
const root=path.resolve(__dirname,'..');
const clone=structuredClone;
const amountContext={};vm.runInNewContext(fs.readFileSync(path.join(root,'admin-preview/live-amount-bands.js'),'utf8'),amountContext);
const bands=Object.fromEntries(['INR','IDR'].map(currency=>{const b=amountContext.HensemAmountBands.defaults[currency];return [currency,JSON.parse(JSON.stringify({charge:b.charge,withdraw:b.withdraw||b.charge}))];}));
const oldNames=['dashboard_prepared_provider_projection','dashboard_prepared_direction_projection','prepared_aggregate_master_projection','prepared_aggregate_echo'];
before(async()=>{
 await hooks.before();
 for(const name of oldNames){let sql=fs.readFileSync(path.join(__dirname,'fixtures/created-manual-master-baseline',name+'.sql'),'utf8');for(const n of oldNames)sql=sql.replaceAll('private.'+n+'(', 'private.oracle_'+n+'(');await database().exec(sql);}
 await database().exec(`create or replace function private.dashboard_serving_default_amount_bands(currency text)returns jsonb language sql as $$select case $1 when 'IDR' then '${JSON.stringify(bands.IDR)}'::jsonb else '${JSON.stringify(bands.INR)}'::jsonb end$$`);
});
beforeEach(()=>hooks.beforeEach());after(()=>hooks.after());
function metric(direction,currency,provider='Brand'){
 return {provider,direction,currency,date:'2020-01-02',hour:0,bucket:'old-bin',all_count:3,all_amount:'9007199254740993.123456789012345678',success_count:1,success_amount:'100.123456789012345678',created_success_count:2,pending_count:1,pending_amount:null,failed_count:1,failed_amount:'2.50',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0',missing_amount_count:1,negative_amount_count:0,success_time_available:true,success_time_basis:'success_at',fee_available:false,fee_unavailable_reason:'fixture_unknown_fee',fee_version_matched_count:0,fee_version_unmatched_count:1,fee_version_estimated_amount:null,latest_synced_at:'2020-01-05T10:00:00Z',fee_items:[{evidence:'original-native-row',amount:null}]};
}
async function fullMaster(nativeKind,{masterBands=true,expired=true}={}){
 const db=database();await db.exec('truncate private.created_cohort_manual_transition;truncate private.prepared_aggregate_heads,private.prepared_aggregate_artifacts,private.prepared_aggregate_jobs cascade;truncate private.fixture_calls;');
 const t={...f.target(1),...(nativeKind==='IN'?{}:{country:'印尼',currency:'IDR',timezone:'Asia/Jakarta',scope_group:'ID'}),source:nativeKind==='duoli'?'duoli':'ar'};
 await db.query('update private.fixture_targets set(country,currency,timezone,scope_group,source)=($1,$2,$3,$4,$5)where id=$6',[t.country,t.currency,t.timezone,t.scope_group,t.source,t.id]);
 const start=t.currency==='INR'?'2020-01-01T18:30:00Z':'2020-01-01T17:00:00Z',end=t.currency==='INR'?'2020-01-02T18:30:00Z':'2020-01-02T17:00:00Z';
 const request=q({view:'full',direction:'all',providers:[],durationVersion:2,startAt:start,endAt:end,successStartAt:start,successEndAt:end,successBasis:t.source==='duoli'?'source_updated':'success',currency:t.currency,...(masterBands?{amountBands:bands[t.currency]}:{})});
 await f.prepare(request,t,{expired});
 const dirs=['charge','withdraw'],rows=dirs.flatMap(d=>[metric(d,t.currency),metric(d,t.currency,'Other')]);
 const capabilities={chargeSuccessTimeAvailable:true,withdrawSuccessTimeAvailable:t.source!=='duoli',paymentSuccessTimeAvailable:t.source!=='duoli',latencyAvailable:t.source!=='duoli',independentSuccessWindow:true,successCohort:'native_original',successTimeBasis:t.source==='duoli'?'source_updated':'success'};
 const groups=Object.fromEntries(['daily','hourly','amount','matrix','pending_age'].map(key=>[key,dirs.map(d=>metric(d,t.currency))]));
 groups.provider=rows;
 groups.latency=dirs.flatMap(direction=>Array.from({length:5},(_,bucket)=>({direction,currency:t.currency,bucket,count:1,amount:'1.01',valid_count:5,valid_amount:'5.05',min_ms:bucket?bucket*60000:null,max_ms:(bucket+1)*60000,unknown_time_count:1})));
 groups.latency_thresholds=dirs.map(direction=>({direction,currency:t.currency,bucket:3,threshold_ms:300000,count:1,amount:'1.01'}));
 if(masterBands){groups.amount_range=dirs.map(d=>metric(d,t.currency));groups.matrix_range=dirs.map(d=>metric(d,t.currency));}
 const payload={version:1,platform:{id:t.id,name:t.name,source:t.source,sourceName:t.source_name,country:t.country,currency:t.currency,timezone:t.timezone,capabilities},startAt:start,endAt:end,successStartAt:start,successEndAt:end,successBasis:request.successBasis,durationVersion:2,rows:[],summary:dirs.map(d=>({...metric(d,t.currency),provider:null,all_count:6,success_count:2,created_success_amount:'77.7700'})),groups,capabilities,_preparedDirectionCapabilities:Object.fromEntries(['all',...dirs].map(d=>[d,capabilities])),latencySummary:dirs.map(direction=>({direction,currency:t.currency,unknown_time_count:1,valid_count:5,valid_amount:'5.05',mean_ms:120000})),pendingSummary:dirs.map(direction=>({direction,unknown_time_count:1,amount:null})),total:12,asOf:'2020-01-05T12:00:00Z',...(masterBands?{amountBands:bands[t.currency],amountBandsVersion:1}:{})};
 await db.query('update private.prepared_aggregate_artifacts set payload=$1',[JSON.stringify(payload)]);
 await db.exec(`insert into private.created_cohort_manual_transition select a.id,j.id,j.target,j.request,j.request_key,j.dependency,'new',a.revision,a.fence,md5(a.payload::text),now(),now()+interval'72hours' from private.prepared_aggregate_jobs j join private.prepared_aggregate_heads h on h.job_id=j.id join private.prepared_aggregate_artifacts a on a.id=h.artifact_id;select set_config('test.dep','new',false)`);
 return {t,request,payload};
}
async function oracle(payload,base,request,target){
 return scalar(`with b as(select private.prepared_aggregate_canonical_request($2,$4)v),c as(select private.prepared_aggregate_canonical_request($3,$4)v),args as(select case when c.v->>'view'='full'and not(c.v?'amountBands')then $1::jsonb-array['amountBands','amountBandsVersion']||jsonb_build_object('groups',($1::jsonb->'groups')-array['amount_range','matrix_range'])else $1::jsonb end payload,case when c.v->>'view'='full'and not(c.v?'amountBands')then b.v-'amountBands'else b.v end base,c.v request from b,c)select private.oracle_prepared_aggregate_echo(private.oracle_prepared_aggregate_master_projection(payload,base,request),$3,$4)from args`,[JSON.stringify(payload),JSON.stringify(base),JSON.stringify(request),JSON.stringify(target)]);
}
for(const native of ['IN','IDR','duoli'])for(const page of ['providers','time','latency'])for(const explicitBands of [false,true])test(`manual ${native} old full master → ${page}, bands ${explicitBands?'explicit':'omitted'} matches complete old DTO`,async()=>{
 const {t,request:base,payload}=await fullMaster(native),request={...base,direction:'withdraw',view:page==='providers'?'providers':'full',providers:page==='providers'?['Brand']:[]};
 if(page==='providers')delete request.durationVersion;else request.durationVersion=page==='latency'?2:1;
 if(!explicitBands)delete request.amountBands;
 const expected=await oracle(payload,base,request,t),before=await scalar('select jsonb_agg(to_jsonb(a)order by a.id)from private.prepared_aggregate_artifacts a'),item=(await call(request)).items[0];
 assert.equal(item.status,'ready');assert.equal(item.publication.semanticTransition,'manual_previous_dependency');assert.equal(item.publication.freshness,'refresh_due');assert.equal(item.publication.sourceComplete,false);assert.equal(item.publication.generation,'1:7');assert.deepEqual(item.result,expected);
 assert.equal(item.result.successBasis,native==='duoli'?'source_updated':'success');assert.equal(item.result.capabilities.paymentSuccessTimeAvailable,native!=='duoli');
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(a)order by a.id)from private.prepared_aggregate_artifacts a'),before);
 assert.equal(await scalar('select count(*)::int from private.fixture_calls'),1,'exact original admission once');
});
test('manual master projection preserves a fresh old expiry but still marks migration result refresh_due',async()=>{
 const {request}=await fullMaster('IN',{expired:false}),out=(await call({...request,direction:'withdraw'})).items[0];assert.equal(out.status,'ready');assert.equal(out.publication.freshness,'refresh_due');assert(Date.parse(out.publication.expiresAt)>Date.now());
});
test('explicit custom IDR bands cannot borrow the old default-band full master',async()=>{
 const {request}=await fullMaster('IDR'),custom=clone(request);custom.amountBands={charge:[1,2,3,4,5,6,7,8,9,10,11],withdraw:[1,2,3,4,5,6,7,8,9,10,11]};const item=(await call(custom)).items[0];assert.notEqual(item.status,'ready');assert.equal(item.result,null);assert.equal(await scalar('select count(*)::int from private.fixture_calls'),1);
});
test('created request cannot borrow any of the old full-master dimensions or monetary values',async()=>{
 const {request}=await fullMaster('IDR'),created={...request,successBasis:'created'};delete created.successStartAt;delete created.successEndAt;const item=(await call(created)).items[0];assert.notEqual(item.status,'ready');assert.equal(item.result,null);
});
for(const page of ['providers','time','latency'])test('IDR '+page+' prefers correct original bands even when old INR-band master was computed later',async()=>{
 const {t,request:base,payload}=await fullMaster('IDR'),good=await scalar('select id::text from private.prepared_aggregate_artifacts');
 const wrong={...base,amountBands:bands.INR};await f.prepare(wrong,t,{expired:true});
 await database().query(`update private.prepared_aggregate_artifacts a set payload=$1,computed_at=now()-interval'90minutes' from private.prepared_aggregate_jobs j where a.job_id=j.id and j.request->'amountBands'=$2`,[JSON.stringify({...payload,amountBands:bands.INR}),JSON.stringify(bands.INR)]);
 await database().exec(`insert into private.created_cohort_manual_transition select a.id,j.id,j.target,j.request,j.request_key,j.dependency,'new',a.revision,a.fence,md5(a.payload::text),now(),now()+interval'72hours' from private.prepared_aggregate_jobs j join private.prepared_aggregate_heads h on h.job_id=j.id join private.prepared_aggregate_artifacts a on a.id=h.artifact_id where not exists(select 1 from private.created_cohort_manual_transition m where m.artifact_id=a.id)`);
 const request={...base,view:page==='providers'?'providers':'full',direction:'withdraw',providers:page==='providers'?['Brand']:[]};delete request.amountBands;if(page==='providers')delete request.durationVersion;else request.durationVersion=page==='time'?1:2;
 const item=(await call(request)).items[0];assert.equal(item.status,'ready');assert.equal(item.publication.id,good);assert.deepEqual(item.result,await oracle(payload,base,request,t));
});
