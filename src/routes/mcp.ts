// Project-owned route: preserves the MCP request boundary around the SDK handler.
// route: /mcp
// emitted to: src/routes/mcp.ts

import { createFileRoute } from "@tanstack/react-router";

import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";

import mcp from "../lib/mcp/index";
import {
  decorateOpenAiFileToolCatalogResponse,
  isMcpToolsListRequest,
} from "../lib/mcp/openai-tool-metadata";
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
        if (denied) return denied;
        const isToolsList = await isMcpToolsListRequest(limited.request.clone());
        const response = await mcpHandler({ request: limited.request });
        return isToolsList ? decorateOpenAiFileToolCatalogResponse(response) : response;
      },
    },
  },
});
