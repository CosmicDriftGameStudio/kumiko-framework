// Boot steps that runProdApp, the dev server and the worker processes run
// identically. Each step keeps the caller in charge of ordering, logging sinks
// and cleanup policy: those differ between the processes.

import {
  AuthErrors,
  AuthHandlers,
  AuthQueries,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdminGuarded,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import { AuthMfaHandlers } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { AuthRoutesConfig } from "@cosmicdrift/kumiko-framework/api";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createDbConnection,
  type DbConnection,
  dbConnectionOptionsFromEnv,
  outsideTransactionPoolOptionsFromEnv,
  type RowLevelSecurityMode,
  serverTimeoutOptionsFromEnv,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type BundledListsOptions,
  collectWriteHandlerQns,
  type EffectiveFeaturesResolver,
  type FeatureDefinition,
  findTierResolverUsage,
  type Registry,
  requireTierResolverPlugin,
  type ValidateBootOptions,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import type { CacheSyncBus } from "@cosmicdrift/kumiko-framework/redis";
import type { EnvelopeCipher } from "@cosmicdrift/kumiko-framework/secrets";
import { warnIfNonUtcServerTimeZone } from "@cosmicdrift/kumiko-framework/time";
import type { FeatureTogglesWiring } from "../boot-options/feature-toggles-option.ts";
import type { DbSeedFn } from "../boot-options/seed-shortcuts.ts";
import {
  type AuthOptionsCarrier,
  buildComposeAuthOptions,
  composeFeatures,
} from "../compose-features.ts";
import type { RunProdAppAuthOptions } from "../run-prod-app.ts";
import { applyBootSeeds } from "./apply-boot-seeds.ts";
import { type DatabaseWaitClock, waitUntilDatabaseReachable } from "./wait-for-database.ts";

/** Returns `envSource` itself (it may be `process.env`) when there is nothing to layer under it. */
export function withEnvDefaults(
  envDefaults: Readonly<Record<string, string | undefined>>,
  envSource: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.keys(envDefaults).length > 0 ? { ...envDefaults, ...envSource } : envSource;
}

export function composeAppFeatures(
  appFeatures: readonly FeatureDefinition[],
  bootFeatures: readonly FeatureDefinition[],
  effectiveAuth: AuthOptionsCarrier | undefined,
  bundledLists?: BundledListsOptions,
): readonly FeatureDefinition[] {
  const composeAuthOptions = buildComposeAuthOptions(effectiveAuth);
  return composeFeatures([...appFeatures, ...bootFeatures], {
    includeBundled: !!effectiveAuth,
    ...(composeAuthOptions && { authOptions: composeAuthOptions }),
    ...(bundledLists && { bundledLists }),
  });
}

export function validateComposedFeatures(
  features: readonly FeatureDefinition[],
  bootOptions: ValidateBootOptions,
): void {
  validateBoot(features, bootOptions);
  warnIfNonUtcServerTimeZone();
  validateAppCustomScreenWriteQns(process.cwd(), collectWriteHandlerQns(features));
}

export function assertMfaSwitchTenantGate(registry: Registry, processName: string): void {
  if (registry.getWriteHandler(AuthHandlers.switchTenantMfaGate) === undefined) {
    throw new Error(
      `[${processName}] auth-mfa is mounted but ${AuthHandlers.switchTenantMfaGate} is not registered: ` +
        "createAuthEmailPasswordFeature registers it only when mfaStatusChecker is set, and without it " +
        "POST /auth/switch-tenant would mint sessions without the second factor",
    );
  }
}

export async function buildEffectiveFeaturesResolver(deps: {
  readonly features: readonly FeatureDefinition[];
  readonly featureToggles: FeatureTogglesWiring | undefined;
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly cacheSync: CacheSyncBus;
}): Promise<EffectiveFeaturesResolver | undefined> {
  const { features, featureToggles, db, registry, cacheSync } = deps;
  const tierResolverUsage = findTierResolverUsage(features);
  const tierResolver = tierResolverUsage
    ? await requireTierResolverPlugin(tierResolverUsage).build({ db, registry, cacheSync })
    : undefined;
  if (!featureToggles) return tierResolver;
  const bound = await featureToggles.bind({ db, registry, cacheSync, tierResolver });
  return bound.resolver;
}

export async function applyStandardBootSeeds(deps: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly admin: SeedAdminOptions | undefined;
  readonly shortcutSeeds: readonly DbSeedFn[];
  readonly cipher: EnvelopeCipher | undefined;
  readonly processName: string;
  readonly databaseWait?: DatabaseWaitClock;
}): Promise<void> {
  const { db, registry, admin, shortcutSeeds, cipher, processName, databaseWait } = deps;
  // Seeds are idempotent, so a transient connection error re-runs the whole sequence; any other
  // error stays fatal. Later boot steps build on the seeds, so this cannot continue in the background.
  await waitUntilDatabaseReachable(
    async () => {
      if (admin) {
        await seedAdminGuarded(db, admin);
      }
      for (const seed of shortcutSeeds) {
        await seed(db);
      }
      // The helper indirection is what config-seed-boot.integration.ts pins — keep it as a single call.
      await applyBootSeeds({
        registry,
        db,
        ...(cipher && { cipher }),
      });
    },
    { ...databaseWait, processName, target: "database (boot seeds)" },
  );
}

