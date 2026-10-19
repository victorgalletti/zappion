// Authorization shared by the management functions (whatsapp, instagram,
// whatsapp-web, ...): who may touch an org's connections. The rule, in one
// place: admins manage every account; a member additionally manages a
// USER-SCOPED one — an address whose agent_id names their own agent.
import type { Context } from "@hono/hono";
import { HTTPException } from "jsr:@hono/hono/http-exception";
import type { User } from "@supabase/supabase-js";
import type { createClient } from "./supabase.ts";
import type { ApiKeyRow } from "./types/database_types.ts";
import type { Database } from "./db_types.ts";

type Service = Database["public"]["Enums"]["service"];
type Role = Database["public"]["Enums"]["role"];

/**
 * What the management functions' auth middleware puts on the context. `user`
 * is absent on the API-key path (where a function supports it), and `apiKey`
 * on the JWT path.
 */
export type ManagementEnv = {
  Variables: {
    supabase: ReturnType<typeof createClient>;
    user?: User;
    apiKey?: ApiKeyRow;
    /** The raw bearer token, where a function keeps it around. */
    token?: string;
  };
};

type Middleware = (
  c: Context<ManagementEnv>,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * The organization the request is about: the query string when present
 * (GET/DELETE), the JSON body otherwise. Read through `c.req.json()`, which
 * memoizes the parse, because these gates run on both sides of the handler —
 * `requireScope` re-enters the admin gate after the handler has already read
 * the body, and the underlying stream is only readable once.
 */
async function getOrganizationId(c: Context<ManagementEnv>): Promise<string> {
  const organization_id = c.req.query("organization_id") ??
    (await c.req.json<{ organization_id?: string }>()
      .catch(() => ({} as { organization_id?: string }))).organization_id;

  if (!organization_id) {
    throw new HTTPException(400, { message: "organization_id is required" });
  }

  return organization_id;
}

/**
 * Requires one of the given roles in the organization — the caller's agent
 * row on the JWT path, the key's own role on the API-key path.
 */
export function requireRoles(roles: Role[]): Middleware {
  return async (c, next) => {
    const organization_id = await getOrganizationId(c);
    const user = c.get("user");

    if (user) {
      const { error, data: agent } = await c.get("supabase")
        .from("agents")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .in("role", roles)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !agent) {
        throw new HTTPException(403, {
          message:
            `Not authorized for organization ${organization_id}. Allowed roles: ${
              roles.join(", ")
            }`,
          cause: error,
        });
      }

      await next();
      return;
    }

    const apiKey = c.get("apiKey");

    if (
      !apiKey || organization_id !== apiKey.organization_id ||
      !roles.includes(apiKey.role)
    ) {
      throw new HTTPException(403, {
        message:
          `API key not authorized for organization ${organization_id}. Allowed roles: ${
            roles.join(", ")
          }`,
      });
    }

    await next();
  };
}

/**
 * The caller's own (human) agent in the organization, or null. The caller's
 * client: RLS scopes the read to their own memberships.
 */
export async function getOwnAgentId(
  c: Context<ManagementEnv>,
  organization_id: string,
): Promise<string | null> {
  const user = c.get("user");

  if (!user) return null; // an API key is nobody

  const { data: agent } = await c.get("supabase")
    .from("agents")
    .select("id")
    .eq("user_id", user.id)
    .eq("organization_id", organization_id)
    .is("deleted_at", null)
    .maybeSingle();

  return agent?.id ?? null;
}

/**
 * Authorizes CREATING a connection with an optional agent_id — the argument
 * that makes any service user-scoped. Absent connects the ORG'S account
 * (shared inbox): `adminGate` alone decides. Set connects a PERSONAL one:
 * any member may name their own agent; naming someone else's takes the gate,
 * plus proof the id is a live agent in the org — an address must never carry
 * an agent_id that names nobody.
 */
export async function requireScope(
  c: Context<ManagementEnv>,
  organization_id: string,
  agent_id: string | undefined,
  adminGate: Middleware,
): Promise<void> {
  if (agent_id && agent_id === await getOwnAgentId(c, organization_id)) {
    return;
  }

  await adminGate(c, () => Promise.resolve());

  if (agent_id) {
    const { data: target } = await c.get("supabase")
      .from("agents")
      .select("id")
      .eq("id", agent_id)
      .eq("organization_id", organization_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!target) {
      throw new HTTPException(400, {
        message: `agent ${agent_id} not found in the organization`,
      });
    }
  }
}

/**
 * Whether the address is USER-SCOPED to the caller: its agent_id names their
 * own agent. For handlers whose target address arrives in the body — the
 * read/delete side of the scope rule, wherever the middleware below cannot
 * see it.
 */
export async function ownsAddress(
  c: Context<ManagementEnv>,
  organization_id: string,
  service: Service,
  address: string,
): Promise<boolean> {
  const { data: row } = await c.get("supabase")
    .from("organizations_addresses")
    .select("agent_id")
    .eq("organization_id", organization_id)
    .eq("service", service)
    .eq("address", address)
    .maybeSingle();

  if (!row?.agent_id) return false;

  const own = await getOwnAgentId(c, organization_id);

  return own !== null && own === row.agent_id;
}

/**
 * The same rule as middleware, for routes that carry `:address` and
 * `?organization_id=`: lets a member through when the target address is
 * their own, and falls back to `byRole` otherwise.
 */
export function requireRolesOrOwnAddress(
  service: Service,
  byRole: Middleware,
): Middleware {
  return async (c, next) => {
    const organization_id = c.req.query("organization_id");
    const address = c.req.param("address");

    if (
      organization_id && address &&
      await ownsAddress(c, organization_id, service, address)
    ) {
      await next();
      return;
    }

    await byRole(c, next);
  };
}
