import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { InternalError } from "../../errors/index.ts";
import { createEventDef } from "../event-def.ts";
import { triggeredEventOf } from "../triggered-event.ts";

const opened = createEventDef({
  feature: "shop",
  name: "order-opened",
  schema: z.object({ id: z.string() }),
  piiFields: "none",
});
const cancelled = createEventDef({
  feature: "shop",
  name: "order-cancelled",
  schema: z.object({ id: z.string(), reason: z.string() }),
  piiFields: "none",
});
const contacted = createEventDef({
  feature: "shop",
  name: "customer-contacted",
  schema: z.object({ email: z.string(), ownerId: z.string() }),
  piiFields: { email: { personal: { of: "ownerId" } } },
});

describe("triggeredEventOf", () => {
  test("parses the payload against the event named by ctx.triggerName", () => {
    const result = triggeredEventOf(
      [opened, cancelled],
      { id: "o-1", reason: "late" },
      { triggerName: "shop:event:order-cancelled" },
    );
    expect(result).toEqual({
      type: "shop:event:order-cancelled",
      payload: { id: "o-1", reason: "late" },
    });
    if (result.type === "shop:event:order-cancelled") {
      expect(result.payload.reason).toBe("late");
    }
  });

  test("a trigger outside the list throws", () => {
    expect(() =>
      triggeredEventOf([opened, cancelled], { id: "o-1" }, { triggerName: "shop:event:other" }),
    ).toThrow(InternalError);
    expect(() =>
      triggeredEventOf([opened, cancelled], { id: "o-1" }, { triggerName: "shop:event:other" }),
    ).toThrow(/is none of/);
  });

  test("an undefined triggerName throws", () => {
    expect(() => triggeredEventOf([opened, cancelled], { id: "o-1" }, {})).toThrow(InternalError);
  });

  test("a payload that does not match the schema throws", () => {
    const call = () =>
      triggeredEventOf([opened], { id: 5 }, { triggerName: "shop:event:order-opened" });
    expect(call).toThrow(InternalError);
    expect(call).toThrow(/does not match its schema/);
  });

  test("an event with personal fields throws", () => {
    const call = () =>
      triggeredEventOf(
        [contacted],
        { email: "cipher", ownerId: "u-1" },
        { triggerName: "shop:event:customer-contacted" },
      );
    expect(call).toThrow(InternalError);
    expect(call).toThrow(/personal fields/);
  });
});
