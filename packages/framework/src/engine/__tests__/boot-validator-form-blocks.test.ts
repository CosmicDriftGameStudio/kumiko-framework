import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { BootValidationError } from "../boot-validator/boot-rule.ts";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";

type Feature = Parameters<typeof validateBoot>[0][number];

function bootRuleIds(feature: Feature): string[] {
  try {
    validateBoot(withBootValidatorFixture([feature]));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  return [];
}

const ACCESS = { openToAll: { reason: "test handler callable by any signed-in test user" } };

type Field = Record<string, unknown>;

function actionFormFeature(opts: {
  readonly fields?: Record<string, Field>;
  readonly layoutFields: readonly (string | Field)[];
  readonly fieldDescriptions?: Record<string, unknown>;
  readonly sectionId?: string;
  readonly preview?: Record<string, unknown>;
}): Feature {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "draft",
      schema: z.object({}),
      handler: async () => ({}),
      access: ACCESS,
    });
    r.writeHandler({
      name: "approve",
      schema: z.object({}),
      handler: async () => ({ isSuccess: true as const, data: null }),
      access: ACCESS,
    });
    r.screen({
      id: "approve-form",
      type: "actionForm",
      handler: "shop:write:approve",
      fields: (opts.fields ?? {
        note: { type: "text" },
        count: { type: "number" },
        hints: { type: "jsonb" },
      }) as never,
      layout: {
        sections: [
          {
            ...(opts.sectionId !== undefined && { id: opts.sectionId }),
            title: "s",
            fields: opts.layoutFields as never,
          },
        ],
      },
      ...(opts.preview !== undefined && { preview: opts.preview as never }),
      ...(opts.fieldDescriptions !== undefined && {
        fieldDescriptions: opts.fieldDescriptions as never,
      }),
    });
  });
}

const GOOD_ASSIST = {
  query: "shop:query:draft",
  resultField: "message",
  chips: [{ label: "k.short", params: { style: "short" } }],
};

function noteWith(aiAssist: Record<string, unknown>): Field {
  return { field: "note", aiAssist };
}

describe("validateBoot — form blocks (aiAssist, valueChips, fieldDescriptions)", () => {
  test("fieldDescriptions params must name fields of the form", () => {
    const withParam = (param: string) =>
      bootRuleIds(
        actionFormFeature({
          layoutFields: ["note", "count", "hints"],
          fieldDescriptions: { note: { key: "k.help", params: { who: param } } },
        }),
      );
    expect(withParam("count")).toEqual([]);
    expect(withParam("nope")).toEqual(["form/field-text-param-unknown-field"]);
  });

  test("a valid aiAssist and valueChips pass", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [
            noteWith({ ...GOOD_ASSIST, prompt: { param: "instruction" } }),
            { field: "count", valueChips: { from: "hints" } },
            "hints",
          ],
          fieldDescriptions: { note: "k.help" },
        }),
      ),
    ).toEqual([]);
  });

  test("aiAssist.query that is no registered query handler", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [noteWith({ ...GOOD_ASSIST, query: "shop:query:ghost" })],
        }),
      ),
    ).toContain("query/not-registered");
  });

  test("aiAssist on a number field", () => {
    expect(
      bootRuleIds(actionFormFeature({ layoutFields: [{ field: "count", aiAssist: GOOD_ASSIST }] })),
    ).toEqual(["form/ai-assist-field-type"]);
  });

  test("aiAssist on a sensitive field", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          fields: { note: { type: "text", sensitive: true } },
          layoutFields: [noteWith(GOOD_ASSIST)],
        }),
      ),
    ).toEqual(["form/ai-assist-sensitive-field"]);
  });

  test("editor document needs a longText field", () => {
    const withNote = (note: Field) =>
      bootRuleIds(
        actionFormFeature({
          fields: { note, count: { type: "number" } },
          layoutFields: [{ field: "note", editor: "document" }, "count"],
        }),
      );
    expect(withNote({ type: "longText" })).toEqual([]);
    expect(withNote({ type: "text" })).toEqual(["form/editor-field-type"]);
  });

  test("editor document rejects fillAction and valueChips", () => {
    const withExtra = (extra: Record<string, unknown>) =>
      bootRuleIds(
        actionFormFeature({
          fields: { note: { type: "longText" }, count: { type: "number" } },
          layoutFields: [{ field: "note", editor: "document", ...extra }, "count"],
        }),
      );
    expect(
      withExtra({ fillAction: { query: "shop:query:draft", label: "k.fill", resultField: "x" } }),
    ).toContain("form/editor-field-type");
    expect(withExtra({ valueChips: { from: "count" } })).toContain("form/editor-field-type");
  });

  test("preview.section must name a fields section id", () => {
    const withSection = (section: string) =>
      bootRuleIds(
        actionFormFeature({
          layoutFields: ["note"],
          sectionId: "recipients",
          preview: { query: "shop:query:draft", facts: [{ field: "n", label: "k.n" }], section },
        }),
      );
    expect(withSection("recipients")).toEqual([]);
    expect(withSection("ghost")).toEqual(["action-form-preview/section-unknown"]);
  });

  test("aiAssist with neither chips nor prompt", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [noteWith({ query: GOOD_ASSIST.query, resultField: "message" })],
        }),
      ),
    ).toEqual(["form/ai-assist-empty"]);
  });

  test("aiAssist chip without params", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [noteWith({ ...GOOD_ASSIST, chips: [{ label: "k.short", params: {} }] })],
        }),
      ),
    ).toEqual(["form/ai-assist-chip-invalid"]);
  });

  test("aiAssist with an empty resultField", () => {
    expect(
      bootRuleIds(
        actionFormFeature({ layoutFields: [noteWith({ ...GOOD_ASSIST, resultField: "" })] }),
      ),
    ).toEqual(["form/ai-assist-result-field-empty"]);
  });

  test("aiAssist prompt with an empty param", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [noteWith({ ...GOOD_ASSIST, prompt: { param: " " } })],
        }),
      ),
    ).toEqual(["form/ai-assist-prompt-param-empty"]);
  });

  test("valueChips on a text field", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [{ field: "note", valueChips: { from: "hints" } }, "hints"],
        }),
      ),
    ).toEqual(["form/value-chips-field-type"]);
  });

  test("valueChips.from naming an unknown field", () => {
    expect(
      bootRuleIds(
        actionFormFeature({ layoutFields: [{ field: "count", valueChips: { from: "ghost" } }] }),
      ),
    ).toEqual(["form/value-chips-unknown-field"]);
  });

  test("fieldDescriptions naming an unknown field", () => {
    expect(
      bootRuleIds(actionFormFeature({ layoutFields: ["note"], fieldDescriptions: { ghost: "k" } })),
    ).toEqual(["form/field-description-unknown-field"]);
  });
});

