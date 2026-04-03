import { describe, expect, test, vi } from "vitest";
import { createEntity, createRegistry, defineFeature } from "../index";

describe("extendsRegistrar", () => {
  test("r.useExtension records usage with name, entity, and options", () => {
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
      r.useExtension("customFields", "vehicle", { allowTypes: ["text", "number"] });
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
      r.useExtension("tags", "vehicle");
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

  test("getExtensionUsages returns filtered usages", () => {
    const ext1 = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const ext2 = defineFeature("comments", (r) => {
      r.extendsRegistrar("commentable", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
      r.useExtension("commentable", "vehicle");
      r.useExtension("tags", "driver");
    });

    const registry = createRegistry([ext1, ext2, consumer]);
    expect(registry.getExtensionUsages("tags")).toHaveLength(2);
    expect(registry.getExtensionUsages("commentable")).toHaveLength(1);
    expect(registry.getExtensionUsages("nonexistent")).toHaveLength(0);
  });
});
