// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useMetaApp } from "@/hooks/use-meta-app";
import { useT } from "@/lib/i18n";
import { Modal } from "./ui/settings-primitives";
import { Eye, EyeOff, Plus } from "lucide-react";
import { useId, useState } from "react";
import { emptyManualConnectFields, manualConnect, validateManualConnect, type ManualConnectFields } from "@/lib/manual-connect";

const field = "mt-2 w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60";
const button = "rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50";

export function ConnectNumber({ organizationId, onConnected, onEmbeddedSignup }: {
  organizationId: string; onConnected: () => Promise<void>; onEmbeddedSignup: () => void;
}) {
  const t = useT();
  const optionsId = useId();
  const [method, setMethod] = useState<"choose" | "manual" | null>(null);
  const metaApp = useMetaApp(organizationId, method === "manual");
  const hasSystemToken = metaApp.data?.has_system_token === true;
  const [fields, setFields] = useState<ManualConnectFields>({ ...emptyManualConnectFields });
  const [showToken, setShowToken] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  function close() {
    setMethod(null); setFields({ ...emptyManualConnectFields }); setShowToken(false); setError("");
  }
  function update<K extends keyof ManualConnectFields>(key: K, value: ManualConnectFields[K]) {
    setFields((previous) => ({ ...previous, [key]: value })); setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const validation = validateManualConnect(fields, hasSystemToken);
    if (validation) { setError(validation); return; }
    setPending(true); setError(""); setSuccess(false);
    const payload = { ...fields };
    // Never retain submitted secrets in rendered fields or React Query's cache.
    setFields((previous) => ({ ...previous, access_token: "", pin: "", verify_token: "" })); setShowToken(false);
    try {
      await manualConnect(organizationId, payload, hasSystemToken);
      close(); setSuccess(true);
      await onConnected();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.connectNumber.couldNotConnectTheNumber);
    } finally { setPending(false); }
  }
  const input = (key: Exclude<keyof ManualConnectFields, "register" | "access_token">, title: string, hint: string, options: { type?: string; required?: boolean; maxLength?: number; inputMode?: "numeric" } = {}) => <label className="block text-sm text-sub">{title}<input aria-label={title} aria-describedby={`manual-${key}-hint`} autoComplete={options.type === "password" ? "off" : undefined} className={field} value={fields[key]} disabled={pending} onChange={(event) => update(key, event.target.value)} {...options} /><span id={`manual-${key}-hint`} className="mt-1 block text-xs leading-5">{hint}</span></label>;
  return <section className="min-w-0">
    <button type="button" className={`${button} inline-flex items-center justify-center gap-2 border-transparent bg-accent text-white hover:bg-accent hover:brightness-110`} disabled={pending} aria-expanded={method !== null} aria-controls={method ? optionsId : undefined} onClick={() => { setMethod("choose"); setSuccess(false); }}><Plus aria-hidden="true" className="size-4" />{t.connectNumber.connectNumber}</button>
    {success && <p role="status" className="text-sm text-accent">{t.connectNumber.numberConnected}</p>}
    {method && <Modal title={method === "choose" ? t.connectNumber.howWouldYouLikeToConnectTheNumber : t.connectNumber.manualCredentials} onClose={() => { if (!pending) close(); }}><div id={optionsId} className="space-y-4">
      {method === "choose" ? <>
        <div className="space-y-2 rounded-xl bg-panel p-4"><h4 className="text-sm font-semibold">{t.connectNumber.embeddedSignupRecommended}</h4><p className="text-sm text-sub">{t.connectNumber.newNumberConnectANumberToUseWithThe}</p><p className="text-sm text-sub">{t.connectNumber.coexistenceConnectANumberAlreadyUsedInTheWhatsApp}</p><a className={`${button} inline-block`} href={process.env.NEXT_PUBLIC_SIGNUP_URL || "http://localhost:8787/conectar"} target="_blank" rel="noopener noreferrer" onClick={onEmbeddedSignup}>{t.connectNumber.openConnectionPage}</a><p className="text-xs text-sub">{t.connectNumber.theListWillRefreshWhenYouReturnFromThe}</p></div>
        <div className="space-y-2 rounded-xl bg-panel p-4"><h4 className="text-sm font-semibold">{t.connectNumber.manualCredentials}</h4><p className="text-sm text-sub">{t.connectNumber.forANumberCreatedDirectlyInMetaSWhatsApp}</p><button type="button" className={button} onClick={() => setMethod("manual")}>{t.connectNumber.useCredentials}</button></div>
      </> : <form noValidate onSubmit={submit} className="space-y-4">
        {input("label", t.connectNumber.instanceNameOptional, t.connectNumber.chooseANameToIdentifyTheNumberInThis, { maxLength: 100 })}
        <div className="grid gap-4 sm:grid-cols-2">
          {input("phone_number_id", t.connectNumber.phoneNumberId, t.connectNumber.whatsAppManagerPhoneNumbersSelectTheNumberAndCopy, { required: true, inputMode: "numeric" })}
          {input("waba_id", t.connectNumber.wabaId, t.connectNumber.businessManagerBusinessSettingsAccountsWhatsAppAccountsCopyThe, { required: true, inputMode: "numeric" })}
        </div>
        <label className="block text-sm text-sub" htmlFor="manual-access-token">{t.connectNumber.permanentAccessToken}</label>
        <div className="flex items-center gap-2"><input id="manual-access-token" type={showToken ? "text" : "password"} autoComplete="off" required={!hasSystemToken} disabled={pending} value={fields.access_token} onChange={(event) => update("access_token", event.target.value)} className={`${field} mt-0`} /><button type="button" disabled={pending} aria-label={showToken ? t.connectNumber.hideToken : t.connectNumber.showToken} aria-pressed={showToken} className={button} onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div>
        <p className="text-xs leading-5 text-sub">{hasSystemToken ? t.metaApp.tokenHint : t.connectNumber.businessManagerUsersSystemUsersGenerateAPermanentToken}</p>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={fields.register} disabled={pending} onChange={(event) => { update("register", event.target.checked); update("pin", ""); }} className="size-4 accent-accent" />{t.connectNumber.registerTheNumberWithTheCloudAPI}</label>
        <p className="text-xs text-sub">{t.connectNumber.selectThisForNewNumbersThatStillNeedTo}</p>
        {fields.register && input("pin", t.connectNumber.twoStepVerificationPIN, t.connectNumber.whatsAppManagerPhoneNumbersTwoStepVerificationUseThe, { type: "password", required: true, maxLength: 6, inputMode: "numeric" })}
        <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-medium">{t.connectNumber.advancedFieldsOptional}</summary><div className="mt-4 space-y-4">
          <p className="text-xs text-sub">{t.connectNumber.fillTheseInOnlyToOverrideTheDefaultWebhook}</p>
          {input("callback_url", t.connectNumber.callbackURL, t.connectNumber.metaAppSettingsWhatsAppConfigurationWebhookYourReceiverS, { type: "url" })}
          {input("verify_token", t.connectNumber.verifyToken, t.connectNumber.useTheVerificationTokenConfiguredInYourReceiverAnd, { type: "password" })}
        </div></details>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={pending} className={`${button} bg-accent text-white hover:brightness-110`}>{pending ? t.connectNumber.connecting : t.connectNumber.connectWithCredentials}</button><button type="button" disabled={pending} className={button} onClick={() => { setFields({ ...emptyManualConnectFields }); setShowToken(false); setError(""); setMethod("choose"); }}>{t.connectNumber.backToConnectionMethods}</button></div>
      </form>}
      <div className="flex justify-end border-t border-line pt-4"><button type="button" disabled={pending} className={button} onClick={close}>{t.connectNumber.cancel}</button></div>
    </div></Modal>}
  </section>;
}
