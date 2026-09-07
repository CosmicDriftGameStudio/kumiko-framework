import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { ToolCallRequest, ToolDispatcher } from "../tool-dispatch";
import { dispatchToolCall } from "../tool-dispatch";
import type { ToolDispatchDescriptor } from "../types";

const CALLER: SessionUser = { id: "user-1", tenantId: "tenant-1", roles: ["member"] };

const DISPATCH_TABLE = new Map<string, ToolDispatchDescriptor>([
  [
    "search_vendor",
    { kind: "search", entityName: "vendor", qn: "vendor-feature:query:vendor:list" },
  ],
  [
    "find_vendor_by_iban",
    {
      kind: "findBy",
      entityName: "vendor",
      fieldName: "iban",
      qn: "vendor-feature:query:vendor:list",
    },
  ],
  [
    "get_vendor",
    {
      kind: "server",
      op: "query",
      qn: "vendor-feature:query:vendor:detail",
      risk: "low",
      entity: "vendor",
      detail: true,
    },
  ],
  [
    "list_vendor",
    {
      kind: "server",
      op: "query",
      qn: "vendor-feature:query:vendor:list",
      risk: "low",
      entity: "vendor",
      list: { searchableFields: ["name"], filterableFields: ["status"] },
    },
  ],
  [
    "vendor_feature_vendor_approve",
    {
      kind: "server",
      op: "write",
      qn: "vendor-feature:write:vendor:approve",
      risk: "mid",
      entity: "vendor",
      detailQn: "vendor-feature:query:vendor:detail",
      injectsVersion: true,
    },
  ],
  [
    "vendor_feature_vendor_ping",
    {
      kind: "server",
      op: "write",
      qn: "vendor-feature:write:vendor:ping",
      risk: "mid",
    },
  ],
  [
    "navigate",
    {
      kind: "client",
      op: "navigate",
      entityScreens: new Map([["vendor", "vendor-detail"]]),
      screenIds: new Set(["vendor-list", "vendor-detail"]),
    },
  ],
  [
    "open_form",
    {
      kind: "client",
      op: "open_form",
      formScreens: new Map([["vendor-feature:write:vendor:approve", "vendor-approve-form"]]),
    },
  ],
  ["ask_user", { kind: "client", op: "ask_user" }],
]);

function recordingDispatcher(overrides: Partial<ToolDispatcher> = {}): ToolDispatcher & {
  queryCalls: { type: string; payload: unknown; user: SessionUser }[];
  writeCalls: { type: string; payload: unknown; user: SessionUser; requestId?: string }[];
} {
  const queryCalls: { type: string; payload: unknown; user: SessionUser }[] = [];
  const writeCalls: { type: string; payload: unknown; user: SessionUser; requestId?: string }[] =
    [];
  return {
    queryCalls,
    writeCalls,
    query: async (type, payload, user) => {
      queryCalls.push({ type, payload, user });
      return { rows: [{ id: "vendor-1" }] };
    },
    write: async (type, payload, user, requestId) => {
      writeCalls.push({ type, payload, user, requestId });
      return { isSuccess: true, data: { id: "vendor-1", version: 2 } };
    },
    ...overrides,
  };
}

function request(overrides: Partial<ToolCallRequest>): ToolCallRequest {
  return {
    dispatcher: recordingDispatcher(),
    user: CALLER,
    toolName: "search_vendor",
    input: {},
    dispatchTable: DISPATCH_TABLE,
    runId: "run-1",
    toolCallId: "call-1",
    ...overrides,
  };
}

describe("dispatchToolCall — search/findBy (unchanged behaviour)", () => {
  test("unknown tool name returns an error result without calling the dispatcher", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(request({ dispatcher, toolName: "search_ghost" }));

    expect(result).toEqual({ ok: false, error: 'Unknown tool "search_ghost"' });
    expect(dispatcher.queryCalls).toHaveLength(0);
  });

  test("search tool dispatches to <entity>:list with a search payload, using the caller's identity", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      request({ dispatcher, toolName: "search_vendor", input: { query: "Müller GmbH" } }),
    );

    expect(result).toEqual({ ok: true, data: { rows: [{ id: "vendor-1" }] } });
    expect(dispatcher.queryCalls).toEqual([
      {
        type: "vendor-feature:query:vendor:list",
        payload: { search: "Müller GmbH", limit: 10 },
        user: CALLER,
      },
    ]);
  });

  test("findBy tool dispatches to <entity>:list with an exact filter payload", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      request({
        dispatcher,
        toolName: "find_vendor_by_iban",
        input: { iban: "DE89370400440532013000" },
      }),
    );

    expect(result).toEqual({ ok: true, data: { rows: [{ id: "vendor-1" }] } });
    expect(dispatcher.queryCalls).toEqual([
      {
        type: "vendor-feature:query:vendor:list",
        payload: {
          filter: { field: "iban", op: "eq", value: "DE89370400440532013000" },
          limit: 10,
        },
        user: CALLER,
      },
    ]);
  });

  test("a dispatcher rejection (e.g. missing handler or failed cap check) becomes an error result, not a throw", async () => {
    const dispatcher = recordingDispatcher({
      query: async () => {
        throw new Error("no handler registered for qn 'vendor:list'");
      },
    });

    const result = await dispatchToolCall(
      request({ dispatcher, toolName: "search_vendor", input: { query: "anything" } }),
    );

    expect(result).toEqual({ ok: false, error: "no handler registered for qn 'vendor:list'" });
  });
});

