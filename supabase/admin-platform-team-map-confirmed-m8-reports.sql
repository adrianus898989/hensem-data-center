-- Owner confirmed these eight existing report platforms belong to M8.
-- Team assignment only: keep the source country/platform and REPORT provenance.
-- This does not register native order sources or change any authorization rule.
begin;

insert into public.dashboard_platform_team_map
 (team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform,metadata)
select 'M8','源日报','REPORT',country_name,country_code,source_country,platform_name,platform_name,
 jsonb_build_object('assignment_confirmation','owner_explicit_2026-09-26','assignment_scope','team_only','source_basis','existing_google_sheet_reports')
from (values
 ('墨西哥','MX','南美','NPG-MEXICO'),
 ('智利','CL','南美','NPG-CHILE'),
 ('哥伦比亚','CO','南美','NPG-COLOMBIA'),
 ('印尼','ID','印尼','HOT985'),
 ('印尼','ID','印尼','IND666'),
 ('印尼','ID','印尼','UANG'),
 ('巴西','BR','巴西','SSSGAME'),
 ('巴西','BR','巴西','TGJOGO')
) v(country_name,country_code,source_country,platform_name)
on conflict (source_system,source_country,source_platform) do nothing;

-- Idempotent reruns retain row IDs and metadata. Abort if a concurrent change
-- has already assigned one of these exact source keys differently.
do $$
begin
 if (select count(*) from public.dashboard_platform_team_map m join (values
  ('墨西哥','MX','南美','NPG-MEXICO'),
  ('智利','CL','南美','NPG-CHILE'),
  ('哥伦比亚','CO','南美','NPG-COLOMBIA'),
  ('印尼','ID','印尼','HOT985'),
  ('印尼','ID','印尼','IND666'),
  ('印尼','ID','印尼','UANG'),
  ('巴西','BR','巴西','SSSGAME'),
  ('巴西','BR','巴西','TGJOGO')
 ) v(country_name,country_code,source_country,platform_name)
 on m.source_system='REPORT' and m.source_country=v.source_country and m.source_platform=v.platform_name
 where m.team_name='M8' and m.active and m.country_name=v.country_name and m.country_code=v.country_code
  and m.platform_name=v.platform_name and m.system_name='源日报')<>8 then
  raise exception 'confirmed M8 report assignments conflict with existing metadata';
 end if;
end;
$$;

commit;
