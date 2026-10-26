import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine/define-feature.ts";
import { createEntity, createTextField } from "../../engine/factories.ts";
import { createRegistry } from "../../engine/registry.ts";
import { collectEntityReadAccess, collectEntityRowReadMaps } from "../entity-read-access.ts";

const fields = { name: createTextField({ personal: false, reason: "test_fixture" }) };

// One entity per feature: inside a feature the registry already rejects folded duplicates through
// the implicit projection name, across features it does not.
function registryOf(...names: readonly string[]) {
  return createRegistry(
    names.map((name, index) =>
      defineFeature(`collide${index}`, (r) => {
        r.entity({ name, ...createEntity({ table: `read_collide_${index}`, fields }) });
      }),
    ),
  );
}

describe("entity read access keys", () => {
  test("two entity names that fold to the same aggregate type fail loudly", () => {
    const registry = registryOf("billing.period", "billingPeriod");
    const message = /"billing.period" and "billingPeriod".*"billing-period"/;
    expect(() => collectEntityReadAccess(registry)).toThrow(message);
    expect(() => collectEntityRowReadMaps(registry)).toThrow(message);
  });

  test("distinct names pass, also when one is camelCase", () => {
    const registry = registryOf("billingPeriod", "billingRun");
    expect(() => collectEntityReadAccess(registry)).not.toThrow();
    expect(() => collectEntityRowReadMaps(registry)).not.toThrow();
  });
});
