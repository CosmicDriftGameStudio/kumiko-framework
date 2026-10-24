// Compliance profiles — GDPR + sector-specific regulations.
//
// The tenant admin must select a profile during onboarding. A profile
// bundles user rights (forget grace period, restriction, access-request
// deadline), notification languages, breach disclosure, audit-log retention,
// subprocessor requirements, and the tenant-destruction grace period.
//
// Current set: three profiles plus one default fallback. Extending via
// `extends` is straightforward; additional jurisdictions (uk-gdpr,
// ca-pipeda, us-ccpa, hipaa-healthcare) can be added when needed.
//
// Edge-case decisions:
//
//   1. Default fallback: `resolveComplianceProfile(undefined)` returns
//      `minimal-no-region` with `warning: "no-profile-selected"`. The caller
//      can use this to trigger an onboarding banner; resolution is never
//      silent.
//
//   2. Extends-chain depth: only one level is allowed. de-hr-dsgvo-hgb
//      extends eu-dsgvo, but eu-dsgvo must not extend another profile. The
//      boot validator checks this.
//
//   3. Override deep-merge semantics: merging is recursive. An override such
//      as `{ userRights: { gracePeriod: { days: 60 } } }` on eu-dsgvo leaves
//      the other userRights fields unchanged. Top-level replacement is not
//      supported; the override must target the corresponding property path.
//
//   4. Required-field overrides: the override type is `DeepPartial<...>`.
//      TypeScript prevents null drops at compile time. Runtime casts from
//      the tenant-admin override endpoint pass through a Zod schema with
//      all properties optional, but not nullable.

import { isPlainObject } from "../utils/is-plain-object.ts";
import type { BundleTier } from "./sub-processors.ts";

// --- Profile-Schema ---

export type ComplianceProfileKey =
  | "eu-dsgvo"
  | "swiss-dsg"
  | "de-hr-dsgvo-hgb"
  | "minimal-no-region";

export type DurationSpec = { readonly days: number } | { readonly hours: number };

export type RetentionSpec = DurationSpec | { readonly months: number } | { readonly years: number };

export type AuthorityNotificationDeadline =
  | DurationSpec
  | "as-soon-as-feasible"
  | "in-most-expedient-time"
  | "manual";

export type UserNotificationRequiredPolicy =
  | "if-high-risk"
  | "if-real-risk-of-significant-harm"
  | "if-serious-risk-of-injury"
  | "always-if-encrypted-data-or-pii"
  | "always-without-undue-delay"
  | "manual";

export interface ComplianceProfile {
  readonly key: ComplianceProfileKey;
  readonly region: string;
  readonly label: string;
  readonly extends?: ComplianceProfileKey;

  readonly userRights: {
    readonly gracePeriod: DurationSpec;
    readonly restrictionAllowed: boolean;
    readonly objectionAllowed: boolean;
    readonly portabilityFormat: readonly string[];
    readonly auskunftFrist: DurationSpec;
    readonly employeeAccessRight?: boolean;
    readonly explicitConsentForAutomatedDecision?: boolean;
    readonly doNotSellRequired?: boolean;
    /**
     * DSGVO Art. 15 + 20 Async-Export — Pipeline-Konfiguration. Spec:
     * docs/plans/architecture/user-data-rights.md "Async Export-Pipeline".
     */
    readonly exportDownloadTtl: DurationSpec;
    readonly exportStaleTimeoutMinutes: number;
    readonly exportStorageCleanupGraceHours: number;
  };

  readonly notifications: {
    readonly languages: readonly string[];
    readonly languageDefault?: string;
    readonly mandatoryBreachNotification: boolean;
  };

  readonly breach: {
    readonly authorityNotificationDeadline: AuthorityNotificationDeadline;
    readonly authorityContact: string;
    readonly userNotificationRequired: UserNotificationRequiredPolicy;
    readonly worksCouncilNotificationRequired?: boolean;
    readonly mandatoryRegisterOfBreaches?: boolean;
  };

  readonly auditLog: {
    readonly retention: RetentionSpec;
    readonly reportFrequency: "quarterly" | "yearly" | "annual-required" | "manual";
  };

  readonly subProcessor: {
    readonly consentRequired: boolean;
    readonly changeNotificationLeadDays: number;
    readonly mandatoryBaaWithSubProcessors?: boolean;
    readonly worksCouncilApprovalRequired?: boolean;
    readonly tierFilter?: readonly BundleTier[];
  };

  readonly tenantDestroyGracePeriod: DurationSpec;

  readonly forgetDiscovery?: {
    readonly enabled: boolean;
    readonly mode?: "manual-redact" | "auto-redact-strict";
  };
}

