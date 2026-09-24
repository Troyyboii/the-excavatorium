import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  Vary: "Origin",
};

export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const origins = new Set(["https://the-excavatorium.lovable.app", "http://localhost:8080"]);
  if (origins.has(origin)) return origin;
  if (!origin.startsWith("https://") || !origin.endsWith(".lovable.app")) return null;
  const preview = Deno.env.get("LOVABLE_PREVIEW_ORIGIN");
  if (preview) {
    try {
      const normalized = new URL(preview).origin;
      if (normalized.startsWith("https://") && normalized.endsWith(".lovable.app"))
        origins.add(normalized);
    } catch {
      // Invalid optional preview configuration must not broaden CORS.
    }
  }
  return origins.has(origin) ? origin : null;
}

export function responseHeaders(origin: string | null): Record<string, string> {
  return origin ? { ...corsHeaders, "Access-Control-Allow-Origin": origin } : corsHeaders;
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  origin: string | null = null,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(origin), ...extraHeaders, "Content-Type": "application/json" },
  });
}

export type AuthenticatedSupabase = { client: SupabaseClient; user: User; authorization: string };

type EnvReader = (name: string) => string | undefined;

/**
 * Resolves the server-side Supabase secret used by the trusted admin client.
 * Prefers the legacy SUPABASE_SERVICE_ROLE_KEY; otherwise reads the default
 * key from the SUPABASE_SECRET_KEYS JSON bundle ({"default":"sb_secret_..."}).
 * Returns null when neither is usable. The value is never logged.
 */
export function resolveSupabaseServiceKey(
  getEnv: EnvReader = (name) => Deno.env.get(name),
): string | null {
  const legacy = getEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  const bundle = getEnv("SUPABASE_SECRET_KEYS")?.trim();
  if (!bundle) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundle);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const preferred = (parsed as Record<string, unknown>).default;
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
  return null;
}

/**
 * Server-only client for trusted runtime producer RPCs. The secret key is
 * read only inside the Edge Function and is never returned to callers.
 */
export function trustedRuntimeSupabase(
  getEnv: EnvReader = (name) => Deno.env.get(name),
): SupabaseClient | null {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = resolveSupabaseServiceKey(getEnv);
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function authenticatedSupabase(
  request: Request,
): Promise<AuthenticatedSupabase | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { client, user: data.user, authorization };
}

export function isQuotaDecision(
  value: unknown,
): value is { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  if (!value || typeof value !== "object") return false;
  const decision = value as Record<string, unknown>;
  return (
    typeof decision.allowed === "boolean" &&
    typeof decision.remaining === "number" &&
    typeof decision.retryAfterSeconds === "number"
  );
}

/**
 * Emits one bounded diagnostic line. Only phase, category, status and timing
 * metadata are ever recorded — never API keys, prompts, file contents, record
 * data, or upstream payloads.
 */
export function logDiagnostic(
  phase: string,
  category: string,
  detail: { status?: number; durationMs?: number } = {},
): void {
  const entry: Record<string, string | number> = { phase, category };
  if (typeof detail.status === "number" && Number.isFinite(detail.status))
    entry.status = detail.status;
  if (typeof detail.durationMs === "number" && Number.isFinite(detail.durationMs))
    entry.durationMs = Math.round(detail.durationMs);
  console.error("document-diagnostic", entry);
}
