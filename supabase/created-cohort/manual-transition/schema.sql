-- A finite deployment manifest, never a new cache or compute pipeline.
-- Installer captures exact old heads before changing semantic functions, then
-- binds each row to the actual post-install dependency in the same transaction.
create table private.created_cohort_manual_transition (
 artifact_id uuid primary key references private.prepared_aggregate_artifacts(id) on delete cascade,
 -- Artifact already belongs to its job through a validated cascading FK.
 -- This copied job id is revalidated against that immutable artifact on every read.
 job_id uuid not null,
 target jsonb not null, request jsonb not null, request_key jsonb not null,
 old_dependency text not null,new_dependency text not null,
 revision bigint not null,fence bigint not null,payload_hash text not null,
 installed_at timestamptz not null,valid_until timestamptz not null,
 check(old_dependency<>new_dependency),
 check(valid_until>installed_at and valid_until<=installed_at+interval'72 hours')
);
alter table private.created_cohort_manual_transition enable row level security;
revoke all on private.created_cohort_manual_transition from public,anon,authenticated,service_role;
