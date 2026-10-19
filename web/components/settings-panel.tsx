// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, useLocale } from "@/lib/i18n";
import { Building2, Users, Smartphone, Upload, Trash2, Plug, Search, RefreshCw, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsSection } from "@/lib/routes";
import type { Workspace } from "@/hooks/use-session";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, useInvitations, useMembers, useSettingsAction } from "@/hooks/use-settings";
import { supabase } from "@/lib/supabase";
import { formatPhone } from "@/lib/messages";
import { instanceName } from "@/lib/instances";
import type { OrganizationAddressRow, Role } from "@/lib/types";
import { OrganizationAvatar } from "./organization-avatar";
import { MemberAvatar } from "./member-avatar";
import { PageHeader } from "./ui/page-header";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Select } from "./ui/select";
import { IntegrationsSettings } from "./integrations-settings";
import { MetaAppSettings } from "./meta-app-settings";
import { Badge, CopyValue, Modal, RowMenu } from "./ui/settings-primitives";
import { ConnectNumber } from "./connect-number";

const field = "mt-2 w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60";
const button = "rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50";
const sections = [
  { id: "organization", icon: Building2 },
  { id: "members", icon: Users },
  { id: "instances", icon: Smartphone },
  { id: "meta-app", icon: Smartphone },
  { id: "integrations", icon: Plug },
] as const;

export function SettingsPanel({ workspace, section, onSectionChange }: { workspace: Workspace; section: SettingsSection; onSectionChange: (section: SettingsSection) => void }) {
  const t = useT();
  return <section className="flex min-w-0 flex-1 flex-col bg-surface">
    <PageHeader title={t.navigationRail.settings} />
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label={t.settingsPanel.settingsSections} className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 md:w-56 md:flex-col md:border-r md:border-b-0">
        {sections.map(({ id, icon: Icon }) => <button key={id} onClick={() => onSectionChange(id)} aria-current={section === id ? "page" : undefined} className={`flex items-center gap-3 whitespace-nowrap rounded-xl px-4 py-3 text-left text-sm ${section === id ? "bg-panel font-semibold text-heading" : "text-sub hover:bg-panel/60"}`}><Icon className="size-4 shrink-0" />{t.settingsPanel[id]}</button>)}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader title={t.settingsPanel[section]} />
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-5 md:p-8"><div className={`min-w-0 space-y-6 ${(section === "integrations" || section === "meta-app" || section === "instances") ? "max-w-5xl" : "max-w-3xl"}`}>
        {workspace.agent.role === "member" && section !== "meta-app" && section !== "integrations" && <p className="rounded-xl bg-panel px-4 py-3 text-sm text-sub">{t.settingsPanel.yourMemberRoleAllowsYouToViewTheseSettings}</p>}
        {section === "meta-app" && <MetaAppSettings key={workspace.organizationId + workspace.agent.role} organizationId={workspace.organizationId} role={workspace.agent.role} />}
        {section === "integrations" && <IntegrationsSettings key={workspace.organizationId + workspace.agent.role} organizationId={workspace.organizationId} role={workspace.agent.role} numbers={workspace.numbers} />}
        {section === "organization" && <OrganizationSettings key={workspace.organizationId} workspace={workspace} />}
        {section === "members" && <MemberSettings workspace={workspace} />}
        {section === "instances" && <InstanceSettings key={workspace.organizationId + workspace.agent.role} workspace={workspace} />}
      </div></div></div>
    </div>
  </section>;
}

function Feedback({ action }: { action: ReturnType<typeof useSettingsAction> }) {
  const t = useT();
  return action.error ? <p role="alert" className="text-sm text-danger">{action.error.message}</p> : action.isSuccess ? <p role="status" className="text-sm text-accent">{t.settingsPanel.changesSaved}</p> : null;
}

