drop trigger if exists "check_billing_message_limit" on "public"."messages";

CREATE TRIGGER check_billing_message_limit BEFORE INSERT ON public.messages FOR EACH ROW WHEN (((new.sender_address IS NULL) AND ((new.status ->> 'pending'::text) IS NOT NULL) AND ((new.content ->> 'internal'::text) IS NULL))) EXECUTE FUNCTION billing.check_product_limit();

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION billing.check_limit(_organization_id uuid, _product_id text, _amount numeric DEFAULT 1)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _tier_id text;
  _kind text;
  _cap numeric;
  _interval text;
  _current numeric;
  _period date;
begin
  -- Get tier from subscription
  select s.tier_id into _tier_id
  from billing.subscriptions s
  where s.organization_id = _organization_id;

  -- No subscription = no billing = allow
  if not found then
    return true;
  end if;

  -- Get product kind
  select p.kind into _kind
  from billing.products p
  where p.id = _product_id;

  -- No product = no billing for this resource
  if not found then
    return true;
  end if;

  -- Get tier cap and interval
  select tp.cap, tp.interval
  into _cap, _interval
  from billing.tiers_products tp
  where tp.tier_id = _tier_id
    and tp.product_id = _product_id;

  -- No tier_product row = no limit for this product
  if not found then
    return true;
  end if;

  -- Cap is null = unlimited
  if _cap is null then
    return true;
  end if;

  -- Determine the period to check
  _period := case _interval
    when 'month' then date_trunc('month', current_date)::date
    when 'day' then current_date
    else '1970-01-01'::date
  end;

  -- Get current value
  select u.quantity into _current
  from billing.usage u
  where u.organization_id = _organization_id
    and u.product_id = _product_id
    and u.interval = _interval
    and u.period = _period;

  _current := coalesce(_current, 0);

  -- Balance products: cap is a floor (minimum allowed balance)
  -- e.g. cap=0 means no debt, cap=-5 allows up to $5 debt
  -- SQLSTATE PT402: PostgREST maps PTnnn to HTTP status nnn, so every
  -- PostgREST-fronted surface (UI, API keys, RPC callers) answers 402
  -- Payment Required instead of a generic 400.
  if _kind = 'balance' then
    if _current - _amount < _cap then
      raise exception 'Insufficient balance for %', _product_id
        using errcode = 'PT402';
    end if;
  else
    -- Counter/gauge: cap is a ceiling
    if _current + _amount > _cap then
      raise exception 'Usage limit reached for %', _product_id
        using errcode = 'PT402';
    end if;
  end if;

  return true;
end;
$function$
;

