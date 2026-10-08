import { decryptStoredPii, mapWithConcurrency } from "../shared/index.js";

// Bounded like tenant:query:members: each decrypt hits the KMS adapter's small pool.
const KMS_POOL_CONCURRENCY = 4;

// Raw reads of read_tenants return the stored column, which is ciphertext
// under an active KMS; executor reads (crud.list/detail) decrypt on their own.
export async function decryptTenantNames<T extends { readonly name?: unknown }>(
  rows: readonly T[],
  fallbackRequestId: string,
): Promise<T[]> {
  return mapWithConcurrency(rows, KMS_POOL_CONCURRENCY, async (row) =>
    typeof row.name === "string"
      ? { ...row, name: await decryptStoredPii(row.name, "name", fallbackRequestId) }
      : row,
  );
}