function OrganizationSettings({ workspace }: { workspace: Workspace }) {
  const t = useT();
  const [name, setName] = useState(workspace.organizationName);
  const [validation, setValidation] = useState("");
  const action = useSettingsAction();
  const editable = workspace.agent.role !== "member";
  // Refresh the field without remounting the form and its already loaded logo.
  useEffect(() => { setName(workspace.organizationName); }, [workspace.organizationName]);
  const updateLogo = (file: File | null) => {
    if (!editable || action.isPending) return;
    setValidation("");
    const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    if (file && (!extensions[file.type] || file.size > 2 * 1024 * 1024)) {
      setValidation(t.profileSettings.chooseAPngJpgOrWebpImageUp); return;
    }
    action.mutate(async () => {
      let path: string | null = null;
      if (file) {
        path = `organizations/${workspace.organizationId}/logo/${crypto.randomUUID()}.${extensions[file.type]}`;
        const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
        if (error) throw error;
      }
      const { error } = await supabase.from("organizations").update({ extra: { logo: path } }).eq("id", workspace.organizationId).select("id").single();
      if (error) throw error;
    });
  };
  return <>
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line p-5">
      <OrganizationAvatar name={workspace.organizationName} path={workspace.organizationLogo} size={80} />
      <div className="space-y-2"><p className="text-sm font-medium">{t.settingsPanel.organizationLogo}</p><p className="text-xs text-sub">{t.profileSettings.pngJpgOrWebpUpTo2Mb}</p>
        {editable && <div className="flex flex-wrap gap-2"><label className={`${button} inline-flex cursor-pointer items-center gap-2 ${action.isPending ? "pointer-events-none opacity-50" : ""}`}><Upload className="size-4" />{workspace.organizationLogo ? t.settingsPanel.changeLogo : t.settingsPanel.uploadLogo}<input aria-label={t.settingsPanel.uploadOrganizationLogo} type="file" accept="image/png,image/jpeg,image/webp" disabled={action.isPending} className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) updateLogo(file); e.target.value = ""; }} /></label>
          {workspace.organizationLogo && <button disabled={action.isPending} onClick={() => updateLogo(null)} className={`${button} inline-flex items-center gap-2 text-danger`}><Trash2 className="size-4" />{t.settingsPanel.remove}</button>}</div>}
      </div>
    </div>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!editable || action.isPending) return; action.mutate(async () => {
      const { error } = await supabase.from("organizations").update({ name: name.trim() }).eq("id", workspace.organizationId).select("id").single(); if (error) throw error;
    }); }}><label className="block text-sm text-sub">{t.settingsPanel.organizationName}<input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} disabled={!editable || action.isPending} className={field} /></label>
      {editable && <button disabled={action.isPending || !name.trim() || name.trim() === workspace.organizationName} className={`${button} bg-accent text-white hover:brightness-110`}>{action.isPending ? t.profileSettings.saving : t.profileSettings.saveName}</button>}
    </form>
    {validation && <p role="alert" className="text-sm text-danger">{validation}</p>}<Feedback action={action} />
  </>;
}

