create view public.wg_detail_coverage as  WITH ranges AS (
         SELECT wg_detail_progress.site_code,
            wg_detail_progress.business,
            wg_detail_progress.basis,
            wg_detail_progress.floor AS started,
            wg_detail_progress.cursor AS finished
           FROM private.wg_detail_progress
          WHERE wg_detail_progress.cursor IS NOT NULL
        UNION ALL
         SELECT wg_detail_history.site_code,
            wg_detail_history.business,
            wg_detail_history.basis,
            wg_detail_history.range_start,
            wg_detail_history.cursor
           FROM private.wg_detail_history
          WHERE wg_detail_history.cursor IS NOT NULL
        ), previous AS (
         SELECT ranges.site_code,
            ranges.business,
            ranges.basis,
            ranges.started,
            ranges.finished,
            max(ranges.finished) OVER (PARTITION BY ranges.site_code, ranges.business, ranges.basis ORDER BY ranges.started, ranges.finished ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_finish
           FROM ranges
        ), numbered AS (
         SELECT previous.site_code,
            previous.business,
            previous.basis,
            previous.started,
            previous.finished,
            previous.previous_finish,
            sum(
                CASE
                    WHEN previous.previous_finish IS NULL OR previous.started > (previous.previous_finish + 1) THEN 1
                    ELSE 0
                END) OVER (PARTITION BY previous.site_code, previous.business, previous.basis ORDER BY previous.started, previous.finished) AS block
           FROM previous
        ), merged AS (
         SELECT numbered.site_code,
            numbered.business,
            numbered.basis,
            min(numbered.started) AS started,
            max(numbered.finished) AS finished,
                CASE
                    WHEN numbered.site_code = ANY (ARRAY['278'::text, '8311'::text, '12588'::text]) THEN 'America/Sao_Paulo'::text
                    ELSE 'Asia/Ho_Chi_Minh'::text
                END AS tz
           FROM numbered
          GROUP BY numbered.site_code, numbered.business, numbered.basis, numbered.block
        ), days AS (
         SELECT m.site_code,
            m.business,
            m.basis,
            m.started,
            m.finished,
            m.tz,
            d.d::date AS business_date
           FROM merged m
             CROSS JOIN LATERAL generate_series((to_timestamp(m.started::double precision) AT TIME ZONE m.tz)::date::timestamp without time zone, (to_timestamp(m.finished::double precision) AT TIME ZONE m.tz)::date::timestamp without time zone, '1 day'::interval) d(d)
        )
 SELECT site_code,
    business,
    basis,
    business_date,
    bool_or(started <= EXTRACT(epoch FROM (business_date::timestamp without time zone AT TIME ZONE tz))::bigint AND finished >= (EXTRACT(epoch FROM ((business_date + 1)::timestamp without time zone AT TIME ZONE tz))::bigint - 1)) AS complete
   FROM days
  GROUP BY site_code, business, basis, business_date;;
