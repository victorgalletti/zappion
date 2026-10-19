// SPDX-License-Identifier: AGPL-3.0-only
import { functionsBaseUrl } from "./urls.ts";

/** Keep the signed storage path/token, using the same public origin as MCP. */
export function storagePublicUrl(signedUrl: string): string {
  const url = new URL(signedUrl);
  const publicUrl = new URL(functionsBaseUrl());
  url.protocol = publicUrl.protocol;
  url.host = publicUrl.host;
  url.port = publicUrl.port;
  return url.toString();
}
