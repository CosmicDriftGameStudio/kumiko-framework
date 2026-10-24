// Public API for seed migrations. Files in /seeds/<date>-<slug>.ts
// export a default object of this type. The runner calls `run(ctx)` in
// chronological order, once per app boot, tracking runs in
// kumiko_es_operations.
//
// API stability: the initial API is intentionally minimal. Context helpers
// (findUserByEmail, etc.) grow on demand: when a real migration needs a
// lookup the context does not provide, add it there. This avoids speculative
// helper APIs.
//
// ctx.db is permitted as an escape hatch for READ-only lookups. WRITES must
// always go through ctx.systemWriteAs so Event Store invariants remain intact
// (source of truth plus automatic projection).

import type { DbRunner } from "../db/index.ts";
import type { TenantId, WriteResult } from "../engine/index.ts";

export type EsOperationAppliedBy = "boot" | "cli" | "ci-pipeline";

/** Default-Export einer seed-Migration-File. */
export type SeedMigration = {
  /** A short description of what the migration does. Shown in
   * kumiko_es_operations.notes and in the `ops seed:status` output. */
  readonly description: string;

  /** Optional: skip this seed when the env var
   * `KUMIKO_SKIP_ES_OPS_<sanitized-filename>=1` is set (for recovery or
   * debug boots). Default false = always-run-pending. */
  readonly skippable?: boolean;

  /** Main migration work. ctx provides systemWriteAs (the Event Store-compliant
   * path, bypassing access checks through the system user) plus read helpers.
   *
   * If this throws, the marker is NOT written, app boot aborts, and the
   * migration is retried on the next boot. Each migration has its own
   * transaction; a failure stops all subsequent pending migrations, preserving
   * their order. */
  readonly run: (ctx: SeedMigrationContext) => Promise<void>;
};

/** Read shape of a user entry exposed to seed helpers.
 * A narrow subset of AuthUserRow, since seeds typically need only
 * these fields for identification. */
export type SeedUserRow = {
  readonly id: string;
  readonly email: string;
  readonly tenantId: string;
};

/** Read shape of a membership entry exposed to seed helpers.
 * Distinguishes two tenantIds: the logical one from the read projection
 * (`tenantId`) and the physical one from the aggregate stream
 * (`streamTenantId`). They only differ for memberships written by an admin
 * of another tenant before `backfillTenantStreamTenants` ran; afterwards
 * `streamTenantId = tenantId`. */
export type SeedMembershipRow = {
  readonly userId: string;
  /** Payload tenant from `read_tenant_memberships.tenant_id`; it is used
   * as `tenantId` in the write payload. */
  readonly tenantId: string;
  /** Stream tenant from `kumiko_events.tenant_id` in the v1 row. MUST be
   * passed as `tenantIdOverride` to `systemWriteAs`; otherwise the Event
   * Store executor looks for the stream in the wrong tenant and returns
   * `version_conflict`. */
  readonly streamTenantId: string;
  readonly roles: readonly string[];
};

/** Read shape of a tenant entry exposed to seed helpers. */
export type SeedTenantRow = {
  readonly id: string;
  readonly name: string;
  readonly tenantKey: string;
};

/** Read-shape of a template-resolver row as exposed to seeds. */
export type SeedTemplateResourceRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly status: string;
};

export type SeedTemplateResourceFilter = {
  /** Defaults to the system tenant, where seeded system templates live. */
  readonly tenantId?: TenantId;
  readonly slug?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly locale?: string;
};

export type SeedMigrationContext = {
  /** Event Store-compliant write through the existing write handler. The system
   * user executes it while bypassing access checks. Events have
   * inserted_by_id = SYSTEM_TENANT_ID-user, making them auditable.
   *
   * The type signature follows existing ctx.writeAs (with payload as unknown).
   * Type safety comes from handler-specific wrappers in the caller; do not
   * attempt generic magic.
   *
   * **tenantIdOverride:** when the target aggregate lives in a specific
   * tenant stream (rather than SYSTEM_TENANT_ID, the default), the caller
   * MUST provide the stream tenantId. Otherwise the Event Store executor
   * looks for the aggregate stream under `SYSTEM_TENANT_ID` and returns
   * `version_conflict`.
   *
   * Typical patterns:
   *   - System-scope aggregates (config-values, system text-content): omit
   *     tenantIdOverride (default SYSTEM_TENANT_ID).
   *   - Tenant-scope aggregates (memberships, tenant-config, app-data): use
   *     `tenantIdOverride: m.tenantId` or the stream tenant from a find*
   *     helper.
   *
   * **extraRoles:** hasAccess has no system bypass. A handler with an
   * explicit role gate (for example, `access: { roles: ["SystemAdmin"] }` or
   * `["anonymous"]`) otherwise rejects the bare `system` actor with
   * `access_denied`. Pass the required role(s) here; see
   * `createSystemUser`'s `extraRoles` documentation. */
  readonly systemWriteAs: (
    handlerQualifiedName: string,
    payload: unknown,
    tenantIdOverride?: TenantId,
    extraRoles?: readonly string[],
  ) => Promise<WriteResult>;

  // Read helpers for common lookups. They grow on demand; further lookups
  // are added with further seeds.
  readonly findUserByEmail: (email: string) => Promise<SeedUserRow | null>;
  readonly findMembershipsOfUser: (userId: string) => Promise<readonly SeedMembershipRow[]>;
  readonly findTenants: () => Promise<readonly SeedTenantRow[]>;
  /** Template rows ordered by slug, locale. Empty list when the
   *  template-resolver feature (its table) is not present. */
  readonly findTemplateResources: (
    filter?: SeedTemplateResourceFilter,
  ) => Promise<readonly SeedTemplateResourceRow[]>;

  /** Escape hatch for direct database access. Use only for READ-only lookups
   * that the context does not provide by default; WRITES must use
   * systemWriteAs. The type is DbRunner (a connection or active transaction)
   * because the runner creates the context within each migration's
   * transaction scope. */
  readonly db: DbRunner;
};
