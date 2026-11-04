import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { registerStubQueryHandler } from "../../__tests__/stub-query-handler.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { BootValidationError } from "../boot-rule.ts";

function ruleIdsOf(features: Parameters<typeof validateBootRaw>[0]): readonly string[] {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  return [];
}

function messageOf(features: Parameters<typeof validateBootRaw>[0]): string {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof Error) return e.message;
    throw e;
  }
  return "";
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function listQuery(r: Parameters<Parameters<typeof defineFeature>[1]>[0], fields: string[]) {
  r.queryHandler({
    name: "order:list",
    schema: z.object({}),
    handler: async () => ({ rows: [], nextCursor: null }),
    access: OPEN_TO_ALL,
    outputSchema: z.object({
      rows: z.array(z.object(Object.fromEntries(fields.map((f) => [f, z.string()])))),
      nextCursor: z.string().nullable(),
    }),
  });
}

function projectionListFeature(
  screen: Record<string, unknown>,
  fields = ["name", "tone", "hint", "why"],
) {
  return defineFeature("shop", (r) => {
    listQuery(r, fields);
    r.screen({
      id: "orders",
      type: "projectionList",
      query: "shop:query:order:list",
      columns: ["name"],
      ...screen,
    } as never);
  });
}

describe("list row guidance", () => {
  test("a valid rowToneField + hint column boots", () => {
    const feature = projectionListFeature({
      rowToneField: "tone",
      columns: [{ field: "hint", hint: { toneField: "tone", reasonField: "why" } }],
    });
    expect(ruleIdsOf([feature])).toEqual([]);
  });

  test("an empty rowToneField is list/guidance-field-empty", () => {
    expect(ruleIdsOf([projectionListFeature({ rowToneField: "" })])).toContain(
      "list/guidance-field-empty",
    );
  });

  test("hint together with a renderer is list/hint-column-renderer", () => {
    const feature = projectionListFeature({
      columns: [{ field: "hint", hint: {}, renderer: { format: "date" } }],
    });
    expect(ruleIdsOf([feature])).toContain("list/hint-column-renderer");
  });

  test("hint together with display is list/hint-column-display", () => {
    const feature = projectionListFeature({
      columns: [{ field: "hint", hint: {}, display: "badge" }],
    });
    expect(ruleIdsOf([feature])).toContain("list/hint-column-display");
  });

  test("linkParamsField without linkScreenField is list/link-params-without-screen-field", () => {
    const feature = projectionListFeature({
      columns: [{ field: "name", linkParamsField: "why" }],
    });
    expect(ruleIdsOf([feature])).toContain("list/link-params-without-screen-field");
  });

  test("a rowToneField missing from the query outputSchema is query/output-field-missing", () => {
    const feature = projectionListFeature({ rowToneField: "tone" }, ["name"]);
    expect(ruleIdsOf([feature])).toContain("query/output-field-missing");
  });

  test("a hint.reasonField missing from the query outputSchema is query/output-field-missing", () => {
    const feature = projectionListFeature(
      { columns: [{ field: "hint", hint: { reasonField: "why" } }] },
      ["hint"],
    );
    expect(ruleIdsOf([feature])).toContain("query/output-field-missing");
  });

  describe("entityList", () => {
    const entityListFeature = (screen: Record<string, unknown>) =>
      defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          ...screen,
        } as never);
      });

    test("an unknown rowToneField is screen/unknown-field-reference", () => {
      expect(ruleIdsOf([entityListFeature({ rowToneField: "tone" })])).toContain(
        "screen/unknown-field-reference",
      );
    });

    test("an unknown hint.detailField is screen/unknown-field-reference", () => {
      const feature = entityListFeature({
        columns: [{ field: "name", hint: { detailField: "ghost" } }],
      });
      expect(ruleIdsOf([feature])).toContain("screen/unknown-field-reference");
    });

    test("known fields boot", () => {
      const feature = entityListFeature({
        rowToneField: "name",
        columns: [{ field: "name", hint: { detailField: "name" } }],
      });
      expect(ruleIdsOf([feature])).toEqual([]);
    });
  });
});

