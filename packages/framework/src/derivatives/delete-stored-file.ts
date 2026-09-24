// Shared binary-deletion helper: deletes an original storage key plus every
// derivative rendered from it (thumbnails/resized variants — see
// derivatives-context.ts). Derivatives are never tracked anywhere but the
// storage layer: they're rendered under a deterministic key (deriveKey +
// variantSuffix) computed from the original's key, on demand, and nothing
// writes that key back onto a FileRef row. Listing the original's key-prefix
// and keeping only candidates whose suffix matches the derivative grammar,
// anchored to the original's own basename AND extension, means a
// same-directory sibling (a different file, possibly another tenant's) shares
// the list prefix but fails the extension/suffix check and is never touched.
//
// Used by both the user-data-rights-defaults forget hook and the
// data-retention hardDelete cleanup — moved here so neither copies the logic.

import { assertSafeStorageKey } from "../files/types";
import { derivativeListPrefix, isDerivativeKeyOf } from "./variant-key";

export type StoredFileStore = {
  list(prefix: string): Promise<readonly string[]>;
  delete(key: string): Promise<void>;
};

// Wrap rather than let a raw provider error (e.g. S3 AccessDenied) surface
// unexplained — list() is a requirement on top of delete(); a bucket policy
// granting only s3:DeleteObject would otherwise fail every run instead of
// just leaving derivatives behind. Name the likely cause so an operator
// doesn't have to guess. `errorContext` names the caller for the message
// prefix (e.g. "user-data-rights-defaults:fileRef", "data-retention:hardDelete").
export async function listDerivativeKeys(
  originalKey: string,
  store: Pick<StoredFileStore, "list">,
  errorContext: string,
): Promise<readonly string[]> {
  let candidates: readonly string[];
  try {
    candidates = await store.list(derivativeListPrefix(originalKey));
  } catch (err) {
    throw new Error(
      `[${errorContext}] provider.list() failed while looking up derivatives of key=${originalKey} — forget/erasure requires list permission on the storage bucket (e.g. s3:ListBucket), not just delete. Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const derivativeKeys: string[] = [];
  for (const candidate of candidates) {
    if (!isDerivativeKeyOf(originalKey, candidate)) continue;
    try {
      assertSafeStorageKey(candidate);
    } catch {
      // ponytail: a listing hit that fails the storage-key grammar can't be
      // a real derivative (every derivative is written via a validated
      // write()) — skip rather than pass a malformed key to delete().
      continue;
    }
    derivativeKeys.push(candidate);
  }
  return derivativeKeys;
}

// Deletes the original key + every derivative. Returns the keys whose delete
// threw — callers fail closed on a non-empty list (delete is idempotent, so a
// retry on the next run converges). assertSafeStorageKey guards the original
// AND every derivative right before the delete call, not just at listing time.
export async function deleteStoredFileAndDerivatives(
  originalKey: string,
  store: StoredFileStore,
  errorContext: string,
): Promise<readonly string[]> {
  assertSafeStorageKey(originalKey);
  const keysToDelete = [
    originalKey,
    ...(await listDerivativeKeys(originalKey, store, errorContext)),
  ];
  const failedKeys: string[] = [];
  for (const key of keysToDelete) {
    try {
      assertSafeStorageKey(key);
      await store.delete(key);
    } catch (err) {
      failedKeys.push(key);
      // biome-ignore lint/suspicious/noConsole: operator-visibility for binary-cleanup-failure
      console.warn(
        `[${errorContext}] storage delete failed key=${key} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return failedKeys;
}
