import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../define-feature.js";
import { createRegistry } from "../registry.js";
import { templateVariable } from "../template-variables.js";
import type { TemplateVariables } from "../types/index.js";

type TemplateDeclaration = {
  readonly variables?: TemplateVariables;
  readonly template?: Readonly<Record<string, { readonly body: string }>>;
  readonly meta?: Readonly<Record<string, { readonly subject: string }>>;
};

function featureWithNotification(name: string, declaration: TemplateDeclaration) {
  return defineFeature("mailer", (r) => {
    r.writeHandler({
      name: "create",
      schema: z.object({}),
      access: { roles: ["TenantAdmin"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    r.notification(name, {
      trigger: { on: "create" },
      recipient: () => null,
      data: () => ({}),
      ...declaration,
    });
  });
}

const goodTemplate: TemplateDeclaration = {
  variables: { name: templateVariable.text({ required: true }) },
  template: { de: { body: "<p>Hallo</p>" } },
  meta: { de: { subject: "Hallo" } },
};

describe("r.notification template declaration", () => {
  test("a complete declaration registers", () => {
    const registry = createRegistry([featureWithNotification("welcome-mail", goodTemplate)]);
    expect(registry.getAllNotifications().get("mailer:notify:welcome-mail")?.template).toEqual(
      goodTemplate.template,
    );
  });

  test("a template locale without meta subject is rejected at boot", () => {
    expect(() =>
      createRegistry([featureWithNotification("welcome-mail", { ...goodTemplate, meta: {} })]),
    ).toThrow(/no meta\.de\.subject/);
  });

  test("a non-kebab notification name is rejected when a template is declared", () => {
    expect(() => createRegistry([featureWithNotification("welcomeMail", goodTemplate)])).toThrow(
      /kebab-case/,
    );
  });

  test("an invalid variable name is rejected, also inside list items", () => {
    expect(() =>
      createRegistry([
        featureWithNotification("welcome-mail", {
          ...goodTemplate,
          variables: { "bad-name": templateVariable.text() },
        }),
      ]),
    ).toThrow(/not a valid placeholder name/);
    expect(() =>
      createRegistry([
        featureWithNotification("welcome-mail", {
          ...goodTemplate,
          variables: { lines: templateVariable.list({ constructor: templateVariable.text() }) },
        }),
      ]),
    ).toThrow(/constructor/);
  });

  test("a variable named like a system placeholder is rejected", () => {
    for (const reserved of ["tenantName", "signature", "imprint", "unsubscribeUrl"]) {
      expect(() =>
        createRegistry([
          featureWithNotification("welcome-mail", {
            ...goodTemplate,
            variables: { [reserved]: templateVariable.text() },
          }),
        ]),
      ).toThrow(/collides with a system placeholder/);
    }
  });

  test("notifications without a template keep working with any name", () => {
    expect(() => createRegistry([featureWithNotification("welcomeMail", {})])).not.toThrow();
  });
});
