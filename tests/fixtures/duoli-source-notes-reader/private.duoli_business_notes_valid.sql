CREATE OR REPLACE FUNCTION private.duoli_business_notes_valid(p_notes jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_field jsonb; v_state text;
begin
  if p_notes is null or pg_catalog.octet_length(p_notes::text)>8192
    or not private.duoli_detail_keys(p_notes,array['version','fields'])
    or p_notes->'version' is distinct from '1'::jsonb
    or not private.duoli_detail_keys(p_notes->'fields',array['condition','remark']) then return false; end if;
  for v_field in select e.value from pg_catalog.jsonb_each(p_notes->'fields') e loop
    if not private.duoli_detail_keys(v_field,array['state','text','redacted','truncated'])
      or pg_catalog.jsonb_typeof(v_field->'state') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_field->'redacted') is distinct from 'boolean'
      or pg_catalog.jsonb_typeof(v_field->'truncated') is distinct from 'boolean' then return false; end if;
    v_state:=v_field->>'state';
    if v_state not in ('missing','empty','invalid','present','withheld') then return false; end if;
    if v_state='present' then
      if pg_catalog.jsonb_typeof(v_field->'text') is distinct from 'string'
        or pg_catalog.length(v_field->>'text') not between 1 and 512
        or pg_catalog.length(pg_catalog.btrim(v_field->>'text'))=0
        or (v_field->>'text') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then return false; end if;
    elsif v_field->'text' is distinct from 'null'::jsonb or v_field->'truncated' is distinct from 'false'::jsonb then
      return false;
    end if;
    if v_state='withheld' then
      if v_field->'redacted' is distinct from 'true'::jsonb then return false; end if;
    elsif v_state<>'present' and v_field->'redacted' is distinct from 'false'::jsonb then return false; end if;
  end loop;
  return true;
end
$function$

