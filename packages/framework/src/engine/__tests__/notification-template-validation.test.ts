import { describe, expect, test } from "bun:test";
import type {
  NotificationLocalizedTemplate,
  TemplateVariables,
} from "@cosmicdrift/kumiko-types/config";
import * as z from "zod";
import { defineFeature } from "../define-feature.ts";
import { createRegistry } from "../registry.ts";
import { templateVariable } from "../template-variables.ts";

type NotificationDeclaration = {
  readonly trigger?: { readonly on: string };
  readonly variables?: TemplateVariables;
  readonly template?: Readonly<Record<string, { readonly body: string }>>;
  readonly meta?: Readonly<Record<string, { readonly subject: string }>>;
  readonly localizedTemplate?: () => NotificationLocalizedTemplate;
};

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
  test("helper names are reserved variable names", () => {
    for (const reserved of ["link", "money", "date"]) {
      expect(() =>
        createRegistry([
          featureWithNotification("welcome-mail", {
            ...goodTemplate,
            variables: { [reserved]: templateVariable.text() },
          }),
        ]),
      ).toThrow(new RegExp(reserved));
    }
  });
});

describe("r.notification without trigger", () => {
  function featureWith(declaration: NotificationDeclaration) {
    return defineFeature("mailer", (r) => {
      r.notification("welcome-mail", declaration);
    });
  }

  test("a notification without trigger, recipient and data registers", () => {
    const registry = createRegistry([featureWith({ variables: goodTemplate.variables })]);
    expect(
      registry.getAllNotifications().get("mailer:notify:welcome-mail")?.trigger,
    ).toBeUndefined();
  });

  test("a trigger without recipient and data is rejected at boot", () => {
    expect(() => createRegistry([featureWith({ trigger: { on: "create" } })])).toThrow(
      /trigger but no recipient and data/,
    );
  });

  test("localizedTemplate resolves into template and meta", () => {
    const registry = createRegistry([
      featureWith({
        variables: goodTemplate.variables,
        localizedTemplate: () => ({ de: { body: "<p>Hallo</p>", meta: { subject: "Hallo" } } }),
      }),
    ]);
    const def = registry.getAllNotifications().get("mailer:notify:welcome-mail");
    expect(def?.template).toEqual({ de: { body: "<p>Hallo</p>" } });
    expect(def?.meta).toEqual({ de: { subject: "Hallo" } });
  });

  test("localizedTemplate together with template is rejected at boot", () => {
    expect(() =>
      createRegistry([
        featureWith({
          ...goodTemplate,
          localizedTemplate: () => ({ de: { body: "<p>Hallo</p>", meta: { subject: "Hallo" } } }),
        }),
      ]),
    ).toThrow(/pick one/);
  });
});
