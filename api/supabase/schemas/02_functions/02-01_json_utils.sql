-- JSON merge-patch, RFC 7396 (the same algorithm as SQLite's json_patch), with
-- one deliberate deviation: a non-object patch at the ROOT is ignored instead
-- of replacing the document. The RFC would let `extra = '"x"'` or `extra =
-- 'null'` blow the whole column away; these columns are always objects, and a
-- caller who writes a scalar into one has made a mistake, not a request.
--
-- | Patch value            | Behavior                               | Merges? |
-- |------------------------|----------------------------------------|---------|
-- | null                   | REMOVES the key (root null: ignored)   | n/a     |
-- | {} (empty object)      | Recursively merges (no-op if empty)    | YES     |
-- | Non-empty object       | Recursively merges nested keys         | YES     |
-- | Array                  | Replaces value at path                 | NO      |
-- | String/Number/Boolean  | Replaces value at path                 | NO      |
--
-- Arrays are opaque, exactly as in the RFC: {"tags":["a","b"]} patched with
-- {"tags":["c"]} yields {"tags":["c"]}. Element-wise array merge is not
-- expressible in merge-patch at all — there is no way to say "leave element 1
-- alone" — which is the same reason null has to mean removal.
create function public.merge_update_jsonb(target jsonb, path text[], object jsonb) returns jsonb
language plpgsql
immutable
set search_path to ''
as $$
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
$$;

create function public.merge_update() returns trigger
language plpgsql
as $$
declare
  column_name text := tg_argv[0]::text;
  old_jsonb jsonb;
  new_jsonb jsonb;
  merged_value jsonb;
begin
  -- Get the column name from trigger argument
  if column_name is null or column_name = 'null' then
    raise exception 'column_name argument is missing';
  end if;

  -- Convert records to jsonb
  old_jsonb := to_jsonb(OLD);
  new_jsonb := to_jsonb(NEW);

  -- Get the column values and perform the merge
  merged_value := public.merge_update_jsonb(
    old_jsonb -> column_name,
    '{}'::text[],
    new_jsonb -> column_name
  );

  -- Update NEW with the merged value
  new_jsonb := jsonb_set(new_jsonb, array[column_name], merged_value);

  -- Convert back to record
  NEW := jsonb_populate_record(NEW, new_jsonb);

  return NEW;
end;
$$;
