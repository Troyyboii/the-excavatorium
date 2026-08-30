import { decorateOpenAiFileToolCatalog } from "../src/lib/mcp/openai-tool-metadata";

const manifestPath = new URL("../.lovable/mcp/manifest.json", import.meta.url);
const original = await Bun.file(manifestPath).text();
const parsed = JSON.parse(original) as unknown;
const decoratedCatalog = decorateOpenAiFileToolCatalog(parsed);
const decorated = `${JSON.stringify(decoratedCatalog, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (JSON.stringify(decoratedCatalog) !== JSON.stringify(parsed)) {
    console.error("MCP manifest is missing the excavate_document OpenAI file metadata.");
    process.exit(1);
  }
} else if (decorated !== original) {
  await Bun.write(manifestPath, decorated);
}
