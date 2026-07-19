import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
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
]);

function recordingDispatcher() {
  const calls: { type: string; payload: unknown; user: SessionUser }[] = [];
  return {
    calls,
    query: async (type: string, payload: unknown, user: SessionUser) => {
      calls.push({ type, payload, user });
      return { rows: [{ id: "vendor-1" }] };
    },
  };
}

describe("dispatchToolCall", () => {
  test("unknown tool name returns an error result without calling the dispatcher", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(dispatcher, CALLER, "search_ghost", {}, DISPATCH_TABLE);

    expect(result).toEqual({ ok: false, error: 'Unknown tool "search_ghost"' });
    expect(dispatcher.calls).toHaveLength(0);
  });

  test("search tool dispatches to <entity>:list with a search payload, using the caller's identity", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      dispatcher,
      CALLER,
      "search_vendor",
      { query: "Müller GmbH" },
      DISPATCH_TABLE,
    );

    expect(result).toEqual({ ok: true, data: { rows: [{ id: "vendor-1" }] } });
    expect(dispatcher.calls).toEqual([
      {
        type: "vendor-feature:query:vendor:list",
        payload: { search: "Müller GmbH", limit: 10 },
        user: CALLER,
      },
    ]);
  });

  test("search tool without a query argument returns an error, no dispatcher call", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(dispatcher, CALLER, "search_vendor", {}, DISPATCH_TABLE);

    expect(result.ok).toBe(false);
    expect(dispatcher.calls).toHaveLength(0);
  });

  test("findBy tool dispatches to <entity>:list with an exact filter payload", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      dispatcher,
      CALLER,
      "find_vendor_by_iban",
      { iban: "DE89370400440532013000" },
      DISPATCH_TABLE,
    );

    expect(result).toEqual({ ok: true, data: { rows: [{ id: "vendor-1" }] } });
    expect(dispatcher.calls).toEqual([
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

  test("findBy tool without its required field argument returns an error, no dispatcher call", async () => {
    const dispatcher = recordingDispatcher();
    const result = await dispatchToolCall(
      dispatcher,
      CALLER,
      "find_vendor_by_iban",
      {},
      DISPATCH_TABLE,
    );

    expect(result.ok).toBe(false);
    expect(dispatcher.calls).toHaveLength(0);
  });

  test("a dispatcher rejection (e.g. missing handler or failed cap check) becomes an error result, not a throw", async () => {
    const dispatcher = {
      query: async () => {
        throw new Error("no handler registered for qn 'vendor:list'");
      },
    };

    const result = await dispatchToolCall(
      dispatcher,
      CALLER,
      "search_vendor",
      { query: "anything" },
      DISPATCH_TABLE,
    );

    expect(result).toEqual({ ok: false, error: "no handler registered for qn 'vendor:list'" });
  });
});