// --- Profile-Definitions (raw, before extends-Resolution) ---

const RAW_PROFILES: Readonly<Record<ComplianceProfileKey, ComplianceProfileRaw>> = {
  "eu-dsgvo": {
    key: "eu-dsgvo",
    region: "EU",
    label: "EU — DSGVO Standard",
    userRights: {
      gracePeriod: { days: 30 },
      restrictionAllowed: true,
      objectionAllowed: true,
      portabilityFormat: ["json"],
      auskunftFrist: { days: 30 },
      exportDownloadTtl: { days: 7 },
      exportStaleTimeoutMinutes: 30,
      exportStorageCleanupGraceHours: 24,
    },
    notifications: {
      languages: ["de", "en"],
      mandatoryBreachNotification: true,
    },
    breach: {
      authorityNotificationDeadline: { hours: 72 },
      authorityContact: "BlnBDI Berlin",
      userNotificationRequired: "if-high-risk",
    },
    auditLog: {
      retention: { months: 24 },
      reportFrequency: "quarterly",
    },
    subProcessor: {
      consentRequired: false,
      changeNotificationLeadDays: 30,
    },
    tenantDestroyGracePeriod: { days: 30 },
    forgetDiscovery: { enabled: false },
  },

  "swiss-dsg": {
    key: "swiss-dsg",
    region: "CH",
    label: "Schweiz — Bundesgesetz über den Datenschutz (rev. 2023)",
    extends: "eu-dsgvo",
    notifications: {
      languages: ["de", "fr", "it", "en"],
      mandatoryBreachNotification: true,
    },
    breach: {
      authorityNotificationDeadline: { hours: 72 },
      authorityContact: "EDÖB Bern",
      userNotificationRequired: "if-high-risk",
    },
  },

  "de-hr-dsgvo-hgb": {
    key: "de-hr-dsgvo-hgb",
    region: "DE",
    label: "Deutschland HR — DSGVO + HGB + Personalakten",
    extends: "eu-dsgvo",
    userRights: {
      gracePeriod: { days: 30 },
      restrictionAllowed: true,
      objectionAllowed: true,
      portabilityFormat: ["json"],
      auskunftFrist: { days: 30 },
      employeeAccessRight: true,
      exportDownloadTtl: { days: 7 },
      exportStaleTimeoutMinutes: 30,
      exportStorageCleanupGraceHours: 24,
    },
    notifications: {
      languages: ["de"],
      mandatoryBreachNotification: true,
    },
    breach: {
      authorityNotificationDeadline: { hours: 72 },
      authorityContact: "Landes-Datenschutzbehörde",
      userNotificationRequired: "if-high-risk",
      worksCouncilNotificationRequired: true,
    },
    auditLog: {
      retention: { years: 10 },
      reportFrequency: "yearly",
    },
    subProcessor: {
      consentRequired: false,
      changeNotificationLeadDays: 30,
      worksCouncilApprovalRequired: true,
    },
    tenantDestroyGracePeriod: { days: 60 },
  },

  "minimal-no-region": {
    key: "minimal-no-region",
    region: "—",
    label: "Minimal — kein Compliance-Profile (NICHT für Production)",
    userRights: {
      gracePeriod: { days: 30 },
      restrictionAllowed: false,
      objectionAllowed: false,
      portabilityFormat: ["json"],
      auskunftFrist: { days: 30 },
      exportDownloadTtl: { days: 7 },
      exportStaleTimeoutMinutes: 30,
      exportStorageCleanupGraceHours: 24,
    },
    notifications: {
      languages: ["en"],
      mandatoryBreachNotification: false,
    },
    breach: {
      authorityNotificationDeadline: "manual",
      authorityContact: "",
      userNotificationRequired: "manual",
    },
    auditLog: {
      retention: { months: 3 },
      reportFrequency: "manual",
    },
    subProcessor: {
      consentRequired: false,
      changeNotificationLeadDays: 30,
    },
    tenantDestroyGracePeriod: { days: 30 },
  },
} satisfies Readonly<Record<ComplianceProfileKey, ComplianceProfileRaw>>;

// Raw profile (before extends resolution) — profiles with `extends` may
// omit required fields because they are supplied by the base profile.
type ComplianceProfileRaw = Partial<Omit<ComplianceProfile, "key" | "region" | "label">> & {
  readonly key: ComplianceProfileKey;
  readonly region: string;
  readonly label: string;
  readonly extends?: ComplianceProfileKey;
};

// --- Tenant-selectable list (excluding minimal-no-region) ---

