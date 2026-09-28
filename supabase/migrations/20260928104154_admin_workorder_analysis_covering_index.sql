-- Keep default collected-ticket summary and original-order grouping on a narrow AR-only index.
-- NULL submitted_date values remain indexed, so the existing submitted_at fallback remains intact.
-- Normal transactional CREATE INDEX: short lock wait; no claims of concurrent deployment.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create index if not exists ar_workorder_analysis_submission_cover_v1_idx
 on public.ar_workorder_issue_details(country_code,platform,submitted_date,submitted_at,work_order_id)
 include(payment_order_no,issue_kind,status_code,amount,operated_at)
 where system_name='AR';
commit;
