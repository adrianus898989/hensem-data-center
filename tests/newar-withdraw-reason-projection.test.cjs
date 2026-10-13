const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=fs.readFileSync(path.join(__dirname,'newar-withdraw-blocking-raw-reasons.test.cjs'),'utf8').split('\ntest(')[0];
const h=new Function('require','__dirname',base+'\nreturn {fixture,migration,order,call,meta,helper,reader};')(require,__dirname);
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const install=read('supabase/migrations/20261013073123_newar_withdraw_reason_projection.sql'),cutover=read('supabase/migrations/20261013073214_newar_withdraw_reason_projected_reader.sql');
async function fixture(){const db=await h.fixture();await db.exec(h.migration);return db;}
async function cases(db){const rs=[];for(const platform of ['DHANIWIN','MAAN.WIN'])for(const kind of ['blocking']){const d=await h.call(db,{platform,kind});rs.push(d);for(const row of d.rows){for(const next of ['blockingVariants','blockingOrders'])for(const offset of [0,20])rs.push(await h.call(db,{platform,kind:next,reasonKey:row.reasonKey,offset,limit:20}));}}return rs;}
async function backfill(db,platform='DhaniWin'){return(await db.query("select private.backfill_newar_withdraw_reason_facts($1,'2026-10-09 18:30:00Z','2026-10-10 18:30:00Z',500)n",[platform])).rows[0].n;}
test('sidecar/fallback/cutover conserve complete JSON for all reason views, keys, pagination and totals',async()=>{const db=await fixture();try{
 for(let i=0;i<48;i++)await h.order(db,'row-'+i,i%4?'免审未通过：用户充提差额不满足自动提现要求:-100':null,{method:i%7?'manual':'auto',platform:i%2?'MAANWIN':'DhaniWin',status:i%3?'success':'failed'});
 const before=await cases(db),meta=await h.meta(db,h.reader),factBefore=(await db.query('select jsonb_agg(f order by record_id)j from private.newar_withdraw_facts f')).rows[0].j;
 await db.exec(install);await db.exec(cutover);assert.deepEqual(await cases(db),before,'missing projection fallback');
 assert.equal(await backfill(db),24);assert.deepEqual(await cases(db),before,'partially warmed');assert.equal(await backfill(db,'MAANWIN'),24);assert.deepEqual(await cases(db),before,'fully warmed');assert.equal(await backfill(db),0);
 assert.deepEqual(await h.meta(db,h.reader),meta);assert.deepEqual((await db.query('select jsonb_agg(f order by record_id)j from private.newar_withdraw_facts f')).rows[0].j,factBefore);
 await db.exec("set test.scope='{\"denied\":true}'");await assert.rejects(h.call(db),/scope_denied/);
 }finally{await db.close()}});
test('insert/update/null label/amount/dataset change/delete stay synchronized without member-note leakage',async()=>{const db=await fixture();try{
 await db.exec(install);await db.exec(cutover);const id=await h.order(db,'trigger','Known reason',{amount:'123.45678901'});
 let r=(await db.query('select * from private.newar_withdraw_reason_facts where record_id=$1',[id])).rows[0];assert.equal(r.source_label,'Known reason');assert.equal(r.amount,'123.45678901');
 await db.query("update newar_detail_records set raw=jsonb_set(raw,'{automaticReasonLabel}','null'),order_number='UPDATED',amount=9 where id=$1",[id]);r=(await db.query('select * from private.newar_withdraw_reason_facts where record_id=$1',[id])).rows[0];assert.equal(r.source_label,null);assert.equal(r.order_number,'UPDATED');assert.equal(r.amount,'9.00000000');
 assert(!JSON.stringify(await h.call(db)).includes('MEMBER NOTE'));
 await db.query("update newar_detail_records set dataset='charge' where id=$1",[id]);assert.equal((await db.query('select count(*)n from private.newar_withdraw_reason_facts')).rows[0].n,0);
 await db.query("update newar_detail_records set dataset='withdraw' where id=$1",[id]);assert.equal((await db.query('select count(*)n from private.newar_withdraw_reason_facts')).rows[0].n,1);
 await db.query('delete from newar_detail_records where id=$1',[id]);assert.equal((await db.query('select count(*)n from private.newar_withdraw_reason_facts')).rows[0].n,0);
 }finally{await db.close()}});
test('raw type/provenance/length/control-char eligibility matches baseline, no broad grants',async()=>{const db=await fixture();try{
 const rawCases=[{automaticReasonLabel:123},{automaticReasonLabel:['x']},{automaticReasonLabel:{a:1}},{automaticReasonLabel:'x'.repeat(257)},{automaticReasonLabel:'x\ny'},{automaticReasonSource:'userRemark'},{businessSchemaVersion:1},{businessSchemaVersion:2},{automaticReasonLabel:'   '},{withdrawDisplayState:{a:1}},{withdrawDisplayState:0}];
 for(let i=0;i<rawCases.length;i++)await h.order(db,'type-'+i,'label',{raw:rawCases[i]});const before=await cases(db);await db.exec(install);await backfill(db);await db.exec(cutover);assert.deepEqual(await cases(db),before);
 const q=(await db.query("select c.relrowsecurity rls,c.relacl::text acl from pg_class c where c.oid='private.newar_withdraw_reason_facts'::regclass")).rows[0];assert(q.rls);assert(!/anon|authenticated|service_role/.test(q.acl));
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(db.query('select * from private.newar_withdraw_reason_facts'),/permission denied/);await db.exec('reset role');}
 }finally{await db.close()}});
