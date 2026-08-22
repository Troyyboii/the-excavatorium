// Project-owned route: preserves the MCP request boundary around the SDK handler.
// route: /mcp
// emitted to: src/routes/mcp.ts

import { createFileRoute } from "@tanstack/react-router";

import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";

import mcp from "../lib/mcp/index";
import { authorizeMcpClientRequest, limitMcpRequestBody } from "../lib/mcp/security";

const mcpHandler = createTanStackMcpHandler(mcp, {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
});

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const limited = await limitMcpRequestBody(request, "jsonrpc");
        if ("response" in limited) return limited.response;
        const denied = await authorizeMcpClientRequest(limited.request, "jsonrpc");
        return denied ?? mcpHandler({ request: limited.request });
      },
    },
  },
});
