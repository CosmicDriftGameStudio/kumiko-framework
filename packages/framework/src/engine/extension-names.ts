// Standardisierte Extension-Namen fuer Datenschutz-Hook-Achsen.
//
// Features registrieren Extensions via:
//   r.extendsRegistrar(EXT_USER_DATA, { hooks: { ... } });
//
// Andere Features haengen sich ein via:
//   r.useExtension(EXT_USER_DATA, "myEntity", { ...hookImpls });
//
// Memory: feedback_role_naming_drift — Magic-Strings driften zwischen
// bundled-features. Diese Constants sind die einzige Quelle der Wahrheit;
// String-Literale aus dem Code rauswerfen. Boot-Validator (validate-
// ExtensionUsages) checkt dass jedes useExtension einen passenden
// extendsRegistrar findet — Tippfehler in Constants → Compile-Time-Fail.
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
 * Union aller standardisierten Extension-Namen. Nicht alle Extensions
 * im System sind in dieser Liste — sie ist nur die Datenschutz-Surface.
 * Andere Features koennen weiterhin eigene Extension-Namen registrieren.
 */
export type DatenschutzExtensionName =
  | typeof EXT_USER_DATA
  | typeof EXT_TENANT_DATA
  | typeof EXT_STORAGE_PROVIDER
  | typeof EXT_SEARCH_ADAPTER
  | typeof EXT_EXTERNAL_RESOURCE
  | typeof EXT_INFRA_RESOURCE;
