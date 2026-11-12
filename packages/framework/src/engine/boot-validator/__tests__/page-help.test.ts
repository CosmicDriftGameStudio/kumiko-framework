import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createSelectField, createTextField } from "../../factories.ts";
import { BootValidationError } from "../boot-rule.ts";

const PII = { personal: false, reason: "test_fixture" } as const;
const OPTION = "entity:doc:field:status:option";

type Violation = { readonly ruleId: string; readonly message: string };

function violationsOf(features: Parameters<typeof validateBootRaw>[0]): readonly Violation[] {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations;
    throw e;
  }
  return [];
}

const statusHelp = (field: string, entity?: string) => ({
  sections: [{ kind: "status", field, ...(entity !== undefined && { entity }) }],
});

function pageHelpFeature(
  pageHelp: Record<string, unknown>,
  helpTexts: Record<string, Record<string, string>>,
) {
  return defineFeature("docs", (r) => {
    r.entity({
      name: "doc",
      ...createEntity({
        fields: {
          title: createTextField({ ...PII, sortable: true }),
          status: createSelectField({ ...PII, options: ["draft", "checked"] as const }),
        },
      }),
    });
    r.screen({
      id: "doc-list",
      type: "entityList",
      entity: "doc",
      columns: ["title"],
      defaultSort: { field: "title", dir: "asc" },
      pageHelp,
    } as never);
    r.translations({
      keys: {
        [`${OPTION}:draft`]: { de: "Ungeprüft", en: "Unchecked" },
        [`${OPTION}:checked`]: { de: "Geprüft", en: "Checked" },
        ...helpTexts,
      },
    });
  });
}

const ALL_HELP = {
  [`${OPTION}:draft:help`]: { de: "Noch nicht angesehen.", en: "Not looked at yet." },
  [`${OPTION}:checked:help`]: { de: "Freigegeben.", en: "Approved." },
};

function pageHelpViolations(feature: ReturnType<typeof pageHelpFeature>): readonly Violation[] {
  return violationsOf([feature]).filter((v) => v.ruleId.startsWith("page-help/"));
}

describe("pageHelp boot rules", () => {
  test("a select field with help text for every option and locale boots", () => {
    expect(pageHelpViolations(pageHelpFeature(statusHelp("status"), ALL_HELP))).toEqual([]);
  });

  test("each status section of one pageHelp is checked, text sections are not", () => {
    const sections = [
      { kind: "text", title: "docs:t", text: "docs:b" },
      { kind: "status", field: "status" },
      { kind: "status", field: "title" },
    ];
    const found = pageHelpViolations(pageHelpFeature({ sections }, ALL_HELP));
    expect(found.map((v) => v.ruleId)).toEqual(["page-help/status-field-invalid"]);
  });

  test("a field that is not a select field is page-help/status-field-invalid", () => {
    const found = pageHelpViolations(pageHelpFeature(statusHelp("title"), ALL_HELP));
    expect(found.map((v) => v.ruleId)).toEqual(["page-help/status-field-invalid"]);
    expect(found[0]?.message).toContain('screen "doc-list"');
    expect(found[0]?.message).toContain('"title"');
  });

  test("an option without help text names screen, field, option and key", () => {
    const { [`${OPTION}:checked:help`]: _omitted, ...onlyDraft } = ALL_HELP;
    const found = pageHelpViolations(pageHelpFeature(statusHelp("status"), onlyDraft));
    expect(found.map((v) => v.ruleId)).toEqual(["page-help/option-help-missing"]);
    const message = found[0]?.message ?? "";
    expect(message).toContain('screen "doc-list"');
    expect(message).toContain('"status"');
    expect(message).toContain(`checked -> docs:${OPTION}:checked:help`);
    expect(message).not.toContain("draft ->");
  });

  test("a locale of the option label that the help text lacks is reported", () => {
    const found = pageHelpViolations(
      pageHelpFeature(statusHelp("status"), {
        ...ALL_HELP,
        [`${OPTION}:draft:help`]: { de: "Noch nicht angesehen." },
      }),
    );
    expect(found.map((v) => v.ruleId)).toContain("page-help/option-help-missing");
    expect(found.map((v) => v.message).join("\n")).toContain("(en)");
  });

  describe("entity of another feature", () => {
    function casesFeature(pageHelp: Record<string, unknown>) {
      return defineFeature("cases", (r) => {
        for (const name of ["case-detail", "doc-list"]) {
          r.queryHandler({
            name,
            schema: z.object({}),
            handler: async () => [],
            access: { roles: ["Admin"] },
          });
        }
        r.screen({
          id: "case-detail",
          type: "projectionDetail",
          query: "cases:query:case-detail",
          layout: {
            sections: [
              {
                kind: "relatedList",
                title: "cases.docs",
                query: "cases:query:doc-list",
                entity: "docs:doc",
                columns: ["title"],
                pageHelp,
              },
            ],
          },
        } as never);
      });
    }

    function violationsFor(docs: ReturnType<typeof pageHelpFeature>, pageHelp: object) {
      return violationsOf([docs, casesFeature(pageHelp as Record<string, unknown>)]).filter((v) =>
        v.ruleId.startsWith("page-help/"),
      );
    }

    test("a relatedList section resolves entity and help texts from the owning feature", () => {
      const docs = pageHelpFeature(statusHelp("status"), ALL_HELP);
      expect(violationsFor(docs, statusHelp("status"))).toEqual([]);
      expect(violationsFor(docs, statusHelp("status", "docs:doc"))).toEqual([]);
    });

    test("a missing help key is reported with the owning feature's key", () => {
      const { [`${OPTION}:checked:help`]: _omitted, ...onlyDraft } = ALL_HELP;
      const found = violationsFor(
        pageHelpFeature(statusHelp("status"), onlyDraft),
        statusHelp("status"),
      );
      const message = found.find((v) => v.message.includes("relatedList"))?.message;
      expect(message).toContain('relatedList "cases.docs"');
      expect(message).toContain(`checked -> docs:${OPTION}:checked:help`);
    });

    test("an unknown feature or entity stays an error", () => {
      const docs = pageHelpFeature(statusHelp("status"), ALL_HELP);
      const unknownFeature = violationsFor(docs, statusHelp("status", "nope:doc"));
      expect(unknownFeature.map((v) => v.ruleId)).toEqual(["page-help/status-field-invalid"]);
      expect(unknownFeature[0]?.message).toContain('unknown feature "nope"');
      const unknownEntity = violationsFor(docs, statusHelp("status", "docs:nope"));
      expect(unknownEntity.map((v) => v.ruleId)).toEqual(["page-help/status-field-invalid"]);
    });
  });

  test("a relatedList pageHelp on an entityEdit is rejected, it would never be shown", () => {
    const feature = defineFeature("docs", (r) => {
      r.entity({
        name: "doc",
        ...createEntity({ fields: { title: createTextField({ ...PII, sortable: true }) } }),
      });
      r.queryHandler({
        name: "related",
        schema: z.object({}),
        handler: async () => [],
        access: { roles: ["Admin"] },
      });
      r.screen({
        id: "doc-edit",
        type: "entityEdit",
        entity: "doc",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "docs.related",
              query: "docs:query:related",
              columns: ["title"],
              pageHelp: statusHelp("status", "doc"),
            },
          ],
        },
      } as never);
    });
    const found = pageHelpViolations(feature);
    expect(found.map((v) => v.ruleId)).toEqual(["page-help/unsupported-site"]);
    expect(found[0]?.message).toContain('relatedList "docs.related"');
  });
});
