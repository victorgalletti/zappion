# Windows client (WinUI 3)

The native Windows app in `windows/`. It talks to the same Supabase backend as the web app and copies
the web app's layout and behavior; the web (`web/`) stays the reference client. This file records what
exists, what was decided and why, what was fixed along the way, and what is still open.

Built on 2026-10-15 and 2026-10-16. Commits: `e1c013f` (first version: chats, realtime, media,
templates in the composer, archive, preferences) and `a8925b1` (native settings, Modelos, Mídia, new
conversation, toasts, taskbar badge, reliability fixes and the review fixes).

## What it does

Everything the web inbox does on desktop, inside a WhatsApp-for-Windows style window:

| Area | Status |
|---|---|
| Sign-in, session kept between launches, sign-out (local scope) | Done |
| Conversation list: search (Ctrl+K), All/Unread filters, number filter, archived view, ninth-digit merge | Done |
| New conversation ("+"): phone with country/area code, business number, reuses an existing chat, otherwise an empty chat created by the first send | Done |
| Chat: formatted bubbles, links, delivery ticks, date chips, wallpaper, quoted replies, reactions, in-chat search (Ctrl+F), copy, message info | Done |
| Realtime: one org channel, status updates in place, reconnect + refetch, unread counts, `mark_read` | Done |
| Approval before sending: a key's held messages show "Waiting for approval · key" with Approve / Reject (RPC errors inline), "Rejected" instead of ticks, a waiting-count badge on Chats and an "Approval" marker on the row; live through `zappion_message_approvals` | Done |
| Media in chat: images, stickers, video (poster frame), audio (waveform, speed), documents, location, contacts; viewer with zoom; save / open | Done |
| Sending: text, attachments (picker, paste, drag-and-drop, caption), voice notes recorded as Ogg/Opus | Done |
| 24-hour window in the header; outside it the composer becomes the approved-template picker (variables, media headers) | Done |
| Notifications: Windows toasts (click opens the chat), sound, taskbar unread badge, taskbar flash | Done; toasts need Windows notifications turned on |
| Modelos: list with filters, detail with preview and data, the full template builder | Done |
| Mídia: Media / Links / Docs tabs, search and filters, grouped results, viewer, download, forward, selection | Done |
| Settings: Organização, Membros (roles, invitations), Instâncias (manual connect), App da Meta, Integrações (API keys, MCP, activity) | Done; Meta's embedded signup opens the web in the browser |
| Profile and per-device preferences (language, theme, font size, chat background, Enter to send, signature, notifications, audio speed) | Done |
| English and Portuguese, following the system language until the person picks one | Done |

## Code layout

| Project | What lives there |
|---|---|
| `windows/Zappion.Windows` | The WinUI app: `MainWindow*` (shell, chat, composer, preferences, new conversation, invitations), `NativeSettingsPanel*`, `NativeTemplatesPanel*`, `MediaLibraryPanel`, `TemplatePicker`/`TemplatePreview`, `ChatMedia`, `MessageBubble`, `DesktopNotifications`, `TaskbarOverlay`, `WebControls` (Lucide icons, avatars, brushes) |
| `windows/Zappion.Windows.Core` | Plain `net8.0`, no UI: `ZappionClient*` (Supabase auth, PostgREST, Realtime, Storage, edge functions), and the logic ported from `web/lib` (`MessageHelpers`, `ChatHelpers`, `ConversationMerger`, `Templates*`, `MediaLibrary`, `ServiceWindow`, `SettingsRules`, `MessageTimeline`, `BottomAnchor`, `OpusWave`, `VoiceEncoder`, …). Strings in `Strings/{en-US,pt-BR}/Resources.resw` |
| `windows/Zappion.Windows.Tests` | xUnit, 282 tests: the ported logic, request payloads, realtime transport, media, settings |
| `windows/tools` | `generate-assets.py` (icons from the web logo) and `verify-task-*.ps1` regression runs against the local Supabase |

Per-device files live in `%LOCALAPPDATA%\Zappion`: `session.json`, `last-read.json`,
`preferences.json`, `cache/media` (500 MB, oldest out first) and `logs/zappion-<date>.log` (kept 7 days).

Build, test and run: see the "Windows app" section of the root `README.md`.

## Decisions and why

