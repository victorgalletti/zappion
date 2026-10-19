// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";

import { useState } from "react";
import { useMediaUrl } from "@/hooks/use-chat";
import { Avatar } from "./avatar";

export function MemberAvatar({ name, path, id, size = 40 }: { name: string; path?: string | null; id: string; size?: number }) {
  const t = useT();
  const photo = useMediaUrl(path ?? null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return photo.data && photo.data !== failedUrl
    ? <img src={photo.data} alt={t.memberAvatar.photoOf(name)} width={size} height={size} style={{ width: size, height: size }} onError={() => setFailedUrl(photo.data!)} className="shrink-0 rounded-full object-cover" />
    : <Avatar name={name} seed={id} size={size} />;
}
