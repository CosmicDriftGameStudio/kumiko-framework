// Hook-Signatur-Types für die EXT_USER_DATA-Extension (DSGVO Art. 15+17+20).
//
// Sprint 1.9 Z1: Bisher gibt der Boot-Validator JEDES Hook-Shape durch
// — useExtension(EXT_USER_DATA, "X", { export: ... }) wird nicht gegen
// eine erwartete Signatur geprüft. Diese Types sind die canonical
// Schema-Sicht; Sprint 2 user-data-rights wird sie via
// `r.extendsRegistrar(EXT_USER_DATA, { hooks: ... })`-Doku exposen.
//
// Boot-Time-Schape-Check (Runtime) ist orthogonal und kommt in Sprint
// 2 wenn die exportRunner-/forgetRunner-Pipelines stehen — bis dahin
// sind diese Types Compile-Time-Hints für App-Authors, keine Runtime-
// Validation.
//
// Siehe docs/plans/datenschutz/user-data-rights.md.

import type { DbRunner } from "../../db/connection";
import type { TenantId } from "../types";

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
 * Context-Snapshot der dem Hook übergeben wird. Sprint 2 erweitert
 * das ggf. um cancel-/timeout-Marker; aktuell minimaler Schnitt.
 *
 * `db` ist `DbRunner` (DbConnection | DbTx) damit der Cleanup-Runner
 * (S2.U5b) den Hook in einer Per-User-Sub-Tx callen kann. Hooks die
 * raw-DB-Operationen machen funktionieren auf beiden Shapes via
 * Drizzle's polymorphem select/insert/update/delete-Chain.
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
}

export interface UserDataHookCtx {
  readonly db: DbRunner;
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
 */
export type UserDataDeleteHook = (
  ctx: UserDataHookCtx,
  strategy: UserDataDeleteStrategy,
) => Promise<void>;

/**
 * Komplette Hook-Tafel für EXT_USER_DATA. Sprint 2 user-data-rights
 * deklariert das via `r.extendsRegistrar(EXT_USER_DATA, { hooks: ... })`,
 * konsumierende Features liefern beide Hooks via
 * `r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })`.
 *
 * Kein Hook ist optional — beide MÜSSEN registriert sein. Boot-Check
 * (Sprint 2) prüft das.
 */
export interface UserDataExtensionHooks {
  readonly export: UserDataExportHook;
  readonly delete: UserDataDeleteHook;
}
