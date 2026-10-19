// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, CircleMinus, KeyRound, Plug, XCircle } from "lucide-react";
import { useMetaApp, useMetaAppActions } from "@/hooks/use-meta-app";
import { useLocale, useT } from "@/lib/i18n";
import { FunctionError } from "@/lib/supabase";
import type { Role } from "@/lib/types";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Badge, CopyValue, Modal, RowMenu } from "./ui/settings-primitives";

const field = "mt-2 w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm text-heading outline-none focus:border-accent disabled:opacity-60";
const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:bg-panel focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} border-transparent bg-accent text-white hover:bg-accent hover:brightness-110`;
const card = "overflow-hidden rounded-2xl border border-line";

export function MetaAppSettings({ organizationId, role }: { organizationId: string; role: Role }) {
  const t = useT().metaApp;
  return role === "admin" || role === "owner" ? <MetaAppConnection key={organizationId} organizationId={organizationId} /> : <p className="text-sm text-sub">{t.adminOnly}</p>;
}

function ResultRow({ title, tone, children }: { title: string; tone: "ok" | "warning" | "error" | "unset"; children: ReactNode }) {
  const Icon = { ok: CheckCircle2, warning: AlertTriangle, error: XCircle, unset: CircleMinus }[tone];
  return <li className="flex items-start gap-3 px-5 py-4"><Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone === "ok" ? "text-accent" : tone === "error" ? "text-danger" : tone === "warning" ? "text-amber-600" : "text-sub"}`} /><div className="grid min-w-0 flex-1 gap-1 text-sm sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-3"><h4 className="font-medium">{title}:</h4><div className="break-words text-sub">{children}</div></div></li>;
}

