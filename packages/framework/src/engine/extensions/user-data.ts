// Hook signature types for the EXT_USER_DATA extension (GDPR Art. 15+17+20).
//
// The boot validator does not check useExtension(EXT_USER_DATA, "X", { export: ... })
// hook shapes against an expected signature — these types are the canonical
// schema view; app authors get compile-time hints only, no runtime validation.
//
// The runner pipelines that consume these hooks are built and live: see
// packages/bundled-features/src/user-data-rights/run-user-export.ts,
// run-forget-cleanup.ts, run-export-jobs.ts.

import type { TenantDb } from "../../db/tenant-db.ts";
import type { Registry, TenantId } from "../types/index.ts";

// SessionUser.id is `string` platform-wide (not a branded type). If
// a UserId brand is introduced, replace the inline type here — other
// codebase locations use the same path.
type UserId = string;

/**
 * Strategy for the forget path per entity:
 *   - "delete":    Physically remove the row (profile, personal notes, sessions).
 *   - "anonymize": Set the user reference to null and display fields to
 *                  "[Geloescht]" — typical for shared data (tasks,
 *                  comments) so other users do not lose the history.
 *
 * The cleanup job applies the retention policy per entity to select the
 * strategy. blockDelete entries ALWAYS use `anonymize` to respect retention
 * obligations.
 */
export type UserDataDeleteStrategy = "delete" | "anonymize";

/**
 * Effective tenant-occupancy model for THIS tenant during a forget run, set by
 * the forget orchestrator. `"single-user"` means the tenant has exactly one
 * member (the user being forgotten) — so a tenant-scoped contributor MAY erase
 * the tenant's data as that user's personal data. `"multi-user"` (the safe
 * default) means tenant-scoped rows are shared and must NOT be erased per-user.
 *
 * The orchestrator derives this from the app-level `tenantModel` config AND a
 * runtime sole-member check, so a stray invite that makes the config's
 * `"single-user"` claim false at runtime never causes a co-member's data to be
 * deleted. Absent → treat as `"multi-user"`.
 */
export type TenantUserModel = "single-user" | "multi-user";

/**
 * `db` is a tenant-filtered `TenantDb`, bound to `tenantId`
 * (or the per-user sub-tx in the forget path). Unfiltered access needs
 * `escapeHatch: { reason }` on the `r.useExtension(...)` registration,
 * then `ctx.db.unsafeRaw()`.
 */
/**
 * Minimal storage surface a file-aware forget hook needs to erase binaries.
 * Structural on purpose — the engine stays free of a dependency on the files
 * package; `FileStorageProvider` is assignable here. The forget/export
 * orchestrator resolves the concrete provider per tenant from the mounted
 * file-foundation and injects it via `UserDataHookCtx.buildStorageProvider`.
 */
export interface UserDataStorageProvider {
  delete(storageKey: string): Promise<void>;
  // Needed so a forget/tenant-destroy hook can find derived/variant keys
  // (thumbnails, resized variants) that are never tracked anywhere but the
  // storage layer itself — see fileRefDeleteHook.
  list(prefix: string): Promise<readonly string[]>;
}

export interface UserDataHookCtx {
  readonly db: TenantDb;
  /**
   * The app registry. A forget hook that must erase CHILD read-model rows past
   * the entity's own row — m:n join projections, per-parent detail projections —
   * uses it to run those custom projections for the executor's
   * `<entity>.forgotten` event: `runProjectionsForEvent(result.data.event,
   * ctx.registry, ctx.db)`. `executor.forget` purges only its OWN projection,
   * and the dispatcher's post-command projection pass does not fire in the forget
   * pipeline (a job, not a dispatched command), so the hook must trigger the
   * cascade itself. Live-erase + rebuild `<parent>.forgotten`-apply converge.
   */
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  /**
   * Per-tenant storage-provider resolver, injected by the forget orchestrator
   * from the mounted file-foundation — so a hook deletes binaries from the
   * SAME store the upload/export path uses (delete-target == upload-target by
   * construction). Undefined when no file provider is resolvable; file-aware
   * hooks then skip binary cleanup (row-only delete) and warn. Resolution
   * failures (provider not configured) should be caught by the hook so a
   * misconfigured store never permanently blocks the user's erasure.
   */
  readonly buildStorageProvider?: (
    tenantId: TenantId,
  ) => Promise<UserDataStorageProvider | undefined>;
  /**
   * Effective tenant-occupancy model for this tenant — see {@link TenantUserModel}.
   * A tenant-scoped contributor reads this to decide whether per-user erasure may
   * touch tenant-scoped rows. Absent → treat as `"multi-user"` (no erasure).
   */
  readonly tenantModel?: TenantUserModel;
  /**
   * Original user email captured before the forget transaction anonymizes it.
   * Set on delete hooks during `runForgetCleanup` so matchers (e.g. email
   * subscriptions) work in every tenant pass. Absent on export hooks.
   */
  readonly userEmailBeforeDelete?: string | null;
}

/**
 * Feature/entity snippet included in the export bundle. The export job
 * orchestrates JSON serialization; hooks return plain records.
 */
export interface UserDataExportSnippet {
  readonly entity: string;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /**
   * Optional signed URLs for file references. user-data-rights puts them
   * separately in the ZIP under `files/`. Other hooks leave this empty.
   */
  readonly fileRefs?: ReadonlyArray<{
    readonly fileRefId: string;
    readonly storageKey: string;
    readonly fileName: string;
  }>;
}

/**
 * Export hook: collects all data belonging to a user for an entity. It is
 * called once per registered entity by the data export job. Idempotent — it
 * can be called multiple times without side effects.
 *
 * The data-rights runner invokes this by iterating over all
 * `r.useExtension(EXT_USER_DATA, ...)` registrations.
 */
export type UserDataExportHook = (ctx: UserDataHookCtx) => Promise<UserDataExportSnippet | null>;

/**
 * Forget hook: deletes or anonymizes entity rows belonging to a user. The
 * cleanup job supplies the strategy, which may differ by entity because of
 * the retention policy.
 *
 * Idempotent — if the job runs twice during crash recovery, the hook must not
 * crash.
 *
 * Return additive to `void`: a hook can return `{status:"ok"}` or
 * `{status:"incomplete", reason}` to signal a partial success to the
 * cleanup runner (e.g. an external provider call failed) without
 * throwing/rolling back the sub-transaction. Existing `void` returners
 * stay valid unchanged — including ones explicitly typed
 * `Promise<void>` (an explicitly-annotated hook, unlike a contextually-
 * typed arrow literal, needs `void` in the union itself: `void` is not
 * assignable to `undefined`).
 */
// Intentional: void (not undefined) is required here so an explicitly-typed
// `Promise<void>` hook stays assignable (see UserDataDeleteHook's doc
// comment above).
export type UserDataDeleteHookResult =
  // biome-ignore lint/suspicious/noConfusingVoidType: see comment above
  void | { readonly status: "ok" } | { readonly status: "incomplete"; readonly reason: string };

export type UserDataDeleteHook = (
  ctx: UserDataHookCtx,
  strategy: UserDataDeleteStrategy,
) => Promise<UserDataDeleteHookResult>;
// At least one hook is required: an empty bag would silently register neither export nor forget.
export type UserDataExtensionOptions = (
  | { readonly export: UserDataExportHook; readonly delete?: UserDataDeleteHook }
  | { readonly export?: UserDataExportHook; readonly delete: UserDataDeleteHook }
) & { readonly order?: number };
