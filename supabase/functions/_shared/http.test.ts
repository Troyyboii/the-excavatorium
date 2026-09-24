import { resolveSupabaseServiceKey, trustedRuntimeSupabase } from "./http.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const envOf = (values: Record<string, string>) => (name: string) => values[name];

Deno.test("legacy service-role key wins when present", () => {
  assertEquals(
    resolveSupabaseServiceKey(
      envOf({
        SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
        SUPABASE_SECRET_KEYS: '{"default":"sb_secret_bundle"}',
      }),
    ),
    "legacy-key",
  );
});

Deno.test("falls back to the default key in SUPABASE_SECRET_KEYS", () => {
  assertEquals(
    resolveSupabaseServiceKey(envOf({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_bundle"}' })),
    "sb_secret_bundle",
  );
});

Deno.test("malformed or empty bundles resolve to null", () => {
  for (const bundle of [
    "",
    "not json",
    "[]",
    "null",
    '{"other":"x"}',
    '{"default":""}',
    '{"default":1}',
  ]) {
    assertEquals(resolveSupabaseServiceKey(envOf({ SUPABASE_SECRET_KEYS: bundle })), null);
  }
  assertEquals(resolveSupabaseServiceKey(envOf({})), null);
});

Deno.test("trusted client needs both the URL and a usable key", () => {
  assertEquals(trustedRuntimeSupabase(envOf({ SUPABASE_URL: "https://x.supabase.co" })), null);
  assertEquals(trustedRuntimeSupabase(envOf({ SUPABASE_SECRET_KEYS: '{"default":"k"}' })), null);
  const client = trustedRuntimeSupabase(
    envOf({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEYS: '{"default":"k"}' }),
  );
  assertEquals(client !== null, true);
});
