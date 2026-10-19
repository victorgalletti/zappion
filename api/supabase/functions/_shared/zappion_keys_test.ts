// SPDX-License-Identifier: AGPL-3.0-only
// Run: deno test --allow-env api/supabase/functions/_shared/zappion_keys_test.ts
import {
  assert,
  assertEquals,
  assertFalse,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  isSecretKey,
  publishableKey,
  secretKey,
  secretKeys,
} from "./zappion_keys.ts";

const NAMES = [
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
];

function withEnv(env: Record<string, string>, fn: () => void) {
  const previous = Object.fromEntries(NAMES.map((n) => [n, Deno.env.get(n)]));
  try {
    for (const name of NAMES) Deno.env.delete(name);
    for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
    fn();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("new keys win, with the default entry first", () => {
  withEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({
      other: "sb_secret_other",
      default: "sb_secret_default",
    }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_x" }),
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service",
    SUPABASE_ANON_KEY: "legacy-anon",
  }, () => {
    assertEquals(secretKey(), "sb_secret_default");
    assertEquals(publishableKey(), "sb_publishable_x");
    assertEquals(secretKeys(), [
      "sb_secret_default",
      "sb_secret_other",
      "legacy-service",
    ]);
  });
});

Deno.test("legacy keys are the fallback (local CLI, older projects)", () => {
  withEnv({
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service",
    SUPABASE_ANON_KEY: "legacy-anon",
  }, () => {
    assertEquals(secretKey(), "legacy-service");
    assertEquals(publishableKey(), "legacy-anon");
  });
});

Deno.test("isSecretKey accepts any secret key in either format", () => {
  withEnv({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_default" }),
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service",
  }, () => {
    assert(isSecretKey("sb_secret_default"));
    assert(isSecretKey("legacy-service"));
    assertFalse(isSecretKey("sb_publishable_x"));
    assertFalse(isSecretKey(""));
    assertFalse(isSecretKey(undefined));
  });
});

Deno.test("malformed or missing keys", () => {
  withEnv({ SUPABASE_SECRET_KEYS: "not json" }, () => {
    assertEquals(secretKeys(), []);
    assertFalse(isSecretKey("not json"));
    assertThrows(() => secretKey());
    assertThrows(() => publishableKey());
  });
});
