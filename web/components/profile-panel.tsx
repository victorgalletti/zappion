// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Check, LogOut, Monitor, Moon, SlidersHorizontal, Sun, UserRound } from "lucide-react";
import { useState } from "react";
import type { ProfileSection } from "@/lib/routes";
import type { Workspace } from "@/hooks/use-session";
import { useT } from "@/lib/i18n";
import { CHAT_BACKGROUNDS, LANGUAGES, usePreferences, type Language } from "@/lib/preferences";
import { signMessageContent } from "@/lib/signature";
import { MessageText } from "./message-text";
import { testNotificationSound } from "@/lib/notification-sound";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "./ui/page-header";
import { ProfileSettings } from "./profile-settings";
import { Select } from "./ui/select";
import { useTheme } from "./providers";

const button = "rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50";
const sections = [
  { id: "profile", icon: UserRound },
  { id: "preferences", icon: SlidersHorizontal },
] as const;

export function ProfilePanel({ workspace, section, onSectionChange }: { workspace: Workspace; section: ProfileSection; onSectionChange: (section: ProfileSection) => void }) {
  const t = useT();
  return <section className="flex min-w-0 flex-1 flex-col bg-surface">
    <PageHeader title={t.profilePanel.myProfile} />
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label={t.profilePanel.myProfileSections} className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 md:w-56 md:flex-col md:border-r md:border-b-0">
        {sections.map(({ id, icon: Icon }) => <button key={id} onClick={() => onSectionChange(id)} aria-current={section === id ? "page" : undefined} className={`flex items-center gap-3 whitespace-nowrap rounded-xl px-4 py-3 text-left text-sm ${section === id ? "bg-panel font-semibold text-heading" : "text-sub hover:bg-panel/60"}`}><Icon className="size-4 shrink-0" />{t.profilePanel[id]}</button>)}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader title={t.profilePanel[section]} />
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-5 md:p-8"><div className="max-w-3xl space-y-6">
          {section === "profile" && <ProfileSettings workspace={workspace} />}
          {section === "preferences" && <Preferences agentName={workspace.agent.name} />}
        </div></div>
      </div>
    </div>
  </section>;
}

