const OPENAI_FILE_TOOL_NAME = "excavate_document";

export const OPENAI_FILE_TOOL_META = Object.freeze({
  "openai/fileParams": Object.freeze(["file"]),
});

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decorateTools(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const tools = value.map((tool) => {
    if (!isObject(tool) || tool.name !== OPENAI_FILE_TOOL_NAME) return tool;
    changed = true;
    const existingMeta = isObject(tool._meta) ? tool._meta : {};
    return { ...tool, _meta: { ...existingMeta, ...OPENAI_FILE_TOOL_META } };
  });
  return changed ? tools : value;
}

/** Adds OpenAI's file-parameter metadata to the one approved mutation tool. */
export function decorateOpenAiFileToolCatalog(value: unknown): unknown {
  if (Array.isArray(value)) {
    const decorated = value.map(decorateOpenAiFileToolCatalog);
    return decorated.some((item, index) => item !== value[index]) ? decorated : value;
  }
  if (!isObject(value)) return value;

  let output = value;
  const replace = (key: string, next: unknown) => {
    if (next === value[key]) return;
    if (output === value) output = { ...value };
    output[key] = next;
  };

  if (Object.prototype.hasOwnProperty.call(value, "tools")) {
    replace("tools", decorateTools(value.tools));
  }
  if (Object.prototype.hasOwnProperty.call(value, "result")) {
    replace("result", decorateOpenAiFileToolCatalog(value.result));
  }
  if (Object.prototype.hasOwnProperty.call(value, "mcp")) {
    replace("mcp", decorateOpenAiFileToolCatalog(value.mcp));
  }
  return output;
}

export async function isMcpToolsListRequest(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return false;
  }
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) => isObject(message) && message.method === "tools/list" && "id" in message,
  );
}

function responseWithBody(response: Response, body: BodyInit): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function decorateSse(text: string): string {
  return text
    .split(/(?<=\n)/)
    .map((line) => {
      if (!line.startsWith("data:")) return line;
      const prefix = line.startsWith("data: ") ? "data: " : "data:";
      const newline = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
      const json = line.slice(prefix.length, newline ? -newline.length : undefined);
      try {
        return `${prefix}${JSON.stringify(decorateOpenAiFileToolCatalog(JSON.parse(json)))}${newline}`;
      } catch {
        return line;
      }
    })
    .join("");
}

/** Decorates a finite tools/list response while preserving its transport shape. */
export async function decorateOpenAiFileToolCatalogResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
    return response;
  }
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    return responseWithBody(response, decorateSse(text));
  }
  try {
    return responseWithBody(
      response,
      JSON.stringify(decorateOpenAiFileToolCatalog(JSON.parse(text))),
    );
  } catch {
    return responseWithBody(response, text);
  }
}
