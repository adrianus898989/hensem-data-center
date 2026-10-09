-- Preserve source list order without changing collector payloads or snapshot identity.
begin;
alter table private.yash_channels add column source_position integer check(source_position between 1 and 2000);
do $source_position$
declare p record;d text;before_meta jsonb;edit record;
begin
 select * into strict p from pg_proc where oid='public.yash_channel_ingest(text,jsonb)'::regprocedure;
 if md5(p.prosrc)<>'ccd1cf0b279d820dc165cac3c606f7de' or md5(pg_get_functiondef(p.oid))<>'b39647158d218ff3f2e6610fce57cafc' then raise exception 'yash_channel_position_ingest_drift';end if;
 if p.prosecdef or p.provolatile<>'v' or p.proconfig is distinct from array['search_path=""'] or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'yash_channel_position_ingest_metadata_drift';end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 for edit in select * from (values
  ($old$r jsonb; k text; v private.yash_channels;$old$,$new$r jsonb; k text; source_index integer; v private.yash_channels;$new$,1),
  ($old$for r in select value from jsonb_array_elements(p_request->'records') loop$old$,$new$for r,source_index in select value,ordinality::integer from jsonb_array_elements(p_request->'records') with ordinality order by ordinality loop$new$,1),
  ($old$v:=jsonb_populate_record(null::private.yash_channels,r);v.order_type:=kind;$old$,$new$v:=jsonb_populate_record(null::private.yash_channels,r);v.order_type:=kind;v.source_position:=source_index;$new$,1),
  ($old$'config_changed_at','is_present']$old$,$new$'config_changed_at','is_present','source_position']$new$,2),
  ($old$insert into private.yash_channels (order_type,channel_id,$old$,$new$insert into private.yash_channels (order_type,channel_id,source_position,$new$,1),
  ($old$values (v.order_type,v.channel_id,$old$,$new$values (v.order_type,v.channel_id,v.source_position,$new$,1),
  ($old$on conflict(order_type,channel_id) do update set channel_name=$old$,$new$on conflict(order_type,channel_id) do update set source_position=excluded.source_position,channel_name=$new$,1)
 )e(old_value,new_value,expected) loop
  if (length(d)-length(replace(d,edit.old_value,'')))/length(edit.old_value)<>edit.expected then raise exception 'yash_channel_position_ingest_anchor_drift';end if;
  d:=replace(d,edit.old_value,edit.new_value);
 end loop;
 execute d;
 if (select to_jsonb(x)-'prosrc' from pg_proc x where oid=p.oid) is distinct from before_meta then raise exception 'yash_channel_position_ingest_metadata_changed';end if;
 select * into strict p from pg_proc where oid='private.dashboard_admin_live_channel_status(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'5b26ef21de81e365384368ba5053d8a3' or md5(pg_get_functiondef(p.oid))<>'bca360d678740bbbd8789380e66db005' then raise exception 'yash_channel_position_reader_drift';end if;
 if not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""'] or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'yash_channel_position_reader_metadata_drift';end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 for edit in select * from (values
  ($old$'channel_id',c.channel_id,$old$,$new$'channel_id',c.channel_id,'source_position',c.source_position,$new$,1),
  ($old$order by c.is_present desc,c.priority nulls last,c.channel_id$old$,$new$order by c.is_present desc,c.source_position nulls last,c.priority nulls last,c.channel_id$new$,1)
 )e(old_value,new_value,expected) loop
  if (length(d)-length(replace(d,edit.old_value,'')))/length(edit.old_value)<>edit.expected then raise exception 'yash_channel_position_reader_anchor_drift';end if;
  d:=replace(d,edit.old_value,edit.new_value);
 end loop;
 execute d;
 if (select to_jsonb(x)-'prosrc' from pg_proc x where oid=p.oid) is distinct from before_meta then raise exception 'yash_channel_position_reader_metadata_changed';end if;
end;$source_position$;
notify pgrst,'reload schema';
commit;
