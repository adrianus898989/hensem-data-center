-- Supports raw third-party -> canonical third-party lookups used by the
-- private admin work-order read model. This is additive and does not change
-- any existing dashboard query or collector.
begin;

create index if not exists third_party_volume_raw_mapping_idx
  on public.third_party_volume(country, platform, raw_channel, direction, data_date, updated_at desc, id desc);

commit;
