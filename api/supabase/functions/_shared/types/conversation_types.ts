/**
 * The shape of a channel, in one vocabulary every service maps onto — the
 * `type` column on conversations.
 *
 *   direct     member-defined  WhatsApp/Instagram DM, Slack im AND mpim
 *   group      private N       WhatsApp group, Slack/Teams private channel
 *   channel    public N        Slack public channel, a local one
 *   broadcast  one-to-many     WhatsApp broadcast list
 *
 * The cut is identity, not arity. A `direct` IS its member set at any size —
 * a Slack mpim is a multi-party direct — so it cannot be joined or left;
 * arity, where the address cannot show it (mirror services), rides as
 * `extra.is_multiple`. `group` and `channel` are named containers with a
 * membership that changes, and differ only in who may see them. `broadcast`
 * is nobody's room at all — it fans out to individual chats on the receiving
 * side.
 *
 * Slack's four kinds map on exactly, so nothing is lost by not storing Slack's
 * own vocabulary: private_channel is `group`, the same shape as a WhatsApp
 * group, and public_channel is the only `channel`.
 */
export type ConversationType =
  | "direct"
  | "group"
  | "channel"
  | "broadcast";
