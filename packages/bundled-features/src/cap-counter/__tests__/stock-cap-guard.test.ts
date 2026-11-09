import { describe, expect, test } from "bun:test";
import { defineWriteHandler, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import * as z from "zod";
import { createStockCapGuard } from "../stock-cap-guard.ts";

const guard = createStockCapGuard(async () => ({ maxItems: 1 }));

describe("withStockCap typing", () => {
  test("a defineWriteHandler result goes in without a cast and keeps its type", () => {
    const plainHandler = defineWriteHandler({
      name: "create-thing",
      schema: z.object({ title: z.string() }),
      access: { roles: ["User"] },
      handler: async (event) => ({
        isSuccess: true as const,
        data: { echoed: event.payload.title },
      }),
    });
    const guarded = guard.withStockCap(plainHandler, {
      table: eventsTable,
      limit: (caps) => caps.maxItems,
      code: "thing_cap_exceeded",
      i18nKey: "cap.thing",
      field: "things",
    });
    const name: "create-thing" = guarded.name;
    expect(name).toBe("create-thing");
    expect(guarded.schema).toBe(plainHandler.schema);
    expect(guarded.handler).not.toBe(plainHandler.handler);
  });

  test("a WriteHandlerDef caller still compiles", () => {
    const def: WriteHandlerDef = {
      name: "create-widget",
      schema: z.object({ title: z.string() }),
      access: { roles: ["User"] },
      handler: async () => ({ isSuccess: true, data: {} }),
    };
    const wrapped: WriteHandlerDef = guard.withStockCap(def, {
      table: eventsTable,
      limit: (caps) => caps.maxItems,
      code: "widget_cap_exceeded",
      i18nKey: "cap.widget",
      field: "widgets",
    });
    expect(wrapped.name).toBe("create-widget");
  });
});
