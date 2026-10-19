drop function if exists "billing"."change_plan"(_organization_id uuid, _plan_id text);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION billing.initialize_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _tier_id text;
  _plan billing.plans%rowtype;
  _pp record;
begin
  select t.id into _tier_id
  from billing.tiers t
  where t.active = true
  order by t.level asc
  limit 1;

  if not found then
    return new;
  end if;

  -- Create subscription with tier only
  insert into billing.subscriptions (organization_id, tier_id)
  values (new.id, _tier_id);

  -- Assign default plan if one exists
  select * into _plan
  from billing.plans p
  where p.is_default = true
    and p.active = true
  limit 1;

  if not found then
    return new;
  end if;

  -- Find the matching tier for this plan's min_tier level
  select t.id into _tier_id
  from billing.tiers t
  where t.level >= _plan.min_tier
    and t.active = true
  order by t.level asc
  limit 1;

  if _tier_id is null then
    raise exception 'No active tier found for plan %', _plan.id;
  end if;

  update billing.subscriptions
  set tier_id = _tier_id,
      plan_id = _plan.id,
      current_period_start = now()
  where organization_id = new.id;

  -- Grant balance products included in the plan
  for _pp in
    select pp.product_id, pp.included
    from billing.plans_products pp
    join billing.products p on p.id = pp.product_id
    where pp.plan_id = _plan.id
      and p.kind = 'balance'
      and pp.included is not null
      and pp.included > 0
  loop
    insert into billing.ledger (organization_id, product_id, type, quantity)
    values (new.id, _pp.product_id, 'grant', _pp.included);
  end loop;

  return new;
end;
$function$
;


