// Supabase client factory for MCP tool handlers.
//
// Import-safe: no env reads at module scope. Every helper resolves
// configuration lazily, inside a tool handler, where the request runtime
// environment is available.

import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

function configuredEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

// Build-time literals from the browser client configuration. These are the
// same public values already embedded in src/lib/supabase.ts.
const BUILD_URL = (import.meta.env["VITE_SUPABASE_URL"] as string | undefined)?.trim();
const BUILD_KEY = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined)?.trim();

const FALLBACK_URL = "https://rmlaknguklxwbbdnywcd.supabase.co";
const FALLBACK_KEY = "sb_publishable_sigueHFNPiD455wrChYrog_SvJQFlIi";

function supabaseProjectUrl(): string {
  return configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]) ?? BUILD_URL ?? FALLBACK_URL;
}

function supabasePublishableKey(): string {
  return (
    configuredEnv([
      "SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
      "VITE_SUPABASE_ANON_KEY",
    ]) ??
    BUILD_KEY ??
    FALLBACK_KEY
  );
}

// Forwards the verified OAuth bearer token so RLS runs as the signed-in user.
// Archive data is private; there is deliberately no anonymous client here.
export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!token) throw new Error("This tool requires an authenticated OAuth session.");
  return createClient(supabaseProjectUrl(), supabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
