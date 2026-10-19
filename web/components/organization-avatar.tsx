// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/lib/i18n";
import { useState } from "react";
import { useMediaUrl } from "@/hooks/use-chat";
import { Avatar } from "./avatar";

export function OrganizationAvatar({ name, path, size = 48 }: { name: string; path?: string | null; size?: number }) {
  const t = useT();
  const logo = useMediaUrl(path ?? null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return logo.data && logo.data !== failedUrl ? <img onError={() => setFailedUrl(logo.data!)} src={logo.data} alt={t.organizationAvatar.logoOf(name)} width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" /> : <Avatar name={name} seed={name} size={size} />;
}
