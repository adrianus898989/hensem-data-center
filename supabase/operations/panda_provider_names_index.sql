CREATE INDEX CONCURRENTLY panda_orders_provider_names_idx ON public.panda_order_details USING btree (platform, direction, provider_name);
