import type { SessionUser, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import type { ToolDispatchDescriptor } from "./types";

/** Narrow view of `Dispatcher` (packages/framework/src/pipeline/dispatcher.ts) — kept out of
 *  `ToolDispatchDescriptor`'s reach and small enough for tests to build a plain object instead
 *  of a real Dispatcher. `write` reaches the real `<entity>:write` / write-handler pipeline with
 *  the same permission checks as an HTTP write; `requestId` is forwarded through to the
 *  Redis-backed IdempotencyGuard (tenantId+userId+requestId keyed), so it — not
 *  `event.metadata.idempotencyKey`, a different lower layer — is the correct idempotency
 *  channel for a tool call that might be retried by the agent runtime. */
export type ToolDispatcher = {
  query(type: string, payload: unknown, user: SessionUser): Promise<unknown>;
  write(
    type: string,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ): Promise<WriteResult>;
};

export type ToolCallResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string };

export type ToolCallRequest = {
  readonly dispatcher: ToolDispatcher;
  /** The real SessionUser of the caller. Never systemQuery/createSystemUser/
   *  createAnonymousUser — those drop the caller's identity and with it every
   *  tenant, ownership and field-level check. */
  readonly user: SessionUser;
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly dispatchTable: ReadonlyMap<string, ToolDispatchDescriptor>;
  /** Idempotency scope: `${runId}:${toolCallId}` becomes the write requestId. */
  readonly runId: string;
  readonly toolCallId: string;
};

const SEARCH_RESULT_LIMIT = 10;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 200;
const FILTER_OPS = ["eq", "ne", "lt", "gt", "in"] as const;
type FilterOp = (typeof FILTER_OPS)[number];

type PayloadResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFilterOp(value: unknown): value is FilterOp {
  return typeof value === "string" && (FILTER_OPS as readonly string[]).includes(value);
}

function buildSearchPayload(
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): PayloadResult {
  const query = toolInput["query"];
  if (typeof query !== "string" || query.length === 0) {
    return { ok: false, error: `Tool "${toolName}" requires a non-empty string "query" argument` };
  }
  return { ok: true, value: { search: query, limit: SEARCH_RESULT_LIMIT } };
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
    value: { filter: { field: fieldName, op: "eq", value }, limit: SEARCH_RESULT_LIMIT },
  };
}

/** Builds the `entityListSchema` payload for `list_<entity>`, validating `filters` against the
 *  catalog's per-entity allowlist. The allowlist keeps the model from probing non-filterable /
 *  access-restricted columns through an arbitrary WHERE clause — rejecting here is an error
 *  contract, not a passthrough to the executor. */
function buildEntityListPayload(
  list: {
    readonly searchableFields: readonly string[];
    readonly filterableFields: readonly string[];
  },
  input: Readonly<Record<string, unknown>>,
): PayloadResult {
  const payload: Record<string, unknown> = { totalCount: true };

  const search = input["search"];
  if (search !== undefined) {
    if (typeof search !== "string") {
      return { ok: false, error: `"search" must be a string` };
    }
    if (list.searchableFields.length === 0) {
      return { ok: false, error: "This entity has no searchable fields" };
    }
    payload["search"] = search;
  }

  const filters = input["filters"];
  if (filters !== undefined) {
    if (!Array.isArray(filters)) {
      return { ok: false, error: `"filters" must be an array` };
    }
    const validated: Array<{ field: string; op: FilterOp; value: unknown }> = [];
    for (const entry of filters) {
      if (!isRecord(entry) || typeof entry["field"] !== "string" || !("value" in entry)) {
        return { ok: false, error: `Each filter must be { field, op, value }` };
      }
      if (!list.filterableFields.includes(entry["field"])) {
        return { ok: false, error: `Field "${entry["field"]}" is not filterable on this entity` };
      }
      if (!isFilterOp(entry["op"])) {
        return { ok: false, error: `Unsupported filter operator "${String(entry["op"])}"` };
      }
      validated.push({ field: entry["field"], op: entry["op"], value: entry["value"] });
    }
    if (validated.length > 0) payload["filters"] = validated;
  }

  const rawLimit = input["limit"];
  const limitValue = typeof rawLimit === "number" ? rawLimit : DEFAULT_LIST_LIMIT;
  payload["limit"] = Math.min(Math.max(limitValue, 1), MAX_LIST_LIMIT);

  return { ok: true, value: payload };
}

