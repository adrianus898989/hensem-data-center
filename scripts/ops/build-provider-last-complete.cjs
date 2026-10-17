// Offline exact reader patch; no database or native business reads.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const baseline=read('tests/fixtures/provider-last-complete/reader-baseline.json').functions.find(x=>x.signature==='private.dashboard_admin_live_provider_snapshot(jsonb)'),retire=read('tests/fixtures/provider-last-complete/retire-baseline.json');
const md5=s=>crypto.createHash('md5').update(s).digest('hex'),body=s=>s.match(/AS (\$[a-z_]*\$)([^]*?)\1/i)[2];
function rep(s,a,b,n=1){if(s.split(a).length-1!==n)throw Error('anchor '+a);return s.split(a).join(b);}
let r=baseline.definition;
r=rep(r," v_scope jsonb:=", " v_version integer;v_due boolean:=false;v_slot_due boolean;v_refresh text:='idle';v_slot_refresh text;v_refresh_at timestamptz;\n v_scope jsonb:=");
r=rep(r,"or p_request->'version'is distinct from'1'::jsonb", "or p_request->'version'is null or p_request->'version'not in('1'::jsonb,'2'::jsonb)");
r=rep(r," if p_request?'export'then", " v_version:=(p_request->>'version')::integer;\n if p_request?'export'then");
r=rep(r,"'version',1,'mode','published_snapshot'", "'version',v_version,'mode','published_snapshot'",5);
r=rep(r,"artifact_dependency=current_dependency and status='ready'and artifact_revision=revision", "artifact_dependency=current_dependency and(status='ready'or v_version=2 and status in('queued','running','failed')and dependency_token=current_dependency)and artifact_revision=revision",2);
r=rep(r,"select j.status,j.last_error_code,j.revision job_revision", "select j.status,j.last_error_code,j.dependency_token job_dependency,j.next_due_at job_next_due,j.revision job_revision");
r=rep(r,"v_payload:=null;v_state:='missing';", "v_payload:=null;v_state:='missing';v_slot_due:=false;v_slot_refresh:='idle';");
const old=`      v_payload:=v_j.payload;v_state:=case when v_j.status in('queued','running')then'building'when v_j.status='failed'then'failed'
       when v_j.status is distinct from'ready'or v_j.artifact_revision is distinct from v_j.job_revision or not v_kernel_current or v_j.dependency_token is distinct from v_dep or v_j.next_due_at<=statement_timestamp()
       or v_period='current'and v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date and v_lookup_cut<statement_timestamp()-interval'30minutes'
       then'stale'else'ready'end;`;
const next=`      v_payload:=v_j.payload;
      v_slot_due:=coalesce(v_j.next_due_at<=statement_timestamp(),false)
       or v_period='current'and v_from::date=(statement_timestamp()at time zone'Asia/Kolkata')::date and v_lookup_cut<statement_timestamp()-interval'30minutes';
      if v_version=2 then
       -- A job's lease/fence may advance during refresh. Only the exact semantic
       -- revision, native target and dependencies authorize its immutable prior head.
       v_state:=case when v_j.artifact_revision is distinct from v_j.job_revision or not v_kernel_current
        or v_j.dependency_token is distinct from v_dep or v_j.job_dependency is distinct from v_dep
        or v_j.provenance->'computationComplete'is distinct from'true'::jsonb
        or v_j.status not in('ready','queued','running','failed')then'stale'else'ready'end;
       if v_state<>'ready'then v_payload:=null;end if;
      else
       v_state:=case when v_j.status in('queued','running')then'building'when v_j.status='failed'then'failed'
        when v_j.status is distinct from'ready'or v_j.artifact_revision is distinct from v_j.job_revision or not v_kernel_current
         or v_j.dependency_token is distinct from v_dep or v_slot_due then'stale'else'ready'end;
      end if;
      v_slot_refresh:=case when v_j.status in('queued','running','failed')then v_j.status else'idle'end;
      v_due:=v_due or v_slot_due;
      if v_slot_refresh='running'or v_slot_refresh='queued'and v_refresh<>'running'or v_slot_refresh='failed'and v_refresh='idle'then v_refresh:=v_slot_refresh;end if;
      if v_j.job_next_due is not null and(v_refresh_at is null or v_j.job_next_due<v_refresh_at)then v_refresh_at:=v_j.job_next_due;end if;`;
