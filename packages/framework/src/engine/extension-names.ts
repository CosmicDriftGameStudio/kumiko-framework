import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import type { OverlayResolverPlugin } from "../derivatives/derivatives-context.ts";
import type { FileProviderPlugin } from "../files/provider-resolver.ts";
import type { PrincipalStatusPlugin, TenantLifecycleStatusPlugin } from "./active-membership.ts";
import type { TenantDataExtensionHooks } from "./extensions/tenant-data.ts";
import type { TenantResourceExtensionHooks } from "./extensions/tenant-resource.ts";
import type { UserDataExtensionOptions } from "./extensions/user-data.ts";
import type { AssignableFromRole } from "./role-assignment.ts";
import { TENANT_TIER_RESOLVER_EXT, type TierResolverPlugin } from "./tier-resolver-extension.ts";

// Standardized extension names for privacy-hook axes.
//
// Features register extensions via:
//   r.extendsRegistrar(EXT_USER_DATA, { hooks: { ... } });
//
// Other features attach to them via:
//   r.useExtension(EXT_USER_DATA, "myEntity", { ...hookImpls });
//
// Background: magic strings drift between bundled features (for example,
// text-content uses "Admin" as a role, while tenant-handler uses
// "TenantAdmin"). Constants are the single source of truth; string literals
// are gradually replaced at the relevant integration points. The boot
// validator (validateExtensionUsages) checks that every useExtension has a
// matching extendsRegistrar, so typos in constants cause a compile-time
// failure.
//
// Hook signatures and boot validation for each extension axis are added by
// the feature that registers that axis:
//   userData / tenantData         → (user-data-rights, retention)
//   storageProvider                → (storage-encryption)
//   searchAdapter / external /     → (tenant-lifecycle)
//   infraResource

/**
 * `userData` — user-data rights hooks (GDPR Articles 15, 17, and 20).
 *
 * Expected hook methods:
 *   - `export(userId, ctx) => Promise<UserDataExport>`
 *   - `delete(userId, strategy: "delete" | "anonymize", ctx) => Promise<void>`
 *
 * Registered by: `user-data-rights`.
 * Used by: every feature with user references (tasks, comments, files, ...).
 */
export const EXT_USER_DATA = "userData" as const;

// Ordering bands for EXT_USER_DATA hooks (forget pipeline). The contract was
// implicit across two packages (-100 in custom-fields, 0 in
// user-data-rights), so a host hook with order < REDACT_BEFORE_OWNER would run
// BEFORE the redactors and reintroduce the strip-after-owner-null bug
// (GDPR Article 17 regression). Rule: redactors < 0 <= owner-mutating hooks.
export const EXT_USER_DATA_ORDER = {
  REDACT_BEFORE_OWNER: -100,
  DEFAULT: 0,
} as const;

/**
 * `tenantData` — per-entity tenant-destroy hooks (GDPR + end of data processing agreement).
 *
 * Expected hook method: `destroy(ctx) => Promise<TenantDestroyHookResult | void>`.
 *
 * Registered by: `tenant-lifecycle`.
 * Consumed by: every feature with a tenantId field.
 */
export const EXT_TENANT_DATA = "tenantData" as const;

/**
 * `storageProvider` — file-storage-plugin tenant-destroy hook.
 *
 * Expected hook method: `destroyTenant(tenantId, ctx) => Promise<TenantDestroyHookResult | void>`.
 *
 * Registered by: `files-tenant-data`.
 * Consumed by: pluggable providers (Local, MinIO, S3, R2).
 */
export const EXT_STORAGE_PROVIDER = "storageProvider" as const;

/**
 * `fileProvider` — file-storage provider plugin selection (file-foundation).
 *
 * Provider features (file-provider-s3, -inmemory, -s3-env) register an
 * implementation via `r.useExtension(EXT_FILE_PROVIDER, "<name>", { build })`;
 * the per-tenant config key `provider` selects one at runtime. The framework
 * resolver (`createFileProviderForTenant`) reads it so upload routes,
 * `ctx.files`, and GDPR jobs all use the same store.
 *
 * The framework owns this contract to prevent string drift — file-foundation
 * MUST register the extension point and config key under exactly these names.
 */
export const EXT_FILE_PROVIDER = "fileProvider" as const;

// Qualified config key registered by the file-foundation feature
// (format `<feature>:config:<key>`). This coupling is intentional: the
// framework resolver is below the feature and reads the key by string. Renaming
// the file-foundation feature MUST be accompanied by changing this constant.
export const FILE_PROVIDER_CONFIG_KEY = "file-foundation:config:provider" as const;

// Two roles: boot gate (validateBoot requires its presence once file/image
// fields are in use) AND the ENV source of the config key above, bridged via
// keyDef.env. Tenant rows keep overriding the bridged value.
export const FILE_STORAGE_PROVIDER_ENV = "FILE_STORAGE_PROVIDER" as const;

