import type { ApiDocsHandler } from "./model.ts";
import { examplePayload } from "./schema-fields.ts";

export function endpointOf(handler: Pick<ApiDocsHandler, "kind">): "/api/query" | "/api/write" {
  return handler.kind === "query" ? "/api/query" : "/api/write";
}

/** Recorded payload when there is one, else a value derived from the input schema. */
export function requestPayload(handler: ApiDocsHandler): unknown {
  const recorded = handler.example?.request.body.payload;
  if (recorded !== undefined) return recorded;
  return handler.inputSchema === undefined ? {} : examplePayload(handler.inputSchema);
}

// Inside a single-quoted shell string the only character that needs care is the quote itself.
function shellSingleQuoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function curlExample(handler: ApiDocsHandler, baseUrl: string): string {
  const body = JSON.stringify({ type: handler.qn, payload: requestPayload(handler) }, null, 2);
  return [
    `curl -X POST ${baseUrl}${endpointOf(handler)} \\`,
    `  -H "Authorization: Bearer $API_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d ${shellSingleQuoted(body)}`,
  ].join("\n");
}