function Preferences({ agentName }: { agentName: string }) {
  const { preference, setPreference } = useTheme();
  const { preferences, setPreferences } = usePreferences();
  const t = useT();
  const [notificationHint, setNotificationHint] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const available = typeof Notification !== "undefined";
  const toggleDesktop = async (enabled: boolean) => {
    setNotificationHint(false);
    if (!enabled) { setPreferences({ desktopNotifications: false }); return; }
    if (!available) return;
    setRequesting(true);
    try {
      const permission = await Notification.requestPermission();
      setPreferences({ desktopNotifications: permission === "granted" });
      if (permission !== "granted") setNotificationHint(true);
    } catch {
      setPreferences({ desktopNotifications: false });
      setNotificationHint(true);
    } finally {
      setRequesting(false);
    }
  };
  return <><section className="space-y-4"><h3 id="language-heading" className="text-xs font-semibold text-sub">{t.preferences.language}</h3><Select aria-labelledby="language-heading" value={preferences.language} onChange={(value) => setPreferences({ language: value as Language })} options={LANGUAGES.map(({ id, label }) => ({ value: id, label }))} /></section>
    <section className="space-y-4"><h3 className="text-xs font-semibold text-sub">{t.profilePanel.appearance}</h3><fieldset><legend className="mb-3 text-sm font-semibold">{t.profilePanel.theme}</legend><div className="space-y-1 rounded-2xl border border-line p-2">{([{ value: "light", label: t.profilePanel.light, icon: Sun }, { value: "dark", label: t.profilePanel.dark, icon: Moon }, { value: "system", label: t.profilePanel.system, icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <label key={value} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 hover:bg-panel"><Icon className="size-5 text-icon" /><span className="flex-1 text-sm">{label}</span><input type="radio" name="theme" checked={preference === value} onChange={() => setPreference(value)} className="size-4 accent-accent" /></label>)}</div></fieldset>
    <fieldset><legend className="mb-3 text-sm font-semibold">{t.profilePanel.fontSize}</legend><div className="flex gap-1 rounded-xl border border-line p-1">{([{ value: "small", label: t.profilePanel.small }, { value: "default", label: t.profilePanel.default }, { value: "large", label: t.profilePanel.large }] as const).map(({ value, label }) => <label key={value} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm ${preferences.fontSize === value ? "bg-panel font-semibold" : "hover:bg-panel/60"}`}><input type="radio" name="fontSize" checked={preferences.fontSize === value} onChange={() => setPreferences({ fontSize: value })} className="size-4 accent-accent" />{label}</label>)}</div><p className="mt-2 text-sm text-sub">{t.profilePanel.thisIsHowYourMessagesLookAtThis}</p></fieldset>
    <fieldset role="radiogroup"><legend className="mb-3 text-sm font-semibold">{t.profilePanel.chatBackground}</legend><div className="flex flex-wrap gap-3">{CHAT_BACKGROUNDS.map(({ id, label }) => <label key={id} className="cursor-pointer" title={label}><input type="radio" name="chatBackground" aria-label={label} checked={preferences.chatBackground === id} onChange={() => setPreferences({ chatBackground: id })} className="peer sr-only" /><span style={{ background: `var(--wa-chat-${id})` }} className="flex size-10 items-center justify-center rounded-full border border-icon/30 text-heading peer-checked:ring-2 peer-checked:ring-accent peer-checked:ring-offset-2 peer-checked:ring-offset-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent">{preferences.chatBackground === id && <Check aria-hidden="true" className="size-5" />}</span></label>)}</div></fieldset>
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">{t.profilePanel.showBackgroundDoodles}<input type="checkbox" role="switch" checked={preferences.chatWallpaper} onChange={(e) => setPreferences({ chatWallpaper: e.target.checked })} className="relative h-6 w-11 shrink-0 appearance-none rounded-full bg-icon/30 transition-colors before:absolute before:top-1 before:left-1 before:size-4 before:rounded-full before:bg-white before:transition-transform checked:bg-accent checked:before:translate-x-5" /></label>
    <div aria-label={t.profilePanel.chatBackgroundPreview} className="chat-wallpaper overflow-hidden rounded-2xl border border-line p-4"><div className="relative space-y-3 text-sm text-bubble"><div className="w-fit max-w-[85%] rounded-xl bg-received px-3 py-2 shadow-sm">{t.profilePanel.hiHowCanIHelp}</div><div className="ml-auto w-fit max-w-[85%] rounded-xl bg-sent px-3 py-2 shadow-sm">{t.profilePanel.iDLikeToLearnMorePlease}</div></div></div>
  </section><section className="space-y-4"><h3 className="text-xs font-semibold text-sub">{t.profilePanel.chats}</h3><div className="rounded-2xl border border-line p-4"><label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">{t.profilePanel.pressEnterToSend}<input type="checkbox" role="switch" checked={preferences.enterToSend} onChange={(e) => setPreferences({ enterToSend: e.target.checked })} aria-describedby="enter-to-send-hint" className="relative h-6 w-11 shrink-0 appearance-none rounded-full bg-icon/30 transition-colors before:absolute before:top-1 before:left-1 before:size-4 before:rounded-full before:bg-white before:transition-transform checked:bg-accent checked:before:translate-x-5" /></label><p id="enter-to-send-hint" className="mt-2 text-xs text-sub">{preferences.enterToSend ? t.profilePanel.shiftEnterAddsANewLine : t.profilePanel.enterAddsANewLineCtrlEnterOr}</p></div></section><section className="space-y-4"><h3 className="text-xs font-semibold text-sub">{t.profilePanel.signature}</h3><div className="space-y-4 rounded-2xl border border-line p-4">
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">{t.profilePanel.signMyMessages}<input type="checkbox" role="switch" checked={preferences.signatureEnabled} onChange={(e) => setPreferences({ signatureEnabled: e.target.checked })} className="relative h-6 w-11 shrink-0 appearance-none rounded-full bg-icon/30 transition-colors before:absolute before:top-1 before:left-1 before:size-4 before:rounded-full before:bg-white before:transition-transform checked:bg-accent checked:before:translate-x-5" /></label>
    <label className="block space-y-2 text-sm font-medium"><span>{t.profilePanel.signatureName}</span><input type="text" value={preferences.signatureName} placeholder={agentName} maxLength={40} onChange={(e) => setPreferences({ signatureName: e.target.value })} className="block w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm outline-none focus:border-accent" /></label>
    <div aria-label={t.profilePanel.signaturePreview} className="ml-auto max-w-sm rounded-xl bg-sent px-3 py-2 text-sm"><MessageText text={String(signMessageContent({ type: "text", kind: "text", text: t.profilePanel.hiHowCanIHelp }, preferences, agentName).text)} markdown /></div>
  </div></section><section className="space-y-4"><h3 className="text-xs font-semibold text-sub">{t.profilePanel.notifications}</h3><div className="space-y-4 rounded-2xl border border-line p-4">
    <div className="flex items-center gap-3"><label className="flex flex-1 cursor-pointer items-center justify-between gap-3 text-sm font-medium">{t.profilePanel.playSoundForIncomingMessages}<input type="checkbox" role="switch" checked={preferences.notificationSound} onChange={(e) => setPreferences({ notificationSound: e.target.checked })} className="relative h-6 w-11 shrink-0 appearance-none rounded-full bg-icon/30 transition-colors before:absolute before:top-1 before:left-1 before:size-4 before:rounded-full before:bg-white before:transition-transform checked:bg-accent checked:before:translate-x-5 disabled:cursor-not-allowed disabled:opacity-50" /></label><button type="button" onClick={() => void testNotificationSound()} className={button}>{t.profilePanel.test}</button></div>
    <label className="flex items-center justify-between gap-3 text-sm font-medium">{t.profilePanel.desktopNotifications}<input type="checkbox" role="switch" checked={available && preferences.desktopNotifications} disabled={!available || requesting} onChange={(e) => void toggleDesktop(e.target.checked)} aria-describedby="desktop-notifications-hint" className="relative h-6 w-11 shrink-0 appearance-none rounded-full bg-icon/30 transition-colors before:absolute before:top-1 before:left-1 before:size-4 before:rounded-full before:bg-white before:transition-transform checked:bg-accent checked:before:translate-x-5 disabled:cursor-not-allowed disabled:opacity-50" /></label>
    <p id="desktop-notifications-hint" role="status" className="text-xs text-sub">{!available ? t.profilePanel.thisBrowserDoesNotSupportDesktopNotifications : notificationHint ? t.profilePanel.allowNotificationsInYourBrowserSettingsForThis : t.profilePanel.getNotificationsWhenYouReInAnotherTab}</p>
  </div></section><button onClick={() => supabase.auth.signOut()} className={`${button} flex items-center gap-2 text-danger`}><LogOut className="size-4" />{t.profilePanel.signOut}</button></>;
}
