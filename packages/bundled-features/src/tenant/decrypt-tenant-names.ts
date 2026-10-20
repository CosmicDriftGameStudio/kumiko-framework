import { decryptStoredPii, mapWithConcurrency } from "../shared/index.ts";

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

// Tenant names are not in the search index (find: "none"), so a name search has to decrypt;
// stopping at `limit` matches keeps a typed prefix from decrypting the whole scan window.
export async function takeTenantsMatchingDecryptedName<
  T extends { readonly id: unknown; readonly name?: unknown },
>(
  rows: readonly T[],
  labelMatches: (label: string) => boolean,
  limit: number,
  fallbackRequestId: string,
): Promise<T[]> {
  const batchSize = Math.max(limit, KMS_POOL_CONCURRENCY);
  const matches: T[] = [];
  for (let start = 0; start < rows.length && matches.length < limit; start += batchSize) {
    const decrypted = await decryptTenantNames(
      rows.slice(start, start + batchSize),
      fallbackRequestId,
    );
    for (const row of decrypted) {
      const label = typeof row.name === "string" ? row.name : String(row.id);
      if (labelMatches(label)) matches.push(row);
    }
  }
  return matches.slice(0, limit);
}
