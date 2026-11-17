-- A disabled publication kernel cannot start a new cutoff. Use the
-- existing unsupported response only after the authorized catalog, published
-- heads, and queued work for the precise requested window have been checked.
set local lock_timeout = '2s';

do $migration$
declare
  reader regprocedure := 'private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure;
  retirement regprocedure := 'private.provider_snapshot_retire_intraday(uuid)'::regprocedure;
  read_hash text;
  retention_hash text;
  anchor text := $anchor$ if v_lookup_cut is not null then v_previous_end:=$anchor$;
  guard text := $guard$ -- No published or scheduled cutoff exists for this authorized window while
 -- the publication worker's computation contract is unavailable.
 if v_version=2 and v_kernel_current is false and v_lookup_cut is null then
  return jsonb_build_object('version',v_version,'mode','published_snapshot','status','unsupported','complete',false,
   'requested',p_request,'platforms','[]'::jsonb,'missing','[]'::jsonb,'window',null,
   'publishedCutoff',null,'cutoffEpochMs',null,'computedAt',null,'nextDueAt',null,
   'workorders',jsonb_build_object('status','not_loaded'),'rates',jsonb_build_object('status','not_loaded'));
 end if;
$guard$;
begin
  select md5(prosrc) into strict read_hash from pg_proc where oid=reader;
  select md5(prosrc) into strict retention_hash from pg_proc where oid=retirement;
  if read_hash='619d02dfa099b2301d5b4857e6a8644e' and retention_hash='e3c0655e21f2f292ad4df8382f9d41ee' then return; end if;
  if read_hash<>'66d7a6afd3e1951726da83daa258df22' or retention_hash<>'2222dc8768404fa848930bf4a9533f3e' then
    raise exception 'provider_unavailable_reader_baseline_changed';
  end if;
  execute replace(pg_get_functiondef(reader),anchor,guard||anchor);
  -- The existing retirement routine verifies the exact reader body. Add the
  -- new valid fingerprint without changing which data it can retire.
  execute replace(pg_get_functiondef(retirement),
    $prior$md5(prosrc)in('d9eab72829992b0ee59e75e9845f0681','66d7a6afd3e1951726da83daa258df22')$prior$,
    $next$md5(prosrc)in('d9eab72829992b0ee59e75e9845f0681','66d7a6afd3e1951726da83daa258df22','619d02dfa099b2301d5b4857e6a8644e')$next$);
  if (select md5(prosrc) from pg_proc where oid=reader)<>'619d02dfa099b2301d5b4857e6a8644e'
    or (select md5(prosrc) from pg_proc where oid=retirement)<>'e3c0655e21f2f292ad4df8382f9d41ee' then
    raise exception 'provider_unavailable_reader_verification_failed';
  end if;
end;
$migration$;

