import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createFeatureTogglesFeature,
  GlobalFeatureToggleRuntime,
  globalFeatureStateTable,
} from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createLateBoundHolder } from "@cosmicdrift/kumiko-framework/testing";
import {
  createProductAuditFeature,
  createProductFeature,
  productAuditEntity,
  productAuditTable,
  productEntity,
  productTable,
} from "../feature";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";

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

  await unsafePushTables(stack.db, { globalFeatureStateTable });
  await unsafeCreateEntityTable(stack.db, productEntity);
  await unsafeCreateEntityTable(stack.db, productAuditEntity, "product-audit");

  runtime = new GlobalFeatureToggleRuntime(stack.db, stack.registry);
  await runtime.initialize();
  effective = runtime.effectiveFeatures;
  runtimeHolder.set(runtime);
});

afterAll(async () => {
  await stack?.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${productAuditTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${productTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${globalFeatureStateTable.tableName}"`);
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
    const auditRowsAfterOn = await selectMany(stack.db, productAuditTable);
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
    const auditRowsAfterReEnable = await selectMany(stack.db, productAuditTable);
    expect(auditRowsAfterReEnable.length).toBe(2);
  });

  test("cross-feature hook: disabling product-audit skips its hook but product keeps working", async () => {
    runtime.apply("product-audit", false);

    const ok = await createProduct("delta");
    expect((await ok.json()).isSuccess).toBe(true);
    // Product row written — handler unaffected.
    const productRows = await selectMany(stack.db, productTable);
    expect(productRows.length).toBe(1);
    // Audit hook owned by product-audit — silently skipped.
    const auditRows = await selectMany(stack.db, productAuditTable);
    expect(auditRows.length).toBe(0);
  });
});
