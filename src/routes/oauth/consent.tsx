import { createFileRoute } from "@tanstack/react-router";
import { OAuthConsentPage } from "@/components/oauth-consent";

export const Route = createFileRoute("/oauth/consent")({
  // Supabase's OAuth authorization server uses this callback path.
  // Keep the Lovable compatibility route alongside it for existing links.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "",
  }),
  component: OAuthConsent,
});

function OAuthConsent() {
  const { authorization_id: authorizationId } = Route.useSearch();
  return <OAuthConsentPage authorizationId={authorizationId} />;
}
