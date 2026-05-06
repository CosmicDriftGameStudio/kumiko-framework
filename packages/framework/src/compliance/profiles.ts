// Compliance-Profiles — DSGVO + sektorspezifische Regelwerke.
//
// Tenant-Admin waehlt ein Profile beim Onboarding (Pflicht). Profile
// buendelt User-Rights (Forget-Grace, Restriction, Auskunftsfrist),
// Notification-Sprache, Breach-Disclosure, Audit-Log-Retention,
// Sub-Processor-Anforderungen und Tenant-Destroy-Grace.
//
// MVP-Set: 3 Profile + 1 Default-Fallback. Erweiterung via `extends`
// trivial — neue Laender (uk-gdpr, ca-pipeda, us-ccpa, hipaa-healthcare)
// kommen on-demand wenn Customer fragt.
//
// Edge-Case-Decisions (advisor-pinned 2026-05-06):
//
//   1. Default-Fallback: `resolveComplianceProfile(undefined)` returnt
//      `minimal-no-region` mit `warning: "no-profile-selected"`. Caller
//      sieht das und kann Onboarding-Banner triggern. Nie still
//      resolven.
//
//   2. extends-Chain-Tiefe: nur 1-Level. de-hr-dsgvo-hgb extends
//      eu-dsgvo, aber eu-dsgvo darf NICHT selbst extends haben. Boot-
//      Validator (Sprint 1.3) prueft.
//
//   3. Deep-merge-Semantik vom Override: rekursiv. Override
//      `{ userRights: { gracePeriod: { days: 60 } } }` auf eu-dsgvo
//      laesst andere userRights-Felder unveraendert. Top-Level-Replace
//      gibt es NICHT — Override muss strukturell exakt das Pfad-Tree
//      treffen.
//
//   4. Required-Field-Override: Override-Type ist `DeepPartial<...>`.
//      TypeScript verhindert null-Drops zur Compile-Time. Runtime-Cast
//      durch Tenant-Admin-Override-Endpoint laeuft durch Zod-Schema
//      mit allen-Properties-optional (kein nullable).
//
// Siehe docs/plans/datenschutz/compliance-profiles.md.

import type { BundleTier } from "./sub-processors";

// --- Profile-Schema ---

export type ComplianceProfileKey =
  | "eu-dsgvo"
  | "swiss-dsg"
  | "de-hr-dsgvo-hgb"
  | "minimal-no-region";

export type DurationSpec = { readonly days: number } | { readonly hours: number };

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
    readonly retention: DurationSpec | { readonly months: number } | { readonly years: number };
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
};

// Raw-Profile (vor extends-Resolution) — `extends`-Profile dürfen
// Required-Felder weglassen, sie kommen vom Base-Profile dazu.
type ComplianceProfileRaw = Partial<Omit<ComplianceProfile, "key" | "region" | "label">> & {
  readonly key: ComplianceProfileKey;
  readonly region: string;
  readonly label: string;
  readonly extends?: ComplianceProfileKey;
};

// --- Tenant-Auswählbare Liste (ohne minimal-no-region) ---

/**
 * Profile-Schluessel die der Tenant-Admin im Onboarding waehlen darf.
 * `minimal-no-region` ist bewusst NICHT in der Liste — es ist der
 * Default-Fallback fuer "noch keine Wahl getroffen", mit sichtbarer
 * Warning. Production-Tenants sollen ein echtes Profile waehlen.
 */
export const SELECTABLE_PROFILE_KEYS: readonly ComplianceProfileKey[] = [
  "eu-dsgvo",
  "swiss-dsg",
  "de-hr-dsgvo-hgb",
];

// --- Extends-Resolver (deep-merge) ---

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

export type ComplianceProfileOverride = DeepReadonly<DeepPartial<ComplianceProfile>>;

