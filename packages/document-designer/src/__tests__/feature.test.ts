import { describe, expect, test } from "bun:test";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { DocumentDesignerCells, TEMPLATE_EDITOR_SCREENS } from "../constants.js";
import { createDocumentDesignerFeature } from "../feature.js";
import { documentDesignerClient } from "../web/client-plugin.js";

const features = [createTemplateResolverFeature(), createDocumentDesignerFeature()];

describe("document-designer feature", () => {
  test("boots next to template-resolver and fails without it", () => {
    expect(() => validateBoot(features)).not.toThrow();
    expect(() => validateBoot([createDocumentDesignerFeature()])).toThrow();
  });

  test("the overview is a tenant-admin screen and the platform overview is system-admin only", () => {
    const registry = createRegistry(features);
    expect(registry.getScreen("document-designer:screen:templates")?.access).toEqual({
      roles: ["TenantAdmin", "SystemAdmin"],
    });
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

  test("layout rows get an edit action that opens the layout editor with slug and kind", () => {
    const registry = createRegistry(features);
    const screen = registry.getScreen("document-designer:screen:templates");
    if (screen?.type !== "projectionList") throw new Error("not a projectionList");
    const navigate = (screen.rowActions ?? []).filter((action) => action.kind === "navigate");
    expect(navigate.map((action) => action.screen)).toEqual([
      TEMPLATE_EDITOR_SCREENS["mail-layout"],
      TEMPLATE_EDITOR_SCREENS["pdf-layout"],
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
