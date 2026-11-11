import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
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
    expect(pageHelpViolations(pageHelpFeature({ statusField: "status" }, ALL_HELP))).toEqual([]);
  });

  test("a field that is not a select field is page-help/status-field-invalid", () => {
    const found = pageHelpViolations(pageHelpFeature({ statusField: "title" }, ALL_HELP));
    expect(found.map((v) => v.ruleId)).toEqual(["page-help/status-field-invalid"]);
    expect(found[0]?.message).toContain('screen "doc-list"');
    expect(found[0]?.message).toContain('"title"');
  });

  test("an option without help text names screen, field, option and key", () => {
    const { [`${OPTION}:checked:help`]: _omitted, ...onlyDraft } = ALL_HELP;
    const found = pageHelpViolations(pageHelpFeature({ statusField: "status" }, onlyDraft));
    expect(found.map((v) => v.ruleId)).toEqual(["page-help/option-help-missing"]);
    const message = found[0]?.message ?? "";
    expect(message).toContain('screen "doc-list"');
    expect(message).toContain('"status"');
    expect(message).toContain(`checked -> docs:${OPTION}:checked:help`);
    expect(message).not.toContain("draft ->");
  });

  test("a locale of the option label that the help text lacks is reported", () => {
    const found = pageHelpViolations(
      pageHelpFeature(
        { statusField: "status" },
        { ...ALL_HELP, [`${OPTION}:draft:help`]: { de: "Noch nicht angesehen." } },
      ),
    );
    expect(found.map((v) => v.ruleId)).toContain("page-help/option-help-missing");
    expect(found.map((v) => v.message).join("\n")).toContain("(en)");
  });
});
