// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, useLocale, getT, getLocale } from "@/lib/i18n";

import { MemberAvatar } from "./member-avatar";
import { PageHeader } from "./ui/page-header";

import { ChevronLeft, ChevronRight, Download, FileText, Forward, Image as ImageIcon, Link as LinkIcon, LoaderCircle, Music, Play, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMediaUrl, useSendMessage } from "@/hooks/use-chat";
import { useMediaLibrary, useMediaPeople } from "@/hooks/use-media-library";
import type { Workspace } from "@/hooks/use-session";
import { fileOf, formatPhone, storagePath } from "@/lib/messages";
import { extractLinks, formatBytes, groupMedia, mediaText, type MediaTab } from "@/lib/media-library";
import { contactName } from "@/lib/contacts";
import { instanceName } from "@/lib/instances";
import { supabase } from "@/lib/supabase";
import type { MessageRow } from "@/lib/types";
import { Select } from "./ui/select";

const button = "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-heading hover:bg-panel disabled:opacity-40 disabled:cursor-not-allowed";
const input = "min-w-0 rounded-lg border border-line bg-input px-3 py-2 text-sm text-heading outline-none focus:border-accent";
const dateLabel = (date: Date) => date.toLocaleDateString(getLocale().locale, { day: "numeric", month: "short", year: "numeric" });

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }} className={`m-auto max-h-[95dvh] ${wide ? "h-[94dvh] w-[96vw] max-w-[1400px]" : "w-[min(94vw,600px)]"} overflow-auto rounded-xl border border-line bg-surface p-0 text-heading backdrop:bg-black/75`}>
    <PageHeader title={title} actions={<button className={button} aria-label={t.home.close} onClick={onClose}><X className="size-5" /></button>} />
    {children}
  </dialog>;
}

