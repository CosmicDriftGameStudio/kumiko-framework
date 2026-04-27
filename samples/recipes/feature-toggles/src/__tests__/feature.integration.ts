import {
  createFeatureTogglesFeature,
  GlobalFeatureToggleRuntime,
  globalFeatureStateTable,
} from "@kumiko/bundled-features/feature-toggles";
import { SYSTEM_TENANT_ID } from "@kumiko/framework/engine";
import {
  createEntityTable,
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/stack";
import { createLateBoundHolder } from "@kumiko/framework/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createProductAuditFeature,
  createProductFeature,
  productAuditEntity,
  productAuditTable,
  productEntity,
  productTable,
} from "../feature";

let stack: TestStack;
let runtime: GlobalFeatureToggleRuntime;

beforeAll(async () => {
  let effective: () => ReadonlySet<string> = () => new Set();
  const runtimeHolder = createLateBoundHolder<GlobalFeatureToggleRuntime>("runtime");

  stack = await setupTestStack({
    features: [
      createProductFeature(),
      createProductAuditFeature(),
      createFeatureTogglesFeature({ getRuntime: () => runtimeHolder.get() }),
    ],
    effectiveFeatures: () => effective(),
    systemHooks: [],
  });

  await pushTables(stack.db, { globalFeatureStateTable });
  await createEntityTable(stack.db, productEntity);
  await createEntityTable(stack.db, productAuditEntity, "product-audit");

  runtime = new GlobalFeatureToggleRuntime(stack.db, stack.registry);
  await runtime.initialize();
  effective = runtime.effectiveFeatures;
  runtimeHolder.set(runtime);
});

afterAll(async () => {
  await stack?.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(productAuditTable);
  await stack.db.delete(productTable);
  await stack.db.delete(globalFeatureStateTable);
  await runtime.refresh();
});

const admin = createTestUser({
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: SYSTEM_TENANT_ID,
  roles: ["SystemAdmin"],
});

async function createProduct(name: string) {
  return stack.http.write("product:write:product:create", { name }, admin);
}

describe("feature-toggles showcase", () => {
  test("runtime flip: product on → create works + audit-hook fires; off → 403; on → works again", async () => {
    // ON
    const ok = await createProduct("alpha");
    expect((await ok.json()).isSuccess).toBe(true);
    const auditRowsAfterOn = await stack.db.select().from(productAuditTable);
    expect(auditRowsAfterOn.length).toBe(1);

    // OFF
    runtime.apply("product", false);
    const denied = await createProduct("beta");
    const deniedBody = (await denied.json()) as {
      isSuccess: boolean;
      error?: { code: string };
    };
    expect(deniedBody.error?.code).toBe("feature_disabled");

    // ON again
    runtime.apply("product", true);
    const again = await createProduct("gamma");
    expect((await again.json()).isSuccess).toBe(true);
    const auditRowsAfterReEnable = await stack.db.select().from(productAuditTable);
    expect(auditRowsAfterReEnable.length).toBe(2);
  });

  test("cross-feature hook: disabling product-audit skips its hook but product keeps working", async () => {
    runtime.apply("product-audit", false);

    const ok = await createProduct("delta");
    expect((await ok.json()).isSuccess).toBe(true);
    // Product row written — handler unaffected.
    const productRows = await stack.db.select().from(productTable);
    expect(productRows.length).toBe(1);
    // Audit hook owned by product-audit — silently skipped.
    const auditRows = await stack.db.select().from(productAuditTable);
    expect(auditRows.length).toBe(0);
  });
});
