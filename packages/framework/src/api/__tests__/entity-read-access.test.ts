import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { hasAccess } from "../../engine/access.ts";
import { defineFeature } from "../../engine/define-feature.ts";
import { hostRoleAllowsRead } from "../../engine/entity-list-runtime-options.ts";
import { createEntity, createTextField } from "../../engine/factories.ts";
import { createRegistry } from "../../engine/registry.ts";
import { createTestUser } from "../../seeding/seed-users.ts";
import {
  collectEntityDetailAccess,
  collectEntityReadAccess,
  collectEntityRowReadMaps,
} from "../entity-read-access.ts";

const fields = { name: createTextField({ personal: false, reason: "test_fixture" }) };

// One entity per feature: inside a feature the registry already rejects folded duplicates through
// the implicit projection name, across features it does not.
function registryOf(...names: readonly string[]) {
  return createRegistry(
    names.map((name, index) =>
      defineFeature(`collide${index}`, (r) => {
        r.entity(createEntity({ name, table: `read_collide_${index}`, fields }));
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

const vaultEntity = createEntity({ name: "vault", table: "read_access_vaults", fields });

type VaultQuery = { readonly name: string; readonly roles: readonly string[] };

function vaultRegistry(regular: readonly VaultQuery[], dispatchOnly: readonly VaultQuery[]) {
  return createRegistry([
    defineFeature("vaults", (r) => {
      r.entity(vaultEntity);
      for (const query of [...regular, ...dispatchOnly]) {
        r.queryHandler({
          name: query.name,
          schema: z.object({}),
          access: { roles: query.roles },
          ...(dispatchOnly.includes(query) && { dispatchOnly: true }),
          handler: async () => ({ rows: [] }),
        });
      }
    }),
  ]);
}

const auditor = createTestUser({ id: 3, roles: ["Auditor"] });
const member = createTestUser({ id: 4, roles: ["User"] });

describe("a dispatchOnly query's access rule grants the row gates but no live signals", () => {
  test("its roles read the entity, a role named by no query does not", () => {
    const registry = vaultRegistry([], [{ name: "vault:lookup", roles: ["Auditor"] }]);
    expect(hostRoleAllowsRead(registry, "vault", auditor)).toBe(true);
    expect(hostRoleAllowsRead(registry, "vault", member)).toBe(false);
  });

  test("its roles open no live signals, a regular query's roles do", () => {
    const onlyDispatchOnly = vaultRegistry([], [{ name: "vault:lookup", roles: ["Auditor"] }]);
    expect(collectEntityReadAccess(onlyDispatchOnly).get("vault")).toBeUndefined();

    const withRegular = vaultRegistry(
      [{ name: "vault:list", roles: ["User"] }],
      [{ name: "vault:lookup", roles: ["Auditor"] }],
    );
    const signalRules = collectEntityReadAccess(withRegular).get("vault") ?? [];
    expect(signalRules.some((rule) => hasAccess(member, rule))).toBe(true);
    expect(signalRules.some((rule) => hasAccess(auditor, rule))).toBe(false);
  });

  test("a dispatchOnly detail query opens the record for its roles only", () => {
    const registry = vaultRegistry([], [{ name: "vault:detail", roles: ["Auditor"] }]);
    const detailRule = collectEntityDetailAccess(registry).get("vault");
    expect(detailRule).toBeDefined();
    expect(hasAccess(auditor, detailRule)).toBe(true);
    expect(hasAccess(member, detailRule)).toBe(false);
  });
});
