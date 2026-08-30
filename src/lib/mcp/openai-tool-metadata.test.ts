import { describe, expect, test } from "bun:test";
import { defineMcp } from "@lovable.dev/mcp-js";
import {
  createTanStackListToolsHandler,
  createTanStackMcpHandler,
} from "@lovable.dev/mcp-js/stacks/tanstack";
import { mcpTools } from "./index";
import {
  decorateOpenAiFileToolCatalog,
  decorateOpenAiFileToolCatalogResponse,
  isMcpToolsListRequest,
} from "./openai-tool-metadata";

const existingTool = { name: "search", description: "Search", inputSchema: { type: "object" } };
const excavationTool = {
  name: "excavate_document",
  description: "Excavate",
  inputSchema: { type: "object" },
  _meta: { "existing/key": "preserved" },
};

describe("OpenAI file-tool catalog metadata", () => {
  test("decorates only excavate_document in REST and manifest catalog shapes", () => {
    const catalog = decorateOpenAiFileToolCatalog({
      server: { name: "the-excavatorium" },
      tools: [existingTool, excavationTool],
    }) as { tools: Array<Record<string, unknown>> };

    expect(catalog.tools[0]).toEqual(existingTool);
    expect(catalog.tools[1]?._meta).toEqual({
      "existing/key": "preserved",
      "openai/fileParams": ["file"],
    });

    const manifest = decorateOpenAiFileToolCatalog({
      version: 1,
      mcp: { tools: [existingTool, excavationTool] },
    }) as { mcp: { tools: Array<Record<string, unknown>> } };
    expect(manifest.mcp.tools[1]?._meta).toEqual({
      "existing/key": "preserved",
      "openai/fileParams": ["file"],
    });
  });

  test("decorates the actual SSE-style JSON-RPC tools/list response", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 7,
      result: { tools: [existingTool, excavationTool] },
    };
    const response = new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      headers: { "content-type": "text/event-stream", "x-existing": "kept" },
    });

    const decorated = await decorateOpenAiFileToolCatalogResponse(response);
    const text = await decorated.text();
    const data = JSON.parse(text.split("data: ")[1]!.trim()) as {
      result: { tools: Array<Record<string, unknown>> };
    };
    expect(data.result.tools[0]).toEqual(existingTool);
    expect(data.result.tools[1]?._meta).toEqual({
      "existing/key": "preserved",
      "openai/fileParams": ["file"],
    });
    expect(decorated.headers.get("x-existing")).toBe("kept");
  });

  test("recognizes only tools/list JSON-RPC requests", async () => {
    expect(
      await isMcpToolsListRequest(
        new Request("https://example.test/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      ),
    ).toBe(true);
    expect(
      await isMcpToolsListRequest(
        new Request("https://example.test/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call" }),
        }),
      ),
    ).toBe(false);
    expect(
      await isMcpToolsListRequest(
        new Request("https://example.test/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([
            { jsonrpc: "2.0", id: 3, method: "tools/call" },
            { jsonrpc: "2.0", id: 4, method: "tools/list" },
          ]),
        }),
      ),
    ).toBe(true);
  });

  test("decorates the actual SDK standard and REST catalogs", async () => {
    const definition = defineMcp({
      name: "catalog-test",
      title: "Catalog test",
      version: "1.0.0",
      instructions: "",
      tools: mcpTools,
      metrics: false,
    });
    const standardHandler = createTanStackMcpHandler(definition);
    const request = new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }),
    });
    const standard = await decorateOpenAiFileToolCatalogResponse(
      await standardHandler({ request }),
    );
    const event = (await standard.text()).split("data: ")[1]!.trim();
    const standardPayload = JSON.parse(event) as {
      result: { tools: Array<Record<string, unknown>> };
    };
    expect(standardPayload.result.tools).toHaveLength(15);
    expect(
      standardPayload.result.tools.find((tool) => tool.name === "excavate_document")?._meta,
    ).toEqual({ "openai/fileParams": ["file"] });

    const restHandler = createTanStackListToolsHandler(definition);
    const rest = await decorateOpenAiFileToolCatalogResponse(
      await restHandler({ request: new Request("https://example.test/.mcp/list-tools") }),
    );
    const restPayload = (await rest.json()) as { tools: Array<Record<string, unknown>> };
    expect(restPayload.tools).toHaveLength(15);
    expect(restPayload.tools.find((tool) => tool.name === "excavate_document")?._meta).toEqual({
      "openai/fileParams": ["file"],
    });
  });

  test("keeps the generated Lovable manifest aligned", async () => {
    const manifest = await Bun.file(
      new URL("../../../.lovable/mcp/manifest.json", import.meta.url),
    ).json();
    const tool = manifest.mcp.tools.find(
      (candidate: { name?: string }) => candidate.name === "excavate_document",
    );
    expect(manifest.mcp.tools).toHaveLength(15);
    expect(tool._meta).toEqual({ "openai/fileParams": ["file"] });
    expect(tool.inputSchema.properties.file.required).toEqual(["download_url", "file_id"]);
    expect(Object.keys(tool.inputSchema.properties.file.properties)).toEqual([
      "download_url",
      "file_id",
      "mime_type",
      "file_name",
    ]);
  });
});
