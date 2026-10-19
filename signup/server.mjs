#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Serves the Embedded Signup page and proxies everything else to the local
// Supabase, so both live on the one public domain registered with Meta
// (any HTTPS tunnel works for local tests).
//
//   META_APP_ID=... META_CONFIG_ID=... node signup/server.mjs

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, "index.html");

// signup/.env (optional): SUPABASE_URL, META_APP_ID, META_CONFIG_ID. Real env vars win.
const env = Object.fromEntries(
  (existsSync(join(here, ".env")) ? readFileSync(join(here, ".env"), "utf8") : "").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const UPSTREAM = process.env.SUPABASE_URL ?? env.SUPABASE_URL ?? "http://127.0.0.1:54321";

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/" || url.pathname === "/conectar") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const appId = process.env.META_APP_ID ?? env.META_APP_ID ?? "";
    const configId = process.env.META_CONFIG_ID ?? env.META_CONFIG_ID ?? "";
    res.end(readFileSync(page, "utf8").replace("__META_APP_ID__", appId).replace("__META_CONFIG_ID__", configId));
    return;
  }

  // Raw bytes both ways: Meta signs the exact webhook body.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = { ...req.headers };
  delete headers.host;
  try {
    const upstream = await fetch(UPSTREAM + req.url, {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const responseHeaders = Object.fromEntries(upstream.headers);
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
    res.writeHead(upstream.status, responseHeaders);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error(`proxy ${req.method} ${req.url}:`, error.message);
    res.writeHead(502);
    res.end("upstream unavailable");
  }
}).listen(PORT, () => console.log(`signup + proxy at http://127.0.0.1:${PORT} -> ${UPSTREAM}`));
