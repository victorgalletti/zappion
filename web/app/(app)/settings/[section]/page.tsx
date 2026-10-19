// SPDX-License-Identifier: AGPL-3.0-only
import { notFound } from "next/navigation";
import { parseRoute } from "@/lib/routes";

/** The shell in the layout renders the screen; this only rejects unknown URLs with a real 404. */
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!parseRoute(`/settings/${encodeURIComponent(section)}`)) notFound();
  return null;
}
