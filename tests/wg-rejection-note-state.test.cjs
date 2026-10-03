// Synthetic note provenance only. Local PostgreSQL; no source-site or production reads.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261003131534_wg_rejection_note_state.sql');
const notice='业务备注包含未识别或敏感自由文本，原文已隐藏，待核实',interceptionNotice='未识别拦截原因，原文已隐藏，待核实';
const cases=[];
for(let i=0;i<7;i++)cases.push({id:'HIDDEN-FRONT-'+i,state:'withheld',fields:{note_state:i<5?'template':'withheld',remark_sanitized:i<5?'自动审核业务模板':interceptionNotice,interception_reason:i<5?'自动审核业务模板':interceptionNotice,front_note_state:'withheld',front_note_sanitized:notice,back_note_state:'empty'}});
cases.push(
 {id:'HIDDEN-MAIN',state:'withheld',fields:{note_state:'redacted',remark_sanitized:'保留的安全片段; '+notice,front_note_state:'empty',back_note_state:'empty'}},
 {id:'HIDDEN-BACK',state:'withheld',fields:{note_state:'empty',front_note_state:'empty',back_note_state:'withheld',back_note_sanitized:notice}},
 {id:'MISSING-ALL',state:'missing',fields:{}},
 {id:'MISSING-NULL',state:'missing',fields:{note_state:'empty',front_note_state:'withheld',front_note_sanitized:null,back_note_state:'empty'}},
 {id:'MISSING-INTERCEPTION',state:'missing',fields:{note_state:'template',remark_sanitized:'自动审核业务模板',interception_reason:'自动审核业务模板',front_note_state:'empty',back_note_state:'empty'}},
 {id:'MISSING-PARTIAL',state:'missing',fields:{note_state:'empty',front_note_state:'empty'}},
 {id:'MISSING-CROSS-SLOT',state:'missing',fields:{note_state:'template',remark_sanitized:notice,front_note_state:'withheld',front_note_sanitized:null,back_note_state:'empty'}},
 {id:'MISSING-UNKNOWN-TEXT',state:'missing',fields:{note_state:'empty',front_note_state:'withheld',front_note_sanitized:'Unknown source text',back_note_state:'empty'}},
 {id:'EMPTY-NULL',state:'empty',fields:{note_state:'empty',front_note_state:'empty',back_note_state:'empty'}},
 {id:'EMPTY-BLANK',state:'empty',fields:{note_state:'empty',front_note_state:'empty',back_note_state:'empty',rejection_reason:' \t\n'}}
);
for(const [i,reason]of ['source text','source text ','source text','（源备注为空）','（源业务备注已隐藏，驳回备注待核对）','<img src=x onerror=alert(1)>\n&#40;source&#41;'].entries())cases.push({id:'PRESENT-'+i,state:'present',fields:{note_state:'empty',front_note_state:'withheld',front_note_sanitized:notice,back_note_state:'empty',rejection_reason:reason}});
let db,metadata,otherMetadata,beforeBlocking,sourceChecksum,knownKeys;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const call=extra=>scalar('select private.dashboard_admin_wg_withdraw_reasons($1::jsonb,$2::jsonb) value',[JSON.stringify({country:'印度',platform:'WG-SYNTHETIC',date:'2026-09-30',kind:'categories',limit:500,...extra}),'{}']);
const meta=()=>scalar("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure");
const otherMeta=()=>db.query("select to_jsonb(p) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname<>'dashboard_admin_wg_withdraw_reasons' order by p.oid").then(x=>x.rows);
const checksum=()=>scalar("select md5(jsonb_agg(to_jsonb(d) order by site_code,order_number)::text) value from wg_withdraw_details d");
const blocks=async()=>{const b=await call({kind:'blocking'}),out=[b];for(const row of b.rows)for(const kind of ['blockingVariants','blockingOrders'])out.push(await call({kind,reasonKey:row.reasonKey}));return out};
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'yes')='yes' and $2='IN' and $3='WG-SYNTHETIC'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_wg_sites() returns table(country text,country_code text,platform text,site_code text,currency text,timezone text) language sql stable as $$values('印度','IN','WG-SYNTHETIC','SYNTHETIC-SITE','INR','Asia/Kolkata')$$;
 create function private.dashboard_admin_live_clean_note(text) returns text language sql immutable as $$select nullif(btrim($1),'')$$;
 create function private.dashboard_admin_live_rejection_exact_note(p_note text) returns text language sql immutable set search_path='' as $$select case when p_note ~ '[^[:space:]]' then p_note end$$;
 create function private.dashboard_admin_live_rejection_exact_key(p_note text) returns text language sql immutable set search_path='' as $$select md5(jsonb_build_array('source_rejection_note_v1',private.dashboard_admin_live_rejection_exact_note(p_note))::text)$$;
 create table wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
 create table wg_withdraw_details(site_code text,order_number text,member_amount numeric,status_code integer,status_group text,created_at timestamptz,captured_at timestamptz,business_fields jsonb);
 insert into wg_detail_coverage values('SYNTHETIC-SITE','withdraw','created','2026-09-30',true);`);
 await db.exec(read('tests/fixtures/wg-rejection-note-state-baseline.sql'));
 await db.exec('revoke all on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) from public,anon,authenticated,service_role');
 for(const c of cases)await db.query("insert into wg_withdraw_details values('SYNTHETIC-SITE',$1,100,7,'rejected','2026-09-30T05:00Z','2026-10-01T05:00Z',$2)",[c.id,{operator_name:'synthetic-agent',operator_class:'manual',...c.fields}]);
 await db.query("insert into wg_withdraw_details values('SYNTHETIC-SITE','PAID-NOTE',100,4,'success','2026-09-30T05:00Z','2026-10-01T05:00Z',$1),('SYNTHETIC-SITE','BEFORE-LOCAL-DAY',100,7,'rejected','2026-09-29T18:29:59Z','2026-10-01T05:00Z',$1),('FOREIGN-SITE','FOREIGN-NOTE',100,7,'rejected','2026-09-30T05:00Z','2026-10-01T05:00Z',$1)",[{operator_name:'system',operator_class:'auto',rejection_reason:'EXCLUDED-SOURCE-TEXT',front_note_state:'withheld',front_note_sanitized:notice}]);
 assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure"),'eaa58b63c49c9372d9b65bf22118b36f');
 knownKeys=new Map((await call()).rows.filter(r=>r.sourceReason!==null).map(r=>[r.sourceReason,r.categoryKey]));
 metadata=await meta();otherMetadata=await otherMeta();sourceChecksum=await checksum();beforeBlocking=await blocks();await db.exec(migration);
});
after(async()=>db?.close());
test('null rejection notes distinguish proven hidden content, missing collection and all explicitly empty fields',async()=>{
 const d=await call();for(const state of ['withheld','missing','empty']){const g=d.rows.filter(r=>r.rejectionNoteState===state);assert.equal(g.length,1);assert.equal(g[0].count,cases.filter(c=>c.state===state).length);assert.equal(g[0].sourceReason,null);assert.equal(g[0].sourceVariantCount,null)}
 assert.equal(d.summary.withheldReason,9);assert.equal(d.summary.missingReason,6);assert.equal(d.summary.emptyReason,2);assert.equal(d.summary.presentReason,6);assert.equal(d.summary.knownReasonCount,5);
 assert.equal(d.summary.totalRejected,cases.length);assert.equal(d.noteCount,cases.length);assert.equal(d.summary.withheldReason+d.summary.missingReason+d.summary.emptyReason+d.summary.presentReason,cases.length);
 assert.equal(d.rejectionNoteStateVersion,'wg_source_note_state_v1');assert(!JSON.stringify(d).includes('EXCLUDED-SOURCE-TEXT'));
});
test('each state group drills by category and reason key to the same exact synthetic orders',async()=>{
 const d=await call(),r=await call({kind:'rejection'});for(const group of d.rows){
  const a=await call({kind:'orders',category:group.categoryKey}),b=await call({kind:'orders',reasonKey:group.categoryKey});assert.deepEqual(a.rows,b.rows);assert.equal(a.total,group.count);assert.equal(a.noteCount,cases.length);
  assert.equal(r.rows.find(x=>x.reasonKey===group.categoryKey).rejectionNoteState,group.rejectionNoteState);
  assert(a.rows.every(x=>x.rejectionNoteState===group.rejectionNoteState));
  if(group.rejectionNoteState!=='present')assert.deepEqual(a.rows.map(x=>x.orderNumber).sort(),cases.filter(c=>c.state===group.rejectionNoteState).map(c=>c.id).sort());
 }
 const hidden=d.rows.find(x=>x.rejectionNoteState==='withheld'),q=await call({kind:'orders',category:hidden.categoryKey,query:'HIDDEN-FRONT-'});assert.equal(q.total,7);assert.equal(q.noteCount,cases.length);assert.equal(q.summary.withheldReason,9);
});
test('nonempty text and exact keys take precedence; state labels cannot collide with actual source text',async()=>{
 const d=await call();for(const [text,key]of knownKeys){const g=d.rows.find(x=>x.sourceReason===text);assert(g,text);assert.equal(g.categoryKey,key);assert.equal(g.rejectionNoteState,'present')}
 const unknownKeys=d.rows.filter(x=>x.rejectionNoteState!=='present').map(x=>x.categoryKey);assert.equal(new Set(unknownKeys).size,3);for(const x of d.rows.filter(x=>x.rejectionNoteState==='present'))assert(!unknownKeys.includes(x.categoryKey));
 const op=await call({kind:'operators'});assert.equal(op.rows[0].categoryCount,5);assert.equal(op.rows[0].missingReasonCount,17);
});
test('order DTO exposes source states and hidden slot names without replacing missing rejection text with interception',async()=>{
 const d=await call({kind:'orders',query:'HIDDEN-FRONT-0'}),row=d.rows[0];assert.equal(row.rejectionReason,null);assert.equal(row.rawRejectionReason,null);assert.equal(row.rejectionNoteState,'withheld');assert.equal(row.manualRemark,'自动审核业务模板');assert.deepEqual(row.hiddenNoteSources,['front']);assert.deepEqual(row.sourceNoteStates,{remark:'template',front:'withheld',back:'empty'});
 for(const x of(await call({kind:'orders'})).rows)assert(!Object.keys(x).some(k=>/business_fields|sanitized|source_fields|audit|frontRemark|beckRemark/.test(k)));
 const missing=(await call({kind:'orders',query:'MISSING-CROSS-SLOT'})).rows[0];assert.equal(missing.rejectionNoteState,'missing');assert.deepEqual(missing.hiddenNoteSources,[]);
});
test('all blocking JSON, source rows, unrelated functions and every WG reader metadata attribute remain unchanged',async()=>{
 assert.deepEqual(await blocks(),beforeBlocking);assert.deepEqual(await meta(),metadata);assert.deepEqual(await otherMeta(),otherMetadata);assert.equal(await checksum(),sourceChecksum);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,'private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)']),false);
 await db.exec("select set_config('test.allowed','no',false)");try{assert.equal(await call(),null)}finally{await db.exec("select set_config('test.allowed','yes',false)")}
});
test('bounded pagination conserves the day and preserves status/date/site scope',async()=>{
 const all=await call({kind:'orders'}),a=await call({kind:'orders',limit:20}),b=await call({kind:'orders',limit:20,offset:20});assert.equal(all.total,cases.length);assert.deepEqual([...a.rows,...b.rows],all.rows);assert.equal(new Set(all.rows.map(x=>x.orderNumber)).size,cases.length);assert(all.rows.every(x=>x.currency==='INR'&&x.statusCode===7));
});
test('migration is idempotent and rejects body/ACL drift atomically without source writes or new grants',async()=>{
 const before=await call();await db.exec(migration);assert.deepEqual(await call(),before);assert.deepEqual(await meta(),metadata);
 await db.exec('begin');try{await db.exec('grant execute on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) to authenticated');await assert.rejects(db.exec(migration),/metadata changed/)}finally{await db.exec('rollback')}
 await db.exec('begin');try{await db.exec(read('tests/fixtures/wg-rejection-note-state-baseline.sql').replace(' return answer;',' return answer; -- changed body'));await assert.rejects(db.exec(migration),/production body changed/)}finally{await db.exec('rollback')}
 assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:grant\s|insert\s+into|delete\s+from|update\s+public|truncate\s|drop\s+(?:table|view|function))\b/i);assert.equal(await checksum(),sourceChecksum);
});
