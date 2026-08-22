import { useCallback, useEffect, useState } from "react";
import { LoginScreen } from "@/components/login-screen";
import {
  performOAuthDecision,
  safeOAuthConsentError,
  type AuthorizationDetails,
  type OAuthNamespace,
} from "@/lib/oauth-consent";
import { supabase } from "@/lib/supabase";

function oauthApi(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export function OAuthConsentPage({ authorizationId }: { authorizationId: string }) {
  const [checkedSession, setCheckedSession] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionRetry, setSessionRetry] = useState(0);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSignedIn(Boolean(data.session));
        setCheckedSession(true);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(safeOAuthConsentError(cause));
        setCheckedSession(true);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      if (session) setError(null);
      setCheckedSession(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [sessionRetry]);

  useEffect(() => {
    if (!signedIn || !authorizationId) return;
    let active = true;
    oauthApi()
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error: detailsError }) => {
        if (!active) return;
        if (detailsError) {
          setError(safeOAuthConsentError(detailsError));
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
        if (active) setError(safeOAuthConsentError(cause));
      });
    return () => {
      active = false;
    };
  }, [signedIn, authorizationId]);

  const decide = useCallback(
    async (approve: boolean) => {
      setBusy(true);
      setError(null);
      let navigating = false;
      try {
        const decision = await performOAuthDecision(oauthApi(), authorizationId, approve);
        if (!decision.redirect) {
          setError(decision.error);
          return;
        }
        navigating = true;
        window.location.href = decision.redirect;
      } finally {
        if (!navigating) setBusy(false);
      }
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

  if (!signedIn && error) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <button
          type="button"
          className="mt-4 rounded-md border px-4 py-2 text-sm font-medium"
          onClick={() => {
            setCheckedSession(false);
            setError(null);
            setSessionRetry((value) => value + 1);
          }}
        >
          Retry session check
        </button>
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
