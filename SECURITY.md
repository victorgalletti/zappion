# Security policy

Zappion handles WhatsApp conversations and Meta access tokens, so security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub:
[Security › Report a vulnerability](https://github.com/victorgalletti/zappion/security/advisories/new).
If you cannot use GitHub, email contact@zappion.dev with "Security" in the subject.

Include what is affected, how to reproduce it, and the impact you expect. You will get an answer within
7 days. Once a fix is released, the advisory is published with credit to you, unless you prefer
otherwise.

## Supported versions

Only the latest version on `main` receives security fixes. If you self-host, keep your installation up
to date (`scripts/setup-cloud.sh` can be run again after pulling).

## Scope

In scope: the code in this repository (`api/`, `web/`, `windows/`, `signup/`, `scripts/`), including
access control between organizations, API keys and the MCP.

Out of scope: vulnerabilities in Supabase, Meta's WhatsApp Business Platform or other third-party
services (report them to those vendors), and issues that need an already-compromised server or admin
account.