r=rep(r,old,next);
r=rep(r,"'upstreamComplete',v_j.provenance->'upstreamComplete','stale',v_state='stale','nextDueAt',private.provider_snapshot_iso(v_j.next_due_at)))", "'upstreamComplete',v_j.provenance->'upstreamComplete','stale',v_state='stale','nextDueAt',private.provider_snapshot_iso(v_j.next_due_at))||case when v_version=2 then jsonb_build_object('freshness',case when v_state='ready'then case when v_slot_due then'refresh_due'else'fresh'end end,'refreshState',v_slot_refresh,'nextRefreshAt',private.provider_snapshot_iso(v_j.job_next_due))else'{}'::jsonb end)");
r=rep(r,"'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));\nend;", "'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'))||case when v_version=2 then jsonb_build_object('freshness',case when v_all then case when v_due then'refresh_due'else'fresh'end end,'refreshState',v_refresh,'nextRefreshAt',private.provider_snapshot_iso(v_refresh_at))else'{}'::jsonb end;\nend;");
const readerHash=md5(body(r));let t=rep(retire.definition,"md5(prosrc)='d9eab72829992b0ee59e75e9845f0681'",`md5(prosrc)in('d9eab72829992b0ee59e75e9845f0681','${readerHash}')`);
function quoted(s){return "'"+s.replaceAll("'","''")+"'";}
const funcs=[{signature:baseline.signature,ddl:r,before:baseline.md5,after:readerHash,definer:true,acl:'{postgres=X/postgres,authenticated=X/postgres}',volatility:'s'},{signature:'private.provider_snapshot_retire_intraday(uuid)',ddl:t,before:retire.md5,after:md5(body(t)),definer:false,acl:'{postgres=X/postgres}',volatility:'v'}];
const guards=funcs.map(x=>` if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(${quoted(x.signature)})and md5(prosrc)=${quoted(x.before)}and pg_get_userbyid(proowner)='postgres'and prosecdef=${x.definer} and provolatile='${x.volatility}'and proconfig=array['search_path=""']and proacl::text=${quoted(x.acl)}and l.lanname='plpgsql'and not proisstrict and not proleakproof and proparallel='u'and prokind='f'and not proretset and procost=100 and prorows=0 and pronargdefaults=0)then raise exception 'provider_last_complete_baseline_drift: ${x.signature}';end if;`).join('\n');
const sql=`-- Version 2 changes freshness visibility only. Existing scheduled producers stay authoritative.
-- No queue writes, requeue, source computation, TTL extension or dependency-token changes.
begin;
set local statement_timeout='5s';
set local lock_timeout='500ms';
do $install$
declare before_metadata jsonb;after_metadata jsonb;begin
 if current_user<>'postgres'then raise exception 'provider_last_complete_denied';end if;
${guards}
 select jsonb_agg(to_jsonb(p)-array['prosrc']order by p.oid)into before_metadata from pg_proc p where p.oid in('private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure,'private.provider_snapshot_retire_intraday(uuid)'::regprocedure);
 ${funcs.map((x,i)=>`execute $definition_${i}$${x.ddl}$definition_${i}$;`).join('\n ')}
 select jsonb_agg(to_jsonb(p)-array['prosrc']order by p.oid)into after_metadata from pg_proc p where p.oid in('private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure,'private.provider_snapshot_retire_intraday(uuid)'::regprocedure);
 if after_metadata is distinct from before_metadata then raise exception 'provider_last_complete_metadata_changed';end if;
 ${funcs.map(x=>`if(select md5(prosrc)from pg_proc where oid=${quoted(x.signature)}::regprocedure)is distinct from'${x.after}'then raise exception 'provider_last_complete_postcheck';end if;`).join('\n ')}
end;$install$;
commit;
`;
fs.writeFileSync(path.join(root,'supabase/operations/provider-last-complete.sql'),sql);
fs.writeFileSync(path.join(root,'supabase/operations/provider-last-complete-hashes.json'),JSON.stringify(funcs.map(({ddl,...x})=>x),null,2)+'\n');
