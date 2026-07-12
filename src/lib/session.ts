// Session hook. Reads the current Supabase session and stays in sync
// with sign-in / sign-out events. Loads once per mount; no per-page
// duplication.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setState(
        data.session
          ? { status: "signed-in", session: data.session }
          : { status: "signed-out" },
      );
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setState(
        session ? { status: "signed-in", session } : { status: "signed-out" },
      );
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return state;
}
