import { useCallback, useEffect, useState } from "react";
import { LoginScreen } from "@/components/login-screen";
import { supabase } from "@/lib/supabase";

type AuthorizationDetails = {
  client?: { name?: string | null } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type OAuthResult = { data: AuthorizationDetails | null; error: { message: string } | null };

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};

function oauthApi(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export function OAuthConsentPage({ authorizationId }: { authorizationId: string }) {
  const [checkedSession, setCheckedSession] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(Boolean(data.session));
      setCheckedSession(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      setCheckedSession(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!signedIn || !authorizationId) return;
    let active = true;
    oauthApi()
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error: detailsError }) => {
        if (!active) return;
        if (detailsError) {
          setError(detailsError.message);
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [signedIn, authorizationId]);

  const decide = useCallback(
    async (approve: boolean) => {
      setBusy(true);
      setError(null);
      const api = oauthApi();
      const { data, error: decisionError } = approve
        ? await api.approveAuthorization(authorizationId)
        : await api.denyAuthorization(authorizationId);
      if (decisionError) {
        setBusy(false);
        setError(decisionError.message);
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        setError("No redirect was returned by the authorization server.");
        return;
      }
      window.location.href = target;
    },
    [authorizationId],
  );

  if (!authorizationId) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-lg font-semibold">Invalid authorization request</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This link is missing an authorization identifier.
        </p>
      </main>
    );
  }

  if (!checkedSession) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </main>
    );
  }

  if (!signedIn) return <LoginScreen />;

  const clientName = details?.client?.name ?? "an application";

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-lg font-semibold">Connect {clientName} to The Excavatorium</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This lets {clientName} read your archive through the app&apos;s agent tools, acting as you.
        You can revoke access at any time from your account.
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          disabled={busy || !details}
          onClick={() => void decide(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </main>
  );
}
