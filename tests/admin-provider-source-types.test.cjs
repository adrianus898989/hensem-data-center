// Synthetic, offline Postgres tests. This test never connects to production.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/admin-live-rates.sql'),'utf8');
const scopeSql=fs.readFileSync(path.join(root,'supabase/migrations/20260912150854_dashboard_account_data_scope.sql'),'utf8');
const liveSql=fs.readFileSync(path.join(root,'supabase/admin-live-query.sql'),'utf8');
function definition(source,name,delimiter){
  const start=source.search(new RegExp(`create (?:or replace )?function private\\.${name}\\(`,'i'));
  assert.ok(start>=0);const opening=source.indexOf(delimiter,start);
  const end=source.indexOf(`${delimiter};`,opening+delimiter.length);
  assert.ok(end>opening);return source.slice(start,end+delimiter.length+1);
}
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const runA=uid(100),runB=uid(101);
const sourceFields=['sourceType','sourceTypeProvider','sourceTypeCell','sourceTypeHeader','sourceTypeSheetId','sourceTypeCollectedAt'];
function grid(id,title,rows,merges=[]){
  const columns=Math.max(...rows.map(row=>row.length));
  return {sheet:{sheetId:id,title},rowCount:rows.length,columnCount:columns,merges,
    cells:rows.map(row=>Array.from({length:columns},(_,i)=>({text:row[i]??''})))};
}

