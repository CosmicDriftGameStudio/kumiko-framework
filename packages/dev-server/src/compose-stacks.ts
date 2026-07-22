// Composable SaaS stack presets — explicit opt-in blocks for run-config.ts.
// Presets export feature instances only; no implicit PAT scopes, anonymousAccess,
// or tier maps (those stay in bin/server.ts / app run-config).

import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  type AuthMfaFeatureOptions,
  createAuthMfaFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { fileProviderS3Feature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import { fileProviderS3EnvFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3-env";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import {
  createLegalPagesFeature,
  type LegalPagesOptions,
} from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { mailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { mailTransportInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { mailTransportSmtpFeature } from "@cosmicdrift/kumiko-bundled-features/mail-transport-smtp";
import { createRateLimitingFeature } from "@cosmicdrift/kumiko-bundled-features/rate-limiting";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createRendererSimpleFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { createTextContentFeature } from "@cosmicdrift/kumiko-bundled-features/text-content";
import {
  createUserDataRightsFeature,
  type UserDataRightsOptions,
} from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export type FileProviderKind = "inmemory" | "s3" | "s3-env";
export type MailTransportKind = "inmemory" | "smtp";
export type GdprStackOrder = "retention-first" | "compliance-first";

export type FileStackOptions = {
  readonly providers: readonly FileProviderKind[];
  readonly includeFilesFeature?: boolean;
};

export type MailStackOptions = {
  readonly transports: readonly MailTransportKind[];
};

export type PagesStackOptions = {
  readonly wrapLayout?: LegalPagesOptions["wrapLayout"];
};

export type GdprStackOptions = {
  readonly order?: GdprStackOrder;
  readonly sessions?: boolean;
  readonly tenantLifecycle?: boolean;
};

export type UserDataRightsStackOptions = {
  readonly userDataRights?: UserDataRightsOptions;
  readonly includeDefaults?: boolean;
};

// `sessions` may live on composeIdentityStack OR composeGdprStack — never both
// with sessions:true. composeOpsStack used to accept it too; combining presets
// that each push "sessions" crashes createRegistry with "duplicate feature".
export type OpsStackOptions = {
  readonly delivery?: boolean;
  readonly audit?: boolean;
  readonly jobs?: boolean;
  readonly rateLimiting?: boolean;
};

/** sessions (+ optional auth-mfa). config/user/tenant/auth-email-password stay
 *  on composeFeatures(includeBundled). Pass `mfa` options to mount TOTP.
 *  When `sessions` is on (the default), auth-foundation is mounted alongside it —
 *  the framework's registry now hard-requires it (sessions.requires("auth-foundation")).
 *  Pass `providers` for the tokenVerifier(s) auth-foundation itself requires at least
 *  one of (e.g. createPersonalAccessTokensFeature({ scopes })) — PAT scopes are
 *  app-specific (which write-handlers an API token may call), so they stay caller-owned
 *  instead of a framework default. */
export type IdentityStackOptions = {
  readonly sessions?: boolean;
  readonly mfa?: AuthMfaFeatureOptions;
  readonly providers?: readonly FeatureDefinition[];
};

export function stackFeatureNames(features: readonly FeatureDefinition[]): string[] {
  return features.map((f) => f.name);
}

export function composePagesStack(options: PagesStackOptions = {}): FeatureDefinition[] {
  return [
    createTextContentFeature(),
    createLegalPagesFeature(
      options.wrapLayout !== undefined ? { wrapLayout: options.wrapLayout } : {},
    ),
  ];
}

export function composeRendererStack(): FeatureDefinition[] {
  return [
    createTemplateResolverFeature(),
    createRendererFoundationFeature(),
    createRendererSimpleFeature(),
  ];
}

export function composeMailStack(options: MailStackOptions): FeatureDefinition[] {
  const out: FeatureDefinition[] = [mailFoundationFeature];
  for (const transport of options.transports) {
    if (transport === "inmemory") out.push(mailTransportInMemoryFeature);
    if (transport === "smtp") out.push(mailTransportSmtpFeature);
  }
  return out;
}

export function composeFileStack(options: FileStackOptions): FeatureDefinition[] {
  const out: FeatureDefinition[] = [fileFoundationFeature];
  for (const provider of options.providers) {
    if (provider === "inmemory") out.push(fileProviderInMemoryFeature);
    if (provider === "s3") out.push(fileProviderS3Feature);
    if (provider === "s3-env") out.push(fileProviderS3EnvFeature);
  }
  if (options.includeFilesFeature ?? true) out.push(createFilesFeature());
  return out;
}

/** Retention + compliance (+ optional lifecycle/sessions). UDR/files mount separately — order varies per app. */
export function composeGdprStack(options: GdprStackOptions = {}): FeatureDefinition[] {
  const order = options.order ?? "retention-first";
  const retention = createDataRetentionFeature();
  const compliance = createComplianceProfilesFeature();
  const out: FeatureDefinition[] =
    order === "compliance-first" ? [compliance, retention] : [retention, compliance];
  if (options.tenantLifecycle) out.push(createTenantLifecycleFeature());
  if (options.sessions) out.push(authFoundationFeature, createSessionsFeature());
  return out;
}

export function composeUserDataRightsStack(
  options: UserDataRightsStackOptions = {},
): FeatureDefinition[] {
  const includeDefaults = options.includeDefaults ?? true;
  const out: FeatureDefinition[] = [createUserDataRightsFeature(options.userDataRights ?? {})];
  if (includeDefaults) out.push(createUserDataRightsDefaultsFeature());
  return out;
}

export function composeOpsStack(options: OpsStackOptions = {}): FeatureDefinition[] {
  const delivery = options.delivery ?? true;
  const audit = options.audit ?? true;
  const jobs = options.jobs ?? true;
  const rateLimiting = options.rateLimiting ?? false;
  const out: FeatureDefinition[] = [];
  if (delivery) out.push(createDeliveryFeature());
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
    out.push(authFoundationFeature, createSessionsFeature());
    if (options.providers) out.push(...options.providers);
  }
  if (options.mfa !== undefined) out.push(createAuthMfaFeature(options.mfa));
  return out;
}
