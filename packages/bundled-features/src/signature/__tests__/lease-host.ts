import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";

export const leaseHostEntity = createEntity({
  table: "signature_test_leases",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 100,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

export const leaseHostFeature = defineFeature("signature-test-lease-host", (r) => {
  r.entity({ name: "lease", ...leaseHostEntity });
});

const leaseExecutor = createEventStoreExecutor(
  buildEntityTable("lease", leaseHostEntity),
  leaseHostEntity,
  { entityName: "lease" },
);

export async function seedLease(
  db: TestStack["db"],
  tenantId: TenantId,
  user: SessionUser,
): Promise<string> {
  const created = await leaseExecutor.create(
    { name: "Lease" },
    user,
    createTenantDb({ db, tenantId, mode: "system", reason: "test seeds the host row" }),
  );
  if (!created.isSuccess) throw new Error(`lease create failed: ${created.error.message}`);
  return String(created.data.id);
}
