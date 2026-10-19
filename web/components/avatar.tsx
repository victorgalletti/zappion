// SPDX-License-Identifier: AGPL-3.0-only
import { User } from "lucide-react";
import { cn, initials } from "@/lib/utils";

const PALETTE = ["#00a884", "#53bdeb", "#ff8f6b", "#a685e2", "#f0b330", "#e26a91", "#4fb4a6", "#6b8cff"];

function colorFor(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** WhatsApp has no profile photos over the API: initials on a stable color. */
export function Avatar({ name, seed, size = 49, className }: { name?: string; seed: string; size?: number; className?: string }) {
  const label = name && !/^\+?[\d\s-]+$/.test(name) ? initials(name) : null;
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none", className)}
      style={{ width: size, height: size, background: label ? colorFor(seed) : "#dfe5e7", fontSize: `${size * 0.36 / 16}rem` }}
    >
      {label ?? <User className="text-white" style={{ width: size * 0.6, height: size * 0.6 }} />}
    </div>
  );
}
