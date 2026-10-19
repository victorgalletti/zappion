// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId, useState } from "react";
import { ArrowLeft, KeyRound, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { useApiKeys, useApiKeyActions, useMcpCalls, type ApiKeyScope } from "@/hooks/use-api-keys";
import { useLocale, useT } from "@/lib/i18n";
import type { OrganizationAddressRow, Role } from "@/lib/types";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Badge, CopyValue, Modal, RowMenu } from "./ui/settings-primitives";
import { Select } from "./ui/select";

const field = "mt-2 w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm text-heading outline-none focus:border-accent disabled:opacity-60";
const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} border-transparent bg-accent text-white hover:bg-accent hover:brightness-110`;
const clients = ["Claude Code", "Claude Desktop", "Cursor", "OpenAI API"] as const;
const scopes = ["read", "send", "admin"] as const;
const statuses = ["ok", "error", "denied", "rate_limited", "pending"] as const;
const tabs = ["keys", "mcp", "activity"] as const;
type UseCase = "read" | "send" | "mcp" | "admin" | "custom";

export function IntegrationsSettings({ organizationId, role, numbers = [] }: { organizationId: string; role: Role; numbers?: OrganizationAddressRow[] }) {
  const t = useT().integrations;
  return role === "admin" || role === "owner" ? <IntegrationContent key={organizationId} organizationId={organizationId} numbers={numbers} /> : <p className="text-sm text-sub">{t.adminOnly}</p>;
}

function KeyMenu({ name, disabled, onRevoke, onDelete }: { name: string; disabled: boolean; onRevoke?: () => void; onDelete: () => void }) {
  const t = useT().integrations;
  return <RowMenu label={`${t.actions}: ${name}`} disabled={disabled} items={[{ label: t.revoke, action: onRevoke }, { label: t.delete, action: onDelete }]} />;
}

function IntegrationContent({ organizationId, numbers }: { organizationId: string; numbers: OrganizationAddressRow[] }) {
  const t = useT().integrations;
  const { locale } = useLocale();
  const id = useId();
  const keys = useApiKeys(organizationId);
  const calls = useMcpCalls(organizationId);
  const { create, revoke, remove } = useApiKeyActions(organizationId);
  const [confirmation, setConfirmation] = useState<{ id: string; name: string; action: "revoke" | "remove" } | null>(null);
  const [tab, setTab] = useState<typeof tabs[number]>("keys");
  const [dialog, setDialog] = useState<"useCases" | "form" | "success" | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [fromMcp, setFromMcp] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("read");
  const [numberMode, setNumberMode] = useState("all");
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([]);
  const connectedNumbers = numbers.filter(number => number.service === "whatsapp" && number.status === "connected");
  const numberLabel = (address: string) => {
    const number = numbers.find(number => number.service === "whatsapp" && number.address === address);
    const name = number?.extra?.label || number?.extra?.verified_name;
    const phone = number?.extra?.phone_number || address;
    return name ? `${name} · ${phone}` : phone;
  };
  const validNumbers = numberMode === "all" || (selectedAddresses.length > 0 && selectedAddresses.every(address => connectedNumbers.some(number => number.address === address)));
  const [expiry, setExpiry] = useState("90");
  const [messages, setMessages] = useState(60);
  const [templates, setTemplates] = useState(10);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [client, setClient] = useState<typeof clients[number]>("Claude Code");
  const [status, setStatus] = useState("");
  const [keyFilter, setKeyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const base = (process.env.NEXT_PUBLIC_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const url = `${base}/functions/v1/mcp`;
  const apiKey = fullKey ?? "<API_KEY>";
  const snippets = {
    "Claude Code": `claude mcp add --transport http zappion ${url} --header "api-key: ${apiKey}"`,
    "Claude Desktop": JSON.stringify({ mcpServers: { zappion: { command: "npx", args: ["-y", "mcp-remote", url, "--header", "api-key:${ZAPPION_API_KEY}"], env: { ZAPPION_API_KEY: apiKey } } } }, null, 2),
    Cursor: JSON.stringify({ mcpServers: { zappion: { url, headers: { "api-key": apiKey } } } }, null, 2),
    "OpenAI API": JSON.stringify({ type: "mcp", server_label: "zappion", server_url: url, headers: { "api-key": apiKey }, require_approval: "never" }, null, 2),
  };
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const date = (value: string | null) => value ? <time dateTime={value} title={new Date(value).toLocaleString(locale)} className="whitespace-nowrap">{dateFormat.format(new Date(value))}</time> : t.never;
  const keyRows = (keys.data ?? []).map(key => ({ key, state: key.revoked_at ? "revoked" as const : key.expires_at && new Date(key.expires_at).getTime() <= Date.now() ? "expired" as const : "active" as const }));
  const hasActiveKeys = keyRows.some(({ state }) => state === "active");
  const inactiveCount = keyRows.filter(({ state }) => state !== "active").length;
  const visibleKeys = keyRows.filter(({ state }) => !hasActiveKeys || showRevoked || state === "active").sort((a, b) => Number(b.state === "active") - Number(a.state === "active"));
  const pending = create.isPending || revoke.isPending || remove.isPending;
  const useCaseOptions = [
    { value: "read", label: t.readUseCase, hint: t.readUseCaseHint },
    { value: "send", label: t.sendUseCase, hint: `${t.sendUseCaseHint} · ${t.limits(60, 10)}` },
    { value: "mcp", label: t.mcpUseCase, hint: `${t.mcpUseCaseHint} · ${t.limits(30, 0)}` },
    { value: "admin", label: t.adminUseCase, hint: t.adminUseCaseHint },
    { value: "custom", label: t.customUseCase, hint: t.customUseCaseHint },
  ] as const;
  function chooseUseCase(value: UseCase) {
    setNumberMode("all"); setSelectedAddresses([]);
    setName(value === "custom" ? t.customName : useCaseOptions.find(option => option.value === value)!.label);
    setScope(value === "mcp" ? "send" : value === "custom" ? "read" : value);
    setExpiry("90"); setMessages(value === "mcp" ? 30 : 60); setTemplates(value === "mcp" ? 0 : 10); setRequiresApproval(false);
    setDialog("form");
  }
  function openCreate(mcp = false) {
    create.reset(); setFromMcp(mcp);
    if (mcp) chooseUseCase("mcp"); else setDialog("useCases");
  }
  const queryError = (error: Error, retry: () => unknown) => <p role="alert" className="text-sm text-danger">{error.message} <button type="button" className="underline" onClick={() => void retry()}>{t.retry}</button></p>;
  const snippet = <><Select aria-label={t.connectClient} value={client} onChange={value => setClient(value as typeof client)} options={clients.map(value => ({ value, label: value }))} />
    {client === "Claude Desktop" && <p className="text-xs text-sub">claude_desktop_config.json · {t.nodeHint}</p>}
    {client === "Cursor" && <p className="text-xs text-sub">.cursor/mcp.json</p>}
    <CopyValue key={`${client}-${apiKey}`} title={t.snippet} value={snippets[client]} /></>;
  const filteredCalls = calls.data?.filter(call => (keyFilter === "all" || (keyFilter === "user" ? !!call.user_id : !call.user_id && (keyFilter === "deleted" ? call.api_key_id === null : call.api_key_id === keyFilter))) && (statusFilter === "all" || call.status === statusFilter));
  // Rows stack below xl so the settings panel never forces horizontal page scroll.
  const table = "w-full table-fixed text-left text-xs max-xl:block";
  const row = "border-b border-line last:border-0 max-xl:grid max-xl:grid-cols-2 max-xl:gap-3 max-xl:p-4";
  const cell = "min-w-0 break-words px-3 py-4 align-top max-xl:block max-xl:p-0";
  const mobileLabel = (label: string) => <span className="mb-1 block text-[10px] font-medium text-sub xl:hidden">{label}</span>;
  return <>
    <div inert={!!dialog || !!confirmation} aria-hidden={dialog || confirmation ? true : undefined} className="min-w-0 space-y-6">
      <div role="tablist" aria-label={t.navigation} className="flex gap-6 border-b border-line">{tabs.map((value, index) => <button key={value} type="button" id={`${id}-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`${id}-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        setTab(tabs[next]); document.getElementById(`${id}-tab-${tabs[next]}`)?.focus();
      }} className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium focus-visible:outline-accent ${tab === value ? "border-accent text-heading" : "border-transparent text-sub hover:text-heading"}`}>{t[value]}</button>)}</div>
      {create.error && !dialog && <p role="alert" className="text-sm text-danger">{create.error.message}</p>}
      {status && <p role="status" className="text-sm text-accent">{status}</p>}
      {tabs.filter(value => value !== tab).map(value => <section key={value} hidden id={`${id}-panel-${value}`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`} />)}
      <section id={`${id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} tabIndex={0} className="min-w-0 space-y-6 outline-none">
        {tab === "keys" && <>
          <div className="flex flex-wrap items-center justify-between gap-4"><p className="max-w-xl text-sm text-sub">{t.apiIntro}</p><button type="button" className={primary} onClick={() => openCreate()}><Plus className="size-4" />{t.createKey}</button></div>
          {hasActiveKeys && inactiveCount > 0 && <button type="button" aria-expanded={showRevoked} className="text-xs text-sub underline-offset-4 hover:text-heading hover:underline" onClick={() => setShowRevoked(value => !value)}>{showRevoked ? t.hideRevoked(inactiveCount) : t.showRevoked(inactiveCount)}</button>}
          {keys.isPending ? <p role="status">{t.loading}</p> : keys.error ? queryError(keys.error, () => keys.refetch()) : !keys.data?.length ? <div className="rounded-2xl border border-dashed border-line p-8 text-center"><KeyRound aria-hidden="true" className="mx-auto mb-3 size-6 text-sub" /><h3 className="text-sm font-semibold">{t.noKeys}</h3><p className="mb-5 mt-2 text-sm text-sub">{t.emptyKeysHint}</p><button type="button" className={button} onClick={() => openCreate()}>{t.createKey}</button></div> : <div className="rounded-2xl border border-line"><table aria-label={t.keys} className={table}>
            <colgroup className="max-xl:hidden"><col /><col className="w-36" /><col className="w-20" /><col className="w-32" /><col className="w-32" /><col className="w-32" /><col className="w-24" /><col className="w-11" /></colgroup>
            <thead className="text-sub max-xl:sr-only"><tr>{[t.name, t.keyName, t.scope, t.created, t.lastUsed, t.expires, t.status, t.actions].map(label => <th scope="col" key={label} className="bg-panel px-3 py-3 font-medium first:rounded-tl-2xl last:rounded-tr-2xl">{label === t.actions ? <span className="sr-only">{label}</span> : label}</th>)}</tr></thead>
            <tbody className="max-xl:block">{visibleKeys.map(({ key, state }) => {
              return <tr key={key.id} className={`${row} ${state !== "active" ? "text-sub opacity-60" : "text-heading"}`}>
                <th scope="row" className={`${cell} font-medium`}>{mobileLabel(t.name)}{key.name}<div className="mt-2 space-y-1 font-normal text-sub" aria-label={t.numbers}>{key.allowed_addresses === null ? t.allNumbers : key.allowed_addresses.map(address => <p key={address}>{numberLabel(address)}</p>)}</div></th>
                <td className={`${cell} max-xl:col-span-2 font-mono text-sub`}>{mobileLabel(t.keyName)}<span className="whitespace-nowrap">{key.key_prefix}…</span></td>
                <td className={cell}>{mobileLabel(t.scope)}<div className="flex flex-wrap gap-1"><Badge subdued>{t[key.scope]}</Badge>{key.requires_approval && <Badge>{t.approvalRequired}</Badge>}</div></td>
                <td className={`${cell} text-sub`}>{mobileLabel(t.created)}{date(key.created_at)}</td>
                <td className={`${cell} text-sub`}>{mobileLabel(t.lastUsed)}{date(key.last_used_at)}</td>
                <td className={`${cell} text-sub`}>{mobileLabel(t.expires)}{date(key.expires_at)}</td>
                <td className={cell}>{mobileLabel(t.status)}<Badge subdued={state !== "active"}>{t[state]}</Badge></td>
                <td className={`${cell} text-right`}><KeyMenu name={key.name} disabled={pending} onRevoke={state === "active" ? () => {
                  revoke.reset(); setStatus(""); setConfirmation({ id: key.id, name: key.name, action: "revoke" });
                } : undefined} onDelete={() => { remove.reset(); setStatus(""); setConfirmation({ id: key.id, name: key.name, action: "remove" }); }} /></td>
              </tr>;
            })}</tbody>
          </table></div>}
          <section className="space-y-3 rounded-2xl bg-panel p-5"><h3 className="text-sm font-semibold">{t.usingApi}</h3><p className="text-xs text-sub">{t.apiHint}</p><CopyValue title={t.baseUrl} value={`${base}/rest/v1`} /><CopyValue title={t.apiExample} value={`curl '${base}/rest/v1/contacts?select=*&limit=1' \\\n  -H 'apikey: ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "<PUBLIC_KEY>"}' \\\n  -H 'api-key: <API_KEY>'`} /><p className="text-xs leading-5 text-sub">{t.limitsNote}</p></section>
        </>}
        {tab === "mcp" && <>
          <p className="text-sm text-sub">{t.intro}</p>
          <div className="space-y-2"><h3 className="text-sm font-medium">{t.serverUrl}</h3><CopyValue title={t.serverUrl} value={url} /></div>
          <div className="space-y-5 rounded-2xl border border-line p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t.stepCreate}</h3><button type="button" className={button} onClick={() => openCreate(true)}><Plus className="size-4" />{t.createKey}</button></div><div className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold">{t.stepPaste}</h3><p className="text-xs text-sub">{t.pasteHint}</p>{snippet}</div></div>
          <aside className="flex gap-3 rounded-xl bg-panel p-4"><ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" /><div><h3 className="text-sm font-medium">{t.oauthTitle}</h3><p className="mt-1 text-sm leading-6 text-sub">{t.chatgptHint}</p></div></aside>
        </>}
        {tab === "activity" && <>
          <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-sub">{t.activityIntro}</p><div className="flex max-w-full flex-wrap gap-2">
            <Select size="compact" aria-label={t.keyName} value={keyFilter} onChange={setKeyFilter} options={[{ value: "all", label: t.allKeys }, { value: "user", label: t.signedInUser }, { value: "deleted", label: t.deletedKey }, ...(keys.data ?? []).map(key => ({ value: key.id, label: key.name })), ...[...new Set((calls.data ?? []).filter(call => !call.user_id && call.api_key_id && !keys.data?.some(key => key.id === call.api_key_id)).map(call => call.api_key_id!))].map(value => ({ value, label: `${t.unknownKey} (${value})` }))]} />
            <Select size="compact" aria-label={t.status} value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: t.allStatuses }, ...statuses.map(value => ({ value, label: value === "error" ? t.callError : t[value] }))]} />
          </div></div>
          {keys.error && queryError(keys.error, () => keys.refetch())}
          {calls.isPending ? <p role="status">{t.loading}</p> : calls.error ? queryError(calls.error, () => calls.refetch()) : !filteredCalls?.length ? <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-sub">{calls.data?.length ? t.noFilteredCalls : t.noCalls}</p> : <div className="overflow-hidden rounded-2xl border border-line"><table aria-label={t.activity} className={table}>
            <colgroup className="max-xl:hidden"><col className="w-[15%]" /><col className="w-[30%]" /><col className="w-[20%]" /><col className="w-[20%]" /><col className="w-[15%]" /></colgroup>
            <thead className="text-sub max-xl:sr-only"><tr>{[t.status, t.tool, t.keyName, t.contact, t.time].map(label => <th scope="col" key={label} className="bg-panel px-3 py-3 font-medium first:rounded-tl-2xl last:rounded-tr-2xl">{label}</th>)}</tr></thead>
            <tbody className="max-xl:block">{filteredCalls.map(call => <tr key={call.id} className={row}>
              <td className={cell}>{mobileLabel(t.status)}<Badge subdued={call.status === "pending"} danger={call.status !== "ok" && call.status !== "pending"}>{call.status === "error" ? t.callError : t[call.status]}</Badge></td>
              <th scope="row" className={`${cell} max-xl:col-span-2 font-normal`}>{mobileLabel(t.tool)}<span className="whitespace-nowrap font-mono">{call.tool}</span>{call.error && <p title={call.error} className="mt-1 line-clamp-2 text-xs text-danger">{call.error}</p>}</th>
              <td className={cell}>{mobileLabel(t.keyName)}{call.user_id ? t.signedInUser : call.api_key_id === null ? t.deletedKey : keys.data?.find(key => key.id === call.api_key_id)?.name ?? t.unknownKey}</td>
              <td className={`${cell} text-sub`}>{mobileLabel(t.contact)}{call.contact_phone ?? "—"}</td>
              <td className={`${cell} text-sub`}>{mobileLabel(t.time)}{date(call.created_at)}</td>
            </tr>)}</tbody>
          </table></div>}
        </>}
      </section>
    </div>
    {confirmation && <ConfirmDialog title={confirmation.action === "revoke" ? t.confirmRevoke(confirmation.name) : t.confirmDelete(confirmation.name)} description={confirmation.action === "revoke" ? t.revokeDescription : t.deleteDescription} confirmLabel={confirmation.action === "revoke" ? t.revoke : t.delete} pending={revoke.isPending || remove.isPending} error={(confirmation.action === "revoke" ? revoke.error : remove.error)?.message} onCancel={() => setConfirmation(null)} onConfirm={() => {
      const mutation = confirmation.action === "revoke" ? revoke : remove;
      mutation.mutate(confirmation.id, { onSuccess: () => { setStatus(confirmation.action === "revoke" ? t.revokeSuccess : t.deleteSuccess); setConfirmation(null); } });
    }} />}
    {dialog && <Modal title={dialog === "useCases" ? t.chooseUseCase : dialog === "form" ? t.configure : t.keyReady} onClose={() => setDialog(null)}>
      <p className="text-xs text-sub">{dialog === "useCases" ? "1 / 3" : dialog === "form" ? "2 / 3" : "3 / 3"}</p>
      {dialog === "useCases" && <><p className="text-sm text-sub">{t.useCaseIntro}</p><ul className="divide-y divide-line rounded-xl border border-line">{useCaseOptions.map(option => <li key={option.value} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><h4 className="text-sm font-medium">{option.label}</h4><p className="mt-1 text-xs text-sub">{option.hint}</p></div><button type="button" className={button} aria-label={`${t.useUseCase}: ${option.label}`} onClick={() => chooseUseCase(option.value)}>{t.useUseCase}</button></li>)}</ul><button type="button" className={button} onClick={() => setDialog(null)}>{t.cancel}</button></>}
      {dialog === "form" && <form className="space-y-5" onSubmit={event => {
        event.preventDefault();
        if (pending || !validNumbers || !name.trim() || !Number.isInteger(messages) || messages < 1 || !Number.isInteger(templates) || templates < 0) return;
        create.reset(); setStatus("");
        create.mutate({ name: name.trim(), scope, allowed_addresses: numberMode === "all" ? null : selectedAddresses, expires_at: expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 86400000).toISOString(), send_limit_per_hour: messages, template_limit_per_hour: templates, requires_approval: scope !== "read" && requiresApproval }, {
          onSuccess: result => { setFullKey(result.key); setDialog("success"); create.reset(); },
        });
      }}>
        <label className="block text-sm text-sub">{t.name}<input required value={name} disabled={pending} onChange={event => setName(event.target.value)} className={field} /></label>
        <fieldset disabled={pending} className="space-y-3"><legend className="mb-2 text-sm font-medium">{t.numbers}</legend>
          <Select aria-label={t.numbers} value={numberMode} onChange={setNumberMode} options={[{ value: "all", label: t.allNumbers }, { value: "selected", label: t.selectedNumbers }]} />
          {numberMode === "selected" && <><div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-line p-3">{connectedNumbers.length ? connectedNumbers.map(number => <label key={number.address} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedAddresses.includes(number.address)} onChange={event => setSelectedAddresses(current => event.target.checked ? [...current, number.address] : current.filter(address => address !== number.address))} className="accent-accent" />{numberLabel(number.address)}</label>) : <p className="text-xs text-sub">{t.noConnectedNumbers}</p>}</div>{!validNumbers && <p className="text-xs text-sub">{t.selectNumbersHint}</p>}</>}
        </fieldset>
        <fieldset disabled={pending} className="space-y-2"><legend className="mb-2 text-sm font-medium">{t.permissions}</legend><p className="text-xs text-sub">{t.includes}</p><div className="grid gap-2 sm:grid-cols-3">{scopes.map(value => <label key={value} className={`cursor-pointer rounded-xl border p-3 ${scope === value ? "border-accent bg-accent/5" : "border-line"}`}><span className="flex items-center gap-2 text-sm font-medium"><input type="radio" aria-label={t[value]} aria-describedby={`${id}-scope-${value}`} name={`${id}-scope`} value={value} checked={scope === value} onChange={() => setScope(value)} className="accent-accent" />{t[value]}</span><span id={`${id}-scope-${value}`} className="mt-2 block text-xs leading-5 text-sub">{t[`${value}Description`]}</span></label>)}</div>
          {scope !== "read" && <label className="flex items-start gap-2 pt-2 text-sm"><input type="checkbox" checked={requiresApproval} onChange={event => setRequiresApproval(event.target.checked)} aria-describedby={`${id}-approval-hint`} className="mt-0.5 accent-accent" /><span><span className="font-medium">{t.requireApproval}</span><span id={`${id}-approval-hint`} className="mt-1 block text-xs leading-5 text-sub">{t.requireApprovalHint}</span></span></label>}
        </fieldset>
        <label className="block text-sm text-sub">{t.expiry}<Select aria-label={t.expiry} className="mt-2" value={expiry} disabled={pending} onChange={setExpiry} options={[{ value: "never", label: t.never }, { value: "30", label: t.days30 }, { value: "90", label: t.days90 }, { value: "365", label: t.year }]} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-sub">{t.messagesPerHour}<input type="number" required min={1} step={1} value={Number.isNaN(messages) ? "" : messages} disabled={pending} onChange={event => setMessages(event.target.valueAsNumber)} className={field} /></label><div><label className="block text-sm text-sub">{t.templatesPerHour}<input type="number" required min={0} step={1} value={Number.isNaN(templates) ? "" : templates} disabled={pending} onChange={event => setTemplates(event.target.valueAsNumber)} className={field} aria-describedby={`${id}-template-hint`} /></label><p id={`${id}-template-hint`} className="mt-2 text-xs text-sub">{t.templateHint}</p></div></div>
        {create.error && <p role="alert" className="text-sm text-danger">{create.error.message}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><button type="button" disabled={pending} className="inline-flex items-center gap-1 text-xs text-sub hover:text-heading" onClick={() => setDialog("useCases")}><ArrowLeft className="size-3" />{t.back}</button><div className="flex gap-2"><button type="button" className={button} onClick={() => setDialog(null)}>{t.cancel}</button><button disabled={pending || !validNumbers} className={primary}>{create.isPending ? t.creating : t.createKey}</button></div></div>
      </form>}
      {dialog === "success" && <><div className="flex items-start gap-3"><Sparkles aria-hidden="true" className="size-5 shrink-0 text-accent" /><p className="text-sm font-medium">{t.keyWarning}</p></div><CopyValue title={t.fullKey} value={fullKey!} />{fromMcp && <div className="space-y-3 border-t border-line pt-5"><h4 className="text-sm font-medium">{t.stepPaste}</h4>{snippet}</div>}<div className="flex justify-end"><button type="button" className={primary} onClick={() => setDialog(null)}>{t.done}</button></div></>}
    </Modal>}
  </>;
}
