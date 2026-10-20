import { describe, expect, test } from "bun:test";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import {
  DocumentDesignerCells,
  PDF_TEMPLATE_EDITOR_SCREEN_ID,
  TEMPLATE_EDITOR_SCREENS,
} from "../constants.ts";
import { createDocumentDesignerFeature } from "../feature.ts";
import { documentDesignerClient } from "../web/client-plugin.tsx";

const features = [createTemplateResolverFeature(), createDocumentDesignerFeature()];

describe("document-designer feature", () => {
  test("boots next to template-resolver and fails without it", () => {
    expect(() => validateBoot(features)).not.toThrow();
    expect(() => validateBoot([createDocumentDesignerFeature()])).toThrow();
  });

  test("the tenant screens and navs are SystemAdmin only by default and follow the access option", () => {
    const tenantRules = (registry: ReturnType<typeof createRegistry>) =>
      [
        registry.getScreen("document-designer:screen:templates")?.access,
        registry.getNav("document-designer:nav:templates")?.access,
        registry.getScreen("document-designer:screen:layout-editor")?.access,
        registry.getScreen("document-designer:screen:mail-editor")?.access,
        registry.getScreen(`document-designer:screen:${PDF_TEMPLATE_EDITOR_SCREEN_ID}`)?.access,
      ].map((rule) => rule?.roles);
    expect(
      tenantRules(createRegistry(features)).every((r) => r?.length === 1 && r[0] === "SystemAdmin"),
    ).toBe(true);
    const opened = createRegistry([
      createTemplateResolverFeature(),
      createDocumentDesignerFeature({ access: { roles: ["TenantAdmin"] } }),
    ]);
    for (const roles of tenantRules(opened)) expect(roles).toEqual(["SystemAdmin", "TenantAdmin"]);
    expect(opened.getScreen("document-designer:screen:platform-templates")?.access).toEqual({
      roles: ["SystemAdmin"],
    });
  });

  test("the platform overview is system-admin only", () => {
    const registry = createRegistry(features);
    expect(registry.getScreen("document-designer:screen:platform-templates")?.access).toEqual({
      roles: ["SystemAdmin"],
    });
    expect(registry.getNav("document-designer:nav:templates")?.screen).toBe(
      "document-designer:screen:templates",
    );
    expect(registry.getNav("document-designer:nav:platform-templates")?.screen).toBe(
      "document-designer:screen:platform-templates",
    );
  });

  test("only the platform overview has the customised-by column", () => {
    const registry = createRegistry(features);
    const columnFields = (id: string): string[] => {
      const screen = registry.getScreen(id);
      if (screen?.type !== "projectionList") throw new Error(`${id} is not a projectionList`);
      return screen.columns.map((column) => (typeof column === "string" ? column : column.field));
    };
    expect(columnFields("document-designer:screen:templates")).not.toContain("overriddenBy");
    expect(columnFields("document-designer:screen:platform-templates")).toContain("overriddenBy");
  });

  test("mail, PDF and layout rows get an edit action with slug and kind", () => {
    const registry = createRegistry(features);
    const screen = registry.getScreen("document-designer:screen:templates");
    if (screen?.type !== "projectionList") throw new Error("not a projectionList");
    const navigate = (screen.rowActions ?? []).filter((action) => action.kind === "navigate");
    expect(navigate.map((action) => [action.id, action.screen])).toEqual([
      ["edit-mail", TEMPLATE_EDITOR_SCREENS.mail],
      ["edit-document-pdf", TEMPLATE_EDITOR_SCREENS["document-pdf"]],
      ["edit-mail-layout", TEMPLATE_EDITOR_SCREENS["mail-layout"]],
      ["edit-pdf-layout", TEMPLATE_EDITOR_SCREENS["pdf-layout"]],
    ]);
  });

  test("the client plugin provides exactly the cell renderers the platform overview names", () => {
    const registry = createRegistry(features);
    const screen = registry.getScreen("document-designer:screen:platform-templates");
    if (screen?.type !== "projectionList") throw new Error("not a projectionList");
    const named = Object.values(DocumentDesignerCells).filter((name) =>
      JSON.stringify(screen.columns).includes(name),
    );
    const provided = Object.keys(documentDesignerClient().columnRenderers ?? {});
    expect(provided.sort()).toEqual(named.sort());
  });
});

describe("document-designer PDF editor screen", () => {
  test("is a dormant custom screen of the feature that the PDF edit action targets", () => {
    const registry = createRegistry(features);
    const screen = registry.getScreen(`document-designer:screen:${PDF_TEMPLATE_EDITOR_SCREEN_ID}`);
    expect(screen?.type).toBe("custom");
    expect(screen?.dormant).toBe(true);
    expect(TEMPLATE_EDITOR_SCREENS["document-pdf"]).toBe(PDF_TEMPLATE_EDITOR_SCREEN_ID);
    expect(documentDesignerClient().components).toHaveProperty(PDF_TEMPLATE_EDITOR_SCREEN_ID);
  });
});
