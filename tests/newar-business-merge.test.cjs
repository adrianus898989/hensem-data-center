const assert=require('node:assert/strict'),test=require('node:test'),path=require('node:path'),fs=require('node:fs');
const {loadTs,root}=require('./load-typescript.cjs');
const merge=loadTs(path.join(root,'src/lib/newarBusinessMerge.ts'));
const day='2026-09-18',captured='2026-09-19T01:00:00Z';
function row(extra={}){return {stat_date:day,country:'巴基斯坦',platform:'POPZAR',system_name:'新AR',...extra};}
function snapshot(kind,payload,direction='all',extra={}){return {kind,payload,direction,platform:'POPZAR',country:'巴基斯坦',country_code:'PK',stat_date:day,captured_at:captured,...extra};}
function valid(kind,snapshots){return merge.validateNewarBusinessSnapshots({source:'newar_direct',snapshots},kind,'2026-09-01','2026-09-30');}
const volumeRow=()=>row({biz_type:'recharge',third_party:'OkPay-Jazz',mapping_code:'JAZZCASH',success_count:8,count:8,total_count:10,failed_count:2,success_amount:800,amount:800,success_rate:.8});
const dailyRow=()=>row({total_count:10,success_count:8,reject_count:2,auto_count:6,manual_count:4,total_handle_seconds:120,handle_count:4});
const operatorRow=()=>row({operator:'worker',processed_count:3,reject_count:1,total_handle_seconds:120,handle_count:4});
test('third party scope replaces Google copy by exact country/platform/day/direction, retains unrelated history',()=>{
  const legacy=[{id:'old',data_date:day,country:'PK',platform:'popzar',direction:'代收',amount:999},
    {id:'withdraw',data_date:day,country:'巴基斯坦',platform:'POPZAR',direction:'代付',amount:50},
    {id:'history',data_date:'2026-09-17',country:'巴基斯坦',platform:'POPZAR',direction:'代收',amount:500},
    {id:'other-platform',data_date:day,country:'巴基斯坦',platform:'OTHER',direction:'代收',amount:500,system_name:'新AR'}];
  const direct=valid('third_party_volume',[snapshot('third_party_volume',{rows:[volumeRow()],third_party_rows:[volumeRow()]},'charge')]);
  const result=merge.mergeNewarVolumeRows(legacy,direct);
  assert.equal(result.length,4);assert.equal(result.filter(r=>r.id==='old').length,0);
  assert.equal(result.find(r=>r.sheet_name==='supabase:newar_direct').amount,800);
  assert.equal(result.find(r=>r.sheet_name==='supabase:newar_direct').count,8);
  assert.equal(result.find(r=>r.sheet_name==='supabase:newar_direct').channel_type,'JAZZCASH');
  assert.deepEqual(result.filter(r=>!r.id.startsWith('newar')).map(r=>r.id),['withdraw','history','other-platform']);
});
test('explicit zero component clears only its scope; compatibility alias never doubles volume',()=>{
  const legacy=[{data_date:day,country:'PK',platform:'POPZAR',direction:'代收',amount:999}];
  const zero=valid('third_party_volume',[snapshot('third_party_volume',{rows:[],third_party_rows:[]},'charge')]);
  assert.deepEqual(merge.mergeNewarVolumeRows(legacy,zero),[]);
  const direct=valid('third_party_volume',[snapshot('third_party_volume',{rows:[volumeRow()],third_party_rows:[volumeRow()]},'charge')]);
  assert.equal(merge.mergeNewarVolumeRows([],direct).length,1);
});
test('operator-only repair must not erase previously complete daily metrics',()=>{
  const daily=[{data_date:day,country:'PK',platform:'POPZAR',total:7}],operators=[{data_date:day,country:'PK',platform:'POPZAR',account:'old',processed:99}];
  const s=valid('auto_withdraw_bundle',[snapshot('auto_withdraw_bundle',{operator_rows:[operatorRow()]})]);
  assert.equal(merge.mergeNewarDailyRows(daily,s)[0].total,daily[0].total);assert.equal(merge.mergeNewarDailyRows(daily,s)[0].country,'巴基斯坦');
  const actual=merge.mergeNewarOperatorRows(operators,s);assert.equal(actual.length,1);assert.equal(actual[0].account,'worker');assert.equal(actual[0].avg_seconds,30);
  assert.deepEqual(merge.mergeNewarOperatorRows(operators,valid('auto_withdraw_bundle',[snapshot('auto_withdraw_bundle',{operator_rows:[]})])),[]);
});
test('full automatic withdrawal snapshot replaces both components, preserving processing seconds averages',()=>{
  const s=valid('auto_withdraw_bundle',[snapshot('auto_withdraw_bundle',{rows:[dailyRow()],operator_rows:[operatorRow()]})]);
  const d=merge.mergeNewarDailyRows([{data_date:day,country:'PK',platform:'POPZAR',total:999}],s)[0];
  assert.equal(d.total,10);assert.equal(d.success,8);assert.equal(d.rejected,2);assert.equal(d.auto_count,6);assert.equal(d.manual_count,4);assert.equal(d.avg_seconds,30);
});
test('workorder replaces all three arrays and exact zero rather than duplicating legacy system aliases',()=>{
  const legacy=[{system_name:'AR',stat_date:day,country_code:'PK',country:'PK',platform:'POPZAR',daily_rows:[{total_count:999}],type_rows:[{order_type:'old'}],employee_rows:[{employee_name:'old'}]},
    {system_name:'新AR',stat_date:day,country_code:'PK',country:'PK',platform:'OtherPlatform',daily_rows:[{total_count:9}],type_rows:[],employee_rows:[]}];
  const direct=valid('workorder_daily_bundle',[snapshot('workorder_daily_bundle',{rows:[row({total_count:5})],type_rows:[],employee_rows:[row({employee_name:'worker'})]})]);
  const result=merge.mergeNewarWorkOrderBundles(legacy,direct);assert.equal(result.length,2);
  const r=result.find(r=>r.platform==='POPZAR');assert.equal(r.daily_rows[0].total_count,5);assert.deepEqual(r.type_rows,[]);assert.equal(r.employee_rows[0].employee_name,'worker');
  assert.equal(result.find(r=>r.platform==='OtherPlatform').daily_rows[0].total_count,9);
});
test('first workorder auxiliary-only snapshot preserves missing components from latest legacy source',()=>{
  const legacy=[{stat_date:day,country_code:'PK',country:'PK',platform:'POPZAR',source_updated_at:'2026-09-18T12:00:00Z',daily_rows:[{total_count:9}],type_rows:[{order_type:'retained'}],employee_rows:[{employee_name:'old'}]}];
  const s=valid('workorder_daily_bundle',[snapshot('workorder_daily_bundle',{employee_rows:[row({employee_name:'new'})]})]);
  const r=merge.mergeNewarWorkOrderBundles(legacy,s)[0];assert.equal(r.daily_rows[0].total_count,9);assert.equal(r.type_rows[0].order_type,'retained');assert.equal(r.employee_rows[0].employee_name,'new');
});
test('platform-country registry rejects cross-scope payloads and retains canonical DhaniWin',()=>{
  for(const extra of [{platform:'other'},{country_code:'IN'},{country:'印度'},{stat_date:'2026-10-01'}])assert.throws(()=>valid('auto_withdraw_bundle',[snapshot('auto_withdraw_bundle',{rows:[dailyRow()]},'all',extra)]));
  for(const extra of [{platform:'92BLAZE'},{country:'印度'},{stat_date:'2026-09-17'}])assert.throws(()=>valid('auto_withdraw_bundle',[snapshot('auto_withdraw_bundle',{rows:[row({...dailyRow(),...extra})]})]));
  const s=valid('auto_withdraw_bundle',[snapshot('auto_withdraw_bundle',{rows:[row({...dailyRow(),country:'IN',platform:'DHANIWIN'})]},'all',{platform:'DHANIWIN',country_code:'IN',country:'印度'})]);assert.equal(s[0].platform,'DhaniWin');
});
test('invalid component, direction, duplicate scope or malformed receipt fails closed',()=>{
  for(const payload of [{},{rows:null},{rows:['bad']}])assert.throws(()=>valid('third_party_volume',[snapshot('third_party_volume',payload,'charge')]));
  assert.throws(()=>valid('third_party_volume',[snapshot('third_party_volume',{rows:[volumeRow()]},'withdraw')]));
  const s=snapshot('auto_withdraw_bundle',{rows:[dailyRow()]});assert.throws(()=>valid('auto_withdraw_bundle',[s,s]),/重复/);
  assert.throws(()=>merge.validateNewarBusinessSnapshots({snapshots:[]},'auto_withdraw_bundle',day,day));
});
test('unsafe numeric aggregate values cannot become zero in direct source',()=>{
  const s=valid('auto_withdraw_bundle',[snapshot('auto_withdraw_bundle',{rows:[dailyRow()]})]);s[0].payload.rows[0].total_count='broken';assert.throws(()=>merge.mergeNewarDailyRows([],s),/数值/);
});
test('Edge and app use the exact same pure merge helper',()=>{
  assert.equal(fs.readFileSync(path.join(root,'src/lib/newarBusinessMerge.ts'),'utf8'),fs.readFileSync(path.join(root,'supabase/functions/dashboard-api/lib/newarBusinessMerge.ts'),'utf8'));
});
