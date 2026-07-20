import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { MailAccountEventPayload } from "../events";
import { loadCurrentMailAccountPayload } from "../handlers/account-state";

function ctxWithEvents(
  payloads: readonly MailAccountEventPayload[],
): Pick<HandlerContext, "loadAggregate"> {
  return {
    loadAggregate: async () =>
      payloads.map((payload) => ({
        // @cast-boundary test fixture — only `payload` is read by the function under test
        payload,
      })) as unknown as Awaited<ReturnType<HandlerContext["loadAggregate"]>>,
  };
}

describe("loadCurrentMailAccountPayload", () => {
  test("returns undefined when the aggregate has no events", async () => {
    const ctx = ctxWithEvents([]);
    expect(await loadCurrentMailAccountPayload(ctx, "acc-1")).toBeUndefined();
  });

  test("returns the payload of the LAST event — full-snapshot semantics", async () => {
    const first = { status: "active" } as unknown as MailAccountEventPayload;
    const last = { status: "degraded" } as unknown as MailAccountEventPayload;
    const ctx = ctxWithEvents([first, last]);
    expect(await loadCurrentMailAccountPayload(ctx, "acc-1")).toBe(last);
  });
});
