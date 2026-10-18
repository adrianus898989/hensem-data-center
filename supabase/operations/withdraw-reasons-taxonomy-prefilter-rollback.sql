-- Necessary-substring prefilter only; original taxonomy block and all later classifiers are unchanged.
begin;set local lock_timeout='3s';set local statement_timeout='15s';
do $patch$declare p pg_proc%rowtype;definition text;patched text;before_meta jsonb;begin
 if current_user<>'postgres'then raise exception 'OWNER_REQUIRED';end if;
 select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_blocking_details_cleaned(text)');
 if p.oid is null or md5(p.prosrc)<>'3126b453070a6d7e0b3ddca6e0eb9a24' or md5(pg_get_functiondef(p.oid))<>'6c2d173b5dfa6da54e1a8642b3dcbbfb'
  or p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.prosecdef or p.proisstrict or p.proleakproof
  or p.provolatile<>'i' or p.proparallel<>'s' or p.prokind<>'f' or p.proretset
  or p.prolang<>(select oid from pg_language where lanname='plpgsql')then raise exception 'REASON_TAX_PREFILTER_BASELINE_DRIFT';end if;
 before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);patched:=definition;
 if (length(patched)-length(replace(patched,$old$ -- Necessary-only prefilter: no taxonomy match can be created by removing a
 -- terminal provider/status field or a failure-label prefix. The English guard
 -- uses the original case-insensitive regex semantics, including locale rules.
 if position('充提差额不满足自动提现要求' in note)>0
  or position('用户等级不在自动提现等级范围内' in note)>0
  or position('用户未完成首充会员' in note)>0
  or position('用户不满足第一次提现流水要求' in note)>0
  or position('领取助力' in note)>0
  or position('余额不足' in note)>0
  or note ~* '(available|amount|insufficient)' then
 tax_note:=translate(note,'：，；',':,;');$old$,'')))/length($old$ -- Necessary-only prefilter: no taxonomy match can be created by removing a
 -- terminal provider/status field or a failure-label prefix. The English guard
 -- uses the original case-insensitive regex semantics, including locale rules.
 if position('充提差额不满足自动提现要求' in note)>0
  or position('用户等级不在自动提现等级范围内' in note)>0
  or position('用户未完成首充会员' in note)>0
  or position('用户不满足第一次提现流水要求' in note)>0
  or position('领取助力' in note)>0
  or position('余额不足' in note)>0
  or note ~* '(available|amount|insufficient)' then
 tax_note:=translate(note,'：，；',':,;');$old$)<>1 then raise exception 'REASON_TAX_PREFILTER_ANCHOR_DRIFT';end if;
 patched:=replace(patched,$old$ -- Necessary-only prefilter: no taxonomy match can be created by removing a
 -- terminal provider/status field or a failure-label prefix. The English guard
 -- uses the original case-insensitive regex semantics, including locale rules.
 if position('充提差额不满足自动提现要求' in note)>0
  or position('用户等级不在自动提现等级范围内' in note)>0
  or position('用户未完成首充会员' in note)>0
  or position('用户不满足第一次提现流水要求' in note)>0
  or position('领取助力' in note)>0
  or position('余额不足' in note)>0
  or note ~* '(available|amount|insufficient)' then
 tax_note:=translate(note,'：，；',':,;');$old$,$new$ tax_note:=translate(note,'：，；',':,;');$new$);
 if (length(patched)-length(replace(patched,$old$ if tax_hit then
  return jsonb_build_object('reason',array_to_string(tax_labels,'；'),'actualValue',actual,'actualField',field,'threshold',threshold);
 end if;
 end if; -- necessary-only taxonomy prefilter$old$,'')))/length($old$ if tax_hit then
  return jsonb_build_object('reason',array_to_string(tax_labels,'；'),'actualValue',actual,'actualField',field,'threshold',threshold);
 end if;
 end if; -- necessary-only taxonomy prefilter$old$)<>1 then raise exception 'REASON_TAX_PREFILTER_ANCHOR_DRIFT';end if;
 patched:=replace(patched,$old$ if tax_hit then
  return jsonb_build_object('reason',array_to_string(tax_labels,'；'),'actualValue',actual,'actualField',field,'threshold',threshold);
 end if;
 end if; -- necessary-only taxonomy prefilter$old$,$new$ if tax_hit then
  return jsonb_build_object('reason',array_to_string(tax_labels,'；'),'actualValue',actual,'actualField',field,'threshold',threshold);
 end if;$new$);
 if md5(patched)<>'9b368a8dee1bee462c24b8bd9b97b760'then raise exception 'REASON_TAX_PREFILTER_CONSTRUCTION_DRIFT';end if;execute patched;
 select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_blocking_details_cleaned(text)');
 if md5(p.prosrc)<>'17122a5ed74374c036bd19b073088031' or md5(pg_get_functiondef(p.oid))<>'9b368a8dee1bee462c24b8bd9b97b760'or(to_jsonb(p)-'prosrc')is distinct from before_meta then raise exception 'REASON_TAX_PREFILTER_POST_MISMATCH';end if;
end;$patch$;
commit;