function listFeature(column: Record<string, unknown>): Feature {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:list",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: ACCESS,
    });
    r.screen({
      id: "order-list",
      type: "projectionList",
      query: "shop:query:order:list",
      columns: [column as never],
    });
    r.translations({ keys: { "screen:order-list.title": { de: "Liste", en: "List" } } });
  });
}

function detailWithPhotoGrid(photoGrid: Record<string, string>): Feature {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:detail",
      schema: z.object({}),
      handler: async () => ({}),
      access: ACCESS,
    });
    r.queryHandler({
      name: "order:photos",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: ACCESS,
    });
    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "shop:query:order:detail",
      layout: {
        sections: [
          {
            kind: "relatedList",
            title: "Photos",
            query: "shop:query:order:photos",
            columns: ["photo", "label"],
            photoGrid: photoGrid as never,
          },
        ],
      },
    });
  });
}

describe("validateBoot — list blocks (pill columns, photoGrid)", () => {
  test("a pill column passes", () => {
    expect(
      bootRuleIds(listFeature({ field: "note", pillField: "state", pillToneField: "tone" })),
    ).toEqual([]);
  });

  test("pillToneField without pillField", () => {
    expect(bootRuleIds(listFeature({ field: "note", pillToneField: "tone" }))).toEqual([
      "list/pill-tone-without-pill",
    ]);
  });

  test("pillField together with display", () => {
    expect(
      bootRuleIds(listFeature({ field: "note", pillField: "state", display: "badge" })),
    ).toEqual(["list/pill-with-display"]);
  });

  test("photoGrid naming a field that is not a column", () => {
    expect(bootRuleIds(detailWithPhotoGrid({ imageField: "ghost" }))).toEqual([
      "list/photo-grid-field-not-in-columns",
    ]);
  });

  test("photoGrid on columns passes", () => {
    expect(
      bootRuleIds(detailWithPhotoGrid({ imageField: "photo", captionField: "label" })),
    ).toEqual([]);
  });
});

function detailWithSections(sections: readonly Record<string, unknown>[]): Feature {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:detail",
      schema: z.object({}),
      outputSchema: z.object({ note: z.string(), state: z.string() }),
      handler: async () => ({ note: "n", state: "open" }),
      access: ACCESS,
    });
    r.queryHandler({
      name: "order:stock",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: ACCESS,
    });
    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "shop:query:order:detail",
      layout: { mode: "tabs", sections: sections as never },
    });
  });
}

const OVERVIEW_FIELDS: Record<string, unknown> = {
  id: "overview",
  title: "Overview",
  fields: ["note"],
};
const OVERVIEW_STEPS: Record<string, unknown> = {
  id: "overview",
  kind: "stepList",
  title: "How it works",
  field: "note",
};
const OVERVIEW_BLOCKS: readonly Record<string, unknown>[] = [
  OVERVIEW_FIELDS,
  {
    id: "overview",
    kind: "relatedList",
    title: "Stock",
    query: "shop:query:order:stock",
    columns: ["name"],
  },
  OVERVIEW_STEPS,
];