function MetaAppConnection({ organizationId }: { organizationId: string }) {
  const t = useT().metaApp;
  const { locale } = useLocale();
  const errorMessage = ({ reason, message }: { reason?: string; message: string }) =>
    reason && Object.hasOwn(t.errors, reason) ? t.errors[reason as keyof typeof t.errors] : message;
  const query = useMetaApp(organizationId);
  const { save, disconnect, test, configureWebhook } = useMetaAppActions(organizationId);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [systemToken, setSystemToken] = useState("");
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [testedAt, setTestedAt] = useState<Date | null>(null);
  const [webhookSource, setWebhookSource] = useState<"test" | "configure" | null>(null);
  const app = query.data;
  useEffect(() => { setAppId(app?.app_id ?? ""); }, [app?.app_id]);
  const pending = save.isPending || disconnect.isPending || test.isPending || configureWebhook.isPending;
  const error = save.error || disconnect.error || test.error;
  const base = (process.env.NEXT_PUBLIC_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const clearSecrets = () => { setAppSecret(""); setSystemToken(""); };
  const resetErrors = () => { save.reset(); disconnect.reset(); setStatus(""); };
  const clearChecks = () => { test.reset(); configureWebhook.reset(); setTestedAt(null); setWebhookSource(null); };
  const openEditor = (title: string) => { resetErrors(); setAppId(app?.app_id ?? ""); clearSecrets(); setEditing(title); };
  const closeEditor = () => { if (!pending) { setEditing(null); clearSecrets(); save.reset(); } };
  const webhook = webhookSource === "configure" ? configureWebhook.data : webhookSource === "test" ? test.data?.webhook : undefined;
  const webhookProblem = webhookSource === "configure" && configureWebhook.error || webhook === null || webhook && ("ok" in webhook || !webhook.callback_url || !webhook.active || !webhook.matches || webhook.missing_fields.length > 0);
  const webhookLabel = webhookProblem ? t.problem : webhook ? t.configured : t.notChecked;
  const webhookTone = !test.data?.webhook ? "unset" : "ok" in test.data.webhook ? "error" : !test.data.webhook.callback_url || !test.data.webhook.active || !test.data.webhook.matches || test.data.webhook.missing_fields.length ? "warning" : "ok";

  return <div className="space-y-6 text-heading">
    {query.isPending ? <p role="status">{t.loading}</p> : query.error ? <p role="alert" className="text-sm text-danger">{query.error.message} <button className="underline" onClick={() => void query.refetch()}>{t.retry}</button></p> : <>
      <section className="rounded-2xl border border-line bg-panel/40 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3"><div className="rounded-xl border border-line bg-input p-3"><Plug aria-hidden="true" className="size-5 text-accent" /></div><div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{app ? test.data?.app.ok ? test.data.app.name : t.title : t.emptyTitle}</h3><Badge subdued={!app}>{app ? t.connected : t.notConnected}</Badge></div><p className="max-w-xl text-sm leading-6 text-sub">{app ? <>{t.appId}: <span className="font-mono text-heading">{app.app_id}</span></> : t.emptyDescription}</p></div></div>
          {app ? <div className="flex items-center gap-2"><button disabled={pending} className={primary} onClick={() => { resetErrors(); test.mutate(undefined, { onSuccess: () => { setTestedAt(new Date()); setWebhookSource("test"); } }); }}>{test.isPending ? t.testing : t.test}</button><RowMenu label={t.actions} disabled={pending} items={[{ label: t.disconnect, action: () => { resetErrors(); setConfirming(true); } }]} /></div> : <button className={primary} onClick={() => openEditor(t.setup)}>{t.setup}</button>}
        </div>
        {app && <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4"><Badge danger={!app.has_app_secret}>{t.appSecret}: {app.has_app_secret ? t.set : t.missing}</Badge><Badge subdued={!app.has_system_token}>{t.systemToken}: {app.has_system_token ? t.set : t.notSet}</Badge><Badge subdued={!webhookSource} danger={!!webhookProblem}>{t.webhookResult}: {webhookLabel}</Badge></div>}
      </section>
      <section className="space-y-3"><h3 className="text-xs font-medium uppercase tracking-wide text-sub">{t.connectionMethod}</h3><div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm"><Check aria-hidden="true" className="size-4 text-accent" />{t.ownApp}</span><button disabled className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-sub">{t.bsp}<Badge subdued>{t.comingSoon}</Badge></button></div><p className="text-xs leading-5 text-sub">{t.existing}? <Link href="/settings/instances" className="text-accent hover:underline">{t.instances} →</Link></p></section>
      {app && <>
        <section className={card} aria-label={t.credentials}>
          <div className="flex items-center gap-2 border-b border-line bg-panel/40 px-5 py-4"><KeyRound aria-hidden="true" className="size-4 text-sub" /><h3 className="font-semibold">{t.credentials}</h3></div>
          <dl className="divide-y divide-line">{[{ label: t.appId, value: app.app_id, action: t.edit }, { label: t.appSecret, value: app.has_app_secret ? `•••• ${t.set}` : t.missing, action: app.has_app_secret ? t.replace : t.edit }, { label: t.systemToken, value: app.has_system_token ? `•••• ${t.set}` : t.notSet, action: app.has_system_token ? t.replace : t.edit }].map(row => <div key={row.label} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="min-w-0"><dt className="text-xs text-sub">{row.label}</dt><dd className="mt-1 break-all font-mono text-sm">{row.value}</dd></div><div className="flex flex-wrap gap-3"><button disabled={pending} className="text-sm text-accent hover:underline disabled:opacity-50" aria-label={`${row.action}: ${row.label}`} onClick={() => openEditor(`${row.action}: ${row.label}`)}>{row.action}</button>{row.label === t.systemToken && app.has_system_token && <button disabled={pending} className="text-xs text-danger hover:underline disabled:opacity-50" onClick={() => { resetErrors(); save.mutate({ app_id: app.app_id, system_user_token: "" }, { onSuccess: () => { clearSecrets(); clearChecks(); setStatus(t.saved); } }); }}>{t.removeToken}</button>}</div></div>)}</dl>
        </section>
        <section className={card}>
          <div className="border-b border-line bg-panel/40 px-5 py-4"><h3 className="font-semibold">{t.webhookResult}</h3></div>
          <div className="space-y-4 p-5"><div><h4 className="text-sm font-medium">{t.automatic}</h4><p className="mt-1 text-xs leading-5 text-sub">{t.automaticHint}</p></div>
            <button type="button" disabled={pending || app.callback_url === null || configureWebhook.error instanceof FunctionError && configureWebhook.error.reason === "no_public_url"} className={button} onClick={() => { resetErrors(); configureWebhook.mutate(undefined, { onSettled: () => setWebhookSource("configure") }); }}>{configureWebhook.isPending ? t.configuringWebhook : t.configureWebhook}</button>
            {app.callback_url === null && <p className="text-sm text-sub">{t.errors.no_public_url}</p>}
          {configureWebhook.data && <div role="status" className="space-y-2 text-sm">
            <p className="text-accent">{t.webhookConfigured}</p>
            <p className="break-all text-sub">{configureWebhook.data.callback_url}</p>
            {configureWebhook.data.missing_fields.length > 0 && <p className="text-amber-600">{t.missingWebhookFields} {configureWebhook.data.missing_fields.join(", ")}</p>}
          </div>}
          {configureWebhook.error && <div role="alert" className="text-sm text-danger">
            <p>{errorMessage({ message: configureWebhook.error.message, reason: configureWebhook.error instanceof FunctionError ? configureWebhook.error.reason : undefined })}</p>
            {configureWebhook.error instanceof FunctionError && configureWebhook.error.reason === "webhook_rejected" && <p className="mt-1 text-xs">{configureWebhook.error.message}</p>}
          </div>}
          </div>
          <details className="group border-t border-line"><summary className="cursor-pointer px-5 py-4 text-sm font-medium focus-visible:outline-accent">{t.configureManually}</summary><div className="space-y-4 px-5 pb-5"><p className="text-xs leading-5 text-sub">{t.manualWebhook}</p>
            <div className="space-y-2"><h4 className="text-xs text-sub">{t.callback}</h4><CopyValue title={t.callback} value={app.callback_url ?? `${base}/functions/v1/whatsapp-webhook?app_id=${encodeURIComponent(app.app_id)}`} /></div>
            <div className="space-y-2"><h4 className="text-xs text-sub">{t.verifyToken}</h4><CopyValue key={app.verify_token} title={t.verifyToken} value={app.verify_token} secret showLabel={t.show} hideLabel={t.hide} /></div>
            <div className="space-y-2"><h4 className="text-xs text-sub">{t.fields}</h4><ul className="flex flex-wrap gap-2">{app.webhook_fields.map(name => <li key={name}><Badge subdued><code>{name}</code></Badge></li>)}</ul></div>
          </div></details>
        </section>
        {test.data && <section role="status" className={card}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel/40 px-5 py-4"><h3 className="font-semibold">{t.testResults}</h3>{testedAt && <p className="text-xs text-sub">{t.lastTested} <time dateTime={testedAt.toISOString()}>{testedAt.toLocaleString(locale)}</time></p>}</div><ul className="divide-y divide-line">
          <ResultRow title={t.app} tone={test.data.app.ok ? "ok" : "error"}>{test.data.app.ok ? test.data.app.name : errorMessage(test.data.app)}</ResultRow>
          <ResultRow title={t.token} tone={test.data.token === null ? "unset" : test.data.token.ok ? "ok" : "error"}>{test.data.token === null ? t.notSet : !test.data.token.ok ? errorMessage(test.data.token) : <>{t.ok} · {t.expires}: {test.data.token.expires_at === null ? t.never : new Date(test.data.token.expires_at * 1000).toLocaleString(locale)}{test.data.token.scopes.length > 0 && <> · {test.data.token.scopes.join(", ")}</>}</>}</ResultRow>
          <ResultRow title={t.webhookResult} tone={webhookTone}>
            <p>{test.data.webhook == null ? t.webhookNotConfigured : "ok" in test.data.webhook ? errorMessage(test.data.webhook) : test.data.webhook.callback_url === null ? t.webhookNotConfigured : !test.data.webhook.matches ? <>{t.webhookOtherAddress} {test.data.webhook.callback_url}</> : test.data.webhook.active ? t.configured : t.webhookInactive}</p>
            {test.data.webhook && "ok" in test.data.webhook && test.data.webhook.reason === "webhook_rejected" && <p className="mt-1 text-xs text-danger">{test.data.webhook.message}</p>}
            {test.data.webhook && !("ok" in test.data.webhook) && test.data.webhook.missing_fields.length > 0 && <p className="text-amber-600">{t.missingWebhookFields} {test.data.webhook.missing_fields.join(", ")}</p>}
          </ResultRow>
        </ul></section>}
      </>}
      {editing && <Modal title={editing} onClose={closeEditor}>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault(); if (pending) return;
          resetErrors();
          const input = { app_id: appId.trim(), ...(appSecret.trim() ? { app_secret: appSecret.trim() } : {}), ...(systemToken.trim() ? { system_user_token: systemToken.trim() } : {}) };
          save.mutate(input, { onSuccess: () => { clearSecrets(); clearChecks(); setEditing(null); setStatus(t.saved); } });
        }}>
          <label className="block text-sm text-sub">{t.appId}<input required pattern="[0-9]+" inputMode="numeric" value={appId} disabled={pending} onChange={event => setAppId(event.target.value)} aria-describedby="meta-id-hint" className={field} /></label>
          <p id="meta-id-hint" className="text-xs leading-5 text-sub">{t.appIdHint}</p>
          <label className="block text-sm text-sub">{t.appSecret}<input aria-label={t.appSecret} type="password" autoComplete="off" required={!app?.has_app_secret || appId.trim() !== app.app_id} placeholder={app?.has_app_secret ? t.keepSecret : undefined} value={appSecret} disabled={pending} onChange={event => setAppSecret(event.target.value)} aria-describedby="meta-secret-hint" className={field} /></label>
          <p id="meta-secret-hint" className="text-xs leading-5 text-sub">{t.appSecretHint}</p>
          <label className="block text-sm text-sub">{t.systemToken}<input aria-label={t.systemToken} type="password" autoComplete="off" placeholder={app?.has_system_token ? t.keepSecret : undefined} value={systemToken} disabled={pending} onChange={event => setSystemToken(event.target.value)} aria-describedby="meta-token-hint" className={field} /></label>
          <p id="meta-token-hint" className="text-xs leading-5 text-sub">{t.systemTokenHint}</p>
          <div className="flex justify-end gap-2 border-t border-line pt-4"><button type="button" disabled={pending} className={button} onClick={closeEditor}>{t.cancel}</button><button disabled={pending} className={primary}>{save.isPending ? t.saving : t.save}</button></div>
          {save.error && <p role="alert" className="text-sm text-danger">{errorMessage({ message: save.error.message, reason: save.error instanceof FunctionError ? save.error.reason : undefined })}</p>}
        </form>
      </Modal>}
    </>}
    {confirming && <ConfirmDialog title={t.disconnect} description={t.confirmDisconnect} confirmLabel={t.disconnect} pending={disconnect.isPending} error={disconnect.error ? errorMessage({ message: disconnect.error.message, reason: disconnect.error instanceof FunctionError ? disconnect.error.reason : undefined }) : null} onCancel={() => setConfirming(false)} onConfirm={() => {
      disconnect.mutate(undefined, { onSuccess: () => { clearSecrets(); clearChecks(); setStatus(t.disconnected); setConfirming(false); } });
    }} />}
    {error && !confirming && !(editing && save.error) && <p role="alert" className="text-sm text-danger">{errorMessage({ message: error.message, reason: error instanceof FunctionError ? error.reason : undefined })}</p>}
    {status && <p role="status" className="text-sm text-accent">{status}</p>}
  </div>;
}
