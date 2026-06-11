// Standardisierte Extension-Namen fuer Datenschutz-Hook-Achsen.
//
// Features registrieren Extensions via:
//   r.extendsRegistrar(EXT_USER_DATA, { hooks: { ... } });
//
// Andere Features haengen sich ein via:
//   r.useExtension(EXT_USER_DATA, "myEntity", { ...hookImpls });
//
// Hintergrund: Magic-Strings driften zwischen Bundled-Features (Beispiel:
// text-content nutzt "Admin" als Rolle, tenant-handler nutzt "TenantAdmin").
// Constants sind die einzige Quelle der Wahrheit; String-Literale werden
// in den Sprint-Touchpoints schrittweise ersetzt. Boot-Validator
// (validateExtensionUsages) checkt dass jedes useExtension einen
// passenden extendsRegistrar findet — Tippfehler in Constants →
// Compile-Time-Fail.
//
// Hook-Signaturen + Boot-Validation pro Extension-Achse kommen mit dem
// jeweiligen registrierenden Sprint:
//   userData / tenantData         → Sprint 2 (user-data-rights, retention)
//   storageProvider                → Sprint 4 (storage-encryption)
//   searchAdapter / external /     → Sprint 5 (tenant-lifecycle)
//   infraResource

/**
 * `userData` — User-Daten-Rights-Hooks (DSGVO Art. 15 + 17 + 20).
 *
 * Erwartete Hook-Methoden:
 *   - `export(userId, ctx) => Promise<UserDataExport>`
 *   - `delete(userId, strategy: "delete" | "anonymize", ctx) => Promise<void>`
 *
 * Registriert von: `user-data-rights` (Sprint 2).
 * Genutzt von: jedes Feature mit User-Referenzen (tasks, comments, files, ...).
 */
export const EXT_USER_DATA = "userData" as const;

// Order-Bänder für EXT_USER_DATA-Hooks (forget-Pipeline). Der Kontrakt war
// implizit über zwei Packages verteilt (-100 in custom-fields, 0 in
// user-data-rights) — ein Host-Hook mit order < REDACT_BEFORE_OWNER liefe
// VOR den Redaktoren und brächte den Strip-nach-owner-null-Bug zurück
// (DSGVO-Art.-17-Regression). Regel: Redaktoren < 0 <= owner-mutierende Hooks.
export const EXT_USER_DATA_ORDER = {
  REDACT_BEFORE_OWNER: -100,
  DEFAULT: 0,
} as const;

/**
 * `tenantData` — Tenant-Destroy-Hooks pro Entity (DSGVO + AVV-Beendigung).
 *
 * Erwartete Hook-Methoden:
 *   - `destroy(tenantId, ctx) => Promise<void>`
 *
 * Registriert von: `tenant-lifecycle` (Sprint 5).
 * Genutzt von: jedes Feature mit tenantId-Field.
 */
export const EXT_TENANT_DATA = "tenantData" as const;

/**
 * `storageProvider` — File-Storage-Plugin-Hooks (Crypto-Shredding fuer Files).
 *
 * Erwartete Hook-Methoden:
 *   - `destroyTenant(tenantId, ctx) => Promise<void>`
 *   - `destroySubject(subject, ctx) => Promise<{ deleted: number }>`
 *
 * Registriert von: `storage-encryption` (Sprint 4).
 * Genutzt von: pluggable Provider (Local, MinIO, S3, R2).
 */
export const EXT_STORAGE_PROVIDER = "storageProvider" as const;

/**
 * `searchAdapter` — Search-Adapter-Forget-Hooks (Meilisearch-Index-Cleanup
 * bei User-Forget oder Tenant-Destroy).
 *
 * Erwartete Hook-Methoden:
 *   - `destroyTenant(tenantId, ctx) => Promise<void>`
 *   - `eraseSubject(subject, ctx) => Promise<void>`
 *
 * Registriert von: `tenant-lifecycle` (Sprint 5).
 * Genutzt von: Meilisearch- und andere Search-Adapter-Implementierungen.
 */
export const EXT_SEARCH_ADAPTER = "searchAdapter" as const;

/**
 * `externalResource` — External-Service-Tenant-Cleanup
 * (Webhook-Subscriptions, Brevo-Empfaenger-Listen, Stripe-Customer-Account).
 *
 * Erwartete Hook-Methoden:
 *   - `destroyTenant(tenantId, ctx) => Promise<void>`
 *
 * Registriert von: `tenant-lifecycle` (Sprint 5).
 */
export const EXT_EXTERNAL_RESOURCE = "externalResource" as const;

/**
 * `infraResource` — Pulumi-managed Resources pro Tenant
 * (Custom-Domain, Cert-Manager-Issuer, dedicated Pod/Volume).
 *
 * Erwartete Hook-Methoden:
 *   - `destroyTenant(tenantId, ctx) => Promise<void>`
 *
 * Registriert von: `tenant-lifecycle` (Sprint 5).
 */
export const EXT_INFRA_RESOURCE = "infraResource" as const;

/**
 * Union aller standardisierten Extension-Namen der Datenschutz-Surface.
 * Nicht alle Extensions im System sind in dieser Liste — andere
 * Features koennen weiterhin eigene Extension-Namen registrieren.
 */
export type KumikoExtensionName =
  | typeof EXT_USER_DATA
  | typeof EXT_TENANT_DATA
  | typeof EXT_STORAGE_PROVIDER
  | typeof EXT_SEARCH_ADAPTER
  | typeof EXT_EXTERNAL_RESOURCE
  | typeof EXT_INFRA_RESOURCE;
