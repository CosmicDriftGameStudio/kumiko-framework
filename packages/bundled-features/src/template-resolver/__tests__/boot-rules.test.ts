import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createTemplateResolverFeature } from "../feature.ts";

const access = { roles: ["TenantAdmin"] };

describe("template-resolver boot rules", () => {
  test("a collection of a refused kind violates collection-refused-kind", () => {
    const error = bootRuleViolationOf(() =>
      createTemplateResolverFeature({
        collections: [
          {
            id: "entries",
            kind: "mail",
            access: { roles: ["Agent"] },
            nav: { label: "mail:nav.snippets" },
          },
        ],
      }),
    );
    expect(error.rule.id).toBe("template-resolver/collection-refused-kind");
    expect(error.message).toContain("which collections may not write");
  });

  test("a repeated tenantEditable entry violates tenant-editable-duplicate", () => {
    const error = bootRuleViolationOf(() =>
      createTemplateResolverFeature({
        tenantEditable: [
          { kind: "mail", slug: "welcome", access },
          { kind: "mail", slug: "welcome", access },
        ],
      }),
    );
    expect(error.rule.id).toBe("template-resolver/tenant-editable-duplicate");
    expect(error.message).toContain('tenantEditable lists "mail/welcome" twice');
  });

  test("a tenantEditable entry without roles violates tenant-editable-invalid-entry", () => {
    const error = bootRuleViolationOf(() =>
      createTemplateResolverFeature({
        tenantEditable: [{ kind: "mail", slug: "welcome", access: { roles: [] } }],
      }),
    );
    expect(error.rule.id).toBe("template-resolver/tenant-editable-invalid-entry");
    expect(error.message).toContain("has no roles in access");
  });
});
