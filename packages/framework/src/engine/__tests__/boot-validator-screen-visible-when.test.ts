import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import type { ScreenDefinition } from "../types/screen.js";

const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

type GatedScreen = Pick<ScreenDefinition, "visibleWhen" | "fallback">;

function gatedFeature(gate: GatedScreen, upgradeGate: GatedScreen = {}) {
  return defineFeature("demo", (r) => {
    r.queryHandler("tier:status", z.object({}), async () => ({ enabled: true }), {
      access: OPEN,
      outputSchema: z.object({ enabled: z.boolean() }),
    });
    r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
      access: OPEN,
    });
    r.screen({
      id: "upgrade",
      type: "projectionList",
      query: "demo:query:items:list",
      columns: ["name"],
      ...upgradeGate,
    });
    r.screen({
      id: "items",
      type: "projectionList",
      query: "demo:query:items:list",
      columns: ["name"],
      ...gate,
    });
    r.translations({
      keys: {
        "screen:items.title": { de: "Artikel", en: "Items" },
        "screen:upgrade.title": { de: "Upgrade", en: "Upgrade" },
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
});