describe("dispatchToolCall — get_/list_ server query tools", () => {
  test("get_<entity> requires a non-empty string id, then queries the detail handler with { id }", async () => {
    const dispatcher = recordingDispatcher();
    const missing = await dispatchToolCall(
      request({ dispatcher, toolName: "get_vendor", input: {} }),
    );
    expect(missing.ok).toBe(false);
    expect(dispatcher.queryCalls).toHaveLength(0);

    const result = await dispatchToolCall(
      request({ dispatcher, toolName: "get_vendor", input: { id: "vendor-1" } }),
    );
    expect(result).toEqual({ ok: true, data: { rows: [{ id: "vendor-1" }] } });
    expect(dispatcher.queryCalls).toEqual([
      { type: "vendor-feature:query:vendor:detail", payload: { id: "vendor-1" }, user: CALLER },
    ]);
  });

  test("list_<entity> rejects a filter field outside the descriptor's allowlist", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      request({
        dispatcher,
        toolName: "list_vendor",
        input: { filters: [{ field: "notFilterable", op: "eq", value: "x" }] },
      }),
    );

    expect(result.ok).toBe(false);
    expect(dispatcher.queryCalls).toHaveLength(0);
  });

  test("list_<entity> rejects an unsupported filter operator", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      request({
        dispatcher,
        toolName: "list_vendor",
        input: { filters: [{ field: "status", op: "like", value: "x" }] },
      }),
    );

    expect(result.ok).toBe(false);
    expect(dispatcher.queryCalls).toHaveLength(0);
  });

  test("list_<entity> builds the entityListSchema payload with totalCount + clamped limit", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      request({
        dispatcher,
        toolName: "list_vendor",
        input: {
          search: "acme",
          filters: [{ field: "status", op: "eq", value: "active" }],
          limit: 999,
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(dispatcher.queryCalls).toEqual([
      {
        type: "vendor-feature:query:vendor:list",
        payload: {
          totalCount: true,
          search: "acme",
          filters: [{ field: "status", op: "eq", value: "active" }],
          limit: 200,
        },
        user: CALLER,
      },
    ]);
  });
});

describe("dispatchToolCall — server write tools", () => {
  test("injectsVersion: reads the current version off the detail handler before writing", async () => {
    const dispatcher = recordingDispatcher({
      query: async (type, payload, user) => {
        dispatcher.queryCalls.push({ type, payload, user });
        expect(type).toBe("vendor-feature:query:vendor:detail");
        return { id: "vendor-1", version: 5 };
      },
    });
    const result = await dispatchToolCall(
      request({
        dispatcher,
        toolName: "vendor_feature_vendor_approve",
        input: { id: "vendor-1", note: "looks good" },
      }),
    );

    expect(result.ok).toBe(true);
    expect(dispatcher.writeCalls).toEqual([
      {
        type: "vendor-feature:write:vendor:approve",
        payload: { id: "vendor-1", note: "looks good", version: 5 },
        user: CALLER,
        requestId: "run-1:call-1",
      },
    ]);
    // Two detail-handler reads: the pre-write version check and the post-write
    // re-read, both field-level filtered rather than trusting the raw write result.
    expect(dispatcher.queryCalls).toEqual([
      { type: "vendor-feature:query:vendor:detail", payload: { id: "vendor-1" }, user: CALLER },
      { type: "vendor-feature:query:vendor:detail", payload: { id: "vendor-1" }, user: CALLER },
    ]);
  });

  test("a write rejection becomes an error result, never a throw, and never falls back to the raw payload", async () => {
    const dispatcher = recordingDispatcher({
      query: async () => ({ id: "vendor-1", version: 5 }),
      write: async () => ({
        isSuccess: false,
        error: {
          code: "access_denied",
          httpStatus: 403,
          i18nKey: "errors.access_denied",
          message: "access denied",
        },
      }),
    });
    const result = await dispatchToolCall(
      request({ dispatcher, toolName: "vendor_feature_vendor_approve", input: { id: "vendor-1" } }),
    );

    expect(result).toEqual({ ok: false, error: "access denied" });
  });

  test("no detailQn: returns only id/version scalars, never the raw write payload", async () => {
    const dispatcher = recordingDispatcher({
      write: async () => ({
        isSuccess: true,
        data: { id: "vendor-9", version: 1, secret: "leak" },
      }),
    });
    const result = await dispatchToolCall(
      request({ dispatcher, toolName: "vendor_feature_vendor_ping", input: {} }),
    );

    expect(result).toEqual({ ok: true, data: { id: "vendor-9", version: 1 } });
  });

  test("no detailQn: falls back to id/version nested under the write result's `data` projection", async () => {
    // Real create/update shape: `{ id, data: <projection>, changes, previous, ... }` — version
    // lives on the projection, not the top level (see dispatchServerWrite's own docstring).
    const dispatcher = recordingDispatcher({
      write: async () => ({
        isSuccess: true,
        data: {
          kind: "save",
          id: "vendor-9",
          data: { id: "vendor-9", version: 1, secret: "leak" },
          changes: { secret: "leak" },
          previous: {},
        },
      }),
    });
    const result = await dispatchToolCall(
      request({ dispatcher, toolName: "vendor_feature_vendor_ping", input: {} }),
    );

    expect(result).toEqual({ ok: true, data: { id: "vendor-9", version: 1 } });
  });

  test("detailQn re-read throwing (e.g. a delete) falls back to id/version scalars", async () => {
    // First query call (pre-write version read) succeeds, second (post-write re-read) throws.
    let calls = 0;
    const scriptedDispatcher: ToolDispatcher = {
      query: async () => {
        calls += 1;
        if (calls === 1) return { version: 5 };
        throw new Error("row not found");
      },
      write: async () => ({ isSuccess: true, data: { id: "vendor-1", version: 6 } }),
    };
    const result = await dispatchToolCall(
      request({
        dispatcher: scriptedDispatcher,
        toolName: "vendor_feature_vendor_approve",
        input: { id: "vendor-1" },
      }),
    );

    expect(result).toEqual({ ok: true, data: { id: "vendor-1", version: 6 } });
  });
});