const MFA_ROUTE_HANDLERS = {
  mfaVerifyHandler: AuthMfaHandlers.verify,
  switchTenantMfaGateHandler: AuthHandlers.switchTenantMfaGate,
  mfaPreauthEnableStartHandler: AuthMfaHandlers.enableStartPreauth,
  mfaPreauthConfirmHandler: AuthMfaHandlers.enableConfirmPreauth,
};

type SharedAuthFlowFields = Pick<
  RunProdAppAuthOptions,
  "passwordReset" | "emailVerification" | "accountUnlock" | "signup" | "invite"
>;

type AuthFlowRoutes = Pick<
  AuthRoutesConfig,
  "passwordReset" | "emailVerification" | "accountUnlock" | "signup" | "invite"
>;

function buildAuthFlowRoutes(effectiveAuth: SharedAuthFlowFields): AuthFlowRoutes {
  return {
    ...(effectiveAuth.passwordReset && {
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
    }),
    ...(effectiveAuth.emailVerification && {
      emailVerification: {
        requestHandler: AuthHandlers.requestEmailVerification,
        confirmHandler: AuthHandlers.verifyEmail,
      },
    }),
    ...(effectiveAuth.accountUnlock && {
      accountUnlock: {
        requestHandler: AuthHandlers.requestAccountUnlock,
        confirmHandler: AuthHandlers.confirmAccountUnlock,
      },
    }),
    ...(effectiveAuth.signup && {
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
    }),
    ...(effectiveAuth.invite && {
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
        infoHandler: AuthQueries.inviteInfo,
      },
    }),
  };
}

export type SharedAuthRouteSource = SharedAuthFlowFields &
  Pick<
    RunProdAppAuthOptions,
    | "loginErrorStatusMap"
    | "cookieDomain"
    | "retiredCookieDomains"
    | "allowedOrigins"
    | "unsafeSkipOriginCheck"
    | "postAuthLanding"
  >;

export type SharedAuthRoutes = AuthFlowRoutes &
  Pick<
    AuthRoutesConfig,
    | "membershipQuery"
    | "loginHandler"
    | "loginErrorStatusMap"
    | "cookieDomain"
    | "retiredCookieDomains"
    | "allowedOrigins"
    | "unsafeSkipOriginCheck"
    | "postAuthLanding"
    | "mfaVerifyHandler"
    | "switchTenantMfaGateHandler"
    | "mfaPreauthEnableStartHandler"
    | "mfaPreauthConfirmHandler"
  >;

export function buildSharedAuthRoutes(
  effectiveAuth: SharedAuthRouteSource,
  hasMfa: boolean,
): SharedAuthRoutes {
  return {
    membershipQuery: TenantQueries.memberships,
    loginHandler: AuthHandlers.login,
    loginErrorStatusMap: effectiveAuth.loginErrorStatusMap ?? {
      [AuthErrors.invalidCredentials]: 401,
      [AuthErrors.noMembership]: 403,
    },
    ...(effectiveAuth.cookieDomain !== undefined && {
      cookieDomain: effectiveAuth.cookieDomain,
    }),
    ...(effectiveAuth.retiredCookieDomains !== undefined && {
      retiredCookieDomains: effectiveAuth.retiredCookieDomains,
    }),
    ...(effectiveAuth.allowedOrigins !== undefined && {
      allowedOrigins: effectiveAuth.allowedOrigins,
    }),
    ...(effectiveAuth.unsafeSkipOriginCheck !== undefined && {
      unsafeSkipOriginCheck: effectiveAuth.unsafeSkipOriginCheck,
    }),
    ...(effectiveAuth.postAuthLanding !== undefined && {
      postAuthLanding: effectiveAuth.postAuthLanding,
    }),
    ...(hasMfa && MFA_ROUTE_HANDLERS),
    ...buildAuthFlowRoutes(effectiveAuth),
  };
}

export async function waitForKmsHealthy(
  kms: KmsAdapter,
  processName: string,
  deadline: number,
  clock?: DatabaseWaitClock,
): Promise<void> {
  const kmsHealth = await waitUntilDatabaseReachable(() => kms.health(), {
    ...clock,
    processName,
    target: "KMS",
    deadline,
  });
  if (!kmsHealth.ok) {
    throw new Error(
      `[${processName}] BOOT ABORTED — KMS health check failed (latency ${kmsHealth.latencyMs}ms)`,
    );
  }
}

export function openDatabasePools(
  databaseUrl: string,
  envSource: Record<string, string | undefined>,
  rowLevelSecurity: RowLevelSecurityMode,
): {
  readonly db: DbConnection;
  readonly closeDb: () => Promise<void>;
  readonly outsideTransactionDb: DbConnection;
  readonly closeOutsideTransactionDb: () => Promise<void>;
} {
  const { db, close: closeDb } = createDbConnection({
    url: databaseUrl,
    rowLevelSecurity,
    ...dbConnectionOptionsFromEnv(envSource),
    ...serverTimeoutOptionsFromEnv(envSource),
  });
  const { db: outsideTransactionDb, close: closeOutsideTransactionDb } = createDbConnection({
    url: databaseUrl,
    rowLevelSecurity,
    ...outsideTransactionPoolOptionsFromEnv(envSource),
    ...serverTimeoutOptionsFromEnv(envSource),
  });
  return { db, closeDb, outsideTransactionDb, closeOutsideTransactionDb };
}
