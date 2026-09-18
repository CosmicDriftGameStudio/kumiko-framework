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
 * `fileProvider` — File-Storage-Provider-Plugin-Selection (file-foundation).
 *
 * Provider-Features (file-provider-s3, -inmemory, -s3-env) registrieren eine
 * Implementierung via `r.useExtension(EXT_FILE_PROVIDER, "<name>", { build })`;
 * der per-Tenant Config-Key `provider` waehlt zur Runtime eine aus. Der
 * Framework-Resolver (`createFileProviderForTenant`) liest das, damit Upload-
 * Routes, `ctx.files` UND die DSGVO-Jobs denselben Store treffen.
 *
 * Framework-seitig besessen, damit kein String-Drift entsteht — file-
 * foundation MUSS Extension-Point + Config-Key unter genau diesen Namen
 * registrieren.
 */
export const EXT_FILE_PROVIDER = "fileProvider" as const;

// Qualifizierter Config-Key, den das file-foundation-Feature registriert
// (Format `<feature>:config:<key>`). Akzeptierte Kopplung: der Framework-
// Resolver liegt UNTER dem Feature und liest den Key per String. Umbenennen
// des file-foundation-Features MUSS diese Konstante mitziehen.
export const FILE_PROVIDER_CONFIG_KEY = "file-foundation:config:provider" as const;

/**
 * `derivativeRenderer` — File-Derivative-Renderer-Plugin-Selection
 * (file-derivatives).
 *
 * Renderer-Features (a future `derivatives-*` feature) register via
 * `r.useExtension(EXT_DERIVATIVE_RENDERER, "<mimePattern>", { render })`,
 * where `<mimePattern>` is an exact MIME type (`application/pdf`) or a
 * type-wildcard (`image/*`). `ctx.derivatives.variant(...)` resolves the
 * renderer for a FileRef's MIME type at call time — exact match first,
 * wildcard second.
 *
 * No `r.extensionSelector` and no config key: unlike `fileProvider`, the
 * resolution is deterministic from the MIME type — no tenant ever picks a
 * different image library for the same content type.
 */
export const EXT_DERIVATIVE_RENDERER = "derivativeRenderer" as const;

/**
 * `derivativePublicPredicate` — per-entityType "is this FileRef's derivative
 * publicly readable?" gate for the anonymous variant route (file-derivatives).
 *
 * Apps register via
 * `r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "<entityType>", { isPublic:
 * (args, ctx) => boolean | Promise<boolean> })`, where `<entityType>` is the
 * `entityType` string a FileRef carries from upload (e.g. "vehicle", "event").
 * No registration for a given entityType is default-deny — the public route
 * serves nothing for that entityType, not even a 403 (404, so existence isn't
 * confirmed to an unauthorised caller).
 *
 * Registered/consumed by: `file-derivatives`' public variant route (#1951).
 */
export const EXT_DERIVATIVE_PUBLIC_PREDICATE = "derivativePublicPredicate" as const;

/**
 * `derivativeOverlayResolver` — per-entityType "resolve this overlay
 * dataToken to its real value" contract for `file-derivatives`' overlay
 * compositing (QR codes on a public variant).
 *
 * Apps register via `r.useExtension(EXT_DERIVATIVE_OVERLAY_RESOLVER,
 * "<entityType>", { resolve: (args) => string | Promise<string> })`. Missing
 * registration, or a resolve() returning an empty string, both throw —
 * unlike `derivativePublicPredicate`, there is no default-deny answer here:
 * an image silently rendered without its QR would look correct while being
 * wrong.
 *
 * Registered/consumed by: `file-derivatives`'s `variant()`
 * (derivatives-context.ts), before the variant's spec hash is computed.
 */
export const EXT_DERIVATIVE_OVERLAY_RESOLVER = "derivativeOverlayResolver" as const;

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
 * `principalStatus` — "is this principal blocked from signing in" contract,
 * consulted by the active-membership building block; fulfilled by the bundled `user` feature.
 */
export const EXT_PRINCIPAL_STATUS = "principalStatus" as const;

/**
 * `tenantLifecycleStatus` — tenant-teardown status contract, fulfilled by
 * the bundled `tenant-lifecycle` feature; absent means no tenant is ever "in teardown".
 */
export const EXT_TENANT_LIFECYCLE_STATUS = "tenantLifecycleStatus" as const;

// Default membership-list query handler name. Accepted coupling, same
// pattern as FILE_PROVIDER_CONFIG_KEY — the `tenant` feature registers a handler under this literal.
export const TENANT_MEMBERSHIPS_QUERY = "tenant:query:memberships" as const;

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
