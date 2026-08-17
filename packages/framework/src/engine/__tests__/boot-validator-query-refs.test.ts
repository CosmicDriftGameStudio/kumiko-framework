import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// fw#2178: a screen's `query` (or a relatedList/dashboard-panel query) must
// resolve to a query-handler actually registered via r.queryHandler(...) —
// mirrors the existing rowAction/toolbarAction handler-existence check.
describe("validateBoot — query QN refs (fw#2178)", () => {
  test("projectionList with a dead query QN throws (a)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:ghost",
        columns: ["description"],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /query "ledger:query:schedule:ghost" is not a registered query-handler/,
    );
  });

  // (b) targets projectionDetail rather than entityEdit: screens.ts
  // unconditionally rejects a relatedList section on entityEdit/actionForm/
  // configEdit with its own "projectionDetail-only primitive" error
  // (fw#2166, screens.ts:955/:621/:506) — that fires first in the per-feature
  // loop, before validateQueryRefs ever runs, so a dead QN there can't reach
  // this check. projectionDetail is the one screen type where relatedList is
  // actually reachable.
  test("projectionDetail relatedList section with a dead query QN throws (b)", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("rent:detail", z.object({}), async () => ({ description: "x" }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Payments",
              query: "app:query:rent:payments-ghost",
              columns: ["amount"],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /relatedList section "Payments" query "app:query:rent:payments-ghost" is not a registered query-handler/,
    );
  });

  test("dashboard stat-group child with a dead query QN throws (c)", () => {
    const feature = defineFeature("demo", (r) => {
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [
          {
            kind: "stat-group",
            id: "net-worth",
            label: "demo:dashboard:group:net-worth",
            stats: [
              {
                kind: "stat",
                id: "assets",
                label: "demo:dashboard:panel:assets",
                query: "demo:query:net-worth:assets-ghost",
                valueField: "value",
              },
            ],
          },
        ],
      });
      r.translations({
        keys: {
          "demo:dashboard:group:net-worth": { de: "Net Worth", en: "Net Worth" },
          "demo:dashboard:panel:assets": { de: "Assets", en: "Assets" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /stat-group "net-worth" child "assets" query "demo:query:net-worth:assets-ghost" is not a registered query-handler/,
    );
  });

  test("dashboard filter optionsQuery with a dead query QN throws", () => {
    const feature = defineFeature("demo", (r) => {
      r.queryHandler("open-count", z.object({}), async () => ({ value: "0" }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "overview",
        type: "dashboard",
        filter: {
          id: "region",
          label: "demo:dashboard:filter:region",
          kind: "select",
          optionsQuery: "demo:query:region:options-ghost",
        },
        panels: [
          {
            kind: "stat",
            id: "open",
            label: "demo:dashboard:panel:open",
            query: "demo:query:open-count",
            valueField: "value",
          },
        ],
      });
      r.translations({
        keys: {
          "demo:dashboard:panel:open": { de: "Offen", en: "Open" },
          "demo:dashboard:filter:region": { de: "Region", en: "Region" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /filter "region" query "demo:query:region:options-ghost" is not a registered query-handler/,
    );
  });

  test("a screen referencing a query registered by a different mounted feature does not throw (d)", () => {
    const provider = defineFeature("catalog", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
      });
    });
    const consumer = defineFeature("storefront", (r) => {
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["name"],
      });
      r.translations({
        keys: { "screen:items.title": { de: "Artikel", en: "Items" } },
      });
    });
    expect(() => validateBoot([provider, consumer])).not.toThrow();
  });
});
