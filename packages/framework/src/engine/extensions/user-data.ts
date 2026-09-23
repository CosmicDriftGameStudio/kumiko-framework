// Hook signature types for the EXT_USER_DATA extension (GDPR Art. 15+17+20).
//
// The boot validator does not check useExtension(EXT_USER_DATA, "X", { export: ... })
// hook shapes against an expected signature — these types are the canonical
// schema view; app authors get compile-time hints only, no runtime validation.
//
// The runner pipelines that consume these hooks are built and live: see
// packages/bundled-features/src/user-data-rights/run-user-export.ts,
// run-forget-cleanup.ts, run-export-jobs.ts.
//
// See docs/plans/datenschutz/user-data-rights.md.

import type { TenantDb } from "../../db/tenant-db";
import type { Registry, TenantId } from "../types";

// SessionUser.id ist plattformweit `string` (kein Brand-Type). Wenn
// jemals ein UserId-Brand eingefuehrt wird, ersetzt man hier den
// inline-Type — andere Codebase-Stellen nutzen denselben Pfad.
type UserId = string;

/**
 * Strategie für den Forget-Pfad pro Entity:
 *   - "delete":    Row physisch entfernen (Profil, Eigene Notizen, Sessions).
 *   - "anonymize": User-Reference auf null + Display-Felder auf
 *                  "[Geloescht]" — typisch für geteilte Daten (Tasks,
 *                  Comments) damit andere User die History nicht verlieren.
 *
 * Cleanup-Job (Sprint 2 data-retention) entscheidet pro Entity über
 * Retention-Policy, welche Strategie greift. blockDelete-Entries lösen
 * IMMER `anonymize` aus damit Aufbewahrungs-Pflicht respektiert wird.
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
 * fw#2914 — `db` is a tenant-filtered `TenantDb`, bound to `tenantId`
 * (or the per-user sub-tx in the forget path). Unfiltered access needs
 * `escapeHatch: { reason }` on the `r.useExtension(...)` registration,
 * then `ctx.db.unsafeRaw(reason)`.
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
 * Pro Feature/Entity-Snippet das im Export-Bundle landet. Sprint 2
 * orchestriert die JSON-Serialisierung; Hooks geben Plain-Records.
 */
export interface UserDataExportSnippet {
  readonly entity: string;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  /**
   * Optional: signed-URLs für File-Refs. user-data-rights packt sie
   * separat ins ZIP unter `files/`. Andere Hooks lassen das leer.
   */
  readonly fileRefs?: ReadonlyArray<{
    readonly fileRefId: string;
    readonly storageKey: string;
    readonly fileName: string;
  }>;
}

/**
 * Export-Hook: Sammelt alle Daten einer Entity die zu einem User
 * gehören. Wird im Daten-Export-Job pro registrierter Entity einmal
 * aufgerufen. Idempotent — kann mehrfach aufgerufen werden ohne
 * Side-Effects.
 *
 * Sprint 2 user-data-rights ruft das via Iteration über alle
 * `r.useExtension(EXT_USER_DATA, ...)`-Registrierungen.
 */
export type UserDataExportHook = (ctx: UserDataHookCtx) => Promise<UserDataExportSnippet | null>;

/**
 * Forget-Hook: Löscht oder anonymisiert die Entity-Rows die zu einem
 * User gehören. Strategy kommt vom Cleanup-Job (kann per Entity
 * unterschiedlich sein wegen Retention-Policy).
 *
 * Idempotent — wenn der Job zweimal läuft (Crash-Recovery), darf der
 * Hook nicht crashen.
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

/**
 * Komplette Hook-Tafel für EXT_USER_DATA. Sprint 2 user-data-rights
 * deklariert das via `r.extendsRegistrar(EXT_USER_DATA, { hooks: ... })`,
 * konsumierende Features liefern beide Hooks via
 * `r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })`.
 *
 * Export-only ist ein legitimer Teil-Vertrag (#972) — siehe `UserDataExtensionOptions`
 * für die tatsächlich akzeptierte Options-Form.
 */
export interface UserDataExtensionHooks {
  readonly export: UserDataExportHook;
  readonly delete: UserDataDeleteHook;
}

/** Options für EXT_USER_DATA: mindestens einer der beiden Hooks ist Pflicht, ein leeres `{}` nicht. */
export type UserDataExtensionOptions = (
  | { readonly export: UserDataExportHook; readonly delete?: UserDataDeleteHook }
  | { readonly export?: UserDataExportHook; readonly delete: UserDataDeleteHook }
) & { readonly order?: number };
