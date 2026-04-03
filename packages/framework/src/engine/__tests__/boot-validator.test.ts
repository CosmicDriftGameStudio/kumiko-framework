import { describe, expect, test } from "vitest";
import { createEntity, createTextField, defineFeature } from "../index";
import { validateBoot } from "../boot-validator";

describe("boot-validator", () => {
  test("passes for valid features with no issues", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity("user", createEntity({ table: "Users", fields: { name: createTextField() } }));
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- Circular dependencies ---

  test("detects circular requires: A → B → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires("b");
      }),
      defineFeature("b", (r) => {
        r.requires("a");
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency.*a.*b/i);
  });

  test("detects circular requires: A → B → C → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires("b");
      }),
      defineFeature("b", (r) => {
        r.requires("c");
      }),
      defineFeature("c", (r) => {
        r.requires("a");
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency/i);
  });

  test("no circular dependency for diamond shape: A → B, A → C, B → D, C → D", () => {
    const features = [
      defineFeature("d", () => {}),
      defineFeature("b", (r) => {
        r.requires("d");
      }),
      defineFeature("c", (r) => {
        r.requires("d");
      }),
      defineFeature("a", (r) => {
        r.requires("b", "c");
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- encrypted + searchable ---

  test("rejects encrypted + searchable field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "secret",
          createEntity({
            table: "Secrets",
            fields: {
              apiKey: { type: "text", encrypted: true, searchable: true },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/apiKey.*cannot be both encrypted and searchable/i);
  });

  test("rejects encrypted + sortable field", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "secret",
          createEntity({
            table: "Secrets",
            fields: {
              token: { type: "text", encrypted: true, sortable: true },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/token.*cannot be both encrypted and sortable/i);
  });

  test("allows encrypted field without searchable/sortable", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          "secret",
          createEntity({
            table: "Secrets",
            fields: {
              apiKey: { type: "text", encrypted: true },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  // --- Extension usage without requires ---

  test("warns when extension used without requires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
      // Missing: r.requires("tags")
    });

    expect(() => validateBoot([ext, consumer])).toThrow(
      /fleet.*uses extension "tags".*requires/i,
    );
  });

  test("passes when extension used with requires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.requires("tags");
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
    });

    expect(() => validateBoot([ext, consumer])).not.toThrow();
  });

  test("passes when extension used with optionalRequires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.optionalRequires("tags");
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
    });

    expect(() => validateBoot([ext, consumer])).not.toThrow();
  });
});