function MemberSettings({ workspace }: { workspace: Workspace }) {
  const t = useT();
  const { locale } = useLocale();
  const members = useMembers(workspace.organizationId);
  const owner = workspace.agent.role === "owner";
  const invitations = useInvitations(workspace.agent.user_id, workspace.organizationId, owner);
  const action = useSettingsAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const ownerCount = members.data?.filter((member) => member.role === "owner").length ?? 0;
  return <>
    <div className="space-y-2 rounded-2xl bg-panel p-4">{(Object.keys(ROLE_LABELS) as Role[]).map((role) => <p key={role} className="text-sm text-sub"><strong className="text-heading">{ROLE_LABELS[role]}:</strong> {ROLE_DESCRIPTIONS[role]}</p>)}</div>
    {members.isLoading && <p role="status" className="text-sm text-sub">{t.settingsPanel.loadingMembers}</p>}
    {members.error && <p role="alert" className="text-sm text-danger">{t.settingsPanel.couldNotLoadMembers}<button className="underline" onClick={() => members.refetch()}>{t.home.tryAgain}</button></p>}
    <div className="space-y-3">{members.data?.map((member) => {
      const lastOwner = member.role === "owner" && ownerCount <= 1;
      return <article key={member.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-4">
        <MemberAvatar name={member.name} id={member.id} path={member.picture} size={40} />
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{member.name} {member.user_id === workspace.agent.user_id && <span className="text-xs text-sub">{t.settingsPanel.you}</span>}</p><p className="text-xs text-sub">{ROLE_LABELS[member.role]}{lastOwner && t.settingsPanel.onlyOwner}</p></div>
        {owner ? <><Select aria-label={t.settingsPanel.roleFor(member.name)} title={lastOwner ? t.settingsPanel.promoteAnotherOwnerBeforeChangingThisRole : undefined} value={member.role} disabled={action.isPending || lastOwner} onChange={(value) => {
          const role = value as Role;
          action.mutate(async () => { const { error } = await supabase.from("agents").update({ role }).eq("organization_id", workspace.organizationId).eq("id", member.id).select("id").single(); if (error) throw error; });
        }} className="w-auto rounded-lg px-2 py-2" options={(Object.keys(ROLE_LABELS) as Role[]).map((role) => ({ value: role, label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] }))} />
          <button disabled={action.isPending || lastOwner} title={lastOwner ? t.settingsPanel.theOrganizationMustHaveAnOwner : t.settingsPanel.removeMember(member.name)} className={`${button} text-danger`} onClick={() => {
            action.reset(); setRemoving({ id: member.id, name: member.name });
          }}>{t.settingsPanel.remove}</button></> : null}
      </article>;
    })}</div>
    {owner && <section className="space-y-4 border-t border-line pt-6"><h3 className="text-lg font-semibold">{t.settingsPanel.pendingInvitations}</h3>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); action.mutate(async () => {
        const { error } = await supabase.from("invitations").insert({ organization_id: workspace.organizationId, email: email.trim().toLowerCase(), role }); if (error) throw error; setEmail("");
      }); }}><label className="min-w-48 flex-1 text-sm text-sub">{t.login.email}<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></label>
        <label className="text-sm text-sub">{t.settingsPanel.role}<Select aria-label={t.settingsPanel.invitationRole} name="role" value={role} onChange={(value) => setRole(value as Role)} className="mt-2" options={(Object.keys(ROLE_LABELS) as Role[]).map((role) => ({ value: role, label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] }))} /></label>
        <button disabled={action.isPending} className={button}>{t.settingsPanel.createInvitation}</button>
      </form>
      <p className="text-xs text-sub">{t.settingsPanel.afterYouCreateTheInvitationTheRecipientCanCreate}</p>
      {invitations.isLoading && <p role="status" className="text-sm text-sub">{t.settingsPanel.loadingInvitations}</p>}
      {invitations.error && <p role="alert" className="text-sm text-danger">{t.settingsPanel.couldNotLoadInvitations}<button onClick={() => invitations.refetch()} className="underline">{t.home.tryAgain}</button></p>}
      {invitations.data?.length === 0 && <p className="text-sm text-sub">{t.settingsPanel.noPendingInvitations}</p>}
      {invitations.data?.map((invite) => <div key={invite.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4"><div className="min-w-0 flex-1"><p className="break-all text-sm">{invite.email}</p><p className="text-xs text-sub">{ROLE_LABELS[invite.role]} · {new Date(invite.created_at).toLocaleDateString(locale)}</p></div><button className={`${button} text-danger`} disabled={action.isPending} onClick={() => action.mutate(async () => {
        const { error } = await supabase.from("invitations").update({ status: "revoked" }).eq("organization_id", workspace.organizationId).eq("id", invite.id).eq("status", "pending").select("id").single(); if (error) throw error;
      })}>{t.settingsPanel.revoke}</button></div>)}
    </section>}
    {removing && <ConfirmDialog title={t.settingsPanel.removeMember(removing.name)} description={t.settingsPanel.removeFromTheOrganization(removing.name)} confirmLabel={t.settingsPanel.remove} pending={action.isPending} error={action.error?.message} onCancel={() => setRemoving(null)} onConfirm={() => {
      action.mutate(async () => { const { error } = await supabase.from("agents").delete().eq("organization_id", workspace.organizationId).eq("id", removing.id); if (error) throw error; }, { onSuccess: () => setRemoving(null) });
    }} />}
    {!removing && <Feedback action={action} />}
  </>;
}

