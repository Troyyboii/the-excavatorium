// Project-owned route: preserves the REST request boundary around the SDK handler.
// route: /.mcp/invoke-tool/$tool
// emitted to: src/routes/[.mcp]/invoke-tool/$tool.ts

import { createFileRoute } from "@tanstack/react-router";

import { createTanStackInvokeToolHandler } from "@lovable.dev/mcp-js/stacks/tanstack";

import mcp from "../../../lib/mcp/index";
import { authorizeMcpClientRequest, limitMcpRequestBody } from "../../../lib/mcp/security";

const invokeToolHandler = createTanStackInvokeToolHandler(mcp, {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
});

export const Route = createFileRoute("/.mcp/invoke-tool/$tool")({
  server: {
    handlers: {
      // ANY: TanStack returns SPA HTML for methods not in `handlers`; the SDK 405s instead.
      ANY: async ({ request, params }) => {
        const limited = await limitMcpRequestBody(request, "json");
        if ("response" in limited) return limited.response;
        const denied = await authorizeMcpClientRequest(limited.request, "json");
        return denied ?? invokeToolHandler({ request: limited.request, params });
      },
    },
  },
});