describe("validateBoot — projectionDetail composite tabs, section visibleWhen, stepList", () => {
  test("adjacent sections sharing an id form one tab", () => {
    expect(
      bootRuleIds(
        detailWithSections([
          ...OVERVIEW_BLOCKS,
          { id: "history", title: "History", fields: ["note"] },
        ]),
      ),
    ).toEqual([]);
  });

  test("a section id that returns after another tab is a duplicate", () => {
    expect(
      bootRuleIds(
        detailWithSections([
          OVERVIEW_FIELDS,
          { id: "history", title: "History", fields: ["note"] },
          OVERVIEW_STEPS,
        ]),
      ),
    ).toEqual(["form/tab-id-duplicate"]);
  });

  test("stepList reading a field the query does not output", () => {
    expect(
      bootRuleIds(
        detailWithSections([
          OVERVIEW_FIELDS,
          { id: "history", kind: "stepList", title: "Steps", field: "ghost" },
        ]),
      ),
    ).toEqual([expect.stringContaining("output")]);
  });

  test("visibleWhen on a field the query outputs passes, on a ghost field it fails", () => {
    const withCondition = (field: string): Feature =>
      detailWithSections([
        { id: "overview", title: "Overview", fields: ["note"] },
        { id: "history", title: "History", fields: ["note"], visibleWhen: { field, eq: "open" } },
      ]);
    expect(bootRuleIds(withCondition("state"))).toEqual([]);
    expect(bootRuleIds(withCondition("ghost"))).not.toEqual([]);
  });

  test("stepList on an actionForm layout is rejected", () => {
    expect(
      bootRuleIds(
        defineFeature("shop", (r) => {
          r.writeHandler({
            name: "approve",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: ACCESS,
          });
          r.screen({
            id: "approve-form",
            type: "actionForm",
            handler: "shop:write:approve",
            fields: { note: { type: "text" } } as never,
            layout: {
              sections: [
                { title: "s", fields: ["note"] },
                { kind: "stepList", title: "Steps", field: "note" },
              ],
            } as never,
          });
        }),
      ),
    ).toEqual(["form/step-list-section-unsupported"]);
  });
});

describe("validateBoot — actionForm fieldBadges and aiAssist.contextFields", () => {
  test("fieldBadges naming a field of the form passes, a ghost fails", () => {
    const withBadge = (field: string): Feature =>
      defineFeature("shop", (r) => {
        r.writeHandler({
          name: "approve",
          schema: z.object({}),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: ACCESS,
        });
        r.screen({
          id: "approve-form",
          type: "actionForm",
          handler: "shop:write:approve",
          fields: { note: { type: "text" } } as never,
          layout: { sections: [{ title: "s", fields: ["note"] }] },
          fieldBadges: { [field]: { label: "k.open", tone: "warn" } },
        });
      });
    expect(bootRuleIds(withBadge("note"))).toEqual([]);
    expect(bootRuleIds(withBadge("ghost"))).toEqual(["form/field-badge-unknown-field"]);
  });

  test("aiAssist.contextFields naming an unknown field", () => {
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [noteWith({ ...GOOD_ASSIST, contextFields: ["ghost"] })],
        }),
      ),
    ).toEqual(["form/ai-assist-context-field-unknown"]);
    expect(
      bootRuleIds(
        actionFormFeature({
          layoutFields: [noteWith({ ...GOOD_ASSIST, contextFields: ["count"] }), "count"],
        }),
      ),
    ).toEqual([]);
  });
});

describe("validateBoot — actionForm summary.paramsFromLoad", () => {
  const withParams = (field: string): Feature =>
    defineFeature("shop", (r) => {
      r.queryHandler({
        name: "order:detail",
        schema: z.object({}),
        outputSchema: z.object({ buyerName: z.string() }),
        handler: async () => ({ buyerName: "x" }),
        access: ACCESS,
      });
      r.writeHandler({
        name: "approve",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: ACCESS,
      });
      r.screen({
        id: "approve-form",
        type: "actionForm",
        handler: "shop:write:approve",
        fields: { note: { type: "text" } } as never,
        layout: { sections: [{ title: "s", fields: ["note"] }] },
        load: { query: "shop:query:order:detail" },
        summary: { title: "k.title", paramsFromLoad: [field] },
      });
    });

  test("a field of the load query passes, a ghost field fails", () => {
    expect(bootRuleIds(withParams("buyerName"))).toEqual([]);
    expect(bootRuleIds(withParams("ghost"))).toEqual(["query/output-field-missing"]);
  });
});
