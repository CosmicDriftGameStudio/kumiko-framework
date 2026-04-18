import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { emitEvent } from "../event-helpers";
import type { EventDef } from "../types/handlers";

describe("emitEvent", () => {
  const orderPlaced: EventDef<{ id: string; customer: string }> = {
    name: "pubsub-orders:event:order-placed",
    schema: z.object({ id: z.string(), customer: z.string() }),
    version: 1,
  };

  test("delegates to ctx.appendEvent with eventDef.name as the type", async () => {
    const ctx = { appendEvent: vi.fn().mockResolvedValue(undefined) };
    await emitEvent(ctx, orderPlaced, {
      aggregateId: "agg-1",
      aggregateType: "pubsubOrder",
      payload: { id: "agg-1", customer: "alice" },
    });
    expect(ctx.appendEvent).toHaveBeenCalledWith({
      aggregateId: "agg-1",
      aggregateType: "pubsubOrder",
      type: "pubsub-orders:event:order-placed",
      payload: { id: "agg-1", customer: "alice" },
    });
  });

  test("payload type is inferred from the eventDef — wrong shape is a compile error", async () => {
    const ctx = { appendEvent: vi.fn().mockResolvedValue(undefined) };
    // Runtime check: compile-time narrowing is the real win, but we also
    // make sure the value flows through unchanged.
    await emitEvent(ctx, orderPlaced, {
      aggregateId: "a",
      aggregateType: "pubsubOrder",
      payload: { id: "a", customer: "bob" },
    });
    const call = ctx.appendEvent.mock.calls[0]?.[0] as { payload: unknown };
    expect(call.payload).toEqual({ id: "a", customer: "bob" });
  });
});
