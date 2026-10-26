// Offline exact native direction responses; no source data or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-member-counts-cache.test.cjs'),'utf8').split(/\ntest\(/)[0];
const{harness,platform,response,row,A,B}=new Function('require',prefix+';return {harness,platform,response,row,A,B};')(require);
const cancelled=()=>Object.assign(Error('statement limit'),{code:'57014'});
const failed=()=>Object.assign(Error('<withdraw unavailable>'),{code:'ADMIN_LIVE_TIMEOUT'});
function partial(h,alter=r=>r){h.handler(q=>{if(q.direction==='all')throw cancelled();if(q.direction==='withdraw')throw failed();return alter(response(q));});}

test('known creation-state direction keeps exact scope while failed peer is absent, not zero or complete',async()=>{
 const h=harness();h.extra({successBasis:'created'});h.L.multi.provider=['B Pay','A Pay'];partial(h,r=>{r.successBasis='created';r.capabilities.successBasis='created_at_current_stored_status';r.capabilities.successCohort='created_at_current_stored_status';r.capabilities.independentSuccessWindow=false;r.capabilities.sourceCompletenessVerified=true;return r;});await h.query();
 assert.deepEqual(h.calls.map(q=>q.direction),['all','charge','withdraw']);assert(h.calls.every(q=>q.successBasis==='created'&&q.startAt===h.calls[0].startAt&&q.endAt===h.calls[0].endAt&&q.currency==='INR'&&JSON.stringify(q.providers)===JSON.stringify(['A Pay','B Pay'])));
 assert.equal(h.ui.platformMetric(A,'charge').value,9);assert.equal(h.ui.platformMetric(A,'withdraw').value,null);assert.equal(h.ui.state.results[0]._memberCacheable,false);assert.equal(h.ui.state.results[0].sourceCompletenessVerified,false);assert.match(h.ui.platformMetric(A,'withdraw').title,/<withdraw unavailable>/);assert.match(h.ui.platformMetric(A,'withdraw').html,/&lt;withdraw unavailable&gt;/);assert.equal(h.ui.state.results[0].rows.length,1);
});

test('known zero and missing identity values stay distinct after a peer failure',async()=>{
 for(const missing of [false,true]){const h=harness();partial(h,r=>{for(const axis of ['created','success']){r.rows[0][axis+'_member_count']=0;r.rows[0][axis+'_order_count']=missing?10:0;r.rows[0][axis+'_missing_member_count']=missing?10:0;}return r;});await h.query();assert.equal(h.ui.platformMetric(A,'charge').value,missing?null:0);assert.equal(h.ui.platformMetric(A,'charge').coverage.missingMemberOrderCount,missing?10:0);assert.equal(h.ui.platformMetric(A,'withdraw').value,null);}
});

test('partial capture remains partial without a render retry; explicit recovery reuses only validated child',async()=>{
 const h=harness();partial(h);await h.query();const saved=h.ui.capture(),at=saved.results[0]._memberReadAt;h.ui.restore(null);h.ui.restore(saved);await h.ui.ensure();assert.equal(h.calls.length,3);assert.equal(h.ui.state.failures.length,1);assert.equal(h.ui.platformMetric(A,'charge').value,9);assert.equal(h.ui.platformMetric(A,'withdraw').value,null);
 h.handler(q=>{if(q.direction==='all')throw cancelled();return response(q);});await h.query();assert.deepEqual(h.calls.slice(3).map(q=>q.direction),['all','withdraw']);assert.equal(h.ui.state.failures.length,0);assert.equal(h.ui.state.results[0]._memberReadAt,at);assert.equal(h.ui.platformMetric(A,'withdraw').value,9);await h.query();assert.equal(h.calls.length,5);
});

test('SQL permission denial discards validated child and evicts it instead of publishing a partial result',async()=>{
 const h=harness();h.handler(q=>{if(q.direction==='all')throw cancelled();if(q.direction==='withdraw')throw Object.assign(Error('permission denied'),{code:'42501'});return response(q);});await h.query();assert.equal(h.ui.state.results.length,0);assert.equal(h.ui.platformMetric(A,'charge').value,null);assert.equal(h.calls.length,3);
 h.L.direction='charge';h.handler(q=>response(q));await h.query();assert.equal(h.calls.length,4);
});

test('force refresh of partial all still invalidates its validated child cache',async()=>{
 const h=harness();partial(h);await h.query();await h.query(true);assert.deepEqual(h.calls.map(q=>q.direction),['all','charge','withdraw','all','charge','withdraw']);assert.equal(h.ui.state.results.length,1);assert.equal(h.ui.state.failures.length,1);for(let i=0;i<3;i++)await h.ui.ensure();assert.equal(h.calls.length,6);
});
