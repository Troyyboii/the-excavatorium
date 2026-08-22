// Project-owned route: preserves client authorization around the SDK catalog handler.
// route: /.mcp/list-tools
// emitted to: src/routes/[.mcp]/list-tools.ts

import { createFileRoute } from "@tanstack/react-router";

import { createTanStackListToolsHandler } from "@lovable.dev/mcp-js/stacks/tanstack";

import mcp from "../../lib/mcp/index";
import { authorizeMcpClientRequest } from "../../lib/mcp/security";

const listToolsHandler = createTanStackListToolsHandler(mcp, {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
});

export const Route = createFileRoute("/.mcp/list-tools")({
  server: {
    handlers: {
      // ANY: TanStack returns SPA HTML for methods not in `handlers`; the SDK 405s instead.
      ANY: async ({ request }) => {
        const denied = await authorizeMcpClientRequest(request, "json");
        return denied ?? listToolsHandler({ request });
      },
    },
  },
});