/**
 * Profile keys that the tenant admin may select during onboarding.
 * `minimal-no-region` is intentionally excluded: it is the default fallback
 * for "no choice made yet" and produces a visible warning. Production
 * tenants must select an actual profile.
 */
export const SELECTABLE_PROFILE_KEYS = [
  "eu-dsgvo",
  "swiss-dsg",
  "de-hr-dsgvo-hgb",
] as const satisfies readonly ComplianceProfileKey[];
// --- Extends-Resolver (deep-merge) ---

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type ComplianceProfileOverride = DeepReadonly<DeepPartial<ComplianceProfile>>;

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

// These paths are replaced as atomic values rather than merged recursively.
// This is required for discriminated unions, where a patch may provide a
// sibling property instead of an override; for example, changing retention
// from { months: 24 } to { years: 10 } would otherwise produce
// { months: 24, years: 10 }, which is semantically invalid.
const ATOMIC_PATHS: ReadonlySet<string> = new Set([
  "userRights.gracePeriod",
  "userRights.auskunftFrist",
  "userRights.exportDownloadTtl",
  "tenantDestroyGracePeriod",
  "breach.authorityNotificationDeadline",
  "auditLog.retention",
]);

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
  path = "",
): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const fullPath = path ? `${path}.${k}` : k;
    const existing = out[k];
    if (ATOMIC_PATHS.has(fullPath)) {
      // Atomic — replace completely instead of merging recursively.
      out[k] = v;
    } else if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v, fullPath);
    } else {
      out[k] = v;
    }
  }
  return out as T; // @cast-boundary generic-record
}

/**
 * Resolves a profile, including its `extends` chain. Throws when the chain
 * is deeper than one level to prevent cycles and keep boot validation simple.
 *
 * The `extends` target itself must not extend another profile. A required
 * multi-level hierarchy must instead be defined explicitly (for example,
 * `de-hr-strict extends eu-dsgvo` rather than
 * `de-hr-strict extends de-hr-dsgvo-hgb extends eu-dsgvo`).
 */
function resolveExtends(key: ComplianceProfileKey): ComplianceProfile {
  const raw = RAW_PROFILES[key];
  if (!raw.extends) {
    return raw as ComplianceProfile; // @cast-boundary schema-walk
  }

  const base = RAW_PROFILES[raw.extends];
  if (base.extends) {
    throw new Error(
      `Compliance-Profile "${key}" extends "${raw.extends}" which itself extends "${base.extends}" — chain depth >1 not supported. Define a flat extends-hierarchy instead.`,
    );
  }

  return deepMerge(
    base as Record<string, unknown>, // @cast-boundary generic-record
    raw as unknown as Record<string, unknown>,
  ) as unknown as ComplianceProfile;
}

/**
 * Precomputed profile list with `extends` already resolved. It is computed
 * once when the module loads, so definition errors (cycles or missing
 * targets) are thrown immediately rather than on the first resolver call.
 */
export const COMPLIANCE_PROFILES: Readonly<Record<ComplianceProfileKey, ComplianceProfile>> =
  Object.fromEntries(
    (Object.keys(RAW_PROFILES) as ComplianceProfileKey[]).map((k) => [k, resolveExtends(k)]),
  ) as Readonly<Record<ComplianceProfileKey, ComplianceProfile>>; // @cast-boundary dynamic-key

// --- Effective-Profile-Resolver ---

export interface EffectiveComplianceProfile {
  readonly profile: ComplianceProfile;
  readonly warning?: "no-profile-selected";
}

/**
 * Returns the effective compliance profile for a tenant, including its
 * tenant override.
 *
 * Edge-case behavior:
 *   - selection=undefined → minimal-no-region + warning="no-profile-selected"
 *   - selection=valid + override=undefined → effective profile, no warning
 *   - selection=valid + override → deep-merged effective profile, no warning
 *
 * The former "minimal-in-production" warning was removed because
 * set-profile no longer accepts minimal-no-region as a tenant selection.
 * Production-specific behavior, such as blocking the default, can be added
 * later if needed.
 */
export function resolveComplianceProfile(args: {
  readonly selection?: ComplianceProfileKey;
  readonly override?: ComplianceProfileOverride;
}): EffectiveComplianceProfile {
  if (!args.selection) {
    return {
      profile: COMPLIANCE_PROFILES["minimal-no-region"],
      warning: "no-profile-selected",
    };
  }

  const base = COMPLIANCE_PROFILES[args.selection];
  if (!args.override) {
    return { profile: base };
  }

  const merged = deepMerge(
    base as unknown as Record<string, unknown>,
    args.override as Record<string, unknown>, // @cast-boundary engine-payload
  ) as unknown as ComplianceProfile;
  return { profile: merged };
}
