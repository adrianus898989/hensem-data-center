-- Targeted update of the existing raw query. Canonical wrapper and ACL stay intact.
-- Successful order lists match the successful-time aggregates; all-order pulls
-- retain creation time. Safe to rerun; unexpected deployed layouts abort.
begin;
set local lock_timeout='3s';
set local statement_timeout='12s';
do $patch$
declare d text;r record;n integer;old_acl aclitem[];old_owner oid;
begin
  select pg_get_functiondef(p.oid),p.proacl,p.proowner into strict d,old_acl,old_owner
    from pg_proc p where p.oid='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;
  for r in select * from (values
    ($old$($19<>'aggregate' and $old$,$new$($19<>'aggregate' and $8<>'success' and $new$,4),
    ($old$($19='aggregate' and ($old$,$new$(($19='aggregate' or $8='success') and ($new$,4),
    ($old$and ($19='details' or $8<>'success' or (status_group='success' and success_in_range))$old$,$new$and ($8<>'success' or (status_group='success' and success_in_range))$new$,1),
    ($old$case when $19<>'details' and $8='success'$old$,$new$case when $8='success'$new$,1),
    ($old$order by created_at desc,direction desc,id desc$old$,$new$order by case when $8='success' then success_at else created_at end desc,direction desc,id desc$new$,2)
  ) replacements(old_text,new_text,expected_count) loop
    n:=(length(d)-length(replace(d,r.old_text,'')))/length(r.old_text);
    if (length(d)-length(replace(d,r.new_text,'')))/length(r.new_text)=r.expected_count then continue;
    elsif n=r.expected_count then d:=replace(d,r.old_text,r.new_text);
    else
      raise exception 'Unexpected query layout; success-time update not applied';
    end if;
  end loop;
  execute d;
  if exists(select 1 from pg_proc p where p.oid='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure
    and (p.proacl is distinct from old_acl or p.proowner<>old_owner)) then
    raise exception 'Query permissions changed';
  end if;
end $patch$;
-- Scope this setting to this function, not the database or other modules.
alter function private.dashboard_admin_live_query_raw(jsonb) set jit=off;
commit;