type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Pfade die als ganzes Atom ersetzt werden (NICHT rekursiv gemergt).
// Notwendig fuer Diskriminierte-Union-Types wo das Patch ein Schwester-
// Property statt einer Override sein kann — z.B. retention von
// { months: 24 } auf { years: 10 } wuerde sonst zu { months: 24, years: 10 }
// werden, semantisch nonsense.
const ATOMIC_PATHS: ReadonlySet<string> = new Set([
  "userRights.gracePeriod",
  "userRights.auskunftFrist",
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
      // Atomic — replace komplett statt rekursiv mergen.
      out[k] = v;
    } else if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v, fullPath);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Resolved ein Profile inklusive `extends`-Auflösung. Wirft wenn die
 * extends-Chain tiefer als 1 Level ist (vermeidet Cycles + macht
 * Boot-Validation einfach).
 *
 * Edge-Case (gepinnt): das `extends`-Target darf selbst KEIN extends
 * haben. Wer doch eine Mehrstufen-Hierarchie braucht, definiert die
 * Stufen explizit (z.B. `de-hr-strict extends eu-dsgvo`, statt
 * `de-hr-strict extends de-hr-dsgvo-hgb extends eu-dsgvo`).
 */
function resolveExtends(key: ComplianceProfileKey): ComplianceProfile {
  const raw = RAW_PROFILES[key];
  if (!raw.extends) {
    return raw as ComplianceProfile;
  }

  const base = RAW_PROFILES[raw.extends];
  if (base.extends) {
    throw new Error(
      `Compliance-Profile "${key}" extends "${raw.extends}" which itself extends "${base.extends}" — chain depth >1 not supported. Define a flat extends-hierarchy instead.`,
    );
  }

  return deepMerge(base as Record<string, unknown>, raw as unknown as Record<string, unknown>) as
    unknown as ComplianceProfile;
}

/**
 * Pre-baked Profile-Liste (extends bereits aufgelöst). Beim Modul-Load
 * einmal berechnet — wirft bei Definition-Fehlern (Cycle, missing target)
 * sofort, nicht erst beim ersten Resolver-Call.
 */
export const COMPLIANCE_PROFILES: Readonly<Record<ComplianceProfileKey, ComplianceProfile>> =
  Object.fromEntries(
    (Object.keys(RAW_PROFILES) as ComplianceProfileKey[]).map((k) => [k, resolveExtends(k)]),
  ) as Readonly<Record<ComplianceProfileKey, ComplianceProfile>>;

// --- Effective-Profile-Resolver ---

export interface EffectiveComplianceProfile {
  readonly profile: ComplianceProfile;
  readonly warning?: "no-profile-selected" | "minimal-in-production";
}

/**
 * Liefert das effektive Compliance-Profile fuer einen Tenant inklusive
 * Tenant-Override.
 *
 * Edge-Case-Verhalten (gepinnt):
 *   - selection=undefined → minimal-no-region + warning="no-profile-selected"
 *   - selection=minimal-no-region in production → minimal-no-region + warning="minimal-in-production"
 *   - selection=valid + override=undefined → effective profile, kein warning
 *   - selection=valid + override → deep-merged effective, kein warning
 */
export function resolveComplianceProfile(args: {
  readonly selection?: ComplianceProfileKey;
  readonly override?: ComplianceProfileOverride;
  readonly isProduction?: boolean;
}): EffectiveComplianceProfile {
  if (!args.selection) {
    return {
      profile: COMPLIANCE_PROFILES["minimal-no-region"],
      warning: "no-profile-selected",
    };
  }

  if (args.selection === "minimal-no-region" && args.isProduction === true) {
    return {
      profile: COMPLIANCE_PROFILES["minimal-no-region"],
      warning: "minimal-in-production",
    };
  }

  const base = COMPLIANCE_PROFILES[args.selection];
  if (!args.override) {
    return { profile: base };
  }

  const merged = deepMerge(
    base as unknown as Record<string, unknown>,
    args.override as Record<string, unknown>,
  ) as unknown as ComplianceProfile;
  return { profile: merged };
}
