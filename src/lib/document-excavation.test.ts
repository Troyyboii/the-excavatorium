import { describe, expect, test } from "bun:test";
import {
  GENERIC_TIMEOUT_MESSAGE,
  sanitizedFunctionErrorDiagnostic,
  sanitizedFunctionErrorMessage,
} from "./document-excavation";

describe("document excavation function errors", () => {
  test("surfaces a sanitized function response", async () => {
    const context = new Response(JSON.stringify({ error: "The document is invalid." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

    expect(await sanitizedFunctionErrorMessage({ context })).toBe("The document is invalid.");
  });

  test("classifies an unparseable gateway 504 as a timeout", async () => {
    const context = new Response("Gateway Timeout", {
      status: 504,
      headers: { "Content-Type": "text/plain" },
    });

    expect(await sanitizedFunctionErrorMessage({ context })).toBe(GENERIC_TIMEOUT_MESSAGE);
  });

  test("leaves an unparseable non-timeout response at relay level", async () => {
    const context = new Response("Bad Gateway", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });

    expect(await sanitizedFunctionErrorMessage({ context })).toBeNull();
  });

  test("accepts only safe diagnostics from a function response", async () => {
    const context = new Response(
      JSON.stringify({
        error: "Excavation service is temporarily unavailable. Please retry.",
        diagnostic: "authentication_unavailable",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );

    expect(await sanitizedFunctionErrorDiagnostic({ context })).toBe("authentication_unavailable");
    expect(
      await sanitizedFunctionErrorDiagnostic({
        context: new Response(JSON.stringify({ error: "private", diagnostic: "private_detail" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      }),
    ).toBeNull();
  });
});
