const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../admin-preview/live-provider-summary.js');
const leaf=(extra={})=>({provider:'提现转充值',source:'wg',direction:'charge',currency:'VND',success_count:13,success_amount:1300,fee_exempt_count:13,fee_version_state:'complete',fee_version_matched_count:13,fee_version_unmatched_count:0,fee_version_estimated_amount:'0',...extra});
const plus=items=>({success_count:items.reduce((n,r)=>n+r.success_count,0),success_amount:items.reduce((n,r)=>n+r.success_amount,0)});
const combine=(items,keys)=>{const groups=new Map();for(const row of items){const key=JSON.stringify(keys.map(k=>row[k]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}return [...groups.values()].map(items=>({...items[0],...plus(items),items}));};
const build=items=>api.buildRows({orders:items,issues:[],rates:[],country:'越南',direction:'charge',plus,combine});
test('confirmed WG transfer renders known zero and exemption without requiring a price',()=>{
 const [row]=build([leaf()]);assert.equal(row.estimated_fee,0);assert.equal(row.fee_reference_label,'免手续费');assert.equal(row.fee_rate_label,'免手续费');assert.equal(row.fee_complete,true);
 const summary=api.feeSummary([row]);assert.equal(summary.amount,0);assert.equal(summary.matchedCount,13);assert.equal(summary.successCount,13);assert.equal(summary.complete,true);
});
test('actual summary rate button and expanded platform row use exemption before external reference lookup',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
 const {fixture}=new Function('require','__dirname',shared+';return {fixture};')(require,__dirname);
 const f=fixture([leaf({platformId:'platform-a',platform:'Synthetic WG',all_amount:1300,all_count:13})]);f.render('charge');
 assert.match(f.html(),/<button class="link provider-fee-preview"[^>]*>免手续费<\/button>/);
 f.root.providerSummaryToggle(0);const buttons=[...f.html().matchAll(/<button class="link provider-fee-preview"[^>]*>([^<]*)<\/button>/g)];assert.equal(buttons.length,2);assert(buttons.every(m=>m[1]==='免手续费'));
});
test('same provider label in non-WG source does not imply exemption or free price',()=>{
 const [row]=build([leaf({source:'ar',fee_exempt_count:0,fee_version_estimated_amount:'26'})]);assert.equal(row.estimated_fee,26);assert.notEqual(row.fee_reference_label,'免手续费');
 const unknown=build([leaf({source:'ar',fee_exempt_count:0,fee_version_state:'unknown',fee_version_matched_count:0,fee_version_unmatched_count:13,fee_version_estimated_amount:null})])[0];assert.equal(unknown.estimated_fee,null);assert.equal(unknown.fee_complete,false);
});
test('manual display alias preserves native exemption while mixed unknown orders stay partial',()=>{
 const manual=build([leaf({provider:'UserChosen'})])[0];assert.equal(manual.estimated_fee,0);assert.equal(manual.fee_reference_label,'免手续费');
 const [mixed]=build([leaf({provider:'UserChosen'}),leaf({provider:'UserChosen',fee_exempt_count:0,success_count:1,success_amount:100,fee_version_state:'unknown',fee_version_matched_count:0,fee_version_unmatched_count:1,fee_version_estimated_amount:null})]);
 assert.equal(mixed.estimated_fee,0);assert.equal(mixed.fee_matched_count,13);assert.equal(mixed.fee_eligible_count,14);assert.equal(mixed.fee_complete,false);assert.equal(mixed.fee_issues[0].count,1);assert.equal(api.feeSummary([mixed]).complete,false);
});
test('malformed exemption counts or inconsistent known-zero facts cannot claim full exemption',()=>{
 for(const extra of [{fee_exempt_count:14},{fee_exempt_count:12},{fee_exempt_count:null},{fee_version_unmatched_count:1},{fee_version_estimated_amount:'3'}])assert.notEqual(api.estimateFacts(leaf(extra),[],'越南').label,'免手续费');
 const [mixed]=build([leaf({success_count:14,fee_exempt_count:13,fee_version_state:'partial',fee_version_unmatched_count:1})]);assert.equal(mixed.estimated_fee,0);assert.equal(mixed.fee_complete,false);assert.notEqual(mixed.fee_reference_label,'免手续费');
});