describe("dashboard list panel", () => {
  const dashboardFeature = (panel: Record<string, unknown>, fields = ["name", "tone"]) =>
    defineFeature("shop", (r) => {
      listQuery(r, fields);
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [
          {
            kind: "list",
            id: "latest",
            label: "shop:dashboard:panel:latest",
            query: "shop:query:order:list",
            columns: ["name"],
            ...panel,
          },
        ],
      } as never);
      r.translations({
        keys: {
          "screen:overview.title": { de: "Übersicht", en: "Overview" },
          "shop:dashboard:panel:latest": { de: "Neueste", en: "Latest" },
        },
      });
    });

  test("hint with display names the dashboard list panel", () => {
    const feature = dashboardFeature({ columns: [{ field: "name", hint: {}, display: "badge" }] });
    expect(ruleIdsOf([feature])).toContain("list/hint-column-display");
    expect(messageOf([feature])).toContain('(dashboard) list-panel "latest"');
  });

  test("linkParamsField without linkScreenField is rejected", () => {
    const feature = dashboardFeature({ columns: [{ field: "name", linkParamsField: "tone" }] });
    expect(ruleIdsOf([feature])).toContain("list/link-params-without-screen-field");
  });

  test("a rowToneField missing from the query outputSchema is rejected", () => {
    const feature = dashboardFeature({ rowToneField: "tone" }, ["name"]);
    expect(ruleIdsOf([feature])).toContain("query/output-field-missing");
  });

  test("rowToneField and a link with params boot", () => {
    const feature = dashboardFeature({
      rowToneField: "tone",
      columns: [{ field: "name", linkScreenField: "tone", linkParamsField: "name" }],
    });
    expect(ruleIdsOf([feature])).toEqual([]);
  });
});

describe("dashboard text panel with a query", () => {
  const textFeature = (panel: Record<string, unknown>) =>
    defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "help:blocks");
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [{ kind: "text", id: "help", ...panel }],
      } as never);
      r.translations({ keys: { "screen:overview.title": { de: "Übersicht", en: "Overview" } } });
    });

  test("neither blocks nor query is dashboard/text-panel-empty", () => {
    const feature = textFeature({ blocks: [] });
    expect(ruleIdsOf([feature])).toContain("dashboard/text-panel-empty");
    expect(messageOf([feature])).toContain("has no blocks and no query");
  });

  test("a query alone is enough", () => {
    expect(ruleIdsOf([textFeature({ query: "shop:query:help:blocks" })])).toEqual([]);
  });

  test("an empty query is dashboard/panel-query-empty", () => {
    expect(
      ruleIdsOf([textFeature({ query: "", blocks: [{ kind: "heading", text: "x" }] })]),
    ).toContain("dashboard/panel-query-empty");
  });

  test("an unregistered query is query/not-registered", () => {
    expect(ruleIdsOf([textFeature({ query: "shop:query:ghost" })])).toContain(
      "query/not-registered",
    );
  });
});

describe("dashboard stat navigate params", () => {
  const statFeature = (params: unknown) =>
    defineFeature("shop", (r) => {
      listQuery(r, ["name"]);
      r.screen({
        id: "orders",
        type: "projectionList",
        query: "shop:query:order:list",
        columns: ["name"],
      });
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "failed",
            label: "shop:dashboard:panel:failed",
            query: "shop:query:order:list",
            valueField: "count",
            navigate: { screen: "orders", params },
          },
        ],
      } as never);
      r.translations({
        keys: {
          "screen:overview.title": { de: "Übersicht", en: "Overview" },
          "screen:orders.title": { de: "Aufträge", en: "Orders" },
          "shop:dashboard:panel:failed": { de: "Fehlgeschlagen", en: "Failed" },
        },
      });
    });

  test("string params boot", () => {
    expect(ruleIdsOf([statFeature({ tab: "failed" })])).not.toContain(
      "dashboard/stat-navigate-params-invalid",
    );
  });

  test("a non-string value is dashboard/stat-navigate-params-invalid", () => {
    expect(ruleIdsOf([statFeature({ tab: 3 })])).toContain(
      "dashboard/stat-navigate-params-invalid",
    );
  });

  test("an empty key is dashboard/stat-navigate-params-invalid", () => {
    expect(ruleIdsOf([statFeature({ "": "x" })])).toContain(
      "dashboard/stat-navigate-params-invalid",
    );
  });
});