describe("dispatchToolCall — client tools", () => {
  test("navigate resolves { entity, id } to the entity's detail screen", async () => {
    const result = await dispatchToolCall(
      request({ toolName: "navigate", input: { entity: "vendor", id: "vendor-1" } }),
    );
    expect(result).toEqual({
      ok: true,
      data: { kind: "navigate", screenId: "vendor-detail", params: { id: "vendor-1" } },
    });
  });

  test("navigate rejects an unknown entity", async () => {
    const result = await dispatchToolCall(
      request({ toolName: "navigate", input: { entity: "ghost", id: "1" } }),
    );
    expect(result.ok).toBe(false);
  });

  test("navigate resolves { screenId, params } when screenId is in the allowlist", async () => {
    const result = await dispatchToolCall(
      request({
        toolName: "navigate",
        input: { screenId: "vendor-list", params: { tab: "open" } },
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { kind: "navigate", screenId: "vendor-list", params: { tab: "open" } },
    });
  });

  test("navigate rejects a screenId outside the manifest allowlist", async () => {
    const result = await dispatchToolCall(
      request({ toolName: "navigate", input: { screenId: "not-a-real-screen" } }),
    );
    expect(result.ok).toBe(false);
  });

  test("open_form resolves a known handler QN to its form screen", async () => {
    const result = await dispatchToolCall(
      request({
        toolName: "open_form",
        input: { handlerQn: "vendor-feature:write:vendor:approve" },
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        kind: "open_form",
        screenId: "vendor-approve-form",
        handlerQn: "vendor-feature:write:vendor:approve",
        prefill: {},
      },
    });
  });

  test("open_form rejects an unmapped handler QN", async () => {
    const result = await dispatchToolCall(
      request({ toolName: "open_form", input: { handlerQn: "vendor-feature:write:vendor:ghost" } }),
    );
    expect(result.ok).toBe(false);
  });

  test("ask_user requires a non-empty question", async () => {
    const missing = await dispatchToolCall(request({ toolName: "ask_user", input: {} }));
    expect(missing.ok).toBe(false);

    const result = await dispatchToolCall(
      request({ toolName: "ask_user", input: { question: "Which vendor?", options: ["A", "B"] } }),
    );
    expect(result).toEqual({
      ok: true,
      data: { kind: "ask_user", question: "Which vendor?", options: ["A", "B"] },
    });
  });

  test("ask_user omits options from the result data when not provided", async () => {
    const result = await dispatchToolCall(
      request({ toolName: "ask_user", input: { question: "Which vendor?" } }),
    );
    expect(result).toEqual({ ok: true, data: { kind: "ask_user", question: "Which vendor?" } });
    if (result.ok) {
      expect(result.data).not.toHaveProperty("options");
    }
  });

  test("ask_user rejects a non-array or mixed-type options argument", async () => {
    const notAnArray = await dispatchToolCall(
      request({ toolName: "ask_user", input: { question: "Which vendor?", options: "A" } }),
    );
    expect(notAnArray.ok).toBe(false);
    if (!notAnArray.ok) expect(notAnArray.error).toContain(`"options"`);

    const mixedTypes = await dispatchToolCall(
      request({ toolName: "ask_user", input: { question: "Which vendor?", options: ["A", 1] } }),
    );
    expect(mixedTypes.ok).toBe(false);
    if (!mixedTypes.ok) expect(mixedTypes.error).toContain(`"options"`);
  });
});
