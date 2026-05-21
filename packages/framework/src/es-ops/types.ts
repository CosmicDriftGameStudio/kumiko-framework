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
import type { WriteResult } from "../engine";

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

/** Read-shape eines Membership-Eintrags wie an Seed-Helpers exposed. */
export type SeedMembershipRow = {
  readonly userId: string;
  readonly tenantId: string;
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
   *  was updateMemberRoles braucht"). Versucht NICHT Generic-Magic. */
  readonly systemWriteAs: (handlerQualifiedName: string, payload: unknown) => Promise<WriteResult>;

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
