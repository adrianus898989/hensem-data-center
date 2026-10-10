CREATE INDEX CONCURRENTLY newar_detail_business_cover_idx
ON public.newar_detail_records (platform, dataset, created_at)
INCLUDE (status_group, amount, currency, provider, channel_type, captured_at, received_at);
