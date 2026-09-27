import { useEffect, useRef, useState } from "react";

const DEFAULT_DEBOUNCE_MS = 200;

/**
 * Keeps a typed query input synchronized with a route `q` value.
 *
 * Local state updates immediately (responsive typing). Route writes are
 * debounced to avoid navigate races. When the route `q` changes from outside
 * (back/forward, inbound links), the input adopts that value.
 */
export function useRouteQuery(
  routeQ: string | undefined,
  commit: (q: string | undefined) => void,
  debounceMs = DEFAULT_DEBOUNCE_MS,
): [string, (value: string) => void] {
  const routeValue = routeQ ?? "";
  const [text, setText] = useState(routeValue);
  const expectedRouteRef = useRef(routeValue);
  const commitRef = useRef(commit);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  commitRef.current = commit;

  useEffect(() => {
    if (routeValue === expectedRouteRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    expectedRouteRef.current = routeValue;
    setText(routeValue);
  }, [routeValue]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function setQuery(value: string) {
    setText(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      expectedRouteRef.current = value;
      commitRef.current(value || undefined);
    }, debounceMs);
  }

  return [text, setQuery];
}