/** Pulls only `id`/`version` off a write result — from the top level, falling back to the
 *  nested `data` projection (the real create/update shape is `{ id, data: <projection>, changes,
 *  previous, ... }`, with `version` living on the projection, not the top level). Never returns
 *  the projection itself or any other field: this is the fallback path for when there is no
 *  detail handler to re-read through, so nothing here has passed the field-level read filter. */
function extractIdAndVersion(data: unknown): { id?: string; version?: number } {
  if (!isRecord(data)) return {};
  const nested = isRecord(data["data"]) ? data["data"] : undefined;
  const id =
    typeof data["id"] === "string"
      ? data["id"]
      : typeof nested?.["id"] === "string"
        ? nested["id"]
        : undefined;
  const version =
    typeof data["version"] === "number"
      ? data["version"]
      : typeof nested?.["version"] === "number"
        ? nested["version"]
        : undefined;
  return { ...(id !== undefined && { id }), ...(version !== undefined && { version }) };
}

async function dispatchSearch(
  descriptor: Extract<ToolDispatchDescriptor, { kind: "search" }>,
  dispatcher: ToolDispatcher,
  user: SessionUser,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): Promise<ToolCallResult> {
  const payload = buildSearchPayload(toolName, input);
  if (!payload.ok) return payload;
  const data = await dispatcher.query(descriptor.qn, payload.value, user);
  return { ok: true, data };
}

async function dispatchFindBy(
  descriptor: Extract<ToolDispatchDescriptor, { kind: "findBy" }>,
  dispatcher: ToolDispatcher,
  user: SessionUser,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): Promise<ToolCallResult> {
  const payload = buildFindByPayload(toolName, descriptor.fieldName, input);
  if (!payload.ok) return payload;
  const data = await dispatcher.query(descriptor.qn, payload.value, user);
  return { ok: true, data };
}

async function dispatchServerQuery(
  descriptor: Extract<ToolDispatchDescriptor, { kind: "server"; op: "query" }>,
  dispatcher: ToolDispatcher,
  user: SessionUser,
  input: Readonly<Record<string, unknown>>,
): Promise<ToolCallResult> {
  if (descriptor.detail) {
    const id = input["id"];
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: `This tool requires a non-empty string "id" argument` };
    }
    const data = await dispatcher.query(descriptor.qn, { id }, user);
    return { ok: true, data };
  }

  if (descriptor.list) {
    const payload = buildEntityListPayload(descriptor.list, input);
    if (!payload.ok) return payload;
    const data = await dispatcher.query(descriptor.qn, payload.value, user);
    return { ok: true, data };
  }

  const data = await dispatcher.query(descriptor.qn, input, user);
  return { ok: true, data };
}

/** Runs a write tool call: optionally injects the current `version` (read fresh from the
 *  paired detail handler right before the optimistic-lock write), dispatches with a
 *  run-scoped idempotency key, and — on success — re-reads through the detail handler so the
 *  returned data goes through the field-level read filter (the raw write result does not). */
async function dispatchServerWrite(
  descriptor: Extract<ToolDispatchDescriptor, { kind: "server"; op: "write" }>,
  dispatcher: ToolDispatcher,
  user: SessionUser,
  input: Readonly<Record<string, unknown>>,
  runId: string,
  toolCallId: string,
): Promise<ToolCallResult> {
  let payload: Readonly<Record<string, unknown>> = input;

  if (descriptor.injectsVersion) {
    const id = input["id"];
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: `This tool requires a non-empty string "id" argument` };
    }
    if (!descriptor.detailQn) {
      return { ok: false, error: "Tool is misconfigured: no detail handler to read version from" };
    }
    const current = await dispatcher.query(descriptor.detailQn, { id }, user);
    const version =
      isRecord(current) && typeof current["version"] === "number" ? current["version"] : undefined;
    if (version === undefined) {
      return { ok: false, error: `Could not read the current "version" for id "${id}"` };
    }
    payload = { ...input, version };
  }

  const requestId = `${runId}:${toolCallId}`;
  const result = await dispatcher.write(descriptor.qn, payload, user, requestId);

  if (!result.isSuccess) {
    return { ok: false, error: result.error.message };
  }

  const { id, version } = extractIdAndVersion(result.data);
  const scalars = { ...(id !== undefined && { id }), ...(version !== undefined && { version }) };

  if (descriptor.detailQn && id !== undefined) {
    try {
      const data = await dispatcher.query(descriptor.detailQn, { id }, user);
      return { ok: true, data };
    } catch {
      return { ok: true, data: scalars };
    }
  }

  return { ok: true, data: scalars };
}

