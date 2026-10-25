import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import type { ScreenDefinition } from "../types/screen.ts";

const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

type GatedScreen = Pick<ScreenDefinition, "visibleWhen" | "fallback">;

function gatedFeature(
  gate: GatedScreen,
  upgradeGate: GatedScreen = {},
  gatedScreen: { readonly type: "projectionList" | "projectionDetail" } = {
    type: "projectionList",
  },
) {
  return defineFeature("demo", (r) => {
    r.queryHandler({
      name: "tier:scoped-status",
      schema: z.object({ tierId: z.string() }),
      handler: async () => ({ enabled: true }),
      access: OPEN,
      outputSchema: z.object({ enabled: z.boolean() }),
    });
    r.queryHandler({
      name: "tier:status",
      schema: z.object({}),
      handler: async () => ({ enabled: true }),
      access: OPEN,
      outputSchema: z.object({ enabled: z.boolean() }),
    });
    r.queryHandler({
      name: "tier:detail-status",
      schema: z.object({ recordId: z.string().uuid() }),
      handler: async () => ({ enabled: true }),
      access: OPEN,
      outputSchema: z.object({ enabled: z.boolean() }),
    });
    r.queryHandler({
      name: "tier:detail-status-extra",
      schema: z.object({ recordId: z.string().uuid(), other: z.string() }),
      handler: async () => ({ enabled: true }),
      access: OPEN,
      outputSchema: z.object({ enabled: z.boolean() }),
    });
    r.queryHandler({
      name: "items:list",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN,
    });
    r.screen({
      id: "upgrade",
      type: "projectionList",
      query: "demo:query:items:list",
      columns: ["name"],
      ...upgradeGate,
    });
    if (gatedScreen.type === "projectionDetail") {
      r.screen({
        id: "items",
        type: "projectionDetail",
        query: "demo:query:items:list",
        layout: { sections: [{ title: "s", fields: ["name"] }] },
        ...gate,
      });
    } else {
      r.screen({
        id: "items",
        type: "projectionList",
        query: "demo:query:items:list",
        columns: ["name"],
        ...gate,
      });
    }
    r.translations({
      keys: {
        "screen:items.title": { de: "Artikel", en: "Items" },
        "screen:upgrade.title": { de: "Upgrade", en: "Upgrade" },
        "entity:__projection-detail__:field:name": { de: "Name", en: "Name" },
      },
    });
  });
}

describe("validateBoot — screen visibleWhen", () => {
  test("accepts a known query, field and fallback screen", () => {
    const feature = gatedFeature({
      visibleWhen: { query: "demo:query:tier:status", field: "enabled", eq: true },
      fallback: "upgrade",
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects an unknown visibleWhen query", () => {
    const feature = gatedFeature({
      visibleWhen: { query: "demo:query:tier:ghost", field: "enabled", eq: true },
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "items" \(projectionList\) visibleWhen query "demo:query:tier:ghost" is not a registered query-handler/,
    );
  });

  test("rejects a visibleWhen field missing from the outputSchema", () => {
    const feature = gatedFeature({
      visibleWhen: { query: "demo:query:tier:status", field: "enable", eq: true },
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "items" \(projectionList\) visibleWhen references field "enable" which is not present in query "demo:query:tier:status"'s outputSchema/,
    );
  });

  test("rejects a visibleWhen query whose input requires fields", () => {
    const feature = gatedFeature({
      visibleWhen: { query: "demo:query:tier:scoped-status", field: "enabled", eq: true },
    });
    expect(() => validateBoot([feature])).toThrow(
      /visibleWhen query "demo:query:tier:scoped-status" requires input; visibleWhen queries run with an empty payload/,
    );
  });

  test("rejects a fallback that resolves to no registered screen", () => {
    const feature = gatedFeature({
      visibleWhen: { query: "demo:query:tier:status", field: "enabled", eq: true },
      fallback: "ghost",
    });
    expect(() => validateBoot([feature])).toThrow(/fallback "ghost" does not resolve/);
  });

  test("rejects a fallback without visibleWhen", () => {
    const feature = gatedFeature({ fallback: "upgrade" });
    expect(() => validateBoot([feature])).toThrow(/fallback without visibleWhen/);
  });

  test("rejects a fallback pointing at the screen itself", () => {
    const feature = gatedFeature({
      visibleWhen: { query: "demo:query:tier:status", field: "enabled", eq: true },
      fallback: "items",
    });
    expect(() => validateBoot([feature])).toThrow(/fallback points at the screen itself/);
  });

  test("rejects a fallback that carries its own visibleWhen", () => {
    const visibleWhen = { query: "demo:query:tier:status", field: "enabled", eq: true };
    const feature = gatedFeature({ visibleWhen, fallback: "upgrade" }, { visibleWhen });
    expect(() => validateBoot([feature])).toThrow(/fallback "upgrade" has its own visibleWhen/);
  });

  describe("idParam", () => {
    const detailGate = (query: string) => ({
      visibleWhen: { query, field: "enabled", eq: true, idParam: "recordId" },
    });

    test("accepts a query with a required id on projectionDetail", () => {
      const feature = gatedFeature(
        detailGate("demo:query:tier:detail-status"),
        {},
        {
          type: "projectionDetail",
        },
      );
      expect(() => validateBoot([feature])).not.toThrow();
    });

    test("rejects the same query without idParam, pointing at idParam", () => {
      const feature = gatedFeature(
        { visibleWhen: { query: "demo:query:tier:detail-status", field: "enabled", eq: true } },
        {},
        { type: "projectionDetail" },
      );
      expect(() => validateBoot([feature])).toThrow(/requires input; .*set visibleWhen\.idParam/);
    });

    test("rejects idParam on a screen type without a route id", () => {
      const feature = gatedFeature(detailGate("demo:query:tier:detail-status"));
      expect(() => validateBoot([feature])).toThrow(
        /Screen "items" \(projectionList\) visibleWhen\.idParam is only supported on projectionDetail/,
      );
    });

    test("rejects a query that needs another required field besides the id", () => {
      const feature = gatedFeature(
        detailGate("demo:query:tier:detail-status-extra"),
        {},
        {
          type: "projectionDetail",
        },
      );
      expect(() => validateBoot([feature])).toThrow(/requires input beyond idParam "recordId"/);
    });
  });
});
