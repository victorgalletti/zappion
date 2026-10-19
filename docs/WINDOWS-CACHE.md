# Windows client: caching plan

Status (2026-10-16): **steps 1-7 implemented** by Codex (steps 1-4 and 5-6 ran in parallel and were
merged by hand; step 7 after them). Checked with 251 tests and an isolated seed-account
run: reopening a chat took 18-64 ms from the cache instead of a full 500-message load. Not checked yet:
template stale-while-revalidate against real Meta data (the local endpoint fails on seed data with
"Invalid JSON for postcard"), and kept pages with a real media library. Context: [`WINDOWS.md`](WINDOWS.md).

## The complaint

Opening a conversation always looks like a fresh load, and pages (templates, media, settings) seem to
forget their data after about a minute. WhatsApp Desktop shows a chat instantly and only fetches what is
new. The Windows client should feel the same.

## What the code does today

| Area | Where | Behaviour |
| --- | --- | --- |
| Open a chat | `MainWindow.SelectConversationAsync` / `LoadChatAsync` (`MainWindow.xaml.cs`) | Clears `messages` and `timeline.Items`, then always runs two queries: the last **500 messages** of the conversation (`GetMessagesAsync`) and the last incoming message (`GetLastIncomingAsync`). There is **no per-conversation message cache**: going A → B → A refetches A in full and rebuilds every bubble. |
| Realtime | `ZappionClient.StartRealtimeAsync` → `MainWindow.ApplyRealtimeAsync` | New messages are applied only to the open chat and to `recentMessages`. Messages of chats that are not open are not kept anywhere, which is why reopening them needs the network. |
| Any `conversations` row change | `ConversationsChanged` → `RecoverAsync` → `RefreshAsync` | A **full refresh**: 500 conversations + 1000 recent messages + all contacts + preferences (`LoadConversationsAsync`), and then reloads the open chat (500 messages again). `SetBusy(true)` shows the progress bar, so the user sees a "loading" each time. |
| Realtime reconnect / resume | 5 s `reconnectTimer` in the `MainWindow` constructor | After a gap > 20 s (sleep, lock, debugger) or 30 s disconnected it tears the channel down; `ConnectionChanged(true)` then triggers the same full refresh. Correct for consistency, but heavy and visible. |
| Templates | `ZappionClient.GetTemplatesAsync` / `GetAllTemplatesAsync` | In-memory cache keyed by org + number with a **1-minute TTL** (copied from the web's `staleTime: 60_000`). After a minute, opening any chat (`LoadTemplatesAsync`) or the Templates page goes back to the edge function, which calls Meta: the slowest request in the app. This matches the "one minute" feeling. |
| Pages | `OnWebSettings` / `OnWebTemplates` / `OnWebMedia` + `CloseProfile` (`MainWindow.Preferences.cs`) | Each panel is **created on open and destroyed on close**. Every visit reloads everything (members, invitations, media pages and people, templates), and scroll position and filters are lost. |
| Media files | `MediaCache` (`Zappion.Windows.Core`) | Good already: files on disk under `%LOCALAPPDATA%\Zappion\cache\media` (500 MB LRU), signed URLs in memory for 50 min. Only the decode is repeated, because bubbles are rebuilt on every chat open. |
| Conversation list | `ZappionClient.conversationRows` etc. | Kept in memory while the app runs, but nothing survives a restart: cold start always waits for the four queries before showing the list. |

The web has the same shapes, but React Query keeps every query in memory (`gcTime` default 5 min) and
shows the cached data while it refetches in the background, so it feels instant. The Windows port
copied the queries and the TTL, but not the "show cached, refresh quietly" part.

## Target behaviour

1. **Opening a chat already seen shows its messages immediately**, with no spinner, then fetches only
   what is newer than the newest cached message (`timestamp > last`) and merges it. Realtime keeps every
   cached chat up to date, not only the open one.
2. **Realtime is the source of freshness.** A `conversations` change updates that one row (the payload
   has it) instead of refetching the whole inbox; full refreshes only on reconnect, and then
   **silently** (no progress bar when there is data on screen).
3. **Templates are stale-while-revalidate:** always return the cached list at once; refresh in the
   background when older than a few minutes; the Templates page "Refresh" button forces it. Creating or
   deleting a template invalidates, as today.
4. **Pages are kept alive** while the app runs: hide them instead of destroying them, refresh their data
   in the background when shown again. Media library keeps its loaded pages, filters and scroll.
5. **Optional, later:** persist the inbox and recent chats to disk (SQLite or JSON in
   `%LOCALAPPDATA%\Zappion\cache`) so a cold start draws the last known state before the network
   answers. Must be cleared on sign-out and keyed by user + organization.

## Design notes

- **Message cache** in `Zappion.Windows.Core` (testable, no UI): `Dictionary<conversationId, List<MessageRow>>`
  with an LRU cap (e.g. 30 conversations × 500 messages). Reuse `MessageTimeline.Upsert` for merges.
  `ZappionClient.ApplyMessage` already sees every realtime row; route it into this cache too.
- **Incremental fetch:** a `GetMessagesSinceAsync(memberIds, timestamp)` (same filter plus
  `timestamp >= last`, upserting so status/reaction updates on the boundary row are not lost). Status
  updates of older messages arrive by realtime `UPDATE` events, so they stay correct while connected;
  after a reconnect, do one full 500-message reload of the **open** chat only and mark the other cached
  chats stale (refetch on next open, still showing the cache first).
- **Keep bubbles:** when switching chats, prefer keeping `MessageItem`s per conversation (or at least
  not clearing `timeline.Items` before the cached rows are applied) so images are not re-decoded.
- **`ConversationsChanged`:** pass the changed `ConversationRow` from the payload and upsert it into
  `conversationRows`; fall back to the full refresh only when the row is unknown (new conversation) or
  the payload is missing. Debounce bursts (e.g. 500 ms).
- **Silent refresh:** split `SetBusy` (blocks input, shows progress) from a background refresh flag;
  only the first load and the explicit `Ctrl+R` show progress.
- **Template TTL:** 1 min → stale-while-revalidate with ~10 min background refresh. The approved list
  for a chat bubble does not need to be fresher than that; template status changes also arrive by
  Meta webhook in the backend, which can be wired to realtime later.
- **Invalidation on sign-out / org switch:** clear every cache in `SignOutAsync` (today only
  `templateCache`) and when `workspace.OrganizationId` changes.
- **Measure first:** add `AppLog.Info` timings around `LoadConversationsAsync`, `LoadChatAsync` and the
  template fetch (request count + ms) so the before/after is visible in the log, and the user can
  confirm whether the slowness is the network or the rendering.

## What was built

- `Core/MessageCache.cs`: per-conversation history, LRU of 30 conversations x 500 messages. Entries
  created only by realtime start stale (one row is not a history). Every disconnect marks all stale.
- `Core/ChatHistory.cs`: merge and last-incoming helpers; `ZappionClient.GetMessagesSinceAsync` fetches
  `timestamp >= newest cached` for incremental loads.
- `Core/ConversationUpdates.cs`: realtime `conversations` rows are upserted locally; unknown, deleted
  or missing rows fall back to the full refresh. `MainWindow` debounces them (500 ms).
- Background refreshes (realtime, reconnect) no longer show the progress bar; Ctrl+R and the first load
  do. Timings go to the log (`LoadConversationsAsync`, `LoadChatAsync`, `RefreshAsync reason=...`,
  `Templates fetch`).
- `Core/TemplateCache.cs`: stale-while-revalidate (10 min), one fetch per key, `TemplatesChanged` event.
- `Core/SnapshotStore.cs` + `ZappionClient.Snapshots.cs` + `MainWindow.Snapshots.cs`: one DPAPI-encrypted
  file per user + organization (`%LOCALAPPDATA%\Zappion\cache\snapshot-<user>-<org>.bin`) with the
  workspace, inbox rows and the 30 cached chats (imported as stale). Restored before the network
  answers; sending, templates, read marking and realtime wait until the fresh inbox loads. Saved at
  most every 30 s after a change and on close; deleted on sign-out; a bad file is discarded. Measured
  on the seed account: restore 31 ms, save 8 ms, 21 KB. Against the local Supabase the network is as
  fast as the disk, so the gain shows only on a remote backend.
- Settings, templates and media panels are hidden instead of destroyed, refresh on show
  (`OnShownAsync`), and are disposed on sign-out or organization change (`DisposeWorkspacePanels`).

## Codex steps

One prompt per step, in order (`codex exec --approve-for-me -C <repo>`); Claude reviews each diff, runs
`dotnet test windows/Zappion.Windows.Tests` and checks the app before the next one.

1. **Instrumentation.** Log duration and row counts for conversation loads, chat loads and template
   fetches. No behaviour change.
2. **Per-conversation message cache in Core** + unit tests (LRU, upsert, realtime apply to non-open
   chats, clear on sign-out).
3. **Chat open from cache:** show cached messages immediately, then incremental fetch and merge; full
   reload only when there is no cache or after a reconnect. Keep the scroll-to-bottom and read-marking
   behaviour exactly as now.
4. **Realtime conversation upsert + silent refresh:** upsert the changed conversation row, debounce,
   no progress bar for background refreshes.
5. **Templates stale-while-revalidate** (longer TTL, background refresh, page refresh button forces).
6. **Keep pages alive:** settings, templates and media panels hidden instead of destroyed; background
   refresh on show; dispose on sign-out.
7. *(Optional)* **Disk snapshot** of inbox + recent chats for instant cold start.

Update `WINDOWS.md` ("Decisions and why") when each step lands.
