// @runtime test
import type { AnyDb } from "../db/query.ts";
import { createTenantDb, withExecutorManagedWrites } from "../db/tenant-db.ts";
import { isBoundTenantDb, isDbRunner, tenantDbRunner } from "../db/tenant-db-runner.ts";

export { resetBlindIndexKeyForTests } from "../crypto/blind-index.ts";
export { resetEventPiiCatalogForTests } from "../crypto/event-pii.ts";
export { resetPiiSubjectKmsForTests } from "../crypto/pii-field-encryption.ts";
export { resetEntityFieldEncryptionCacheForTests } from "../db/entity-field-encryption.ts";

// Seeds and teardown write read-model rows without events; the capability is the sanctioned test seam.
export function withExecutorManagedWritesForTests(db: AnyDb): AnyDb {
  if (isBoundTenantDb(db)) {
    return createTenantDb({
      db: withExecutorManagedWrites(tenantDbRunner(db)),
      tenantId: db.tenantId,
      mode: db.mode,
    });
  }
  if (isDbRunner(db)) return withExecutorManagedWrites(db);
  throw new Error("withExecutorManagedWritesForTests: expected a TenantDb or a postgres-js runner");
}
