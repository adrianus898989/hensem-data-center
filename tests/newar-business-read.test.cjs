const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {loadTs,root}=require('./load-typescript.cjs');
function edge(entry){const modules=new Map();function load(file){if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',js)(name=>load(path.resolve(path.dirname(file),name)),m,m.exports);return m.exports;}return load(path.join(root,entry));}
const readers=[['app',loadTs(path.join(root,'src/lib/supabaseDashboardServer.ts'))],['edge',edge('supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts')]];
const day='2026-09-18',captured='2026-09-19T01:00:00Z';
const businessRow={stat_date:day,country:'巴基斯坦',platform:'POPZAR',system_name:'新AR'};
const volume={...businessRow,biz_type:'recharge',third_party:'OkPay',mapping_code:'Jazz',success_amount:800,success_count:8,failed_count:2,success_rate:.8};
const daily={...businessRow,total_count:10,success_count:8,reject_count:2,auto_count:6,manual_count:4,total_handle_seconds:120,handle_count:4};
const operator={...businessRow,operator:'new-worker',processed_count:3,reject_count:1,total_handle_seconds:120,handle_count:4};
const wo={...businessRow,total_count:10,completed_count:8,rejected_count:2,pending_count:0};
function direct(kind,options){const payload=kind==='third_party_volume'?{rows:[volume],third_party_rows:[volume]}:kind==='auto_withdraw_bundle'?{...(options.operatorOnly?{}:{rows:[daily]}),operator_rows:[operator]}:{rows:[wo],type_rows:[],employee_rows:[{...businessRow,employee_name:'new-worker',completed_count:8,rejected_count:2,total_count:10}]};return {source:'newar_direct',snapshots:[{kind,platform:'POPZAR',country_code:'PK',country:'巴基斯坦',stat_date:day,direction:kind==='third_party_volume'?'charge':'all',captured_at:captured,payload}]};}
async function fixture(options,run){
  const oldFetch=global.fetch,oldDeno=global.Deno,keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'],env=keys.map(k=>process.env[k]);
  process.env[keys[0]]='https://newar-fixture.supabase.invalid';process.env[keys[1]]='synthetic-public';global.Deno={env:{get:k=>k==='SUPABASE_URL'?process.env[keys[0]]:'synthetic-public'}};
  const calls=[];
  global.fetch=async(input,init={})=>{
    const url=new URL(input);assert.equal(url.origin,'https://newar-fixture.supabase.invalid');assert.equal(init.headers.Authorization,'Bearer synthetic-user');
    if(url.pathname==='/auth/v1/user')return Response.json({id:'one'});
    if(url.pathname==='/rest/v1/dashboard_profiles')return Response.json([{auth_user_id:'one',active:true,role:options.scope?'viewer':'owner',permissions:{third_party:!options.denied,auto_withdraw:!options.denied,work_orders:!options.denied},...(options.scope?{data_scope:options.scope}:{})}]);
    const name=url.pathname.split('/').pop();calls.push(name);
    if(name==='auto_withdraw_daily')return Response.json([{data_date:day,country:'PK',platform:'POPZAR',total:99,success:90,rejected:9,auto_count:90,manual_count:9,avg_seconds:9},{data_date:'2026-09-17',country:'PK',platform:'POPZAR',total:50,success:40,rejected:10,auto_count:30,manual_count:20,avg_seconds:20}]);
    if(name==='withdraw_operator_daily')return Response.json([{data_date:day,country:'PK',platform:'POPZAR',account:'old-worker',processed:90,rejected:9,avg_seconds:9}]);
    if(name==='workorder_daily_bundle')return Response.json([{system_name:'AR',stat_date:day,country:'巴基斯坦',country_code:'PK',platform:'POPZAR',daily_rows:[{total_count:99,completed_count:90,rejected_count:9}],type_rows:[{order_type:'old',total_count:99}],employee_rows:[{employee_name:'old-worker',total_count:99}]},{system_name:'AR',stat_date:'2026-09-17',country:'巴基斯坦',country_code:'PK',platform:'POPZAR',daily_rows:[{total_count:5}],type_rows:[],employee_rows:[]}]);
    if(name==='workorder_deposit_daily')return Response.json([]);
    if(name==='dashboard_third_party_volume_fast_v2')return Response.json({rows:[{id:'old-collect',data_date:day,country:'巴基斯坦',platform:'POPZAR',channel:'OldPay',direction:'代收',amount:999,count:9},{id:'old-payout',data_date:day,country:'巴基斯坦',platform:'POPZAR',channel:'KeepPay',direction:'代付',amount:50,count:1},{id:'other',data_date:day,country:'巴基斯坦',platform:'OTHER',channel:'OtherPay',direction:'代收',amount:100,count:1}]});
    if(name==='dashboard_newar_business_snapshots'){
      assert.equal(init.method,'POST');assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
      if(options.unavailable)return Response.json({message:'not deployed'},{status:503});
      return Response.json(direct(JSON.parse(init.body).p_kind,options));
    }
    if(name==='dashboard_game66_withdraw_daily')return Response.json({rows:[],operatorRows:[]});
    if(['dashboard_collection_success','dashboard_withdraw_pending'].includes(name))return Response.json({snapshots:[]});
    if(name==='dashboard_withdraw_actual')return Response.json({rows:[]});
    throw new Error(`Unexpected read ${name}`);
  };
  try{await run(new Request('https://app.invalid/api/data',{headers:{Authorization:'Bearer synthetic-user'}}),calls);}finally{global.fetch=oldFetch;global.Deno=oldDeno;keys.forEach((k,i)=>env[i]===undefined?delete process.env[k]:process.env[k]=env[i]);}
}
for(const [name,reader] of readers){
  test(`${name}: actual third-party reader replaces only NEWAR direction scope, no amount double-count`,async()=>fixture({},async(request,calls)=>{
    const result=await reader.readSupabaseThirdPartyVolume(request,day,day,'巴基斯坦');
    assert.equal(result.rows.length,3);assert.equal(result.rows.filter(r=>r.platform==='POPZAR'&&r.direction==='代收').length,1);
    assert.equal(result.rows.find(r=>r.channel==='OkPay').amount,800);assert.equal(result.rows.find(r=>r.channel==='KeepPay').amount,50);
    assert.equal(result.summary.amount,950);assert.ok(calls.includes('dashboard_newar_business_snapshots'));
  }));
  test(`${name}: actual automatic-withdraw reader maps full direct bundle, but operator-only repair retains daily`,async()=>{
    await fixture({},async request=>{const result=await reader.readSupabaseAutoWithdraw(request,day,day);assert.equal(result.dailyRows.length,1);assert.equal(result.dailyRows[0].total,10);assert.equal(result.operatorRows.length,1);assert.equal(result.operatorRows[0].account,'new-worker');assert.equal(result.dailyRows[0].previousDay.total,50);});
    await fixture({operatorOnly:true},async request=>{const result=await reader.readSupabaseAutoWithdraw(request,day,day);assert.equal(result.dailyRows[0].total,99);assert.equal(result.operatorRows[0].account,'new-worker');});
  });
  test(`${name}: actual workorder reader replaces daily/type/employee once and retains uncovered history`,async()=>fixture({},async request=>{
    const result=await reader.readSupabaseWorkOrderMonths(request,['2026_09']);
    assert.equal(result.rows.filter(r=>r.date===day).length,2);assert.equal(result.rows.filter(r=>r.date===day&&r.kind==='type').length,0);
    assert.equal(result.rows.find(r=>r.date===day&&r.kind==='daily').total,10);assert.equal(result.rows.find(r=>r.kind==='operator').operator,'new-worker');assert.equal(result.rows.find(r=>r.date==='2026-09-17').total,5);
  }));
  test(`${name}: unavailable direct reader cannot falsely return stale Google totals as success`,async()=>fixture({unavailable:true},async request=>{
    await assert.rejects(()=>reader.readSupabaseThirdPartyVolume(request,day,day,'巴基斯坦'));
  }));
  test(`${name}: unauthorized foreign direct source is discarded after authenticated RPC scope checks`,async()=>fixture({scope:{mode:'selected',countries:['IN']}},async request=>{
    const result=await reader.readSupabaseAutoWithdraw(request,day,day);assert.equal(result.dailyRows.length,0);assert.equal(result.operatorRows.length,0);
  }));
}