function InstanceSettings({ workspace }: { workspace: Workspace }) {
  const t = useT();
  const { locale } = useLocale();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const awaitingSignup = useRef(false);
  const refresh = useCallback(async () => {
    setRefreshing(true); setRefreshError("");
    try {
      await client.invalidateQueries({ queryKey: ["workspace"] }, { throwOnError: true });
      await client.invalidateQueries({ queryKey: ["instance-counts", workspace.organizationId] }, { throwOnError: true });
    } catch { setRefreshError(t.settingsPanel.couldNotRefreshInstancesTryAgain); }
    finally { setRefreshing(false); }
  }, [client, workspace.organizationId, t]);
  useEffect(() => {
    const onReturn = () => {
      if (!awaitingSignup.current || document.visibilityState === "hidden") return;
      awaitingSignup.current = false;
      void refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [refresh]);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale);
  const term = normalize(search.trim());
  const phoneTerm = /^[+\d\s().-]+$/.test(term) ? term.replace(/\D/g, "") : "";
  const filtered = workspace.numbers.filter((number) => {
    const values = [instanceName(number), number.extra?.label, number.extra?.verified_name, number.extra?.phone_number, formatPhone(number.extra?.phone_number ?? number.address), number.extra?.waba_id, number.address];
    const matches = values.some((value) => value && (normalize(value).includes(term) || (phoneTerm && value.replace(/\D/g, "").includes(phoneTerm))));
    return (status === "all" || number.status === status) && matches;
  });
  const counts = useQuery({ queryKey: ["instance-counts", workspace.organizationId, workspace.numbers.map((number) => number.address)], queryFn: async () => {
    return Object.fromEntries(await Promise.all(workspace.numbers.map(async (number) => {
      const { count, error } = await supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", workspace.organizationId).eq("service", "whatsapp").eq("organization_address", number.address);
      if (error) throw error;
      return [number.address, count ?? 0];
    })));
  } });
  const editable = workspace.agent.role !== "member";
  const connect = <ConnectNumber organizationId={workspace.organizationId} onConnected={refresh} onEmbeddedSignup={() => { awaitingSignup.current = true; }} />;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-md text-sm leading-6 text-sub">{t.settingsPanel.instancesIntro}</p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={refreshing} aria-busy={refreshing} aria-label={t.settingsPanel.refreshInstances} title={t.settingsPanel.refreshInstances} onClick={() => void refresh()} className="rounded-xl border border-line p-2.5 text-sub hover:bg-panel focus-visible:outline-accent disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? "animate-spin" : ""}`} /></button>
        {editable && connect}
      </div>
    </div>
    {workspace.numbers.length > 0 && <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-[1_1_15rem]"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-sub" /><input aria-label={t.settingsPanel.searchInstances} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.settingsPanel.searchPlaceholder} className="w-full rounded-xl border border-line bg-input py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent" /></div>
      <Select size="compact" aria-label={t.settingsPanel.filterInstancesByStatus} value={status} onChange={setStatus} options={[{ value: "all", label: t.settingsPanel.allStatuses }, ...Array.from(new Set(["connected", "disconnected", ...workspace.numbers.map((number) => number.status)])).map((value) => ({ value, label: value === "connected" ? t.settingsPanel.connected : value === "disconnected" ? t.settingsPanel.disconnected : value }))]} />
      <p className="text-xs text-sub" role="status">{t.settingsPanel.instancesCount(filtered.length, filtered.filter(number => number.status === "connected").length)}</p>
    </div>}
    {refreshError && <p role="alert" className="text-sm text-danger">{refreshError}</p>}
    {workspace.numbers.length === 0 ? <div className="space-y-3 rounded-2xl border border-dashed border-line p-8 text-center"><Smartphone aria-hidden="true" className="mx-auto size-7 text-sub" /><h3 className="text-sm font-semibold">{t.settingsPanel.noInstancesConnected}</h3><p className="text-sm text-sub">{t.settingsPanel.emptyInstancesHint}</p>{editable && connect}</div> : filtered.length === 0 && <p role="status" className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-sub">{t.settingsPanel.noInstancesMatchThisSearchAndStatus}</p>}
    {counts.error && <p role="alert" className="text-sm text-danger">{t.settingsPanel.couldNotLoadChatCounts}</p>}
    {filtered.length > 0 && <div className="rounded-2xl border border-line">{filtered.map((number) => <InstanceCard key={number.address} number={number} editable={editable} count={counts.data?.[number.address]} />)}</div>}
  </>;
}

function InstanceCard({ number, editable, count }: { number: OrganizationAddressRow; editable: boolean; count?: number }) {
  const t = useT();
  const [dialog, setDialog] = useState<"details" | "rename" | null>(null);
  const [label, setLabel] = useState("");
  const [copyStatus, setCopyStatus] = useState<{ message: string; error: boolean } | null>(null);
  const action = useSettingsAction();
  const name = instanceName(number);
  const status = number.status === "connected" ? t.settingsPanel.connected : number.status === "disconnected" ? t.settingsPanel.disconnected : number.status;
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopyStatus({ message: t.integrations.copied, error: false }); }
    catch { setCopyStatus({ message: t.integrations.copyError, error: true }); }
  };
  return <article className="min-w-0 border-b border-line last:border-0">
    <div className="flex items-center gap-2 px-3 py-3 sm:gap-4 sm:px-4">
      <button type="button" aria-label={`${t.settingsPanel.instanceDetails}: ${name}`} onClick={() => setDialog("details")} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-accent">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel text-sm font-semibold text-sub">{Array.from(name)[0]?.toLocaleUpperCase()}</span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-heading">{name}</span><span className="mt-1 block break-all text-xs text-sub">{formatPhone(number.extra?.phone_number ?? number.address)}</span><span className="mt-2 block sm:hidden"><Badge subdued={number.status !== "connected"}>{status}</Badge></span></span>
      </button>
      <span className="hidden shrink-0 sm:block"><Badge subdued={number.status !== "connected"}>{status}</Badge></span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-sub" title={t.profilePanel.chats}><MessageSquare aria-hidden="true" className="size-3.5" /><span>{count ?? "—"}<span className="sr-only"> {t.profilePanel.chats}</span></span></span>
      <RowMenu label={`${t.settingsPanel.instanceActions}: ${name}`} disabled={action.isPending} items={[
        { label: t.settingsPanel.instanceDetails, tone: "neutral", action: () => setDialog("details") },
        { label: t.settingsPanel.renameInstance, tone: "neutral", action: editable ? () => { action.reset(); setLabel(number.extra?.label ?? ""); setDialog("rename"); } : undefined },
        { label: t.settingsPanel.copyPhoneNumberId, tone: "neutral", action: () => void copy(number.address) },
        { label: t.settingsPanel.copyWabaId, tone: "neutral", action: number.extra?.waba_id ? () => void copy(number.extra!.waba_id!) : undefined },
      ]} />
    </div>
    {copyStatus && <p role={copyStatus.error ? "alert" : "status"} className="px-4 pb-3 text-xs text-sub">{copyStatus.message}</p>}
    {!dialog && <div className="px-4"><Feedback action={action} /></div>}
    {dialog === "details" && <Modal title={name} onClose={() => setDialog(null)}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-sub">{formatPhone(number.extra?.phone_number ?? number.address)}</p><Badge subdued={number.status !== "connected"}>{status}</Badge></div>
      <dl className="grid grid-cols-2 gap-4 text-sm"><div className="min-w-0"><dt className="text-xs text-sub">{t.settingsPanel.verifiedName}</dt><dd className="mt-1 break-words">{number.extra?.verified_name || t.settingsPanel.notProvided}</dd></div><div><dt className="text-xs text-sub">{t.profilePanel.chats}</dt><dd className="mt-1">{count ?? "—"}</dd></div></dl>
      <div className="space-y-2"><h4 className="text-xs text-sub">{t.settingsPanel.phoneNumberId}</h4><CopyValue title={t.settingsPanel.phoneNumberId} value={number.address} /></div>
      <div className="space-y-2"><h4 className="text-xs text-sub">{t.settingsPanel.wabaId}</h4>{number.extra?.waba_id ? <CopyValue title={t.settingsPanel.wabaId} value={number.extra.waba_id} /> : <p className="text-sm text-sub">{t.settingsPanel.notProvided}</p>}</div>
    </Modal>}
    {dialog === "rename" && editable && <Modal compact title={t.settingsPanel.renameInstance} onClose={() => { if (!action.isPending) setDialog(null); }}>
      <form className="mx-auto max-w-md space-y-4" onSubmit={event => {
        event.preventDefault();
        if (action.isPending || label.trim() === (number.extra?.label ?? "")) return;
        action.mutate(async () => {
          const { error } = await supabase.rpc("set_address_label", { p_service: "whatsapp", p_address: number.address, p_label: label.trim() }); if (error) throw error;
        }, { onSuccess: () => setDialog(null) });
      }}>
        <label className="block text-sm text-sub">{t.settingsPanel.instanceName}<input maxLength={100} placeholder={number.extra?.verified_name || t.settingsPanel.optionalName} value={label} disabled={action.isPending} onChange={event => setLabel(event.target.value)} className={field} aria-describedby={`rename-hint-${number.address}`} /></label>
        <p id={`rename-hint-${number.address}`} className="text-xs text-sub">{t.settingsPanel.leaveBlankToUseTheVerifiedName}</p>
        {action.error && <p role="alert" className="text-sm text-danger">{action.error.message}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><button type="button" disabled={action.isPending} className={button} onClick={() => setDialog(null)}>{t.confirmDialog.cancel}</button><button disabled={action.isPending || label.trim() === (number.extra?.label ?? "")} className={`${button} border-transparent bg-accent text-white hover:bg-accent hover:brightness-110`}>{action.isPending ? t.profileSettings.saving : t.profileSettings.saveName}</button></div>
      </form>
    </Modal>}
  </article>;
}
