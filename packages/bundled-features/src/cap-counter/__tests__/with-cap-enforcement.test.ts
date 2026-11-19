import { describe, expect, test } from "bun:test";
import { defineWriteHandler, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import type { CalendarCapDef, CalendarCapResolver } from "../with-cap-enforcement.ts";
import { withCapEnforcement } from "../with-cap-enforcement.ts";

const resolver: CalendarCapResolver = (): CalendarCapDef => ({
  capName: "things",
  periodStartIso: "2026-01-01T00:00:00Z",
  limit: 10,
  profile: "hardSlot",
  notify: async () => {},
});

describe("withCapEnforcement typing", () => {
  test("a defineWriteHandler result goes in without a cast and keeps its type", () => {
    const plain = defineWriteHandler({
      name: "send-thing",
      schema: z.object({ to: z.string() }),
      access: { roles: ["User"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    const wrapped = withCapEnforcement(plain, resolver);
    const name: "send-thing" = wrapped.name;
    expect(name).toBe("send-thing");
    expect(wrapped.schema).toBe(plain.schema);
    expect(wrapped.handler).toBe(plain.handler);
    expect(typeof wrapped.reserveBeforeTransaction).toBe("function");
  });

  test("a WriteHandlerDef caller still compiles", () => {
    const def: WriteHandlerDef = {
      name: "send-widget",
      schema: z.object({ to: z.string() }),
      access: { roles: ["User"] },
      handler: async () => ({ isSuccess: true, data: {} }),
    };
    const out: WriteHandlerDef = withCapEnforcement(def, resolver);
    expect(out.name).toBe("send-widget");
  });
});
