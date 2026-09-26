-- New detailed-admin current-rate read API only.
-- Dependency: admin-live-query.sql (fresh independent permission/scope helper).
-- No source data, old RPC, collector or existing table policy is changed.
begin;

-- Display-only source projection. It never changes category or fee matching.
-- A blank cell is filled only when the original sheet explicitly merges it.
create or replace function private.dashboard_admin_rate_source_cell(p_grid jsonb,p_row integer,p_column integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  m jsonb; sr integer; er integer; sc integer; ec integer;
  grid_rows integer; grid_columns integer;
  anchor_row integer:=p_row; anchor_column integer:=p_column; matches integer:=0; cell jsonb;
begin
  if p_row is null or p_column is null or p_row<0 or p_column<0
    or jsonb_typeof(p_grid->'cells') is distinct from 'array'
    or jsonb_typeof(p_grid->'merges') is distinct from 'array' then return null; end if;
  if jsonb_array_length(p_grid->'merges')>10000 then return null; end if;
  if not (coalesce(p_grid->>'rowCount','') ~ '^[0-9]{1,5}$'
    and coalesce(p_grid->>'columnCount','') ~ '^[0-9]{1,3}$') then return null; end if;
  grid_rows:=(p_grid->>'rowCount')::integer; grid_columns:=(p_grid->>'columnCount')::integer;
  if grid_rows>10000 or grid_columns>512 or p_row>=grid_rows or p_column>=grid_columns then return null; end if;
  for m in select value from jsonb_array_elements(p_grid->'merges') loop
    if not (coalesce(m->>'startRowIndex','') ~ '^[0-9]{1,5}$'
      and coalesce(m->>'endRowIndex','') ~ '^[0-9]{1,5}$'
      and coalesce(m->>'startColumnIndex','') ~ '^[0-9]{1,3}$'
      and coalesce(m->>'endColumnIndex','') ~ '^[0-9]{1,3}$') then return null; end if;
    sr:=(m->>'startRowIndex')::integer; er:=(m->>'endRowIndex')::integer;
    sc:=(m->>'startColumnIndex')::integer; ec:=(m->>'endColumnIndex')::integer;
    if sr>=er or sc>=ec or er>grid_rows or ec>grid_columns then return null; end if;
    if p_row>=sr and p_row<er and p_column>=sc and p_column<ec then
      matches:=matches+1;
      if matches>1 then return null; end if;
      anchor_row:=sr; anchor_column:=sc;
    end if;
  end loop;
  cell:=p_grid->'cells'->anchor_row->anchor_column;
  if jsonb_typeof(cell->'text') is distinct from 'string' then return null; end if;
  return jsonb_build_object('text',cell->>'text','row',anchor_row,'column',anchor_column);
end;
$$;
revoke all on function private.dashboard_admin_rate_source_cell(jsonb,integer,integer) from public,anon,authenticated;

-- Called once per sheet for the already authorized, paginated rate rows.
-- Only the workbook's published run and matching metadata can supply labels.
create or replace function private.dashboard_admin_rate_type_sources(p_sheet_name text,p_source_rows integer[])
returns table(source_row integer,source_type text,source_type_provider text,source_type_cell text,
  source_type_header text,source_type_sheet_id bigint,source_type_collected_at timestamptz)
language plpgsql stable set search_path='' as $$
declare
  grid jsonb; grid_cells jsonb; grid_merges jsonb; resolved_sheet_id bigint; source_run uuid;
  collected_at timestamptz; rows_count integer; columns_count integer;
  r integer; c integer; i integer; j integer; sr integer; er integer; sc integer; ec integer;
  anchor integer; type_anchor integer; provider_anchor integer;
  header_anchors integer[]; type_anchors integer[]; provider_anchors integer[];
  merge_index integer[]:='{}'; wanted_rows integer[];
  type_column integer; provider_column integer;
  type_header_row integer:=-1; provider_header_row integer:=-1; type_header text;
  cell jsonb; provider_cell jsonb; label text; column_label text; n integer; m jsonb;
begin
  if p_sheet_name is null or cardinality(p_source_rows) is null or cardinality(p_source_rows)>500
    or to_regclass('public.third_party_rate_original_workbooks') is null
    or to_regclass('public.third_party_rate_original_sheets') is null then return; end if;
  -- Resolve tiny metadata first, then use the snapshot primary key. Filtering
  -- by payload title would decompress every sheet once for every request sheet.
  select q.run_id,q.sheet_id into source_run,resolved_sheet_id from (
    select w.run_id,case when entry->>'sheetId' ~ '^[0-9]{1,10}$' then (entry->>'sheetId')::bigint end as sheet_id,
      count(*) over() as matches
    from public.third_party_rate_original_workbooks w
    cross join lateral jsonb_array_elements(case when jsonb_typeof(w.metadata->'sheets')='array'
      then w.metadata->'sheets' else '[]'::jsonb end) entry
    where w.source_key='default' and entry->>'title'=p_sheet_name
  ) q where q.matches=1;
  if source_run is null or resolved_sheet_id is null then return; end if;
  select s.payload,s.collected_at into grid,collected_at
    from public.third_party_rate_original_sheets s where s.run_id=source_run and s.sheet_id=resolved_sheet_id;
  if grid->'sheet'->>'title' is distinct from p_sheet_name
    or grid->'sheet'->>'sheetId' is distinct from resolved_sheet_id::text then return; end if;
  if grid is null or not (coalesce(grid->>'rowCount','') ~ '^[0-9]{1,5}$'
    and coalesce(grid->>'columnCount','') ~ '^[0-9]{1,3}$') then return; end if;
  rows_count:=(grid->>'rowCount')::integer; columns_count:=(grid->>'columnCount')::integer;
  if rows_count<1 or rows_count>10000 or columns_count<1 or columns_count>512
    or rows_count::bigint*columns_count>250000 then return; end if;
  grid_cells:=grid->'cells'; grid_merges:=grid->'merges'; grid:=null;
  if jsonb_typeof(grid_cells) is distinct from 'array' or jsonb_typeof(grid_merges) is distinct from 'array' then return; end if;
  if jsonb_array_length(grid_merges)>10000 then return; end if;
  header_anchors:=array_fill(null::integer,array[least(rows_count,4)*columns_count]);
  -- Parse/validate each merge once. Integer anchor indexes avoid sending the
  -- large formatted grid to a helper or scanning its merges for every cell.
  for m in select value from jsonb_array_elements(grid_merges) loop
    if not (coalesce(m->>'startRowIndex','') ~ '^[0-9]{1,5}$'
      and coalesce(m->>'endRowIndex','') ~ '^[0-9]{1,5}$'
      and coalesce(m->>'startColumnIndex','') ~ '^[0-9]{1,3}$'
      and coalesce(m->>'endColumnIndex','') ~ '^[0-9]{1,3}$') then return; end if;
    sr:=(m->>'startRowIndex')::integer; er:=(m->>'endRowIndex')::integer;
    sc:=(m->>'startColumnIndex')::integer; ec:=(m->>'endColumnIndex')::integer;
    if sr>=er or sc>=ec or er>rows_count or ec>columns_count then return; end if;
    merge_index:=merge_index||array[sr,er,sc,ec];
    if sr<4 then
      for r in sr..least(er,4)-1 loop
        for c in sc..ec-1 loop
          i:=r*columns_count+c+1;
          header_anchors[i]:=case when header_anchors[i] is null then sr*columns_count+sc else -1 end;
        end loop;
      end loop;
    end if;
  end loop;
  for r in 0..least(rows_count,4)-1 loop
    for c in 0..columns_count-1 loop
      anchor:=coalesce(header_anchors[r*columns_count+c+1],r*columns_count+c);
      if anchor<0 then continue; end if;
      -- #> walks to the scalar without materializing a formatted row/cell.
      cell:=grid_cells#>array[(anchor/columns_count)::text,(anchor%columns_count)::text,'text'];
      if jsonb_typeof(cell) is distinct from 'string' then continue; end if;
      label:=btrim(regexp_replace(cell#>>'{}','[[:space:]]+',' ','g'));
      if label ~ '^(类型([ ]*[/／][ ]*钱包)?|钱包(类型)?|通道类型|收款类型|代收类型|业务类型)$' then
        if type_column is not null and type_column<>anchor%columns_count then return; end if;
        type_column:=anchor%columns_count; type_header_row:=anchor/columns_count; type_header:=cell#>>'{}';
      elsif label ~ '^(三方(名称)?|代收三方|代付三方|支付三方|三方支付名称)$' then
        if provider_column is not null and provider_column<>anchor%columns_count then return; end if;
        provider_column:=anchor%columns_count; provider_header_row:=anchor/columns_count;
      end if;
    end loop;
    -- Once both identities are found, later rows are data. In particular,
    -- the legitimate value "钱包" must not replace the "类型" heading.
    if provider_column is not null then
      if type_column is null then return; end if;
      exit;
    end if;
  end loop;
  if type_column is null or provider_column is null or type_column=provider_column then return; end if;
  select array_agg(value order by value) into wanted_rows from (select distinct value from unnest(p_source_rows) value
    where value>greatest(type_header_row,provider_header_row)+1 and value<=rows_count) wanted;
  if wanted_rows is null then return; end if;
  type_anchors:=array_fill(null::integer,array[cardinality(wanted_rows)]);
  provider_anchors:=array_fill(null::integer,array[cardinality(wanted_rows)]);
  if cardinality(merge_index)>0 then
    for j in 1..cardinality(merge_index) by 4 loop
      sr:=merge_index[j];er:=merge_index[j+1];sc:=merge_index[j+2];ec:=merge_index[j+3];
      if not (type_column>=sc and type_column<ec or provider_column>=sc and provider_column<ec) then continue; end if;
      for i in 1..cardinality(wanted_rows) loop
        r:=wanted_rows[i]-1;
        if r<sr or r>=er then continue; end if;
        if type_column>=sc and type_column<ec then
          type_anchors[i]:=case when type_anchors[i] is null then sr*columns_count+sc else -1 end;
        end if;
        if provider_column>=sc and provider_column<ec then
          provider_anchors[i]:=case when provider_anchors[i] is null then sr*columns_count+sc else -1 end;
        end if;
      end loop;
    end loop;
  end if;
  for i in 1..cardinality(wanted_rows) loop
    r:=wanted_rows[i];
    type_anchor:=coalesce(type_anchors[i],(r-1)*columns_count+type_column);
    provider_anchor:=coalesce(provider_anchors[i],(r-1)*columns_count+provider_column);
    if type_anchor<0 or provider_anchor<0 or type_anchor/columns_count<=type_header_row
      or provider_anchor/columns_count<=provider_header_row then continue; end if;
    cell:=grid_cells#>array[(type_anchor/columns_count)::text,(type_anchor%columns_count)::text,'text'];
    provider_cell:=grid_cells#>array[(provider_anchor/columns_count)::text,(provider_anchor%columns_count)::text,'text'];
    if jsonb_typeof(cell) is distinct from 'string' or jsonb_typeof(provider_cell) is distinct from 'string'
      or nullif(btrim(provider_cell#>>'{}'),'') is null then continue; end if;
    column_label:=''; n:=type_anchor%columns_count+1;
    while n>0 loop
      column_label:=chr(65+(n-1)%26)||column_label; n:=(n-1)/26;
    end loop;
    source_row:=r; source_type:=nullif(btrim(cell#>>'{}'),'');
    source_type_provider:=provider_cell#>>'{}'; source_type_cell:=column_label||(type_anchor/columns_count+1)::text;
    source_type_header:=type_header; source_type_sheet_id:=resolved_sheet_id; source_type_collected_at:=collected_at;
    return next;
  end loop;
end;
$$;
revoke all on function private.dashboard_admin_rate_type_sources(text,integer[]) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_rates(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_type text; v_country text; v_platform text; v_provider text; v_query text;
  v_offset integer; v_limit integer; v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
    'scopeType','country','platform','provider','query','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['scopeType','country','platform','provider','query'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200
       or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  foreach v_key in array array['offset','limit'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number'
      or p_request->>v_key !~ '^[0-9]{1,7}$') then
      raise exception using errcode='22023',message='invalid_pagination';
    end if;
  end loop;
  v_type:=coalesce(p_request->>'scopeType','all');
  v_country:=nullif(p_request->>'country','');
  v_platform:=nullif(p_request->>'platform','');
  v_provider:=nullif(p_request->>'provider','');
  v_query:=nullif(btrim(p_request->>'query'),'');
  v_offset:=coalesce((p_request->>'offset')::integer,0);
  v_limit:=coalesce((p_request->>'limit')::integer,20);
  if v_type not in ('all','country','platform') then
    raise exception using errcode='22023',message='invalid_scope_type';
  end if;
  if v_limit not in (20,30,50,100,500) or v_offset>1000000 then
    raise exception using errcode='22023',message='invalid_pagination';
  end if;
  -- These small configuration tables are intentionally separate rows. A generic
  -- country row is not a platform override and neither side is a fee history.
  with allowed_rows as materialized (
    select 'country:'||r.id as id,r.id as source_id,'country'::text as scope_type,
      r.country,private.dashboard_data_group(r.country,'') as scope_group,null::text as platform,
      r.third_party as provider,r.category,r.collect_fee,r.payout_fee,r.total_fee,
      r.collect_single_fee,r.payout_single_fee,r.collect_limit,r.payout_limit,
      r.status,null::text as raw_status,r.sheet_name,r.source_row,null::integer as source_column,r.updated_at
    from public.third_party_rates r
    where private.dashboard_scope_allows(v_scope,r.country,'')
    union all
    select 'platform:'||p.id,p.id,'platform'::text,
      p.country,private.dashboard_data_group(p.country,p.platform),p.platform,
      p.third_party,p.category,p.collect_fee,p.payout_fee,p.total_fee,
      p.collect_single_fee,p.payout_single_fee,p.collect_limit,p.payout_limit,
      p.status,p.raw_status,p.sheet_name,p.source_row,p.source_column,p.updated_at
    from public.third_party_platform_status p
    where private.dashboard_scope_allows(v_scope,p.country,p.platform)
  ), filtered as materialized (
    select * from allowed_rows a
    where (v_type='all' or a.scope_type=v_type)
      and (v_country is null or a.scope_group=v_country)
      and (v_platform is null or a.platform=v_platform)
      and (v_provider is null or a.provider=v_provider)
      -- Literal substring, not LIKE wildcard or fuzzy/canonical alias matching.
      and (v_query is null or strpos(lower(a.provider),lower(v_query))>0)
  ), page as materialized (
    select * from filtered order by scope_group nulls last,platform nulls first,provider nulls last,category nulls last,id
    offset v_offset limit v_limit
  ), type_sources as materialized (
    select q.sheet_name,t.* from (
      select sheet_name,array_agg(distinct source_row) as source_rows from page
      where sheet_name is not null and source_row is not null group by sheet_name
    ) q cross join lateral private.dashboard_admin_rate_type_sources(q.sheet_name,q.source_rows) t
  )
  select jsonb_build_object(
    'version',1,'asOf',statement_timestamp(),'basis','current_rate_table',
    'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit,
    'hasMore',(select count(*) from filtered)>v_offset::bigint+v_limit,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'sourceId',p.source_id,'scopeType',p.scope_type,
      'country',p.country,'scopeGroup',p.scope_group,'platform',p.platform,'provider',p.provider,
      'category',p.category,'collectFee',p.collect_fee,'payoutFee',p.payout_fee,'totalFee',p.total_fee,
      'collectSingleFee',p.collect_single_fee,'payoutSingleFee',p.payout_single_fee,
      'collectLimit',p.collect_limit,'payoutLimit',p.payout_limit,
      'status',p.status,'rawStatus',p.raw_status,'sheetName',p.sheet_name,
      'sourceRow',p.source_row,'sourceColumn',p.source_column,'updatedAt',p.updated_at,
      'sourceType',t.source_type,'sourceTypeProvider',t.source_type_provider,'sourceTypeCell',t.source_type_cell,
      'sourceTypeHeader',t.source_type_header,'sourceTypeSheetId',t.source_type_sheet_id,
      'sourceTypeCollectedAt',t.source_type_collected_at
    ) order by p.scope_group nulls last,p.platform nulls first,p.provider nulls last,p.category nulls last,p.id)
      from page p left join type_sources t on t.sheet_name=p.sheet_name and t.source_row=p.source_row),'[]'::jsonb),
    'options',jsonb_build_object(
      'countries',coalesce((select jsonb_agg(jsonb_build_object('value',o.scope_group,'label',o.country)
        order by o.scope_group,o.country) from (select scope_group,min(country) as country from allowed_rows
        where scope_group is not null and scope_group<>'' and country is not null group by scope_group) o),'[]'::jsonb),
      'platforms',coalesce((select jsonb_agg(jsonb_build_object('value',o.platform,'country',o.country,'scopeGroup',o.scope_group)
        order by o.scope_group,o.platform) from (select distinct platform,country,scope_group from allowed_rows
        where platform is not null and platform<>'') o),'[]'::jsonb),
      'providers',coalesce((select jsonb_agg(o.provider order by o.provider) from
        (select distinct provider from allowed_rows where provider is not null and provider<>'') o),'[]'::jsonb)
    ),
    'capabilities',jsonb_build_object('historicalFeeVersions',false,'feeEstimate',false,
      'providerMatching','exact_raw_name','tierHandling','raw_not_averaged')
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_rates(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_rates(jsonb) to authenticated;

create or replace function public.dashboard_admin_live_rates(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_admin_live_rates(p_request);
$$;
revoke all on function public.dashboard_admin_live_rates(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_rates(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
