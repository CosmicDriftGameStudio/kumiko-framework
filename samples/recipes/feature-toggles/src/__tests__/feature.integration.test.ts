import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createFeatureTogglesFeature,
  GlobalFeatureToggleRuntime,
  globalFeatureStateTable,
} from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { createLateBoundHolder } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
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

const admin = createTestUser({
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: SYSTEM_TENANT_ID,
  roles: ["SystemAdmin"],
});

// Products and audit rows are system-wide by design, so tests isolate through
// product names that are unique per test instead of per tenant.
let testNumber = 0;
let suffix = "";

beforeEach(() => {
  testNumber += 1;
  suffix = `-t${testNumber}`;
  runtime.apply("product", true);
  runtime.apply("product-audit", true);
});

async function auditNames(): Promise<string[]> {
  const rows = await selectMany(stack.db, productAuditTable);
  return rows.map((row) => String(row["productName"])).filter((name) => name.endsWith(suffix));
}

async function productNames(): Promise<string[]> {
  const rows = await selectMany(stack.db, productTable);
  return rows.map((row) => String(row["name"])).filter((name) => name.endsWith(suffix));
}

async function createProduct(name: string) {
  return stack.http.write("product:write:product:create", { name: `${name}${suffix}` }, admin);
}

describe("feature-toggles showcase", () => {
  test("runtime flip: product on → create works + audit-hook fires; off → 403; on → works again", async () => {
    // ON
    const ok = await createProduct("alpha");
    expect((await ok.json()).isSuccess).toBe(true);
    expect(await auditNames()).toHaveLength(1);

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
    expect(await auditNames()).toHaveLength(2);
  });

  test("cross-feature hook: disabling product-audit skips its hook but product keeps working", async () => {
    runtime.apply("product-audit", false);

    const ok = await createProduct("delta");
    expect((await ok.json()).isSuccess).toBe(true);
    // Product row written — handler unaffected.
    expect(await productNames()).toHaveLength(1);
    // Audit hook owned by product-audit — silently skipped.
    expect(await auditNames()).toHaveLength(0);
  });
});