test('authoritative provider types use exact published source cells without changing rate semantics',async t=>{
  const db=new PGlite();
  const scalar=async(query,args=[])=>Object.values((await db.query(query,args)).rows[0])[0];
  const asUser=async n=>{
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);
    await db.exec('set role authenticated');
  };
  const rpc=async(request={limit:500})=>scalar('select public.dashboard_admin_live_rates($1::jsonb)',[JSON.stringify(request)]);
  const row=async id=>(await rpc()).rows.find(r=>r.id===id);
  const sheets=[];
  const publish=async payload=>{
    await db.exec('reset role');
    sheets.push(payload.sheet);
    await db.query(`insert into public.third_party_rate_original_sheets values($1,$2,$3::jsonb,'2026-09-26T09:48:00Z')`,[runA,payload.sheet.sheetId,JSON.stringify(payload)]);
    await db.query(`update public.third_party_rate_original_workbooks set metadata=$1::jsonb where source_key='default'`,[JSON.stringify({title:'Rates',sheets})]);
    await asUser(1);
  };
  const addRate=async(id,country,provider,sheet,sourceRow)=>{
    await db.exec('reset role');
    await db.query(`insert into public.third_party_rates(id,country,third_party,category,collect_fee,payout_fee,payout_single_fee,sheet_name,source_row)
      values($1,$2,$3,'USDT','4.00%','2.50%','6',$4,$5)`,[id,country,provider,sheet,sourceRow]);
    await asUser(1);
  };
  try{
    await db.exec(`
      create role anon;create role authenticated;create schema auth;create schema private;
      grant usage on schema auth,public to anon,authenticated;grant usage on schema private to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb default '{}');
      create table public.dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
      create table public.third_party_rates(id text primary key,country text,third_party text,category text,collect_fee text,payout_fee text,
        total_fee text,collect_single_fee text,payout_single_fee text,collect_limit text,payout_limit text,status text,sheet_name text,source_row integer,updated_at timestamptz);
      create table public.third_party_platform_status(id text primary key,country text,platform text,third_party text,category text,collect_fee text,payout_fee text,
        total_fee text,collect_single_fee text,payout_single_fee text,collect_limit text,payout_limit text,status text,raw_status text,sheet_name text,
        source_row integer,source_column integer,updated_at timestamptz);
      create table public.third_party_rate_original_workbooks(source_key text primary key,run_id uuid,metadata jsonb,collected_at timestamptz);
      create table public.third_party_rate_original_sheets(run_id uuid,sheet_id bigint,payload jsonb,collected_at timestamptz,primary key(run_id,sheet_id));
      alter table public.third_party_rate_original_sheets enable row level security;
      alter table public.third_party_rate_original_workbooks enable row level security;
    `);
    for(const name of ['dashboard_data_scope_valid','dashboard_data_group','dashboard_current_data_scope','dashboard_scope_allows'])await db.exec(definition(scopeSql,name,'$function$'));
    await db.exec(definition(liveSql,'dashboard_admin_live_scope','$$'));
    await db.exec('revoke all on function private.dashboard_admin_live_scope() from public,anon,authenticated');
    await db.query(`insert into public.dashboard_profiles values($1,'owner',true,'{"mode":"all","countries":[]}','{}'),($2,'viewer',true,'{"mode":"selected","countries":["IN"]}','{}')`,[uid(1),uid(2)]);
    await db.query('insert into public.dashboard_admin_preview_grants values($1,true)',[uid(2)]);
    await db.query(`insert into public.third_party_rate_original_workbooks values('default',$1,'{"sheets":[]}','2026-09-26T09:48:00Z')`,[runA]);
    await db.exec(sql);
    const india=grid(10,'印度线下',[
      ['三方名称','类型','代收','其他'],['UPI-QR','跑分','✅','SOURCE_SECRET'],['ArbPay','钱包'],['UPIPAY','唤醒/跑分'],
      ['WPAY','唤醒/跑分'],['IC2Pay','跑分'],['HAP(原xupipay)',''],['NewProvider','future / 源文类型']
    ]);
    await publish(india);
    await addRate('upi','印度','UPI-QR','印度线下',2);
    await addRate('arb','印度','ArbPay','印度线下',3);
    await addRate('confirmed-upipay','印度','UpiPay','印度线下',4);
    await addRate('other-upipay','印度','UpiPay','印度线下',7);
    await addRate('future','印度','NewProvider','印度线下',8);
    await db.exec('reset role');
    await db.query(`insert into public.third_party_platform_status(id,country,platform,third_party,category,collect_fee,sheet_name,source_row)
      values('ic','印度','91CLUB','ICPay','UPI','3.50%','印度线下',6)`);
    await asUser(1);

    await t.test('B column is authoritative; existing category and all fee strings remain unchanged',async()=>{
      const upi=await row('country:confirmed-upipay');
      assert.equal(upi.sourceType,'唤醒/跑分');assert.equal(upi.sourceTypeProvider,'UPIPAY');
      assert.equal(upi.sourceTypeCell,'B4');assert.equal(upi.sourceTypeHeader,'类型');
      assert.equal(upi.sourceTypeSheetId,10);assert.equal(Date.parse(upi.sourceTypeCollectedAt),Date.parse('2026-09-26T09:48:00Z'));
      assert.equal(upi.category,'USDT');assert.equal(upi.collectFee,'4.00%');assert.equal(upi.payoutFee,'2.50%');assert.equal(upi.payoutSingleFee,'6');
      assert.equal((await row('country:arb')).sourceType,'钱包');
      assert.equal((await row('country:upi')).sourceType,'跑分');
      assert.equal((await row('country:future')).sourceType,'future / 源文类型');
    });
    await t.test('platform rows carry exact raw provider for existing country-specific alias validation',async()=>{
      const ic=await row('platform:ic');assert.equal(ic.provider,'ICPay');assert.equal(ic.sourceTypeProvider,'IC2Pay');
      assert.equal(ic.sourceType,'跑分');assert.equal(ic.sourceTypeCell,'B6');assert.equal(ic.collectFee,'3.50%');
      const other=await row('country:other-upipay');assert.equal(other.sourceType,null);assert.equal(other.sourceTypeProvider,'HAP(原xupipay)');
      assert.equal((await row('country:confirmed-upipay')).sourceType,'唤醒/跑分');
    });
    await t.test('no type header means null, never a fee/category or another provider column',async()=>{
      await publish(grid(11,'巴西盘口',[['三方名称','代收'],['UpiPay','✅'],['Other','钱包']]));
      await addRate('brazil','巴西','UpiPay','巴西盘口',2);
      const br=await row('country:brazil');for(const key of sourceFields)assert.equal(br[key],null,key);
      assert.equal(br.category,'USDT');
      await addRate('missing','印度','UpiPay','No matching sheet',2);
      for(const key of sourceFields)assert.equal((await row('country:missing'))[key],null,key);
    });
    await t.test('A-column type with a second-row header resolves only explicit merged source cells',async()=>{
      const merged=grid(12,'越南盘口',[
        ['标题'],['类型','三方'],['钱包','RawA'],['','RawB'],['','RawC'],['','RawD']
      ],[{startRowIndex:2,endRowIndex:5,startColumnIndex:0,endColumnIndex:1}]);
      await publish(merged);await addRate('merged','越南','RawC','越南盘口',5);await addRate('blank','越南','RawD','越南盘口',6);
      const m=await row('country:merged');assert.equal(m.sourceType,'钱包');assert.equal(m.sourceTypeCell,'A3');assert.equal(m.sourceTypeProvider,'RawC');
      assert.equal((await row('country:blank')).sourceType,null);
    });
    await t.test('multiple type values for the same provider stay separate for honest UI conflict handling',async()=>{
      await publish(grid(13,'分档',[['三方名称','类型／钱包'],['DualPay','跑分'],['DualPay','钱包']]));
      await addRate('dual-a','印度','DualPay','分档',2);await addRate('dual-b','印度','DualPay','分档',3);
      const rates=(await rpc({provider:'DualPay',limit:500})).rows;
      assert.deepEqual(rates.map(r=>r.sourceType).sort(),['跑分','钱包'].sort());assert.equal(rates.length,2);
      assert.equal(rates[0].sourceTypeHeader,'类型／钱包');
    });
    await t.test('old, uncommitted, missing-metadata and mismatched sheet snapshots never supply types',async()=>{
      await db.exec('reset role');
      const unpublished=grid(10,'印度线下',[['三方名称','类型'],['UPI-QR','UNPUBLISHED_TYPE']]);
      await db.query(`insert into public.third_party_rate_original_sheets values($1,10,$2::jsonb,now())`,[runB,JSON.stringify(unpublished)]);
      await asUser(1);assert.equal((await row('country:upi')).sourceType,'跑分');
      await db.exec('reset role');await db.query('update public.third_party_rate_original_workbooks set run_id=$1 where source_key=\'default\'',[uid(102)]);
      await asUser(1);assert.equal((await row('country:upi')).sourceType,null);
      await db.exec('reset role');await db.query('update public.third_party_rate_original_workbooks set run_id=$1 where source_key=\'default\'',[runA]);
      await db.query(`update public.third_party_rate_original_workbooks set metadata='{"sheets":[]}' where source_key='default'`);
      await asUser(1);assert.equal((await row('country:upi')).sourceType,null);
      await db.exec('reset role');await db.query(`update public.third_party_rate_original_workbooks set metadata=$1 where source_key='default'`,[JSON.stringify({sheets})]);
      await db.query(`update public.third_party_rate_original_sheets set payload=jsonb_set(payload,'{sheet,sheetId}','999') where run_id=$1 and sheet_id=10`,[runA]);
      await asUser(1);assert.equal((await row('country:upi')).sourceType,null);
      await db.exec('reset role');await db.query(`update public.third_party_rate_original_sheets set payload=$1 where run_id=$2 and sheet_id=10`,[JSON.stringify(india),runA]);await asUser(1);
    });
    await t.test('ambiguous parallel layouts and overlapping/malformed merges fail closed',async()=>{
      await publish(grid(14,'Ambiguous',[['三方名称','类型','三方名称','类型'],['Alpha','跑分','Other','钱包']]));
      await addRate('ambiguous','印度','Alpha','Ambiguous',2);assert.equal((await row('country:ambiguous')).sourceType,null);
      const overlapping=grid(15,'Overlap',[['三方名称','类型'],['Alpha','跑分'],['Beta','钱包']],
        [{startRowIndex:1,endRowIndex:3,startColumnIndex:1,endColumnIndex:2},{startRowIndex:1,endRowIndex:2,startColumnIndex:1,endColumnIndex:2}]);
      await publish(overlapping);await addRate('overlap','印度','Alpha','Overlap',2);assert.equal((await row('country:overlap')).sourceType,null);
      const malformed=grid(16,'Malformed',[['三方名称','类型'],['Alpha','跑分']],{});
      await publish(malformed);await addRate('malformed','印度','Alpha','Malformed',2);assert.equal((await row('country:malformed')).sourceType,null);
    });
    await t.test('source fields follow fresh authorization; raw sheets/helpers remain inaccessible',async()=>{
      await asUser(2);const result=await rpc();assert.ok(result.rows.length);assert.ok(result.rows.every(r=>r.scopeGroup==='IN'));
      assert.ok(!JSON.stringify(result).includes('SOURCE_SECRET'));
      await assert.rejects(scalar('select private.dashboard_admin_rate_type_sources($1,$2)', ['印度线下',[2]]),/permission denied/);
      await assert.rejects(scalar("select private.dashboard_admin_rate_source_cell('{}',0,0)"),/permission denied/);
      await assert.rejects(scalar('select count(*) from public.third_party_rate_original_sheets'),/permission denied/);
      await db.exec('reset role');await db.query('update public.dashboard_admin_preview_grants set can_view=false where auth_user_id=$1',[uid(2)]);
      await asUser(2);await assert.rejects(rpc(),/preview_denied/);await asUser(1);
    });
    await t.test('large formatted snapshots keep exact multirow anchors with bounded lookup latency',async()=>{
      const rows=Array.from({length:502},(_,r)=>Array.from({length:32},(_,c)=>r===0?
        c===26?'三方名称':c===27?'类型':'':r===1?'':c===26?'Provider '+(r+1):c===27?'跑分':'其他单元格 '+r+':'+c));
      const large=grid(17,'Formatted',rows,[
        {startRowIndex:0,endRowIndex:2,startColumnIndex:26,endColumnIndex:27},
        {startRowIndex:0,endRowIndex:2,startColumnIndex:27,endColumnIndex:28},
        {startRowIndex:2,endRowIndex:5,startColumnIndex:26,endColumnIndex:27},
        {startRowIndex:2,endRowIndex:4,startColumnIndex:27,endColumnIndex:28}
      ]);
      for(const row of large.cells)for(const cell of row)cell.format={backgroundColor:{red:.5,green:.6,blue:.7},
        textFormat:{fontFamily:'Arial',fontSize:11,bold:false,foregroundColor:{red:.1,green:.2,blue:.3}},
        borders:{bottom:{style:'SOLID',width:1,color:{red:.5}}}};
      await publish(large);await db.exec('reset role');
      const start=performance.now();
      const result=(await db.query(`select * from private.dashboard_admin_rate_type_sources('Formatted',array(select generate_series(3,502)))`)).rows;
      const elapsed=performance.now()-start;
      assert.equal(result.length,500);assert.equal(result[0].source_type_cell,'AB3');
      assert.equal(result[1].source_type_cell,'AB3');assert.equal(result[1].source_type_provider,'Provider 3');
      assert.equal(result[2].source_type_cell,'AB5');assert.equal(result[2].source_type_provider,'Provider 3');
      assert.equal(result.at(-1).source_type_cell,'AB502');assert.equal(result.at(-1).source_type_provider,'Provider 502');
      assert.ok(result.every(r=>r.source_type==='跑分'));
      // This wide guard tolerates slow CI but catches the previous multi-second
      // full-grid/per-cell expansion. The production target is measured separately.
      assert.ok(elapsed<2000,`500-row display metadata lookup took ${Math.round(elapsed)} ms`);
      t.diagnostic(`Formatted 500-row lookup: ${Math.round(elapsed)} ms`);await asUser(1);
    });
    await t.test('projection leaves source data unchanged and deployment upgrade is repeatable',async()=>{
      await db.exec('reset role');
      const before=await scalar('select jsonb_agg(to_jsonb(s) order by run_id,sheet_id) from public.third_party_rate_original_sheets s');
      const patch=fs.readFileSync(path.join(root,'supabase/admin-live-provider-source-types.sql'),'utf8');
      await db.exec(patch);await db.exec(patch);await asUser(1);
      assert.equal((await row('country:confirmed-upipay')).sourceType,'唤醒/跑分');
      await db.exec('reset role');const after=await scalar('select jsonb_agg(to_jsonb(s) order by run_id,sheet_id) from public.third_party_rate_original_sheets s');
      assert.deepEqual(after,before);
      const expected=sql.replace(/create function private\.dashboard_admin_live_rates/,'create or replace function private.dashboard_admin_live_rates')
        .replace(/create function public\.dashboard_admin_live_rates/,'create or replace function public.dashboard_admin_live_rates');
      assert.equal(patch,expected);
      assert.equal(await scalar("select has_function_privilege('anon','public.dashboard_admin_live_rates(jsonb)','EXECUTE')"),false);
    });
  }finally{await db.close();}
});
