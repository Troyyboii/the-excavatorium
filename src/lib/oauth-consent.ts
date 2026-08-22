export type AuthorizationDetails = {
  client?: { name?: string | null } | null;
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
