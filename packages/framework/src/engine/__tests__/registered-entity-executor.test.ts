import { describe, expect, test } from "bun:test";
import { createEntity, createRegistry, defineFeature, registeredEntityExecutor } from "../index.ts";

function registryWithNote() {
  return createRegistry([
    defineFeature("notes", (r) => {
      r.entity({ name: "note", ...createEntity({ table: "notes", fields: {} }) });
    }),
  ]);
}

describe("registeredEntityExecutor", () => {
  test("returns undefined for an entity no feature registered", () => {
    expect(registeredEntityExecutor(registryWithNote(), "missing")).toBeUndefined();
  });

  test("reuses one executor per registered entity", () => {
    const registry = registryWithNote();
    const first = registeredEntityExecutor(registry, "note");
    expect(first).not.toBeUndefined();
    expect(registeredEntityExecutor(registry, "note")).toBe(first);
  });

  test("builds separate executors for different definitions under the same name", () => {
    const first = registeredEntityExecutor(registryWithNote(), "note");
    const second = registeredEntityExecutor(registryWithNote(), "note");
    expect(first).not.toBeUndefined();
    expect(second).not.toBe(first);
  });
});