**Platform and build**
- **WinUI 3, unpackaged and self-contained, x64, .NET 8, Windows App SDK 2.5.1.** It must build with
  `dotnet build` alone (the PC has only the VS Build Tools). Windows App SDK 1.6 needs Visual Studio's
  PRI tasks and fails with `dotnet build`; 2.5.1 works. Do not add `Microsoft.Windows.SDK.BuildTools`
  (the SDK brings a newer one; pinning an older one fails restore).
- **No API layer of its own.** Like the web, the app calls Supabase directly (C# `Supabase` client plus
  raw PostgREST requests where the fluent API falls short, e.g. the media library's `or=` filters).
  RLS and the edge functions are the same for every client.
- **Web logic is ported to `Core`, not shared.** Each ported function names the web file it mirrors
  and has tests; the WhatsApp markdown conversion runs against the shared fixtures in
  `api/supabase/functions/_shared/zappion_markdown_fixtures.json`. This differs from the original plan
  (move client rules to the backend first): the port was faster, and the rules can still move to the
  backend later.
- **Strings are copied from `web/lib/i18n` into `.resw`** with the web's wording, per section. There
  is no generator yet.

**Look**
- **Identical to the web inside the window.** The owner rejected the first generic Fluent layout: the
  rail, sidebar, chat, bubbles, colors, spacing and wording follow the web components, with the
  `--wa-*` tokens of `web/app/globals.css` as brush resources in `App.xaml`.
- **WhatsApp-for-Windows frame.** A 38 px title bar (favicon `web/app/icon.png` + "Zappion" at the
  left, native caption buttons at the right) joined with the 64 px rail as one L-shaped surface; the
  content is inset with a rounded top-left corner.
- **Logo.** The web's rounded logo (`web/public/images/zappion-logo.png`), only in the title bar, the
  empty state and the sign-in page; never repeated in a header.

**Platform features**
- **Toasts use `Windows.UI.Notifications.ToastNotificationManager`** with an AppUserModelID registered
  under `HKCU\Software\Classes\AppUserModelId\Zappion.Windows` and a COM activator, so clicking opens the
  chat. `AppNotificationManager` cannot register in a self-contained unpackaged app: it fails loading
  `Microsoft.WindowsAppRuntime.Insights.Resource.dll`, which no package ships.
- **The taskbar badge is an `ITaskbarList3` overlay icon** (green circle with the count) plus
  `FlashWindowEx` when a message arrives and the window is not focused, like WhatsApp. Both work even
  with Windows notifications off. `BadgeNotificationManager` needs package identity ("Not applicable
  for unpackaged applications").
- **Voice notes are Ogg/Opus both ways, with Concentus.** Recording encodes mono 16 kHz Opus (WhatsApp
  plays a voice note only as `audio/ogg; codecs=opus`). Playback decodes Ogg/Opus to WAV, because Windows
  has no Opus decoder (`MediaPlayer` failed with `0xC00D36B6`).
- **Diagnostics.** Every UI callback and unhandled exception is logged with its full stack to the daily
  log. Start there when something misbehaves.

**What stays in the web**
- Meta's embedded signup (the Facebook login popup) opens the web app in the browser; the manual
  connection is native. `WebAppUrl` in `appsettings.local.json` says where the web runs.

## Bugs found and fixed

| Problem | Cause | Fix |
|---|---|---|
| Realtime events lost, also for the web, when the Windows app joined | The C# client sent `phx_join` without the user's JWT, so `get_authorized_orgs` raised "authentication required" and the batch was dropped | The join carries the access token (`RealtimeJoinEncoder`); ready only after the server's "subscribed" reply, then refetch |
| Crash plus "Não foi possível carregar as mensagens" | Template lookup treated a contact message's data array as an object (`ArgumentException`) | Fixed lookup; every async UI handler catches and logs |
| Chat kept scrolling down while reading | Bottom-follow only stopped on wheel, arrow keys or pointer press; touchpad and scrollbar drags did not count | `BottomAnchor`: any scroll the app did not start that moves up stops following |
| "F5" tooltip on hover anywhere | The F5 accelerator sat on the root grid | `KeyboardAcceleratorPlacementMode="Hidden"` |
| Delivery ticks and accents shown as `?` | Non-ASCII characters lost when written by the agents | Fluent/Lucide icons for ticks; non-ASCII as `\uXXXX` in C#, real UTF-8 in `.resw` |
| Search field showed a box inside the pill | A styled `TextBox` inside a rounded container | One restyled `TextBox` for every search field |
| Taskbar badge and toasts never appeared | Packaged-only APIs (see above) | `ITaskbarList3` + `FlashWindowEx`; classic toasts with an HKCU AUMID |
| Modelos page blank | Brush keys that do not exist (`InkBrush`, `SelectedBrush`, `ChatBackgroundBrush`) throw | Existing keys and an accent tint |
| Owner signed out of the app after a test run | A verification run used the real session | Verification uses its own session under `windows/.verification/` |
| Voice notes did not play | No Opus decoder in Windows | Concentus decode to WAV |
| Review round (Modelos colors and centering, builder dialog colors, Mídia filter alignment, "Selecionar" not looking like a button, video controls over the frame) | Not matching the web | Fixed in `a8925b1` |

## Not verified yet

- Real sends to Meta from the app: template submission from the builder, forwarding from Mídia, a
  first message to a new number. They work against the local database; WhatsApp delivery was not
  exercised.
- Physical input: touchpad scrolling, drag-and-drop from Explorer, paste, the microphone.
- Toasts on the owner's PC: Windows notifications are off there (`ToastEnabled = 0`); the
  notification service receives them, but they only show once notifications are turned on.

## Still open

- Distribution: code signing (otherwise SmartScreen warns), an installer or MSIX, and auto-update.
- Push when the app is closed (WNS and a `devices` table for push tokens); today
  notifications need the app running.
- A shared foundation for the clients (generated types, tokens, strings, client rules in
  the backend) was skipped for speed; do it before the macOS client so the three clients stop
  drifting.

## Working on it: pitfalls

- **`WebBrush.Get(element, key)` throws if the key is not in `App.xaml`.** Use existing keys only.
- **Do not nest UI classes** (a `Grid`/`Control` subclass inside another class): the XAML compiler
  crashes with `WMC9999` and then reports every XAML type as unknown, hiding the real C# errors. Build
  with `-v:n` and look for `error CS` to see them.
- **Kill `Zappion.Windows.exe` before building**, or the copy step fails on the locked files.
- **Verification never touches the owner's session** (`%LOCALAPPDATA%\Zappion\session.json`), never
  signs it out and never sends WhatsApp messages or templates to Meta. Use the seed account and an
  isolated session under `windows/.verification/` (the `verify-task-*.ps1` scripts do this).
- **Screen checks**: UI Automation can open pages and invoke buttons without moving the mouse;
  window captures come out black when the window is fully covered.
- **Do not edit the root `README.md` for features**; it keeps only setup and commands. This file is the
  place for decisions and history.

## History

| Step | What | Done by |
|---|---|---|
| 1 | Project scaffold, sign-in, conversation list | Codex |
| 2 | Logo, window chrome, chat, sending text | Codex |
| 3 | Realtime, unread, notifications; review fixes (ticks, virtualized list, colors) | Codex |
| 3b | Layout identical to the web, Portuguese, realtime JWT fix | Codex |
| 4 | Media in chat, attachments, voice notes; scroll-to-bottom fix | Codex |
| 5 | Service window, templates in the composer, replies, reactions | Codex |
| 5b | WhatsApp-style frame, templates button in the composer | Codex |
| 6 | Numbers, search, archive, profile, preferences; accessibility fix pass | Codex |
| Commit `e1c013f` | First version | |
| A | Crash logging and fix, scroll, search field, organization avatar | Codex |
| B | New conversation, taskbar overlay badge | Codex |
| C / C2 | Native organization settings; layout parity and date fix | Codex / agy (Gemini) |
| F | Toasts through the classic API | agy |
| D | Modelos page (started by agy, finished and fixed) | agy / Claude |
| E | Mídia page | Claude |
| Review | Owner's review fixes (Modelos, Mídia, voice notes) | Claude |
| Commit `a8925b1` | Settings, Modelos, Mídia and everything above | |

Claude wrote the task prompts (kept outside the repo, in `.claude/codex/`), reviewed every diff, ran
the builds and tests, checked each screen against the web and fixed what the agents missed.
