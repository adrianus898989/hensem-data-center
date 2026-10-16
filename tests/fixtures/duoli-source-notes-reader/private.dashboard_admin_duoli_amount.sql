CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_amount(p_business text, p_currency text, p_field text, p_raw text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 if p_currency is distinct from 'IDR' or p_raw is null or length(p_raw)>128
  or p_raw !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then return null;end if;
 if p_business='recharge' and p_field='original_price' then return p_raw::numeric/1000;end if;
 if p_business='withdraw' and p_field='gold' then return p_raw::numeric;end if;
 return null;
exception when numeric_value_out_of_range or invalid_text_representation then return null;
end;
$function$