function dispatchClientNavigate(
  descriptor: Extract<ToolDispatchDescriptor, { kind: "client"; op: "navigate" }>,
  input: Readonly<Record<string, unknown>>,
): ToolCallResult {
  const entity = input["entity"];
  if (typeof entity === "string") {
    const screenId = descriptor.entityScreens.get(entity);
    if (!screenId) return { ok: false, error: `Unknown entity "${entity}" for navigation` };
    const id = input["id"];
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: `Navigating to "${entity}" requires a non-empty string "id"` };
    }
    return { ok: true, data: { kind: "navigate", screenId, params: { id } } };
  }

  const screenId = input["screenId"];
  if (typeof screenId === "string") {
    if (!descriptor.screenIds.has(screenId)) {
      return { ok: false, error: `Unknown screen "${screenId}"` };
    }
    const params = input["params"];
    if (params !== undefined) {
      if (!isRecord(params) || Object.values(params).some((value) => typeof value !== "string")) {
        return { ok: false, error: `"params" must be an object of string values` };
      }
      return { ok: true, data: { kind: "navigate", screenId, params } };
    }
    return { ok: true, data: { kind: "navigate", screenId, params: {} } };
  }

  return { ok: false, error: `navigate requires either { entity, id } or { screenId }` };
}

function dispatchClientOpenForm(
  descriptor: Extract<ToolDispatchDescriptor, { kind: "client"; op: "open_form" }>,
  input: Readonly<Record<string, unknown>>,
): ToolCallResult {
  const handlerQn = input["handlerQn"];
  if (typeof handlerQn !== "string") {
    return { ok: false, error: `open_form requires a string "handlerQn" argument` };
  }
  const screenId = descriptor.formScreens.get(handlerQn);
  if (!screenId) return { ok: false, error: `No form screen mounted for handler "${handlerQn}"` };
  return {
    ok: true,
    data: { kind: "open_form", screenId, handlerQn, prefill: input["prefill"] ?? {} },
  };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function dispatchClientAskUser(input: Readonly<Record<string, unknown>>): ToolCallResult {
  const question = input["question"];
  if (typeof question !== "string" || question.length === 0) {
    return { ok: false, error: `ask_user requires a non-empty string "question" argument` };
  }
  const options = input["options"];
  if (options === undefined) {
    return { ok: true, data: { kind: "ask_user", question } };
  }
  if (!isStringArray(options)) {
    return { ok: false, error: `ask_user "options" argument must be an array of strings` };
  }
  return { ok: true, data: { kind: "ask_user", question, options } };
}

function dispatchClient(
  descriptor: Extract<ToolDispatchDescriptor, { kind: "client" }>,
  input: Readonly<Record<string, unknown>>,
): ToolCallResult {
  switch (descriptor.op) {
    case "navigate":
      return dispatchClientNavigate(descriptor, input);
    case "open_form":
      return dispatchClientOpenForm(descriptor, input);
    case "ask_user":
      return dispatchClientAskUser(input);
  }
}

/** Executes one LLM-issued tool call. Never throws — a missing tool, a missing argument, a
 *  disallowed filter field, or a rejected handler call (cap check, validation, ...) all come
 *  back as `{ ok: false }` so the agent loop can feed the error back to the model instead of
 *  crashing. `request.user` must be the caller's real identity — every server-kind tool runs
 *  through the same permission-checked dispatcher pipeline as a normal HTTP request. */
export async function dispatchToolCall(request: ToolCallRequest): Promise<ToolCallResult> {
  const { dispatcher, user, toolName, input, dispatchTable, runId, toolCallId } = request;
  const descriptor = dispatchTable.get(toolName);
  if (!descriptor) {
    return { ok: false, error: `Unknown tool "${toolName}"` };
  }

  try {
    switch (descriptor.kind) {
      case "search":
        return await dispatchSearch(descriptor, dispatcher, user, toolName, input);
      case "findBy":
        return await dispatchFindBy(descriptor, dispatcher, user, toolName, input);
      case "client":
        return dispatchClient(descriptor, input);
      case "server":
        return descriptor.op === "query"
          ? await dispatchServerQuery(descriptor, dispatcher, user, input)
          : await dispatchServerWrite(descriptor, dispatcher, user, input, runId, toolCallId);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
