// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// The public MCP routes are project-owned because they enforce request-size and
// verified-client boundaries around the SDK handlers. Keep the plugin active
// for Lovable manifest discovery, but isolate its generated route templates
// outside TanStack's src/routes tree so it cannot overwrite those boundaries.
// @lovable.dev/mcp-js 0.26.1 also rejects Vite's slash-normalized root on
// Windows, where the committed project-owned routes are used directly.
const mcpVitePlugins =
  process.platform === "win32" ? [] : [mcpPlugin({ routesDir: ".lovable/mcp-generated-routes" })];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: mcpVitePlugins,
  },
});
