export type AuthorizationDetails = {
  client?: { name?: string | null } | null;
  // Pending (not yet consented) authorizations carry the client's registered
  // redirect URI here. Already-consented responses carry redirect_url instead.
  redirect_uri?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

export type OAuthResult = {
  data: AuthorizationDetails | null;
  error: { message: string } | null;
};

export type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};

// Host the owner returns to after approving, derived from the authorization
// details. The pending-consent redirect_uri comes first; redirect_url is only
// the already-consented fallback. Only the host is exposed: redirect targets
// must never leak query strings or fragments that could carry a code. Null
// when absent, relative, or invalid.
export function consentRedirectHost(
  details:
    | Pick<AuthorizationDetails, "redirect_uri" | "redirect_url" | "redirect_to">
    | null
    | undefined,
): string | null {
  const target = details?.redirect_uri ?? details?.redirect_url ?? details?.redirect_to;
  if (!target) return null;
  try {
    const host = new URL(target).host;
    return host || null;
  } catch {
    return null;
  }
}

export type ConsentRedirectNotice = { kind: "return"; host: string } | { kind: "undeclared" };

// Render decision for the redirect line: show the return host when declared,
// otherwise a visible warning. Never blocks approval by itself.
export function consentRedirectNotice(
  details:
    | Pick<AuthorizationDetails, "redirect_uri" | "redirect_url" | "redirect_to">
    | null
    | undefined,
): ConsentRedirectNotice {
  const host = consentRedirectHost(details);
  return host ? { kind: "return", host } : { kind: "undeclared" };
}

export function safeOAuthConsentError(_cause: unknown): string {
  return "This authorization request could not be completed. Please try again.";
}

export async function performOAuthDecision(
  api: OAuthNamespace,
  authorizationId: string,
  approve: boolean,
): Promise<{ redirect: string | null; error: string | null }> {
  try {
    const result = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (result.error) return { redirect: null, error: safeOAuthConsentError(result.error) };
    const redirect = result.data?.redirect_url ?? result.data?.redirect_to ?? null;
    return redirect
      ? { redirect, error: null }
      : { redirect: null, error: safeOAuthConsentError(null) };
  } catch (cause) {
    return { redirect: null, error: safeOAuthConsentError(cause) };
  }
}
