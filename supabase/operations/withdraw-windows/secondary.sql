-- Only captured, authorized native targets. A secondary window NEVER filters
-- created cohorts, and created bounds NEVER filter the successful-time branch.
CREATE FUNCTION private.withdraw_window_targets(q jsonb,s jsonb,c jsonb)
RETURNS TABLE(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''AS $$
 SELECT p.*FROM private.withdraw_prepared_platforms(c)p
 WHERE private.dashboard_scope_allows(s,p.scope_group,p.source_name)
 AND(CASE WHEN q?'scopeTargets'THEN EXISTS(SELECT 1 FROM jsonb_array_elements(q->'scopeTargets')t WHERE t->>'country'=p.country AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(t->'platforms')x WHERE private.dashboard_admin_live_withdraw_key(x)IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name))))ELSE q->>'country'=p.country END)
 AND(nullif(q->>'platform','')IS NULL OR private.dashboard_admin_live_withdraw_key(q->>'platform')IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name)))
 AND(NOT q?'platforms'OR jsonb_array_length(q->'platforms')=0 OR nullif(q->>'platform','')IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(q->'platforms')x WHERE private.dashboard_admin_live_withdraw_key(x)IN(private.dashboard_admin_live_withdraw_key(p.name),private.dashboard_admin_live_withdraw_key(p.source_name))));
