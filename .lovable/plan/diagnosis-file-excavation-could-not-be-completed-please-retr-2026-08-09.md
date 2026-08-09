# Diagnosis: "File excavation could not be completed. Please retry."

Read-only analysis of commit `d3ea549`. No files were changed.

## Confirmed evidence (from source)

1. **The message the user sees is emitted by the client, not necessarily by the server.**
   `src/lib/document-excavation.ts:36-39` — on *any* `error` returned by
   `supabase.functions.invoke`, the client throws a fixed string:
   `"File excavation could not be completed. Please retry."`
   The status code and the JSON `{ error: ... }` body from the Edge Function are
   discarded and never read.
   `src/components/record-form.tsx:574-577` then displays `e.message` verbatim.

   Consequence: 401, 403, 413, 429, 429-with-Retry-After, 502, 503, 504, a CORS
   rejection, and a function boot crash all render as the exact same sentence.
   The observed string proves only "invoke returned an error" — it does **not**
   identify the boundary.

2. **The Supabase JS client only populates `error` (a `FunctionsHttpError`) for
   non-2xx responses; the informative body is on `error.context` (a `Response`)**
   and is never awaited here. Every specific server message written in
   `supabase/functions/document-extract/index.ts` (lines 427-486, 497-501,
   525-531, 568-574, 583-608) is therefore invisible to the user.

3. **The Edge Function also collapses its own most likely internal failures.**
   `supabase/functions/document-extract/index.ts:583-608`:
   - `openAiJson` throws bare `Error("upstream" | "output" | "configuration" | "deadline")`
     (lines 217-253) — all four map to one generic 502. HTTP status, OpenAI error
     body, and model name are never logged or surfaced.
   - The final `catch` fallback (lines 604-608) returns **400** with the string
     `"File excavation could not be completed. Please retry."` — coincidentally
     identical to the client's fallback, which makes the two boundaries
     indistinguishable from the UI.
   - There is no `console.error` anywhere in the function, so even Edge Function
     logs will not contain the cause.

4. **PDF normalization is a plausible hard-failure point and is equally masked.**
   `supabase/functions/_shared/document.ts:1` imports
   `npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs` at module top level, and
   line 372 calls `getDocument({ data, disableWorker: true, isEvalSupported: false })`.
   Any pdfjs load/parse throw is swallowed by the bare `catch` at line 373 and
   re-thrown as a generic 422 ("The PDF could not be read"), with the underlying
   reason dropped.

## Most likely failure boundary (ranked hypotheses — not proven)

Ordered by likelihood given the code, all consistent with the single observed message:

- **H1 — OpenAI call fails (502 path).** `MODEL = "gpt-5.6-terra"`
  (index.ts:32) with the `/v1/responses` strict `json_schema` format. If the
  model id is unavailable to the key, or the key is missing/invalid, or the
  25 s per-call timeout (line 29) is exceeded on a multi-chunk PDF,
  `openAiJson` throws `"upstream"`/`"deadline"` → generic 502 → generic client string.
- **H2 — pdfjs fails in the Deno edge runtime.** pdfjs-dist 4.x legacy commonly
  needs DOM shims (`DOMMatrix`, `Path2D`) and standard-font/cmap URLs. A module
  load failure would fail the whole function (non-2xx boot error); a parse
  failure yields the masked 422.
- **H3 — Quota RPC.** Lines 471-479 call
  `consume_conversation_extraction_quota`; any RPC error or an unexpected shape
  returns 503, and `!allowed` returns 429 — both invisible in the UI.
- **H4 — Request-shape/limits.** `contentHash` mismatch, `kindFor` mime/extension
  mismatch, or the 12 MB bounded-body cap (413).
- **H5 — CORS/origin.** `allowedOrigin` (http.ts:10-24) allows only
  `https://the-excavatorium.lovable.app` and localhost; a preview-origin request
  hits the 403 `__denied__` path.

## Explicit limitation

**The exact cause cannot be proven from source alone.** It requires either the
Edge Function invocation logs for the failing request (status code + any runtime
stack) or a reproduction with the original PDF. Because the function never logs
and the client never reads the response body, today neither signal exists — this
observability gap is itself the primary defect.

## Smallest safe repair target (for a later, authorized patch)

Two additive, behaviour-preserving changes; no schema, RLS, RPC, secret, or
deployment change:

1. `src/lib/document-excavation.ts` (~lines 32-39): read
   `error.context` when the invoke error is a `FunctionsHttpError`, parse the
   JSON `{ error }` body, and surface the server message plus HTTP status;
   keep the current sentence only as a last-resort fallback.
2. `supabase/functions/document-extract/index.ts`: add non-sensitive
   `console.error` breadcrumbs at the four masked boundaries — the `openAiJson`
   failure (include upstream HTTP status and a truncated body, never the API
   key), the quota branch, the PDF-normalize catch in
   `supabase/functions/_shared/document.ts:373` (log `error.name`/`message`),
   and the final catch-all — and give the catch-all a distinct string so it can
   no longer be confused with the client fallback.

Nothing else should change until the logs name the boundary.

## Verification after an authorized patch

1. Re-run the same PDF on `/documents/new`; capture the now-specific UI message
   and the HTTP status in the browser network tab.
2. Pull `document-extract` logs for that invocation and confirm exactly one
   breadcrumb identifies the boundary.
3. Cross-check with a tiny known-good `.txt` and a tiny known-good `.pdf` to
   separate H1 (fails for both) from H2 (fails only for PDF).
4. Only then propose the actual fix for the identified boundary.
