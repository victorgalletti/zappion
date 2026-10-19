// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import Image from "next/image";
import { ArrowRight, CheckCheck, CircleAlert, LoaderCircle, MessageCircle } from "lucide-react";

import { safeNext } from "@/lib/routes";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { supabase } from "@/lib/supabase";

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [signUp, setSignUp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const { data, error } = signUp
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      const messages: Record<string, string> = {
        invalid_credentials: t.login.incorrectEmailOrPassword,
        email_not_confirmed: t.login.confirmYourEmailBeforeSigningIn,
        user_already_exists: t.login.anAccountWithThisEmailAlreadyExistsSign,
        weak_password: t.login.chooseAStrongerPasswordWithAtLeast6,
        over_email_send_rate_limit: t.login.waitAFewMinutesBeforeRequestingAnotherEmail,
        over_request_rate_limit: t.login.tooManyAttemptsWaitAFewMinutesAnd,
        email_address_invalid: t.login.enterAValidEmailAddress,
        signup_disabled: t.login.registrationIsDisabledContactYourOrganizationAdministrator,
      };
      setError(messages[error.code ?? ""] ?? t.login.couldNotAccessYourAccountCheckYourDetails);
      return;
    }
    if (signUp && !data.session) { setNotice(t.login.accountCreatedCheckYourEmailToConfirmYour); return; }
    router.replace(safeNext(searchParams.get("next")));
  };

  const field = "mt-2 h-11 w-full rounded-lg border border-line bg-input px-3 text-base text-heading shadow-xs outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

  return (
    <main className="flex min-h-svh items-center justify-center bg-layout p-4 sm:p-8 lg:p-12">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-2xl border border-line bg-surface shadow-sm lg:min-h-[700px] lg:grid-cols-2">
        <aside className="relative hidden flex-col overflow-hidden border-r border-line bg-panel p-12 lg:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-40 size-[600px] rounded-full bg-accent/5 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <Image src="/images/zappion-logo.png" alt="" width={40} height={40} priority className="rounded-xl" />
            <span className="text-xl font-semibold tracking-tight text-heading">{t.login.productName}</span>
          </div>
          <div className="relative my-auto py-12">
            <p className="mb-5 flex items-center gap-2 text-xs font-medium tracking-widest text-sub uppercase">
              <span className="size-1.5 rounded-full bg-accent" />{t.login.openSource}
            </p>
            <h2 className="max-w-sm text-4xl leading-tight font-semibold tracking-tight text-heading xl:text-5xl">{t.login.brandHeadline}</h2>
            <p className="mt-5 max-w-sm text-base leading-relaxed text-sub">{t.login.brandDescription}</p>
            <div className="mt-10 rounded-xl border border-line bg-surface/80 p-5 shadow-sm">
              <div className="mb-5 flex items-center gap-2.5 border-b border-line pb-4">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent"><MessageCircle size={17} aria-hidden="true" /></span>
                <p className="text-sm font-medium text-heading">{t.login.sharedInbox}</p>
              </div>
              <p className="mr-10 rounded-xl rounded-tl-sm border border-line bg-input px-4 py-3 text-sm leading-relaxed text-heading">{t.login.customerMessage}</p>
              <div className="mt-3 ml-10 rounded-xl rounded-tr-sm bg-accent/10 px-4 py-3">
                <p className="text-sm leading-relaxed text-heading">{t.login.teamReply}</p>
                <CheckCheck size={16} aria-hidden="true" className="mt-2 ml-auto text-accent" />
              </div>
            </div>
          </div>
          <p className="relative text-xs leading-relaxed text-sub">{t.login.officialApi}</p>
        </aside>
        <section className="flex min-w-0 flex-col items-center justify-center px-6 py-10 sm:px-12 sm:py-16" aria-labelledby="login-heading">
          <div className="w-full max-w-sm">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <Image src="/images/zappion-logo.png" alt="" width={40} height={40} priority className="rounded-xl" />
              <span className="text-xl font-semibold tracking-tight text-heading">{t.login.productName}</span>
            </div>
            <h1 id="login-heading" className="text-2xl font-semibold tracking-tight text-heading">{signUp ? t.login.createAccount : t.login.welcomeBack}</h1>
            <p className="mt-2 text-sm leading-relaxed text-sub">{signUp ? t.login.createAccountDescription : t.login.signInDescription}</p>
            {/* Future Google OAuth button and "or" divider go here, above the email form. */}
            <form onSubmit={submit} aria-busy={loading} className="mt-8 space-y-5">
              <label className="block text-sm font-medium text-heading">
                {t.login.email}
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
              </label>
              <label className="block text-sm font-medium text-heading">
                {t.login.password}
                <input type="password" required minLength={signUp ? 6 : undefined} autoComplete={signUp ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
              </label>
              {notice && <p role="status" className="rounded-lg border border-accent/25 bg-accent/5 p-3 text-sm leading-relaxed text-heading">{notice}</p>}
              {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm leading-relaxed text-heading"><CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />{error}</p>}
              <button type="submit" disabled={loading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-heading px-4 py-2.5 text-sm font-medium text-surface shadow-xs transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60">
                {loading && <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                {loading ? t.login.pleaseWait : signUp ? t.login.createAccount : t.login.signIn}
                {!loading && <ArrowRight size={16} aria-hidden="true" />}
              </button>
              <div className="border-t border-line pt-5 text-center">
                <button type="button" disabled={loading} onClick={() => { setSignUp(!signUp); setError(null); setNotice(null); }} className="min-h-11 max-w-full rounded-md px-2 py-2 text-sm leading-relaxed text-sub underline-offset-4 transition-colors hover:text-heading hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60">{signUp ? t.login.alreadyHaveAnAccountSignIn : t.login.receivedAnInvitationCreateAccount}</button>
              </div>
            </form>
            <p className="mt-8 text-center text-xs leading-relaxed text-sub lg:hidden">{t.login.officialApi}</p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
