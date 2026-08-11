import type { FormDraftBlob } from "./schemas";

// The draft blob's `values` is free-form by design (issue #1889: form-draft
// never knows the consuming form's field schema, only { values, stepIndex,
// savedAt }). A FileRef pointer is therefore recognised purely by shape —
// any object anywhere in `values` carrying a non-empty string `storageKey`
// matches what POST /files returns (file-routes.ts) and what a photo-upload
// step writes into the draft, whether under a single "file" field or nested
// in a "files"/"images" array.
function isFileRefPointer(value: unknown): value is { readonly storageKey: string } {
  if (typeof value !== "object" || value === null) return false;
  const storageKey = (value as { storageKey?: unknown }).storageKey;
  return typeof storageKey === "string" && storageKey.length > 0;
}

function collectStorageKeys(value: unknown, keys: Set<string>): void {
  if (isFileRefPointer(value)) {
    keys.add(value.storageKey);
    // skip: FileRef pointer is a leaf — nothing further to recurse into.
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStorageKeys(item, keys);
    // skip: array items are already visited recursively above.
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectStorageKeys(item, keys);
  }
}

export function collectDraftFileRefKeys(
  draft: FormDraftBlob | null | undefined,
): readonly string[] {
  if (!draft) return [];
  const keys = new Set<string>();
  collectStorageKeys(draft.values, keys);
  return [...keys];
}

// Best-effort by design: a storage hiccup must not block a draft discard or
// the nightly cleanup sweep — this is storage-cost hygiene, not GDPR Art. 17
// erasure, so there is no fail-closed requirement (contrast
// user-data-rights-defaults/hooks/file-ref.userdata-hook.ts, which rolls
// back the whole forget on a binary-delete failure). Each failing key is
// logged and skipped; the caller's row-level operation proceeds regardless.
//
// Takes an already-decided key list, not the draft blob — callers must run
// collectDraftFileRefKeys() output through db/queries' owned-storage-key
// filter first. `values` is free-form, client-supplied JSON (issue #1889);
// releasing a key straight out of it without verifying a real, owned
// file_refs row exists would let a crafted `{ storageKey: "<victim's key>" }`
// delete someone else's file — the same ownership check file-routes.ts runs
// before every read/delete (loadFileForTenant + FileAccessGuard).
export async function releaseDraftFileRefs(
  keys: readonly string[],
  deleteBinary: (storageKey: string) => Promise<void>,
  log?: { warn(msg: string, data?: Record<string, unknown>): void },
): Promise<void> {
  for (const key of keys) {
    try {
      await deleteBinary(key);
    } catch (err) {
      log?.warn(`[form-draft] failed to release FileRef storageKey=${key}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
