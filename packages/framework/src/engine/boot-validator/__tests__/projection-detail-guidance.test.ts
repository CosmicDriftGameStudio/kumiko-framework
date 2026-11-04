import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
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

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const ALL_FIELDS = ["title", "path", "line", "tone", "notice", "steps", "sub"];

function detailFeature(screen: Record<string, unknown>, outputFields = ALL_FIELDS) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:detail",
      schema: z.object({}),
      handler: async () => ({}),
      access: OPEN_TO_ALL,
      outputSchema: z.object(Object.fromEntries(outputFields.map((f) => [f, z.string()]))),
    });
    r.writeHandler({
      name: "archive",
      schema: z.object({ id: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_TO_ALL,
    });
    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "shop:query:order:detail",
      layout: { sections: [{ title: "s", fields: ["title"] }] },
      ...screen,
    } as never);
  });
}

const archive = {
  kind: "writeHandler",
  id: "archive",
  label: "actions.archive",
  handler: "shop:write:archive",
} as const;

describe("projectionDetail record guidance blocks", () => {
  test("all four blocks with actions boot", () => {
    const feature = detailFeature({
      breadcrumb: { field: "path" },
      summary: { field: "line", toneField: "tone" },
      banner: { field: "notice", actions: [archive] },
      steps: { field: "steps", subtitleField: "sub", actions: [archive] },
    });
    expect(ruleIdsOf([feature])).toEqual([]);
  });

  test("an empty field name is projection-detail/guidance-field-empty", () => {
    expect(ruleIdsOf([detailFeature({ summary: { field: "" } })])).toContain(
      "projection-detail/guidance-field-empty",
    );
  });

  test("rowClick on a steps action is screen/header-action-row-click", () => {
    const feature = defineFeature("shop", (r) => {
      r.queryHandler({
        name: "order:detail",
        schema: z.object({}),
        handler: async () => ({}),
        access: OPEN_TO_ALL,
      });
      r.screen({ id: "order-edit", type: "custom", renderer: { react: "stub" } });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: { sections: [{ title: "s", fields: ["title"] }] },
        steps: {
          field: "steps",
          actions: [
            {
              kind: "navigate",
              id: "edit",
              label: "actions.edit",
              screen: "order-edit",
              rowClick: true,
            },
          ],
        },
      });
    });
    expect(ruleIdsOf([feature])).toContain("screen/header-action-row-click");
  });

  test("showOnTabs on a banner action is projection-detail/guidance-action-show-on-tabs", () => {
    const feature = detailFeature({
      banner: { field: "notice", actions: [{ ...archive, showOnTabs: ["a"] }] },
    });
    expect(ruleIdsOf([feature])).toContain("projection-detail/guidance-action-show-on-tabs");
  });

  test("a steps navigate action to an unknown screen is screen/navigate-target-unresolved", () => {
    const feature = detailFeature({
      steps: {
        field: "steps",
        actions: [{ kind: "navigate", id: "edit", label: "actions.edit", screen: "ghost" }],
      },
    });
    expect(ruleIdsOf([feature])).toContain("screen/navigate-target-unresolved");
  });

  test("a banner action without a resolvable icon is rejected", () => {
    const feature = detailFeature({
      banner: { field: "notice", actions: [{ ...archive, id: "zzz-unknown" }] },
    });
    expect(ruleIdsOf([feature])).toContain("screen/action-icon");
  });

  test("a summary.field missing from the outputSchema is query/output-field-missing", () => {
    const feature = detailFeature({ summary: { field: "line" } }, ["title"]);
    expect(ruleIdsOf([feature])).toContain("query/output-field-missing");
  });

  test("a steps.subtitleField missing from the outputSchema is query/output-field-missing", () => {
    const feature = detailFeature({ steps: { field: "steps", subtitleField: "sub" } }, [
      "title",
      "steps",
    ]);
    expect(ruleIdsOf([feature])).toContain("query/output-field-missing");
  });

  test("a metrics toneField missing from the outputSchema is query/output-field-missing", () => {
    const feature = detailFeature(
      { metrics: [{ field: "title", label: "shop:metric:title", toneField: "tone" }] },
      ["title"],
    );
    expect(ruleIdsOf([feature])).toContain("query/output-field-missing");
  });

  test("an empty metrics toneField is projection-detail/guidance-field-empty", () => {
    const feature = detailFeature({
      metrics: [{ field: "title", label: "shop:metric:title", toneField: "" }],
    });
    expect(ruleIdsOf([feature])).toContain("projection-detail/guidance-field-empty");
  });

  test("a metrics toneField present in the outputSchema raises neither rule", () => {
    const feature = detailFeature({
      metrics: [{ field: "title", label: "shop:metric:title", toneField: "tone" }],
    });
    const ids = ruleIdsOf([feature]);
    expect(ids).not.toContain("query/output-field-missing");
    expect(ids).not.toContain("projection-detail/guidance-field-empty");
  });
});
