import { describe, expect, test, vi } from "vitest";
import { createEntity, createRegistry, defineFeature } from "../index";

describe("extendsRegistrar", () => {
  test("feature can register an extension", () => {
    const feature = defineFeature("customFields", (r) => {
      r.extendsRegistrar("customFields", {
        onRegister: () => {},
      });
    });

    expect(feature.registrarExtensions["customFields"]).toBeDefined();
  });

  test("another feature can use the extension via r.extensionName()", () => {
    const ext = defineFeature("customFields", (r) => {
      r.extendsRegistrar("customFields", {
        onRegister: () => {},
      });
    });

    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      // biome-ignore lint/suspicious/noExplicitAny: dynamic extension call via Proxy
      (r as any).customFields("vehicle");
    });

    expect(consumer.extensionUsages).toHaveLength(1);
    expect(consumer.extensionUsages[0]?.extensionName).toBe("customFields");
    expect(consumer.extensionUsages[0]?.entityName).toBe("vehicle");
  });

  test("dynamic extension call works via Proxy", () => {
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      // biome-ignore lint/suspicious/noExplicitAny: dynamic extension call via Proxy
      const rx = r as any;
      rx.tags("vehicle");
      rx.customFields("vehicle", { allowTypes: ["text", "number"] });
    });

    expect(consumer.extensionUsages).toHaveLength(2);
    expect(consumer.extensionUsages[0]).toEqual({
      extensionName: "tags",
      entityName: "vehicle",
      options: undefined,
    });
    expect(consumer.extensionUsages[1]).toEqual({
      extensionName: "customFields",
      entityName: "vehicle",
      options: { allowTypes: ["text", "number"] },
    });
  });

  test("registry calls onRegister for each extension usage", () => {
    const onRegister = vi.fn();

    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister });
    });

    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      // biome-ignore lint/suspicious/noExplicitAny: dynamic extension call via Proxy
      (r as any).tags("vehicle");
    });

    createRegistry([ext, consumer]);

    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(onRegister).toHaveBeenCalledWith("vehicle", undefined);
  });

  test("registry throws on duplicate extension name", () => {
    const f1 = defineFeature("a", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const f2 = defineFeature("b", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate registrar extension.*tags/i);
  });

  test("extension with all 5 levels", () => {
    const ext = defineFeature("customFields", (r) => {
      r.extendsRegistrar("customFields", {
        onRegister: () => {},
        extendSchema: () => ({
          customData: { type: "text" as const },
        }),
        hooks: {
          preSave: async (changes) => changes,
        },
        extendSearch: () => ({ dynamicField: true }),
        uiExtension: {
          editSection: "customFieldsSection",
          listColumns: "customFieldColumns",
        },
      });
    });

    const registry = createRegistry([ext]);
    const extension = registry.getExtension("customFields");
    expect(extension).toBeDefined();
    expect(extension?.extendSchema).toBeDefined();
    expect(extension?.hooks?.preSave).toBeDefined();
    expect(extension?.extendSearch).toBeDefined();
    expect(extension?.uiExtension?.editSection).toBe("customFieldsSection");
  });

  test("getExtensionUsages returns filtered usages", () => {
    const ext1 = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const ext2 = defineFeature("comments", (r) => {
      r.extendsRegistrar("commentable", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      // biome-ignore lint/suspicious/noExplicitAny: dynamic extension call via Proxy
      (r as any).tags("vehicle");
      // biome-ignore lint/suspicious/noExplicitAny: dynamic extension call via Proxy
      (r as any).commentable("vehicle");
      // biome-ignore lint/suspicious/noExplicitAny: dynamic extension call via Proxy
      (r as any).tags("driver");
    });

    const registry = createRegistry([ext1, ext2, consumer]);
    expect(registry.getExtensionUsages("tags")).toHaveLength(2);
    expect(registry.getExtensionUsages("commentable")).toHaveLength(1);
    expect(registry.getExtensionUsages("nonexistent")).toHaveLength(0);
  });
});
