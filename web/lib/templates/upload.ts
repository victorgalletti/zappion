// SPDX-License-Identifier: AGPL-3.0-only
import { getT } from "@/lib/i18n";
import { FUNCTIONS_URL, supabase } from "@/lib/supabase";
import type { HeaderFormat } from "./types";

export function validateTemplateMedia(file: File, format: HeaderFormat): string | null {
  const rules: Record<string, { types: string[]; mb: number }> = {
    IMAGE: { types: ["image/jpeg", "image/jpg", "image/png"], mb: 5 },
    VIDEO: { types: ["video/mp4"], mb: 16 },
    DOCUMENT: { types: ["application/pdf"], mb: 100 },
  };
  const rule = rules[format];
  if (!rule || !rule.types.includes(file.type)) return getT().templatesUpload.selectJpgPngForAnImageMp4For;
  if (!file.size || file.size > rule.mb * 1024 * 1024) return getT().templatesUpload.theFileMustBeMbOrSmallerAnd(rule.mb);
  return null;
}
/** Ready for the missing backend route. Tokens for Meta must stay on the server. */
export async function uploadTemplateMedia(file: File, format: HeaderFormat, organizationId: string, organizationAddress: string): Promise<string> {
  const invalid = validateTemplateMedia(file, format);
  if (invalid) throw new Error(invalid);
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error(getT().templatesUpload.signInAgainToUploadMedia);
  const body = new FormData();
  body.set("organization_id", organizationId); body.set("organization_address", organizationAddress); body.set("format", format); body.set("file", file);
  const response = await fetch(`${FUNCTIONS_URL}/whatsapp-management/template-media?organization_id=${encodeURIComponent(organizationId)}`, { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` }, body });
  const result = await response.json().catch(() => ({})) as { header_handle?: string; message?: string };
  if (response.status === 404 || response.status === 405) throw new Error(getT().templatesUpload.sampleUploadIsUnavailableOnTheServerWhatsapp);
  if (!response.ok || !result.header_handle?.trim()) throw new Error(result.message ?? getT().templatesUpload.couldNotGetTheHeaderHandleFromMeta);
  return result.header_handle;
}