$$;
CREATE FUNCTION private.withdraw_window_success_rows(t jsonb,b text,a timestamptz,z timestamptz)
RETURNS TABLE(account text,amount numeric,operator_available boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''AS $function$
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF coalesce((private.withdraw_window_capability(t->>'source',b)->>'available')::boolean,false)IS NOT TRUE THEN RETURN;END IF;
 IF t->>'source'='newar'THEN
  -- Join the verified source projection for operator/method only; its creation
  -- timestamp is not a filter on these independently timed successful orders.
  RETURN QUERY EXECUTE 'SELECT CASE WHEN f.method IS DISTINCT FROM ''auto''THEN coalesce(nullif(btrim(f.account),''''),''（未知操作人）'')END,CASE WHEN n.currency=$4 THEN n.amount END,f.method IS DISTINCT FROM ''auto'' FROM public.newar_detail_records n LEFT JOIN private.newar_withdraw_facts f ON f.record_id=n.id AND f.platform=n.platform AND f.source_id=n.source_id JOIN public.newar_detail_platforms p ON p.platform=n.platform AND p.enabled WHERE n.platform=$1 AND n.dataset=''withdraw''AND n.status_group=''success'' AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'>=$2 AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'<$3 AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'>=n.created_at AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'<=n.captured_at AND '||CASE b WHEN'success'THEN'n.success_at'ELSE'n.source_updated_at'END||'<=statement_timestamp() AND(p.launch_at IS NULL OR n.created_at>=p.launch_at)' USING t->>'source_name',a,z,t->>'currency';
 ELSIF t->>'source'='kb'AND t->>'scope_group'='IN'AND t->>'source_name'='YASH.BET'AND b='success'THEN
  RETURN QUERY SELECT coalesce(nullif(btrim(y.operator),''),'（未知操作人）'),CASE WHEN y.currency=t->>'currency'THEN y.amount END,true FROM private.yash_orders y WHERE y.source_site='yash'AND y.order_type='withdrawal'AND private.dashboard_admin_yash_status(y.order_type,y.status)='success'AND y.completed_at>=a AND y.completed_at<z AND y.completed_at>=y.created_at AND y.completed_at<=y.observed_at AND y.completed_at<=statement_timestamp();
 ELSIF t->>'source'='duoli'AND t->>'scope_group'='ID'AND t->>'timezone'='Asia/Jakarta'AND b='source_updated'THEN
  RETURN QUERY SELECT coalesce(nullif(btrim(d.operator),''),'（未知操作人）'),private.dashboard_admin_duoli_amount(d.business,d.currency,d.amount_source,d.amount_raw),true FROM private.duoli_order_details d WHERE d.platform=t->>'source_name'AND d.business='withdraw'AND d.country='ID'AND d.system_name='DOLI'AND private.dashboard_admin_duoli_status('withdraw',d.status_code)='success'AND d.updated_at>=a AND d.updated_at<z AND d.updated_at>=d.created_at AND d.updated_at<=d.observed_at AND d.updated_at<=statement_timestamp();
 ELSIF t->>'source'='game66'AND b='source_updated'THEN
  RETURN QUERY SELECT CASE WHEN w.auto_commit='2'THEN'自动审核'ELSE coalesce(nullif(btrim(w.audit_admin),''),nullif(btrim(w.lock_admin),''),nullif(btrim(w.lock_user_admin),''),'人工审核（未标记账号）')END,coalesce(w.amount_display,w.amount_minor/100.0),true FROM public.game66_withdraw_orders w WHERE w.platform_id=(t->>'id')::uuid AND w.status_code='3'AND w.update_time>=a AND w.update_time<z AND w.update_time>=w.create_time AND w.update_time<=w.last_seen_at AND w.update_time<=statement_timestamp();
 ELSIF t->>'source'='lg'AND b='success'THEN
  RETURN QUERY SELECT null::text,l.metric_amount,false FROM public.lg_orders l WHERE l.country_code=t->>'scope_group'AND l.platform=t->>'source_name'AND l.source_system='LG'AND l.order_kind='withdraw'AND l.status_class='success'AND l.paid_at>=a AND l.paid_at<z AND l.paid_at>=l.created_at AND l.paid_at<=statement_timestamp();
 END IF;
END;$function$;
CREATE FUNCTION private.withdraw_window_secondary(q jsonb,s jsonb,c jsonb)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''AS $$
DECLARE t record;cap jsonb;rows jsonb:='[]';ops jsonb;v jsonb;a timestamptz;b timestamptz;n bigint;v_amount numeric;account_filter text:=nullif(btrim(q->>'account'),'');
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 PERFORM private.withdraw_window_validate(q);
 FOR t IN SELECT *FROM private.withdraw_window_targets(q,s,c)ORDER BY country,name,id LOOP
  cap:=private.withdraw_window_capability(t.source,q->>'successBasis');n:=null;v_amount:=null;ops:='[]';
  IF (cap->>'available')::boolean THEN
   a:=left(q->>'successStartAt',19)::timestamp AT TIME ZONE t.timezone;b:=(left(q->>'successEndAt',19)::timestamp+interval'1second')AT TIME ZONE t.timezone;
   WITH facts AS MATERIALIZED(SELECT f.account,CASE WHEN f.amount::text NOT IN('NaN','Infinity','-Infinity')THEN f.amount END amount,f.operator_available FROM private.withdraw_window_success_rows(to_jsonb(t),q->>'successBasis',a,b)f),groups AS(
    SELECT account,count(*)count,CASE WHEN count(amount)=count(*)THEN sum(amount)END amount FROM facts WHERE operator_available AND(account_filter IS NULL OR position(lower(account_filter)IN lower(account))>0)GROUP BY account)
   SELECT (SELECT count(*)FROM facts),(SELECT CASE WHEN count(amount)=count(*)THEN sum(amount)END FROM facts),coalesce(jsonb_agg(jsonb_build_object('account',account,'count',count,'amount',amount)ORDER BY account),'[]')INTO n,v_amount,ops FROM groups;
  END IF;
  v:=jsonb_build_object('platform',t.name,'country',t.country,'source',t.source,'timezone',t.timezone,'currency',t.currency,'capability',cap,'count',CASE WHEN n>0 THEN n END,'amount',v_amount,'observedCount',n,'complete',false,'coverageVerified',false,'state',CASE WHEN NOT(cap->>'available')::boolean THEN'timestamp_unavailable'WHEN n=0 THEN'no_matching_observed_records'ELSE'observed_records'END,'operatorAttributionAvailable',t.source<>'lg','operatorRows',ops);
  rows:=rows||jsonb_build_array(v);
 END LOOP;
 RETURN jsonb_build_object('basis',q->>'successBasis','startAt',q->>'successStartAt','endAt',q->>'successEndAt','createdIntersection',false,'complete',false,'rows',rows);
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_window_targets(jsonb,jsonb,jsonb),private.withdraw_window_success_rows(jsonb,text,timestamptz,timestamptz),private.withdraw_window_secondary(jsonb,jsonb,jsonb)FROM public,anon,authenticated,service_role;