function Attachment({ row, full = false }: { row: MessageRow; full?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(full);
  const file = fileOf(row.content);
  useEffect(() => {
    if (full) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [full]);
  const url = useMediaUrl(visible && file ? storagePath(file.uri) : null);
  const source = url.data ?? (file && /^https?:\/\//.test(file.uri) ? file.uri : undefined);
  const mime = (file?.mime_type ?? "").toLowerCase();
  return <div ref={ref} className={`flex h-full w-full items-center justify-center overflow-hidden ${full ? "min-h-40" : "bg-panel"}`}>
    {url.isError ? <span className="p-3 text-xs text-danger">{t.mediaLibrary.previewUnavailable}</span> : source && mime.startsWith("image/") ?
      // Signed private URLs cannot use the public Next image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={source} alt={file?.name ?? t.mediaLibrary.image} loading="lazy" className={`h-full w-full ${full ? "object-contain" : "object-cover"}`} /> : source && mime.startsWith("video/") ?
        <div className="relative h-full w-full"><video src={source} controls={full} preload="metadata" className="h-full w-full object-contain" />{!full && <Play className="absolute inset-0 m-auto size-10 rounded-full bg-black/50 p-2 text-white" />}</div> : full && source && mime.startsWith("audio/") ? <audio controls src={source} /> : url.isLoading && visible ? <LoaderCircle className="size-6 animate-spin text-sub" /> : mime.startsWith("audio/") ? <Music className="size-8 text-accent" /> : mime.startsWith("video/") ? <Play className="size-8 text-accent" /> : <FileText className="size-8 text-accent" />}
  </div>;
}

async function downloadRow(row: MessageRow) {
  const file = fileOf(row.content);
  if (!file) throw new Error(getT().mediaLibrary.thisItemDoesNotContainAFile);
  const path = storagePath(file.uri);
  let url = file.uri;
  if (path) {
    const { data, error } = await supabase.storage.from("media").createSignedUrl(path, 60);
    if (error) throw error;
    url = data.signedUrl;
  }
  if (!/^https?:\/\//.test(url)) throw new Error(getT().mediaLibrary.fileNotYetAvailableToDownload);
  const response = await fetch(url);
  if (!response.ok) throw new Error(getT().mediaLibrary.couldNotDownloadTheFile);
  const blob = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a"); anchor.href = blob; anchor.download = file.name ?? getT().mediaLibrary.fileName(row.id);
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blob), 30_000);
}

export function MediaLibrary({ workspace, onOpenMessage }: { workspace: Workspace; onOpenMessage: (row: MessageRow) => void }) {
  const { messages: t, locale } = useLocale();
  const [tab, setTab] = useState<MediaTab>("media");
  const [search, setSearch] = useState(""); const [term, setTerm] = useState("");
  const [sender, setSender] = useState(""); const [contactSearch, setContactSearch] = useState("");
  const [conversation, setConversation] = useState(""); const [instance, setInstance] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [selecting, setSelecting] = useState(false); const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<string | null>(null); const [forwardRows, setForwardRows] = useState<MessageRow[] | null>(null);
  const [destinations, setDestinations] = useState<Set<string>>(new Set()); const [destinationSearch, setDestinationSearch] = useState("");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const sent = useRef(new Set<string>());
  const people = useMediaPeople(workspace.organizationId);
  useEffect(() => { const timer = setTimeout(() => setTerm(search), 300); return () => clearTimeout(timer); }, [search]);
  const contacts = people.data?.contacts ?? [];
  const conversations = people.data?.conversations ?? [];
  const nameOf = (row: MessageRow) => row.sender_address === null ? row.agent_id === workspace.agent.id ? t.composer.you : people.data?.agents.find((agent) => agent.id === row.agent_id)?.name ?? t.mediaLibrary.team : contactName(contacts.find((c) => c.address === row.sender_address && c.organization_address === row.organization_address)?.extra) ?? conversations.find((c) => c.id === row.conversation_id)?.name ?? formatPhone(row.sender_address);
  const conversationName = (c: typeof conversations[number]) => contactName(contacts.find((contact) => contact.address === c.address && contact.organization_address === c.organization_address)?.extra) ?? c.name ?? formatPhone(c.address);
  const instanceLabel = (address: string) => { const number = workspace.numbers.find((n) => n.address === address); return number ? instanceName(number) : formatPhone(address); };
  const matchingAddresses = [...new Set([...contacts.filter((c) => `${c.extra?.synced?.name ?? ""} ${c.extra?.saved_name ?? ""} ${c.extra?.name ?? ""} ${formatPhone(c.address)}`.toLowerCase().includes(term.trim().toLowerCase())).map((c) => c.address), ...conversations.filter((c) => `${c.name ?? ""} ${formatPhone(c.address)}`.toLowerCase().includes(term.trim().toLowerCase())).map((c) => c.address)])];
  const senderLabel = (row: MessageRow) => {
    const agent = row.sender_address === null ? row.agent_id === workspace.agent.id ? workspace.agent : people.data?.agents.find((agent) => agent.id === row.agent_id) : undefined;
    return <span className="inline-flex max-w-full items-center gap-2 align-middle">{agent && <MemberAvatar id={agent.id} name={agent.name} path={agent.picture} size={20} />}<span className="truncate">{nameOf(row)}</span></span>;
  };
  const filters = { tab, search: term, sender, conversations: conversation ? [conversation] : [], instance, from, to, matchingAddresses: term.trim() ? matchingAddresses : [] };
  const query = useMediaLibrary(workspace.organizationId, filters);
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data]);
  const groups = groupMedia(rows);
  const total = query.data?.pages[0]?.count ?? 0;
  const chosen = rows.filter((row) => selected.has(row.id));
  const currentIndex = rows.findIndex((row) => row.id === viewer); const current = rows[currentIndex];
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) void query.fetchNextPage(); }, { rootMargin: "300px" });
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetching, query.isFetchNextPageError, query.fetchNextPage, rows.length]);
  useEffect(() => { setSelected(new Set()); setViewer(null); }, [tab, term, sender, conversation, instance, from, to]);
  useEffect(() => {
    if (!viewer) return;
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLVideoElement) return;
      if (event.key === "ArrowLeft" && currentIndex > 0) setViewer(rows[currentIndex - 1].id);
      if (event.key === "ArrowRight" && currentIndex < rows.length - 1) setViewer(rows[currentIndex + 1].id);
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [viewer, currentIndex, rows]);
  const toggle = (id: string) => setSelected((value) => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const download = async (items: MessageRow[]) => {
    setBusy(true); setNotice("");
    let count = 0;
    try { for (const row of items) { await downloadRow(row); count++; } setNotice(t.mediaLibrary.downloaded(count)); }
    catch (error) { setNotice(t.mediaLibrary.downloadError(count, error instanceof Error ? error.message : t.mediaLibrary.downloadFailed)); }
    finally { setBusy(false); }
  };
  const openForward = (items: MessageRow[]) => { setForwardRows(items); setDestinations(new Set()); setDestinationSearch(""); sent.current.clear(); setNotice(""); };
  const send = useSendMessage(workspace.agent.id, workspace.agent.name);
  const forward = async () => {
    if (!forwardRows) return;
    setBusy(true); setNotice(""); const results: string[] = [];
    for (const id of destinations) {
      const destination = conversations.find((c) => c.id === id); if (!destination) continue;
      let count = 0;
      try {
        for (const row of forwardRows) {
          const receipt = `${id}:${row.id}`;
          if (sent.current.has(receipt)) continue;
          const { data: incoming, error } = await supabase.from("messages").select("timestamp").eq("organization_id", workspace.organizationId).eq("conversation_id", id).not("sender_address", "is", null).order("timestamp", { ascending: false }).limit(1).maybeSingle();
          if (error) throw error;
          if (!incoming || Date.now() >= new Date(incoming.timestamp).getTime() + 24 * 60 * 60_000) throw new Error(t.mediaLibrary.windowClosed);
          const file = fileOf(row.content);
          if (file) await send.mutateAsync({ target: { organizationId: workspace.organizationId, organizationAddress: destination.organization_address, address: destination.address, conversationId: id }, content: { type: "file", kind: row.content.kind, file, ...(mediaText(row) ? { text: mediaText(row) } : {}) } });
          else await send.mutateAsync({ target: { organizationId: workspace.organizationId, organizationAddress: destination.organization_address, address: destination.address, conversationId: id }, content: { type: "text", kind: "text", text: mediaText(row) } });
          sent.current.add(receipt); count++;
        }
        results.push(t.mediaLibrary.sent(conversationName(destination), count));
      } catch (error) { results.push(t.mediaLibrary.sendError(conversationName(destination), count, error instanceof Error ? error.message : t.mediaLibrary.couldNotSend)); }
    }
    setNotice(results.join(" ")); setBusy(false);
  };
  const senderOptions = [{ value: "", label: t.mediaLibrary.allSenders }, { value: "team", label: t.mediaLibrary.meTeam }, ...Array.from(new Map(conversations.map((c) => [c.address, { value: c.address, label: conversationName(c) }])).values()).filter((c) => c.value === sender || c.label.toLowerCase().includes(contactSearch.toLowerCase()))];

  return <section className="flex min-w-0 flex-1 flex-col bg-surface text-heading">
    <PageHeader title={selecting ? t.mediaLibrary.selectedCount(selected.size) : t.mediaLibrary.media} actions={<button className={button} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? t.mediaLibrary.cancelSelection : t.mediaLibrary.select}</button>} />
    <div className="border-b border-line px-5 py-3">
      <div role="tablist" aria-label={t.mediaLibrary.contentTypes} className="flex rounded-full bg-panel p-1">{([['media', t.mediaLibrary.media], ['links', t.mediaLibrary.links], ['docs', t.mediaLibrary.docs]] as const).map(([value, label]) => <button id={`media-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="media-results" key={value} onClick={() => setTab(value)} className={`rounded-full px-6 py-1.5 text-sm ${tab === value ? "bg-surface font-semibold shadow-sm" : "text-sub"}`}>{label}</button>)}</div>
    </div>
    <div className="space-y-3 border-b border-line p-4">
      <label className="flex items-center gap-2 rounded-lg bg-input px-3 py-2"><Search className="size-4 text-icon" /><input className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label={t.mediaLibrary.searchMedia} placeholder={t.mediaLibrary.searchByFileCaptionLinkOrContact} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} w-40`} aria-label={t.mediaLibrary.searchSenders} placeholder={t.mediaLibrary.searchContacts} value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} />
        <Select size="compact" aria-label={t.mediaLibrary.sentBy} value={sender} onChange={setSender} options={senderOptions} />
        <Select size="compact" aria-label={t.mediaLibrary.chat} value={conversation} onChange={setConversation} options={[{ value: "", label: t.mediaLibrary.allChats }, ...conversations.filter((c) => c.id === conversation || conversationName(c).toLowerCase().includes(contactSearch.toLowerCase())).map((c) => ({ value: c.id, label: conversationName(c), description: instanceLabel(c.organization_address) }))]} />
        {workspace.numbers.length > 1 && <Select size="compact" aria-label={t.mediaLibrary.instance} value={instance} onChange={setInstance} options={[{ value: "", label: t.mediaLibrary.allInstances }, ...workspace.numbers.map((n) => ({ value: n.address, label: instanceName(n) }))]} />}
        <label className="flex items-center gap-2 text-xs text-sub">{t.mediaLibrary.from} <input type="date" aria-label={t.mediaLibrary.startDate} className={input} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-xs text-sub">{t.mediaLibrary.to} <input type="date" aria-label={t.mediaLibrary.endDate} className={input} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <button className={button} onClick={() => { setSearch(""); setSender(""); setConversation(""); setInstance(""); setFrom(""); setTo(""); setContactSearch(""); }}>{t.mediaLibrary.clearFilters}</button>
      </div>
    </div>
    {people.error && <div role="alert" className="p-3 text-sm text-danger">{t.mediaLibrary.couldNotLoadContactsAndChats} <button onClick={() => void people.refetch()}>{t.home.tryAgain}</button></div>}
    {notice && <div role="status" className="border-b border-line px-4 py-3 text-sm text-accent">{notice}</div>}
    <div id="media-results" role="tabpanel" aria-labelledby={`media-tab-${tab}`} className="thin-scroll min-h-0 flex-1 overflow-auto p-5">
      {query.isLoading ? <p role="status" className="p-10 text-center text-sub">{t.mediaLibrary.loading}</p> : query.isError && !rows.length ? <p role="alert" className="p-10 text-center text-danger">{t.mediaLibrary.couldNotLoadMedia} <button className={button} onClick={() => void query.refetch()}>{t.home.tryAgain}</button></p> : !rows.length ? <div className="flex flex-col items-center gap-3 p-12 text-sub"><ImageIcon className="size-10" /><p>{t.mediaLibrary.noItemsFound}</p><p className="text-sm">{t.mediaLibrary.adjustTheFiltersOrWaitForNewMessages}</p></div> : null}
      {query.isError && rows.length > 0 && !query.isFetchNextPageError && <p role="alert" className="p-3 text-sm text-danger">{t.mediaLibrary.couldNotRefreshTheResults} <button className={button} onClick={() => void query.refetch()}>{t.home.tryAgain}</button></p>}
      {tab === "docs" && rows.length > 0 && <div className="mb-2 grid min-w-[700px] grid-cols-[minmax(240px,2fr)_1fr_1fr_140px] gap-4 px-3 text-xs font-semibold text-sub"><span>{t.messages.document}</span><span>{t.mediaLibrary.caption}</span><span>{t.mediaLibrary.senderDate}</span><span>{t.mediaLibrary.actions}</span></div>}
      {groups.map((group) => <section key={group.key} className="mb-6"><header className="mb-3 border-b border-line py-3"><h2 className="font-semibold">{group.label}</h2><p className="text-xs text-sub">{dateLabel(group.start)}{dateLabel(group.start) !== dateLabel(group.end) && ` – ${dateLabel(group.end)}`}</p></header>
        <div className={tab === "media" ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6" : "space-y-1"}>{group.rows.map((row) => {
          const file = fileOf(row.content); const checked = selected.has(row.id); const links = extractLinks(mediaText(row));
          return tab === "media" ? <button key={row.id} aria-label={t.mediaLibrary.itemLabel(selecting ? checked ? t.mediaLibrary.deselect : t.mediaLibrary.select : t.mediaLibrary.open, file?.name ?? t.mediaLibrary.mediaFallback, nameOf(row))} aria-pressed={selecting ? checked : undefined} onClick={() => selecting ? toggle(row.id) : setViewer(row.id)} className={`relative aspect-square overflow-hidden rounded-lg border-2 ${checked ? "border-accent" : "border-transparent"}`}>
            <Attachment row={row} />{selecting && <span aria-hidden="true" className={`absolute left-2 top-2 flex size-5 items-center justify-center rounded-full border border-white text-xs text-white ${checked ? "bg-accent" : "bg-black/30"}`}>{checked ? "✓" : ""}</span>}<span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-2 text-left text-xs text-white">{senderLabel(row)}</span>
          </button> : <div key={row.id} className={`flex items-center gap-2 rounded-lg border border-line p-3 ${checked ? "bg-accent/10" : "bg-panel/40"}`}>
            {selecting && <input type="checkbox" aria-label={t.mediaLibrary.selectItem(file?.name ?? links[0]?.domain ?? t.mediaLibrary.link)} checked={checked} onChange={() => toggle(row.id)} className="accent-accent" />}
            {tab === "docs" ? <div className="grid min-w-[660px] flex-1 grid-cols-[minmax(220px,2fr)_1fr_1fr_140px] items-center gap-4"><button className="flex min-w-0 items-center gap-3 text-left" onClick={() => selecting ? toggle(row.id) : setViewer(row.id)}><span className="size-12 shrink-0 overflow-hidden rounded-lg"><Attachment row={row} /></span><span className="min-w-0"><strong className="block truncate text-sm">{file?.name ?? (file?.mime_type.startsWith("audio/") ? t.mediaLibrary.audio : t.messages.document)}</strong><span className="text-xs text-sub">{formatBytes(file?.size)} · {file?.name?.split(".").at(-1)?.toUpperCase() ?? file?.mime_type.split("/").at(-1)?.toUpperCase()}</span></span></button><span className="truncate text-sm text-sub" title={mediaText(row)}>{mediaText(row) || t.mediaLibrary.noCaption}</span><span className="truncate text-sm">{senderLabel(row)}<span className="block text-xs text-sub">{new Date(row.timestamp).toLocaleString(locale)}</span></span><div className="flex"><button aria-label={t.mediaLibrary.goToMessage} title={t.mediaLibrary.goToMessage} className={button} onClick={() => onOpenMessage(row)}><FileText className="size-4" /></button><button disabled={busy} className={button} aria-label={t.mediaLibrary.download} onClick={() => void download([row])}><Download className="size-4" /></button><button disabled={busy} className={button} aria-label={t.mediaLibrary.forward} onClick={() => openForward([row])}><Forward className="size-4" /></button></div></div> : <><LinkIcon className="size-7 shrink-0 text-accent" /><div className="min-w-0 flex-1">{links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="mb-1 block truncate text-sm text-accent"><strong>{link.domain}</strong><span className="ml-2 text-xs text-sub">{link.url}</span></a>)}<p className="truncate text-sm">{mediaText(row)}</p><p className="mt-1 text-xs text-sub">{senderLabel(row)} · {new Date(row.timestamp).toLocaleString(locale)}</p></div><button className={button} onClick={() => onOpenMessage(row)}>{t.mediaLibrary.goToMessage}</button><button aria-label={t.mediaLibrary.forward} className={button} onClick={() => openForward([row])}><Forward className="size-4" /></button></>}
          </div>;
        })}</div>
      </section>)}
      <div ref={sentinel} className="py-3 text-center text-sm text-sub">{query.isFetchingNextPage ? t.mediaLibrary.loadingMore : query.hasNextPage && <button className={button} onClick={() => void query.fetchNextPage()}>{query.isFetchNextPageError ? t.mediaLibrary.couldNotLoadTryAgain : t.mediaLibrary.loadMore}</button>}</div>
    </div>
    <footer className="flex flex-wrap items-center justify-center gap-3 border-t border-line bg-panel px-4 py-3 text-sm text-sub">
      {selecting ? <><strong className="mr-auto text-heading">{t.mediaLibrary.selectedCount(selected.size)}</strong><button className={button} onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)))}>{t.mediaLibrary.selectAll}</button><span className="text-xs">{t.mediaLibrary.loadedCount(rows.length)}</span><button disabled={!chosen.length || busy || !!people.error || people.isLoading} className={button} onClick={() => openForward(chosen)}><Forward className="size-4" />{t.mediaLibrary.forward}</button>{tab !== "links" && <button disabled={!chosen.length || busy} className={button} onClick={() => void download(chosen)}><Download className="size-4" />{t.mediaLibrary.download}</button>}</> : <span>{t.mediaLibrary.totalItems(total, total.toLocaleString(locale), tab)}</span>}
    </footer>
    {current && <Modal wide title={fileOf(current.content)?.name ?? t.mediaLibrary.viewer} onClose={() => setViewer(null)}><div className="flex h-[calc(94dvh-140px)] items-center gap-2 p-4"><button className={button} aria-label={t.mediaLibrary.previous} disabled={currentIndex <= 0} onClick={() => setViewer(rows[currentIndex - 1].id)}><ChevronLeft /></button><div className="flex h-full min-w-0 flex-1 flex-col items-center gap-3"><div className="min-h-0 w-full flex-1"><Attachment key={current.id} row={current} full /></div><p className="text-sm">{mediaText(current) || fileOf(current.content)?.name}</p><p className="text-xs text-sub">{senderLabel(current)} · {new Date(current.timestamp).toLocaleString(locale)}</p></div><button className={button} aria-label={t.mediaLibrary.next} disabled={currentIndex >= rows.length - 1 && !query.hasNextPage} onClick={async () => { if (currentIndex < rows.length - 1) setViewer(rows[currentIndex + 1].id); else { const next = await query.fetchNextPage(); const all = next.data?.pages.flatMap((p) => p.rows); if (all?.[currentIndex + 1]) setViewer(all[currentIndex + 1].id); } }}><ChevronRight /></button></div><div className="flex flex-wrap justify-center gap-3 border-t border-line p-3"><button className={button} onClick={() => onOpenMessage(current)}>{t.mediaLibrary.goToMessage}</button><button disabled={busy} className={button} onClick={() => void download([current])}><Download className="size-4" />{t.mediaLibrary.download}</button><button disabled={busy || !!people.error || people.isLoading} className={button} onClick={() => { setViewer(null); openForward([current]); }}><Forward className="size-4" />{t.mediaLibrary.forward}</button></div></Modal>}
    {forwardRows && <Modal title={t.mediaLibrary.forwardItems(forwardRows.length)} onClose={() => { if (!busy) setForwardRows(null); }}><div className="space-y-3 p-4"><input autoFocus aria-label={t.mediaLibrary.searchDestinations} className={`${input} w-full`} placeholder={t.mediaLibrary.searchDestinationChats} value={destinationSearch} onChange={(e) => setDestinationSearch(e.target.value)} /><p className="text-xs text-sub">{t.mediaLibrary.forwardNotice}</p><div className="thin-scroll max-h-72 overflow-auto">{conversations.filter((c) => `${conversationName(c)} ${instanceLabel(c.organization_address)}`.toLowerCase().includes(destinationSearch.toLowerCase())).map((c) => <label key={c.id} className="flex items-center gap-3 rounded-lg p-3 hover:bg-panel"><input type="checkbox" disabled={busy} checked={destinations.has(c.id)} onChange={() => setDestinations((value) => { const next = new Set(value); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })} /><span className="text-sm">{conversationName(c)}<span className="block text-xs text-sub">{instanceLabel(c.organization_address)}</span></span></label>)}{!conversations.length && <p className="p-4 text-sub">{t.mediaLibrary.noChatsAvailable}</p>}</div>{notice && <p role="status" className="text-sm text-accent">{notice}</p>}<button disabled={!destinations.size || busy} className={`${button} w-full bg-accent/15`} onClick={() => void forward()}>{busy ? t.mediaLibrary.forwarding : t.mediaLibrary.forward}</button></div></Modal>}
  </section>;
}
