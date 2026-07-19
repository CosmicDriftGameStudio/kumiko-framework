// Public API für seed-migrations. Files in /seeds/<date>-<slug>.ts
// exportieren ein default-Object dieses Typs. Runner ruft `run(ctx)` in
// chronologischer Reihenfolge auf, einmal pro App-Boot (track in
// kumiko_es_operations).
//
// API-Stabilität: Phase 1 ist "minimal-viable". Helper am Context
// (findUserByEmail, etc.) wachsen on-demand — wenn eine real-Migration
// einen Lookup braucht den der Context nicht anbietet, fügen wir ihn
// dort hinzu. Das vermeidet "wir-bauen-alle-möglichen-Helper-spekulativ".
//
// ctx.db als Escape-Hatch ist erlaubt für READ-only lookups. WRITES
// IMMER via ctx.systemWriteAs damit Event-Store-Invariants bleiben
// (Source-of-Truth + Projection läuft automatisch).

import type { DbRunner } from "../db";
import type { TenantId, WriteResult } from "../engine";

export type EsOperationAppliedBy = "boot" | "cli" | "ci-pipeline";

/** Default-Export einer seed-Migration-File. */
export type SeedMigration = {
  /** Kurze Beschreibung was die Migration tut. Wird in kumiko_es_operations.notes
   *  und im `ops seed:status`-Output gezeigt. */
  readonly description: string;

  /** Optional: skippe diesen Seed wenn die env-var
   *  `KUMIKO_SKIP_ES_OPS_<sanitized-filename>=1` gesetzt ist (für Recovery /
   *  Debug-Boots). Default false = always-run-pending. */
  readonly skippable?: boolean;

  /** Hauptarbeit. ctx liefert systemWriteAs (Event-Store-konformer Pfad,
   *  bypassed Access-Checks via system-user) plus Read-Helpers.
   *
   *  Throws → Marker NICHT geschrieben, App-Boot bricht ab, Retry bei
   *  nächstem Boot. Pro-Migration eigene Transaction; ein Failure stoppt
   *  alle nachfolgenden pending-Migrations (Order-Erhalt). */
  readonly run: (ctx: SeedMigrationContext) => Promise<void>;
};

/** Read-shape eines User-Eintrags wie an Seed-Helpers exposed.
 *  Schmaler Subset von AuthUserRow — Seeds brauchen typischerweise nur
 *  diese Felder zur Identifikation. */
export type SeedUserRow = {
  readonly id: string;
  readonly email: string;
  readonly tenantId: string;
};

/** Read-shape eines Membership-Eintrags wie an Seed-Helpers exposed.
 *  Unterscheidet zwei tenantIds: die "logische" aus dem Read-Projektion
 *  (`tenantId`) und die "physische" aus dem Aggregate-Stream
 *  (`streamTenantId`). Die beiden weichen voneinander ab wenn das
 *  Aggregate von einem Executor mit anderer tenantId angelegt wurde
 *  (z.B. seedTenantMembership-by=systemAdmin) — typischer
 *  publicstatus-Driver-Use-Case. */
export type SeedMembershipRow = {
  readonly userId: string;
  /** Payload-tenant aus `read_tenant_memberships.tenant_id`. Geht ins
   *  write-payload als `tenantId`. */
  readonly tenantId: string;
  /** Stream-tenant aus `kumiko_events.tenant_id` der v1-Row. MUSS als
   *  `tenantIdOverride` an `systemWriteAs` durchgereicht werden, sonst
   *  sucht der Event-Store-Executor den Stream im falschen Tenant und
   *  liefert `version_conflict`. */
  readonly streamTenantId: string;
  readonly roles: readonly string[];
};

/** Read-shape eines Tenant-Eintrags wie an Seed-Helpers exposed. */
export type SeedTenantRow = {
  readonly id: string;
  readonly name: string;
  readonly tenantKey: string;
};

export type SeedMigrationContext = {
  /** Event-Store-konformer Write via existing write-handler. System-User
   *  als Executor bypassed Access-Check (Standard-Seed-Pattern). Events
   *  haben inserted_by_id = SYSTEM_TENANT_ID-User → audit-fähig.
   *
   *  Typ-Signatur folgt existing ctx.writeAs (payload als unknown) — Type-
   *  Safety kommt über handler-spezifische Wrapper im Aufrufer ("ich weiß
   *  was updateMemberRoles braucht"). Versucht NICHT Generic-Magic.
   *
   *  **tenantIdOverride (Phase 1.5):** wenn das Ziel-Aggregate in einem
   *  spezifischen Tenant-Stream lebt (nicht SYSTEM_TENANT_ID, was Default
   *  ist), MUSS der Caller die Stream-tenantId mitgeben — sonst sucht der
   *  Event-Store-Executor den Aggregate-Stream gegen `SYSTEM_TENANT_ID`
   *  und liefert `version_conflict` (siehe Memory
   *  `feedback_event_store_tenant_consistency.md` + Driver-Use-Case
   *  publicstatus-admin-roles in `project_es_ops_phase1_retro.md`).
   *
   *  Typische Pattern:
   *    - System-scope-Aggregate (config-values, system text-content) →
   *      tenantIdOverride weglassen (Default SYSTEM_TENANT_ID).
   *    - Tenant-scope-Aggregate (memberships, tenant-config, app-data) →
   *      `tenantIdOverride: m.tenantId` (oder den Stream-Tenant aus
   *      einem find*-Helper).
   *
   *  **extraRoles:** hasAccess kennt keinen System-Bypass — Handler mit
   *  einem expliziten Rollen-Gate (z.B. `access: { roles: ["SystemAdmin"] }`
   *  oder `["anonymous"]`) lehnen den reinen `system`-Actor sonst mit
   *  `access_denied` ab. Rolle(n) hier zusätzlich mitgeben, siehe
   *  `createSystemUser`'s `extraRoles`-Doku. */
  readonly systemWriteAs: (
    handlerQualifiedName: string,
    payload: unknown,
    tenantIdOverride?: TenantId,
    extraRoles?: readonly string[],
  ) => Promise<WriteResult>;

  // Read-helpers für die häufigsten Lookups. Wachsen on-demand —
  // Phase 1 deckt den admin-roles-Driver-Use-Case ab; weitere Lookups
  // kommen mit weiteren Seeds.
  readonly findUserByEmail: (email: string) => Promise<SeedUserRow | null>;
  readonly findMembershipsOfUser: (userId: string) => Promise<readonly SeedMembershipRow[]>;
  readonly findTenants: () => Promise<readonly SeedTenantRow[]>;

  /** Escape-Hatch — direkter DB-Zugang. Nur für READ-only Lookups die der
   *  Context nicht standard-mäßig anbietet. WRITES via systemWriteAs!
   *  Type ist DbRunner (Connection oder aktive Tx) weil der Runner den
   *  Context pro-Migration im Tx-Scope erzeugt. */
  readonly db: DbRunner;
};
