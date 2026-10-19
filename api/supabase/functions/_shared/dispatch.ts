import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types/database_types.ts";
import type { Json } from "./db_types.ts";
import * as log from "./logger.ts";

/**
 * Persists the result of dispatching an outgoing message: stamps the
 * service-assigned `external_id`, merges in the given status, and retracts the
 * arm bit — the service has the message now, so the row is no longer something
 * to send. `pending` is a merge-patch null (RFC 7396), which REMOVES the key.
 *
 * Retracting is the writer's job, not a trigger's: only the caller knows the
 * send actually happened. The retry sweep already skips rows carrying
 * `accepted`, so this changes no dispatch behaviour — it stops outgoing rows
 * from reading as simultaneously queued and sent to everyone downstream (the
 * UI, `notify_webhook`, anything asking whether a message is still in flight).
 *
 * Only the success path. A transient failure keeps the arm bit deliberately —
 * that is what the sweep re-fires on.
 *
 * Handles the race where a webhook for the same `external_id` lands before this
 * update and inserts its own row — e.g. a `sent`/`read` status (or an echo)
 * arriving before the dispatcher finished writing. The unique constraint on
 * `external_id` then rejects our update (Postgres 23505). Rather than dropping
 * our row (which holds the authoritative content + agent metadata, and the id
 * the UI/agent already rendered) or losing the webhook row's status, we MERGE:
 * fold the duplicate's status into ours, delete the now-redundant duplicate, and
 * retry the update on our row. Our row survives carrying both halves.
 *
 * `externalId` is optional: some sends (e.g. Instagram reactions) yield no id to
 * track, in which case there is no unique-violation risk and we just merge the
 * status onto our row.
 */
export async function commitDispatchedMessage({
  client,
  messageId,
  externalId,
  status,
}: {
  client: SupabaseClient<Database>;
  messageId: string;
  externalId?: string;
  status: Record<string, Json>;
}): Promise<void> {
  // Caller-stated keys win, so a dispatcher that has a reason to keep the row
  // armed can say so.
  const patch: Record<string, Json> = { pending: null, ...status };

  const { error } = await client
    .from("messages")
    .update({
      ...(externalId && { external_id: externalId }),
      status: patch,
    })
    .eq("id", messageId);

  if (!error) return;

  // Only the external_id unique violation is recoverable here.
  if (error.code !== "23505" || !externalId) throw error;

  log.warn(
    "A webhook row already owns this external_id; merging the duplicate",
    { message_id: messageId, external_id: externalId },
  );

  // Capture the duplicate's status so we don't lose it, then remove it.
  const { data: duplicate } = await client
    .from("messages")
    .select("status")
    .eq("external_id", externalId)
    .maybeSingle()
    .throwOnError();

  const duplicateStatus =
    duplicate?.status && typeof duplicate.status === "object" &&
      !Array.isArray(duplicate.status)
      ? duplicate.status as Record<string, Json>
      : {};

  // NOTE: the messages realtime/notify trigger fires on insert/update, not
  // delete, so this removal is not pushed to clients. A UI that already rendered
  // the duplicate row (from the webhook insert) may keep showing it until a
  // refresh. Rare race, pre-existing limitation. To close it, either add a
  // notify-on-delete trigger or have the UI dedup rendered messages by
  // external_id.
  await client
    .from("messages")
    .delete()
    .eq("external_id", externalId)
    .throwOnError();

  // Retry on our row, folding the duplicate's status into ours. The status
  // merge trigger then combines this with our row's existing status.
  await client
    .from("messages")
    .update({
      external_id: externalId,
      status: { ...duplicateStatus, ...patch },
    })
    .eq("id", messageId)
    .throwOnError();
}