// Presence placeholder runDevApp writes when an explicitly wired provider
// (options.files) already satisfies the boot gate. It names no plugin, so
// provider resolution treats it like an unset key.
export const FILE_STORAGE_PROVIDER_BOOT_SENTINEL = "configured" as const;

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
 * Registered/consumed by: `file-derivatives`' public variant route.
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
 * `resolve()` runs on every `variant()` call — including cache hits on the
 * anonymous public route — because the spec hash needs the resolved value.
 * It must be cheap or cache its own lookups.
 *
 * Registered/consumed by: `file-derivatives`'s `variant()`
 * (derivatives-context.ts), before the variant's spec hash is computed.
 */
export const EXT_DERIVATIVE_OVERLAY_RESOLVER = "derivativeOverlayResolver" as const;

/**
 * `searchAdapter` — search-index tenant-destroy hook (Meilisearch index
 * cleanup on tenant-destroy).
 *
 * Expected hook method: `destroyTenant(tenantId, ctx) => Promise<TenantDestroyHookResult | void>`.
 *
 * Consumed by: Meilisearch and other search-adapter implementations.
 */
export const EXT_SEARCH_ADAPTER = "searchAdapter" as const;

/**
 * `externalResource` — external-service tenant-destroy hook (webhook
 * subscriptions, Brevo recipient lists, provider customer accounts).
 *
 * Expected hook method: `destroyTenant(tenantId, ctx) => Promise<TenantDestroyHookResult | void>`.
 */
export const EXT_EXTERNAL_RESOURCE = "externalResource" as const;

/**
 * `infraResource` — Pulumi-managed per-tenant resource tenant-destroy hook
 * (custom domain, cert-manager issuer, dedicated pod/volume).
 *
 * Expected hook method: `destroyTenant(tenantId, ctx) => Promise<TenantDestroyHookResult | void>`.
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

/**
 * `assignableRole` — an app declares a membership role as assignable:
 * `r.useExtension(EXT_ASSIGNABLE_ROLE, "<RoleName>", { assignableFrom? })`
 * (`assignableFrom` defaults to "Admin").
 * Provider is the bundled `tenant` feature; consumers are the membership-role guards.
 */
export const EXT_ASSIGNABLE_ROLE = "assignableRole" as const;

// Default membership-list query handler name. Accepted coupling, same
// pattern as FILE_PROVIDER_CONFIG_KEY — the `tenant` feature registers a handler under this literal.
export const TENANT_MEMBERSHIPS_QUERY = "tenant:query:memberships" as const;

/**
 * Union of standardized extension names for the privacy surface.
 * Not every extension in the system is included — other features can still
 * register their own extension names.
 */
export type KumikoExtensionName =
  | typeof EXT_USER_DATA
  | typeof EXT_TENANT_DATA
  | typeof EXT_STORAGE_PROVIDER
  | typeof EXT_SEARCH_ADAPTER
  | typeof EXT_EXTERNAL_RESOURCE
  | typeof EXT_INFRA_RESOURCE
  | typeof EXT_FILE_PROVIDER
  | typeof EXT_DERIVATIVE_RENDERER
  | typeof EXT_DERIVATIVE_PUBLIC_PREDICATE
  | typeof EXT_DERIVATIVE_OVERLAY_RESOLVER
  | typeof EXT_PRINCIPAL_STATUS
  | typeof EXT_TENANT_LIFECYCLE_STATUS
  | typeof EXT_ASSIGNABLE_ROLE;

/** The four `destroyTenant(tenantId, ctx)`-only resource-cleanup extension points. */
export type TenantResourceExtensionName =
  | typeof EXT_STORAGE_PROVIDER
  | typeof EXT_SEARCH_ADAPTER
  | typeof EXT_EXTERNAL_RESOURCE
  | typeof EXT_INFRA_RESOURCE;

// r.useExtension options-shape for framework-owned extension points; app/bundled-features-owned
// points augment co-located with their owner, since the framework never imports upward.
declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [EXT_TENANT_DATA]: TenantDataExtensionHooks;
    [EXT_USER_DATA]: UserDataExtensionOptions;
    [EXT_FILE_PROVIDER]: FileProviderPlugin;
    [EXT_DERIVATIVE_RENDERER]: DerivativeRendererPlugin;
    [EXT_DERIVATIVE_OVERLAY_RESOLVER]: OverlayResolverPlugin;
    [EXT_PRINCIPAL_STATUS]: PrincipalStatusPlugin;
    [EXT_TENANT_LIFECYCLE_STATUS]: TenantLifecycleStatusPlugin;
    [EXT_ASSIGNABLE_ROLE]: { readonly assignableFrom?: AssignableFromRole };
    [EXT_STORAGE_PROVIDER]: TenantResourceExtensionHooks;
    [EXT_SEARCH_ADAPTER]: TenantResourceExtensionHooks;
    [EXT_EXTERNAL_RESOURCE]: TenantResourceExtensionHooks;
    [EXT_INFRA_RESOURCE]: TenantResourceExtensionHooks;
    [TENANT_TIER_RESOLVER_EXT]: TierResolverPlugin;
  }
}
