// @runtime runtime
// Despite living in this "dev"-marked package, every preset here composes
// @cosmicdrift/kumiko-bundled-features factories, and run-config.ts in every
// app repo feeds it into the runProdApp boot path, not just runDevApp
// (kumiko-framework#2337).
//
// Composable SaaS stack presets — explicit opt-in blocks for run-config.ts.
// Presets export feature instances only; no implicit PAT scopes or
// anonymousAccess. A stack that needs a runProdApp boot option tags the
// feature that depends on it with `bootRequires`; runProdApp names the gap.

import {
  type AccountSecurityFeatureOptions,
  createAccountSecurityFeature,
} from "@cosmicdrift/kumiko-bundled-features/account-security";
import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  type AuthMfaFeatureOptions,
  createAuthMfaFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import {
  type BillingFoundationOptions,
  createBillingFoundationFeature,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createCapCounterFeature } from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import {
  type CreateCapOverviewOptions,
  createCapOverviewFeature,
} from "@cosmicdrift/kumiko-bundled-features/cap-overview";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createCryptoShreddingFeature } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createFileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { createFileProviderS3Feature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import {
  createLegalPagesFeature,
  type LegalPagesOptions,
} from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { createMailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { createMailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { createMailTransportSmtpFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-smtp";
import { createRateLimitingFeature } from "@cosmicdrift/kumiko-bundled-features/rate-limiting";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  createSubscriptionMollieFeature,
  type SubscriptionMollieOptions,
} from "@cosmicdrift/kumiko-bundled-features/subscription-mollie";
import {
  createTemplateResolverFeature,
  type TemplateResolverOptions,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import {
  type CreateTierEngineOptions,
  createTierEngineFeature,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import {
  createUserDataRightsFeature,
  type UserDataRightsOptions,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import {
  createWaitlistFeature,
  type WaitlistOptions,
} from "@cosmicdrift/kumiko-bundled-features/waitlist";
import type { BootOptionName, FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createRendererMailHtmlFeature,
  type MailBrandSuffixResolver,
  type MailFooterResolver,
} from "@cosmicdrift/kumiko-renderer-mail-html";

export type FileProviderKind = "inmemory" | "s3" | "s3-env";
export type MailTransportKind = "inmemory" | "smtp";
export type GdprStackOrder = "retention-first" | "compliance-first";

export type FileStackOptions = {
  /** Without providers the stack needs runProdApp's `fileStorage` option. */
  readonly providers?: readonly FileProviderKind[];
  readonly includeFilesFeature?: boolean;
};

export type MailStackOptions = {
  readonly transports: readonly MailTransportKind[];
};

export type PagesStackOptions = {
  readonly wrapLayout?: LegalPagesOptions["wrapLayout"];
  /** Also serves the terms routes, see LegalPagesOptions.terms. */
  readonly terms?: LegalPagesOptions["terms"];
};

export type GdprStackOptions = {
  readonly order?: GdprStackOrder;
  readonly sessions?: boolean;
  readonly tenantLifecycle?: boolean;
  /** Adds sessions, user-data-rights and user-profile in the order the
   *  self-service privacy center needs; user-data-rights needs `mail`. */
  readonly selfService?: { readonly userDataRights?: UserDataRightsOptions };
  /** Optional tokenVerifier provider(s) (e.g. PAT) when `sessions` is on.
   *  Session-only stacks need none — sessions registers sessionStore, which
   *  satisfies auth-foundation's boot check (#1570). Pass providers when the
   *  app also wants Bearer/PAT auth. */
  readonly providers?: readonly FeatureDefinition[];
  /** Roles allowed to use the compliance-profiles handlers; default access.admin. */
  readonly access?: readonly string[];
};

export type UserDataRightsStackOptions = {
  readonly userDataRights?: UserDataRightsOptions;
  readonly includeDefaults?: boolean;
};

// `sessions` may live on composeIdentityStack OR composeGdprStack; both with default
// options is deduped at boot, differing options throw "Duplicate feature".
export type OpsStackOptions = {
  readonly delivery?: boolean;
  /** Roles allowed to use the delivery handlers; default access.admin. */
  readonly access?: readonly string[];
  readonly audit?: boolean;
  readonly jobs?: boolean;
  readonly rateLimiting?: boolean;
};

/** sessions (+ optional auth-mfa). config/user/tenant/auth-email-password stay
 *  on composeFeatures(includeBundled). Pass `mfa` options to mount TOTP.
 *  When `sessions` is on (the default), auth-foundation is mounted alongside it —
 *  the framework's registry now hard-requires it (sessions.requires("auth-foundation")).
 *  Session-only is enough for boot (#1570); optional Bearer/PAT still needs a
 *  tokenVerifier provider from the caller (e.g. createPersonalAccessTokensFeature
 *  ({ scopes })) — PAT scopes are app-specific, so they stay caller-owned. */
export type IdentityStackOptions = {
  readonly sessions?: boolean;
  readonly mfa?: AuthMfaFeatureOptions;
};

function withBootRequires<TFeature extends FeatureDefinition>(
  feature: TFeature,
  stack: string,
  options: readonly BootOptionName[],
  severity: "error" | "warn" = "error",
): TFeature {
  return {
    ...feature,
    bootRequires: { stack, options, ...(severity === "warn" && { severity }) },
  };
}

export function stackFeatureNames(features: readonly FeatureDefinition[]): string[] {
  return features.map((f) => f.name);
}

export function composePagesStack(options: PagesStackOptions = {}): FeatureDefinition[] {
  // Pages content lives in template-resolver (kind text-block), which the
  // renderer stack already mounts — an app composing pages WITHOUT the renderer
  // stack has to add createTemplateResolverFeature() itself, or legal-pages'
  // r.requires fails the boot. Mounting it here instead would collide with
  // composeRendererStack (createRegistry rejects duplicate features).
  return [
    createLegalPagesFeature({
      ...(options.wrapLayout !== undefined && { wrapLayout: options.wrapLayout }),
      ...(options.terms !== undefined && { terms: options.terms }),
    }),
  ];
}

export type RendererStackOptions = {
  /** Platform imprint, privacy link and footer text under every mail; see createRendererMailHtmlFeature. */
  readonly mailFooter?: MailFooterResolver;
  /** Word after the tenant name in the mail's brand row, e.g. "Status". */
  readonly mailBrandSuffix?: MailBrandSuffixResolver;
  /** Passed to createTemplateResolverFeature, e.g. `tenantEditable` to let a TenantAdmin edit chosen templates. */
  readonly templateResolver?: TemplateResolverOptions;
};

export function composeRendererStack(options: RendererStackOptions = {}): FeatureDefinition[] {
  return [
    createTemplateResolverFeature(options.templateResolver),
    createRendererFoundationFeature(),
    createRendererMailHtmlFeature({
      ...(options.mailFooter !== undefined && { footer: options.mailFooter }),
      ...(options.mailBrandSuffix !== undefined && { brandSuffix: options.mailBrandSuffix }),
    }),
  ];
}

/** Tenant mail transports reach users through channel-email, so the stack needs `mail`. */
export function composeMailStack(options: MailStackOptions): FeatureDefinition[] {
  const out: FeatureDefinition[] = [
    withBootRequires(createMailFoundationFeature(), "composeMailStack", ["mail"]),
  ];
  for (const transport of options.transports) {
    if (transport === "inmemory") out.push(createMailTransportInMemoryFeature());
    if (transport === "smtp") out.push(createMailTransportSmtpFeature());
  }
  return out;
}

export function composeFileStack(options: FileStackOptions = {}): FeatureDefinition[] {
  const providers = options.providers ?? [];
  const foundation = createFileFoundationFeature();
  const out: FeatureDefinition[] = [
    providers.length === 0
      ? withBootRequires(foundation, "composeFileStack", ["fileStorage"])
      : foundation,
  ];
  for (const provider of providers) {
    if (provider === "inmemory") out.push(createFileProviderInMemoryFeature());
    if (provider === "s3") out.push(createFileProviderS3Feature());
    if (provider === "s3-env") out.push(createFileProviderS3Feature({ fromEnv: true }));
  }
  if (options.includeFilesFeature ?? true) out.push(createFilesFeature());
  return out;
}

/** Retention + compliance (+ optional lifecycle/sessions/self-service). Needs an
 *  explicit KMS decision (`kmsMode`, or the low-level `kms` / `allowPlaintextPii`).
 *  `selfService` mounts user-profile, which requires user-data-rights-defaults and
 *  auth-email-password: composeUserDataRightsStack mounts the defaults, the login comes from the `auth` option. */
export function composeGdprStack(options: GdprStackOptions = {}): FeatureDefinition[] {
  const order = options.order ?? "retention-first";
  const retention = withBootRequires(createDataRetentionFeature(), "composeGdprStack", ["kmsMode"]);
  const compliance = createComplianceProfilesFeature(
    options.access !== undefined ? { access: options.access } : {},
  );
  const out: FeatureDefinition[] =
    order === "compliance-first" ? [compliance, retention] : [retention, compliance];
  if (options.tenantLifecycle) out.push(createTenantLifecycleFeature());
  if (options.sessions) {
    out.push(createAuthFoundationFeature(), createSessionsFeature());
    if (options.providers) out.push(...options.providers);
  }
  if (options.selfService) {
    if (!options.sessions) out.push(createSessionsFeature());
    out.push(
      withBootRequires(
        createUserDataRightsFeature(options.selfService.userDataRights ?? {}),
        "composeGdprStack",
        ["mail"],
      ),
      createUserProfileFeature(),
    );
  }
  return out;
}

export function composeUserDataRightsStack(
  options: UserDataRightsStackOptions = {},
): FeatureDefinition[] {
  const includeDefaults = options.includeDefaults ?? true;
  // Export-ready and deletion mails go through delivery + channel-email.
  const out: FeatureDefinition[] = [
    withBootRequires(
      createUserDataRightsFeature(options.userDataRights ?? {}),
      "composeUserDataRightsStack",
      ["mail"],
    ),
  ];
  if (includeDefaults) out.push(createUserDataRightsDefaultsFeature());
  return out;
}

export function composeOpsStack(options: OpsStackOptions = {}): FeatureDefinition[] {
  const delivery = options.delivery ?? true;
  const audit = options.audit ?? true;
  const jobs = options.jobs ?? true;
  const rateLimiting = options.rateLimiting ?? false;
  const out: FeatureDefinition[] = [];
  if (delivery)
    out.push(createDeliveryFeature(options.access !== undefined ? { access: options.access } : {}));
  if (audit) out.push(createAuditFeature());
  if (jobs) out.push(createJobsFeature());
  if (rateLimiting) out.push(createRateLimitingFeature());
  return out;
}

/** Identity opt-ins: sessions by default; auth-mfa when `mfa` options given.
 *  Do not also pass `sessions: true` to composeGdprStack — duplicate feature. */
export function composeIdentityStack(options: IdentityStackOptions = {}): FeatureDefinition[] {
  const sessions = options.sessions ?? true;
  const out: FeatureDefinition[] = [];
  if (sessions) {
    out.push(createAuthFoundationFeature(), createSessionsFeature());
  }
  if (options.mfa !== undefined) out.push(createAuthMfaFeature(options.mfa));
  return out;
}

export type AuthStackOptions = {
  readonly sessions?: boolean;
  readonly mfa?: AuthMfaFeatureOptions;
  /** Self-service screen for MFA and own sessions; mounted when `mfa` and `sessions` are on. */
  readonly accountSecurity?: AccountSecurityFeatureOptions;
};

/** auth-foundation + sessions, optional auth-mfa and account-security.
 *  auth-email-password stays with runProdApp's `auth` option, which also wires
 *  the MFA status checker into the login handler. */
export function composeAuthStack(options: AuthStackOptions = {}): FeatureDefinition[] {
  const sessions = options.sessions ?? true;
  const out = composeIdentityStack({
    sessions,
    ...(options.mfa !== undefined && { mfa: options.mfa }),
  });
  if (options.mfa !== undefined && sessions) {
    out.push(createAccountSecurityFeature(options.accountSecurity ?? {}));
  }
  return out;
}

export type SaasStackBilling =
  | { readonly billing: "stripe" }
  | { readonly billing: "mollie"; readonly mollie: SubscriptionMollieOptions };

export type SaasStackOptions<
  TCaps extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> = SaasStackBilling & {
  readonly tiers: CreateTierEngineOptions<TCaps>;
  readonly billingFoundation?: BillingFoundationOptions;
  /** Mounts cap-counter and cap-overview. */
  readonly caps?: CreateCapOverviewOptions;
  /** Mounts waitlist; it needs auth-email-password and user-data-rights. */
  readonly waitlist?: WaitlistOptions;
  /** Operator switches over the tiers: the stack then expects runProdApp / runDevApp's `featureToggles` option. */
  readonly featureToggles?: boolean;
};

/** billing-foundation + tier-engine (+ caps, waitlist). `"stripe"` leaves
 *  subscription-stripe and its webhook route to runProdApp's `billing` option;
 *  Without that option a stripe stack only warns at boot.
 *  `"mollie"` mounts subscription-mollie, whose webhook route the app adds.
 *  billing-foundation requires tenant-lifecycle and compliance-profiles, which
 *  composeGdprStack({ tenantLifecycle: true }) mounts. */
export function composeSaasStack<TCaps extends Readonly<Record<string, unknown>>>(
  options: SaasStackOptions<TCaps>,
): FeatureDefinition[] {
  const foundation = createBillingFoundationFeature(options.billingFoundation ?? {});
  const tierEngine = createTierEngineFeature(options.tiers);
  const out: FeatureDefinition[] = [
    options.billing === "stripe"
      ? withBootRequires(foundation, "composeSaasStack", ["billing"], "warn")
      : foundation,
    options.featureToggles
      ? withBootRequires(tierEngine, "composeSaasStack", ["featureToggles"])
      : tierEngine,
  ];
  if (options.billing === "mollie") out.push(createSubscriptionMollieFeature(options.mollie));
  if (options.caps) out.push(createCapCounterFeature(), createCapOverviewFeature(options.caps));
  if (options.waitlist) out.push(createWaitlistFeature(options.waitlist));
  return out;
}

export type SecurityStackOptions = {
  /** Default true; pass false when another stack already mounts sessions with other options. */
  readonly includeSessions?: boolean;
};

/** sessions, crypto-shredding, rate-limiting, audit: the security baseline the
 *  production boot warning checks. Relies on runProdApp's default L1/L2 rate
 *  limits and an explicit KMS decision. */
export function composeSecurityStack(options: SecurityStackOptions = {}): FeatureDefinition[] {
  return [
    ...(options.includeSessions === false ? [] : [createSessionsFeature()]),
    withBootRequires(createCryptoShreddingFeature(), "composeSecurityStack", ["kmsMode"]),
    withBootRequires(createRateLimitingFeature(), "composeSecurityStack", ["rateLimit"]),
    createAuditFeature(),
  ];
}
