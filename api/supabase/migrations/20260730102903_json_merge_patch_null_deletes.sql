set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.merge_update_jsonb(target jsonb, path text[], object jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  key text;
  value jsonb;
begin
  if target is null then
    target := '{}'::jsonb;
  end if;

  case jsonb_typeof(object) -- object, array, string, number, boolean, and null
    when 'object' then
      if jsonb_typeof(target #> path) <> 'object' or target #> path is null then
          if cardinality(path) = 0 then
            target := '{}'::jsonb;
          else
            target := jsonb_set(target, path, '{}', true);
          end if;
      end if;

      for key, value in select * from jsonb_each(object) loop
          target := public.merge_update_jsonb(target, array_append(path, key), value);
      end loop;
    when 'null' then
      -- The RFC's removal sentinel. Guarded rather than left to `#-`, which
      -- happens to return the target unchanged for an empty path: a
      -- root-level null falls under the deviation above and is ignored, and
      -- that should be stated, not inherited from an operator's edge case.
      if cardinality(path) > 0 then
        target := target #- path;
      end if;
    else
      -- Scalars and arrays replace. At the root this is where the deviation
      -- takes effect: jsonb_set with a zero-length path returns the target
      -- untouched, so the patch is dropped. A SQL NULL patch lands here too
      -- and propagates, jsonb_set being strict.
      target := jsonb_set(target, path, object, true);
  end case;

  return target;
end;
$function$
;


