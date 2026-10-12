// No member IDs or network: exercise production member UI against scoped counts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'admin-member-counts-ui.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,p,response,row,A,B}=new Function('require','__dirname',source+';return {harness,p,response,row,A,B};')(require,__dirname);
const platform=(id=A,caps={memberDailyAvailable:true})=>p(id,{source:'duoli',country:'印尼',timezone:'Asia/Jakarta',currency:'IDR',capabilities:caps});
function fixture(){const h=harness();h.L.country='印尼';h.select([platform()]);h.query({startAt:'2026-09-25T17:00:00Z',endAt:'2026-09-26T17:00:00Z'});h.handler(result);return h;}
function result(q){const r=response(q);r.platform=platform(q.platformId);Object.assign(r.capabilities,{memberDailyAvailable:true,successTimeBasis:'order_updated_at',paymentSuccessTimeAvailable:false,withdrawCreatedCoverageAvailable:false,frequencyBasis:'per_platform_local_day_order_count',frequencyThresholds:[2,3,4,5]});for(const x of r.rows)for(const n of [2,3,4,5]){x['created_members_ge'+n]=5-n;x['success_members_ge'+n]=5-n;}return r;}
test('DUOLI becomes eligible only after the server advertises memberDaily explicitly',async()=>{
 const h=fixture();for(const caps of [{},{memberDailyAvailable:false}]){h.select([platform(A,caps)]);await h.ui.load();assert.equal(h.calls.length,0);assert.match(h.ui.metric('charge'),/尚未接入/);}
 h.select([platform()]);await h.ui.load();assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'memberDaily');assert.equal(h.calls[0].currency,'IDR');assert.equal(h.calls[0].startAt,'2026-09-25T17:00:00Z');assert.equal(h.ui.state.status,'ready');
});
test('DUOLI cards, platform tooltip and both detail tabs disclose updated-time proxy and incomplete withdrawal coverage',async()=>{
 const h=fixture();await h.ui.ensure();for(const text of [h.ui.metric('charge'),h.ui.metric('withdraw'),h.ui.platformMetric(A,'withdraw').title]){assert.match(text,/成功状态＋订单更新时间/);assert.match(text,/不代表实际到账/);assert.match(text,/提现创建覆盖尚未核验/);}
 assert.equal(h.ui.platformMetric(A,'withdraw').coverage.sourceCompletenessVerified,false);
 for(const tab of ['members','frequency']){h.ui.details(tab,'success');assert.match(h.drawers.at(-1).body,/成功状态＋订单更新时间/);assert.match(h.drawers.at(-1).body,/仅统计已采集订单/);}
});
test('DUOLI rejects unlabelled success clocks, wrong timezone or inflated completeness',async()=>{
 const h=fixture();for(const change of [r=>delete r.capabilities.successTimeBasis,r=>r.capabilities.paymentSuccessTimeAvailable=true,r=>r.capabilities.sourceCompletenessVerified=true,r=>r.capabilities.withdrawCreatedCoverageAvailable=true,r=>r.platform.timezone='UTC',r=>r.platform.source='ar']){h.handler(q=>{const r=result(q);change(r);return r;});await h.ui.load();assert.equal(h.ui.state.status,'error');assert.match(h.ui.metric('charge'),/— \/ —/);}
});
test('DUOLI missing IDs remain missing and mixed sources keep the explicit source-specific warning',async()=>{
 const h=fixture();h.select([platform(A),p(B,{timezone:'Asia/Jakarta'})]);h.handler(q=>{if(q.platformId===B){const r=response(q);r.platform.timezone='Asia/Jakarta';return r;}const r=result(q);r.rows[0]={...r.rows[0],created_member_count:0,created_missing_member_count:20,success_member_count:0,success_missing_member_count:15};return r;});await h.ui.ensure();assert.match(h.ui.metric('charge'),/部分数据/);assert.match(h.ui.metric('charge'),/12 \/ 9/);assert.match(h.ui.metric('charge'),/多利成功人数/);
 h.ui.details();assert.match(h.drawers.at(-1).body,/20 笔未提供会员 ID/);assert.match(h.drawers.at(-1).body,/不代表实际到账/);
});
test('existing AR-only counts never acquire the DUOLI interpretation',async()=>{const h=harness();await h.ui.ensure();assert.doesNotMatch(h.ui.metric('charge'),/多利|订单更新时间/);assert.doesNotMatch(h.ui.platformMetric(A,'charge').title,/多利|订单更新时间/);});
