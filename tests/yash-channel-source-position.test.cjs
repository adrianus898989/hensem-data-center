// Full current ingest and authorized reader on synthetic data. No source/production writes.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'yash-channel-reader.test.cjs'),req=createRequire(filename),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261009055205_yash_channel_source_position.sql'),baseline=JSON.parse(read('tests/fixtures/yash-channel-position-production-functions.json'));
let h,meta;
before(async()=>{let setup;const c={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(c);
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get f(){return f},get id(){return id},direct,execute,snapshot,channel,transaction,denied};',c,{filename});await setup();h=c.fixture;await h.f.admin();
 for(const b of baseline){assert.equal(await h.f.scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[b.signature]),b.hash);}
 meta=await h.f.scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where oid=any($1::regprocedure[])",[baseline.map(x=>x.signature)]);
 await h.f.db.exec(migration);
});
after(async()=>h?.f.db.close());
const channels=async(kind='charge')=>{await h.f.as(h.f.OWNER);return (await h.direct({direction:kind})).snapshots[0].channels;};
const saved=()=>h.f.scalar("select jsonb_build_object('channels',(select jsonb_agg(to_jsonb(c) order by order_type,channel_id) from private.yash_channels c),'state',(select jsonb_agg(to_jsonb(s) order by order_type) from private.yash_channel_sync_state s))");
test('source records order is stored one-based and wins over channel id, enabled status and configured priority',async()=>h.transaction(async()=>{
 await h.snapshot('deposit',[h.channel('ZZ',{priority:99,enabled:false,status_text:'停用'}),h.channel('AA',{priority:1}),h.channel('MM',{priority:0})],'2026-10-08T02:00:00Z');
 const rows=await channels();assert.deepEqual(rows.filter(x=>x.is_present).map(x=>[x.channel_id,x.source_position]),[['ZZ',1],['AA',2],['MM',3]]);assert(rows.slice(3).every(x=>x.is_present===false));
 await h.f.admin();assert.equal(await h.f.scalar("select payload_hash=md5($1::jsonb::text) from private.yash_channel_sync_state where order_type='deposit'",[JSON.stringify([h.channel('ZZ',{priority:99,enabled:false,status_text:'停用'}),h.channel('AA',{priority:1}),h.channel('MM',{priority:0})])]),true);
}));
test('reordering changes only list position and refresh timestamps, not configuration age; opposite directions are independent',async()=>h.transaction(async()=>{
 const first=[h.channel('ZZ'),h.channel('AA')];await h.snapshot('deposit',first,'2026-10-08T02:00:00Z');await h.snapshot('withdrawal',[h.channel('ZZ')],'2026-10-08T02:00:00Z');
 await h.snapshot('deposit',[...first].reverse(),'2026-10-08T03:00:00Z');const rows=(await channels()).filter(x=>x.is_present);assert.deepEqual(rows.map(x=>x.channel_id),['AA','ZZ']);assert.deepEqual(rows.map(x=>x.source_position),[1,2]);
 for(const row of rows)assert.equal(Date.parse(row.config_changed_at),Date.parse('2026-10-08T02:00:00Z'));
 const withdraw=await channels('withdraw');assert.equal(withdraw[0].source_position,1);
}));
test('exact replay and older snapshot do not rewrite positions; reordered equal-time payload still conflicts',async()=>h.transaction(async()=>{
 const rows=[h.channel('ZZ'),h.channel('AA')];await h.snapshot('deposit',rows,'2026-10-08T02:00:00Z');const before=await saved();
 await h.snapshot('deposit',rows,'2026-10-08T02:00:00Z');assert.deepEqual(await saved(),before);
 const old=await h.snapshot('deposit',[...rows].reverse(),'2026-10-08T01:30:00Z');assert.equal(old.snapshot_applied,false);assert.deepEqual(await saved(),before);
 await h.denied(()=>h.snapshot('deposit',[...rows].reverse(),'2026-10-08T02:00:00Z'),/YASH_INVALID_SNAPSHOT_CONFLICT/);assert.deepEqual(await saved(),before);
}));
test('missing channels keep last position while returning last; bad full snapshots roll back every row and source_position cannot be supplied',async()=>h.transaction(async()=>{
 await h.snapshot('deposit',[h.channel('ZZ'),h.channel('AA')],'2026-10-08T02:00:00Z');await h.snapshot('deposit',[h.channel('AA')],'2026-10-08T03:00:00Z');
 const rows=await channels(),zz=rows.find(x=>x.channel_id==='ZZ');assert.equal(rows[0].channel_id,'AA');assert.equal(rows[0].source_position,1);assert.equal(zz.source_position,1);assert.equal(zz.is_present,false);
 await h.f.admin();const before=await saved();await h.denied(()=>h.snapshot('deposit',[h.channel('ZZ'),h.channel('BAD',{success_rate_today:'101'})],'2026-10-08T04:00:00Z'),/check constraint|YASH_INVALID/);assert.deepEqual(await saved(),before);
 await h.denied(()=>h.snapshot('deposit',[h.channel('AA',{source_position:1})],'2026-10-08T04:00:00Z'),/YASH_INVALID_RECORD/);assert.deepEqual(await saved(),before);
}));
test('legacy rows remain null until a genuinely newer full snapshot and final schema/ACL preserve existing boundaries',async()=>h.transaction(async()=>{
 const rows=await channels();assert(rows.every(x=>x.source_position===null));await h.f.admin();const before=await saved();
 await h.snapshot('deposit',[h.channel('D1'),h.channel('D2',{provider:'TwoPay',enabled:false,status_text:'停用',priority:null,success_rate_today:null,balance:'123.45',balance_currency:null})]);assert.deepEqual(await saved(),before);
 const current=await h.f.scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where oid=any($1::regprocedure[])",[baseline.map(x=>x.signature)]);assert.deepEqual(current,meta);
 for(const role of ['anon','authenticated']){assert.equal(await h.f.scalar("select has_function_privilege($1,'public.yash_channel_ingest(text,jsonb)','execute')",[role]),false);assert.equal(await h.f.scalar("select has_table_privilege($1,'private.yash_channels','select')",[role]),false);}
 const column=await h.f.scalar("select is_nullable from information_schema.columns where table_schema='private' and table_name='yash_channels' and column_name='source_position'");assert.equal(column,'YES');
 await h.denied(()=>h.f.db.exec("update private.yash_channels set source_position=0"),/check constraint/);
}));
test('source positions are exposed through the unchanged signed role gateway and cannot bypass direct-reader protection',async()=>h.transaction(async()=>{
 await h.snapshot('deposit',[h.channel('ZZ'),h.channel('AA')],'2026-10-08T02:00:00Z');
 await h.f.granted(h.f.ADMIN,['channel_status.view','channel_status.query']);const data=await h.execute({direction:'charge'});assert.deepEqual(data.snapshots[0].channels.filter(x=>x.is_present).map(x=>x.source_position),[1,2]);
 await h.denied(()=>h.direct({direction:'charge'}),/role_gateway_required/);
}));
test('production function drift aborts the migration and rolls back its additive column',async()=>h.transaction(async()=>{
 await h.f.db.exec('alter table private.yash_channels drop column source_position');
 for(const item of baseline)await h.f.db.exec(item.definition);
 const ingest=baseline.find(x=>x.signature.startsWith('yash_channel_ingest'));
 await h.f.db.exec(ingest.definition.replace('YASH_UNAUTHORIZED','YASH_AUTH_CHANGED'));
 await h.denied(()=>h.f.db.exec(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),/yash_channel_position_ingest_drift/);
 assert.equal(await h.f.scalar("select count(*)::integer from information_schema.columns where table_schema='private' and table_name='yash_channels' and column_name='source_position'"),0);
}));
