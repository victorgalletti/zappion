// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { useInvitations, useSettingsAction, ROLE_LABELS } from "@/hooks/use-settings";
import { supabase } from "@/lib/supabase";

export function InvitationInbox({ userId }: { userId: string }) {
  const t = useT();
  const invitations = useInvitations(userId);
  const action = useSettingsAction();
  return <main className="h-dvh overflow-y-auto bg-surface text-heading"><div className="mx-auto mt-16 max-w-xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">{t.invitationInbox.welcome}</h1>
    <p className="text-sm text-sub">{t.invitationInbox.noOrganization}</p>
    {invitations.isLoading && <p role="status">{t.invitationInbox.loadingInvitations}</p>}
    {invitations.error && <p role="alert" className="text-sm text-danger">{t.invitationInbox.couldNotLoadInvitations}<button onClick={() => invitations.refetch()} className="underline">{t.home.tryAgain}</button></p>}
    {invitations.data?.length === 0 && <p className="text-sm text-sub">{t.invitationInbox.noPendingInvitationsForYourEmail}</p>}
    {invitations.data?.map((invitation) => <article key={invitation.id} className="space-y-3 rounded-xl border border-line p-4">
      <h2 className="font-semibold">{invitation.organization_name || t.invitationInbox.organization}</h2>
      <p className="text-sm text-sub">{t.invitationInbox.invitationFrom(invitation.invited_by_name || t.invitationInbox.anOwner)} · {ROLE_LABELS[invitation.role]}</p>
      <div className="flex gap-3">{(["accept_invitation", "reject_invitation"] as const).map((rpc) => <button key={rpc} disabled={action.isPending} onClick={() => action.mutate(async () => {
        const { error } = await supabase.rpc(rpc, { invitation_id: invitation.id });
        if (error) throw error;
      })} className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-panel disabled:opacity-50">{rpc === "accept_invitation" ? t.invitationInbox.accept : t.invitationInbox.decline}</button>)}</div>
    </article>)}
    {action.error && <p role="alert" className="text-sm text-danger">{action.error.message}</p>}
    <button onClick={() => supabase.auth.signOut()} className="text-sm text-danger">{t.invitationInbox.signOut}</button>
  </div></main>;
}
