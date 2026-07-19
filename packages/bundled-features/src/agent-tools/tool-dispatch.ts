import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { ToolDispatchDescriptor } from "./types";

/** Narrow view of `Dispatcher` (packages/framework/src/pipeline/dispatcher.ts) — dispatch only
 *  ever needs `query`, and this keeps the module testable without constructing a real Dispatcher.
 *  Callers pass either the app's real `dispatcher` or `{ query: ctx.queryAs }` from inside a
 *  handler — both run the same `executeQuery` pipeline with a caller-supplied SessionUser, never
 *  `systemQuery`/`createSystemUser`/`createAnonymousUser` (all of which drop the caller's identity). */
export type ToolDispatcher = {
  query(type: string, payload: unknown, user: SessionUser): Promise<unknown>;
};

export type ToolCallResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string };

const RESULT_LIMIT = 10;

/** Execute one LLM-issued tool call. `callerUser` MUST be the real Tenant+User identity of
 *  whoever's search this is running on behalf of — every call goes through `<entity>:list`,
 *  the same handler + permission pipeline as a normal HTTP list request (search/filter are both
 *  native `<entity>:list` payload fields, see `packages/framework/src/db/event-store-executor-read.ts`).
 *  Never throws — a missing tool, a missing argument, or a rejected handler call (e.g. no
 *  `<entity>:list` handler mounted, or a cap check failing) all come back as `{ ok: false }` so
 *  the agent loop can feed the error back to the model instead of crashing. */
export async function dispatchToolCall(
  dispatcher: ToolDispatcher,
  callerUser: SessionUser,
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
  dispatchTable: ReadonlyMap<string, ToolDispatchDescriptor>,
): Promise<ToolCallResult> {
  const descriptor = dispatchTable.get(toolName);
  if (!descriptor) {
    return { ok: false, error: `Unknown tool "${toolName}"` };
  }

  const payload =
    descriptor.kind === "search"
      ? buildSearchPayload(toolName, toolInput)
      : buildFindByPayload(toolName, descriptor.fieldName, toolInput);
  if (!payload.ok) {
    return payload;
  }

  try {
    const data = await dispatcher.query(descriptor.qn, payload.value, callerUser);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type PayloadResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

function buildSearchPayload(
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): PayloadResult {
  const query = toolInput["query"];
  if (typeof query !== "string" || query.length === 0) {
    return { ok: false, error: `Tool "${toolName}" requires a non-empty string "query" argument` };
  }
  return { ok: true, value: { search: query, limit: RESULT_LIMIT } };
}

function buildFindByPayload(
  toolName: string,
  fieldName: string,
  toolInput: Readonly<Record<string, unknown>>,
): PayloadResult {
  const value = toolInput[fieldName];
  if (value === undefined) {
    return { ok: false, error: `Tool "${toolName}" requires a "${fieldName}" argument` };
  }
  return {
    ok: true,
    value: { filter: { field: fieldName, op: "eq", value }, limit: RESULT_LIMIT },
  };
}
