// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { useEffect, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import type { Workspace } from "@/hooks/use-session";
import { useSettingsAction } from "@/hooks/use-settings";
import { supabase } from "@/lib/supabase";
import { MemberAvatar } from "./member-avatar";

const button = "rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50";
const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function ProfileSettings({ workspace }: { workspace: Workspace }) {
  const t = useT();
  const { agent } = workspace;
  const [name, setName] = useState(agent.name);
  const [validation, setValidation] = useState("");
  const action = useSettingsAction();
  useEffect(() => { setName(agent.name); }, [agent.name]);

  const update = async (patch: { name: string } | { picture: string | null }) => {
    const { error } = await supabase.from("agents").update(patch)
      .eq("id", agent.id).eq("user_id", agent.user_id).eq("organization_id", workspace.organizationId).select("id").single();
    if (error) throw error;
  };
  const updatePhoto = (file: File | null) => {
    if (action.isPending) return;
    setValidation("");
    if (file && (!extensions[file.type] || file.size > 2 * 1024 * 1024)) {
      setValidation(t.profileSettings.chooseAPngJpgOrWebpImageUp); return;
    }
    action.mutate(async () => {
      let picture: string | null = null;
      if (file) {
        picture = `organizations/${workspace.organizationId}/agents/${agent.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
        const { error } = await supabase.storage.from("media").upload(picture, file, { contentType: file.type });
        if (error) throw error;
      }
      await update({ picture });
    });
  };

  return <>
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line p-5">
      <MemberAvatar name={agent.name} id={agent.id} path={agent.picture} size={80} />
      <div className="space-y-2"><p className="text-sm font-medium">{t.profileSettings.profilePhoto}</p><p className="text-xs text-sub">{t.profileSettings.pngJpgOrWebpUpTo2Mb}</p>
        <div className="flex flex-wrap gap-2"><label className={`${button} inline-flex cursor-pointer items-center gap-2 ${action.isPending ? "pointer-events-none opacity-50" : ""}`}><Upload className="size-4" />{agent.picture ? t.profileSettings.changePhoto : t.profileSettings.uploadPhoto}<input aria-label={t.profileSettings.uploadProfilePhoto} type="file" accept="image/png,image/jpeg,image/webp" disabled={action.isPending} className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) updatePhoto(file); e.target.value = ""; }} /></label>
          {agent.picture && <button type="button" disabled={action.isPending} onClick={() => updatePhoto(null)} className={`${button} inline-flex items-center gap-2 text-danger`}><Trash2 className="size-4" />{t.profileSettings.removePhoto}</button>}
        </div>
      </div>
    </div>
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (action.isPending || !name.trim() || name.trim() === agent.name) return;
      setValidation("");
      action.mutate(() => update({ name: name.trim() }));
    }}><label className="block text-sm text-sub">{t.profileSettings.yourName}<input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} disabled={action.isPending} className="mt-2 w-full rounded-xl border border-line bg-input px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60" /></label>
      <button disabled={action.isPending || !name.trim() || name.trim() === agent.name} className={`${button} bg-accent text-white hover:brightness-110`}>{action.isPending ? t.profileSettings.saving : t.profileSettings.saveName}</button>
    </form>
    {validation ? <p role="alert" className="text-sm text-danger">{validation}</p> : action.error ? <p role="alert" className="text-sm text-danger">{action.error.message}</p> : action.isSuccess ? <p role="status" className="text-sm text-accent">{t.profileSettings.profileUpdated}</p> : null}
  </>;
}
