import {
  EXT_SESSION_STORE,
  resolveSessionStore,
  resolveTokenVerifier,
  type SessionStore,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  AUTH_MFA_FEATURE,
  bindMfaRevokeAllOtherSessionsFromFeature,
  bindMfaTokenSecretsFromFeature,
  bindRevokeAllPatTokensFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import {
  bindPatAutoRevokeOnPasswordChangeFromFeature,
  PAT_FEATURE,
  patRateLimitFromFeature,
  revokeAllPatTokensForUser,
} from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  bindAutoRevokeFromFeature,
  SESSIONS_FEATURE,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import type { SessionMetadata, TokenVerifier } from "@cosmicdrift/kumiko-framework/api";
import { createInMemoryLoginRateLimiter } from "@cosmicdrift/kumiko-framework/api";
import type {
  EffectiveFeaturesResolver,
  FeatureDefinition,
  Registry,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { resolveBootCrypto } from "@cosmicdrift/kumiko-server-runtime/boot/boot-crypto";
import {
  applyStandardBootSeeds,
  assertMfaSwitchTenantGate,
  buildEffectiveFeaturesResolver,
} from "@cosmicdrift/kumiko-server-runtime/boot/shared-boot-steps";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { DevBootConfig } from "./run-dev-app-config.ts";

// Holder for everything that only exists after the stack is built: the wrappers handed to
// createKumikoServer read it lazily, runDevAfterSetup fills it.
export type DevLateBindings = {
  tierResolver: EffectiveFeaturesResolver | undefined;
  sessionStore: SessionStore | undefined;
  tokenVerifier: TokenVerifier | undefined;
  readonly resets: Array<() => void>;
};

export function createDevLateBindings(): DevLateBindings {
  return { tierResolver: undefined, sessionStore: undefined, tokenVerifier: undefined, resets: [] };
}

// Tier-Composition auto-wire: scan features for a
// tenantTierResolver-extension and wire a late-bound wrapper here; it is
// filled in onAfterSetup (where stack.db + stack.registry are available).
// The global operator toggles layer over the same wrapper.
// App-Author sees nothing — `createTierEngineFeature(opts)` mounts +
// framework auto-wires.
export function createLateBoundEffectiveFeatures(
  lateBindings: DevLateBindings,
  enabled: boolean,
): EffectiveFeaturesResolver | undefined {
  if (!enabled) return undefined;
  return Object.assign(
    (tenantId: TenantId) => {
      // Defensive: Server starts AFTER onAfterSetup completes, so the
      // resolver is filled before any request comes in. Throwing here
      // means a programming error (boot order) rather than silent
      // "all-features-on" misbehavior.
      if (!lateBindings.tierResolver) {
        throw new Error(
          "tier-resolver: extension found but resolver not yet built — boot order issue?",
        );
      }
      return lateBindings.tierResolver(tenantId);
    },
    {
      // The real trialGate lands on the holder's resolver only after plugin.build(). Delegate rather than
      // copy it because this wrapper closure is created before build().
      // Return false when no trial gate is available.
      trialGate: (tenantId: TenantId, featureName: string): Promise<boolean> =>
        lateBindings.tierResolver?.trialGate?.(tenantId, featureName) ?? Promise.resolve(false),
    },
  );
}

// Sessions: late-bound holder — resolveSessionStore needs concrete db+
// registry (only after setupTestStack). Wired when sessions feature is
// mounted; no auth.sessions opt-in anymore.
function createDevSessionAuthFragment(lateBindings: DevLateBindings) {
  const requireSessionStore = (): SessionStore => {
    if (!lateBindings.sessionStore) {
      throw new Error("[runDevApp] sessionStore accessed before onAfterSetup");
    }
    return lateBindings.sessionStore;
  };
  return {
    sessionCreator: (user: SessionUser, meta: SessionMetadata) =>
      requireSessionStore().creator(user, meta),
    sessionRevoker: (sid: string) => requireSessionStore().revoker(sid),
    sessionChecker: (sid: string, userId: string) => requireSessionStore().checker(sid, userId),
  };
}

// Token-verifier opt-in: same late-bound holder pattern — resolveTokenVerifier
// needs the real db+registry (only concrete after setupTestStack). Wired
// whenever a provider feature (personal-access-tokens today) is mounted.
function createDevPatAuthFragment(patFeature: FeatureDefinition, lateBindings: DevLateBindings) {
  const rl = patRateLimitFromFeature(patFeature);
  return {
    tokenVerifier: (rawToken: string) => {
      if (!lateBindings.tokenVerifier) {
        throw new Error("[runDevApp] token-verifier accessed before onAfterSetup");
      }
      return lateBindings.tokenVerifier(rawToken);
    },
    patRateLimiter: createInMemoryLoginRateLimiter(rl.maxRequests, rl.windowMs),
  };
}

export type DevAuthWiring = {
  readonly patFeature: FeatureDefinition | undefined;
  readonly mfaFeature: FeatureDefinition | undefined;
  readonly sessionAuthFragment: ReturnType<typeof createDevSessionAuthFragment> | undefined;
  readonly patAuthFragment: ReturnType<typeof createDevPatAuthFragment> | undefined;
};

export function wireDevAuth(
  config: DevBootConfig,
  registry: Registry | undefined,
  sessionStoreProviderMounted: boolean,
  lateBindings: DevLateBindings,
): DevAuthWiring {
  const { features, effectiveAuth, envSource } = config;
  const patFeature = features.find((f) => f.name === PAT_FEATURE);
  const mfaFeature = features.find((f) => f.name === AUTH_MFA_FEATURE);
  // Same master secret as runProdApp. Without JWT_SECRET the feature keeps
  // its explicit secrets, or its handlers report the missing binding.
  const devMasterSecret = envSource["JWT_SECRET"];
  if (mfaFeature && devMasterSecret) {
    bindMfaTokenSecretsFromFeature(mfaFeature)?.(devMasterSecret, envSource);
  }
  if (effectiveAuth && mfaFeature && registry) {
    assertMfaSwitchTenantGate(registry, "runDevApp");
  }
  const patAuthFragment = patFeature
    ? createDevPatAuthFragment(patFeature, lateBindings)
    : undefined;

  // Parity with runProdApp: gate on sessionStore provider, not
  // the sessions feature name — a custom provider must also wire auth
  // callbacks. sessionStoreProviderMounted computed via the registry
  // (same check as runProdApp) — not recomputed here.
  const sessionAuthFragment =
    effectiveAuth && sessionStoreProviderMounted
      ? createDevSessionAuthFragment(lateBindings)
      : undefined;
  return { patFeature, mfaFeature, sessionAuthFragment, patAuthFragment };
}

// Binds a late-bound revoker and records its unbind for when the app stops.
function bindReleasable<Revoker>(
  bind: ((revoker: Revoker) => () => void) | undefined,
  revoker: Revoker,
  resets: Array<() => void>,
): void {
  if (bind) resets.push(bind(revoker));
}

export type DevAfterSetupContext = {
  readonly config: DevBootConfig;
  readonly bootCrypto: ReturnType<typeof resolveBootCrypto>;
  readonly auth: DevAuthWiring;
  readonly lateBindings: DevLateBindings;
};

async function bindDevSessionStore(stack: TestStack, ctx: DevAfterSetupContext): Promise<void> {
  const { config, auth, lateBindings } = ctx;
  const { patFeature, mfaFeature } = auth;
  // Secure-by-default: resolve sessionStore provider; bind
  // password-change mass-revoke + MFA revokeAllOthers.
  const store = await resolveSessionStore({
    db: stack.db,
    registry: stack.registry,
  });
  const sessionsFeature = config.features.find((f) => f.name === SESSIONS_FEATURE);
  if (sessionsFeature) {
    bindReleasable(
      bindAutoRevokeFromFeature(sessionsFeature),
      store.massRevoker,
      lateBindings.resets,
    );
  }
  if (mfaFeature) {
    bindReleasable(
      bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature),
      store.revokeAllOthers,
      lateBindings.resets,
    );
  }
  if (mfaFeature && patFeature) {
    bindReleasable(
      bindRevokeAllPatTokensFromFeature(mfaFeature),
      (userId) => revokeAllPatTokensForUser(stack.db, userId),
      lateBindings.resets,
    );
  }
  lateBindings.sessionStore = store;
}

function bindDevPatVerifier(
  stack: TestStack,
  patFeature: FeatureDefinition,
  lateBindings: DevLateBindings,
): void {
  lateBindings.tokenVerifier = (rawToken) =>
    resolveTokenVerifier({ db: stack.db, registry: stack.registry }, rawToken);
  // Password-change → PAT-revoke: independent of sessions/MFA being
  // mounted, so wired unconditionally here whenever PAT itself is.
  bindReleasable(
    bindPatAutoRevokeOnPasswordChangeFromFeature(patFeature),
    (userId) => revokeAllPatTokensForUser(stack.db, userId),
    lateBindings.resets,
  );
}

export async function runDevAfterSetup(stack: TestStack, ctx: DevAfterSetupContext): Promise<void> {
  const { config, bootCrypto, auth, lateBindings } = ctx;
  const { wiring, effectiveAuth, features } = config;
  // Build tier-resolver BEFORE any seeds so seeds can rely
  // on the resolver being live (e.g. seed that writes a SystemAdmin's
  // tier-assignment can immediately read tier-cuts).
  lateBindings.tierResolver = await buildEffectiveFeaturesResolver({
    features,
    featureToggles: wiring.featureToggles,
    db: stack.db,
    registry: stack.registry,
    cacheSync: stack.cacheSync,
  });
  if (effectiveAuth && stack.registry.getExtensionUsages(EXT_SESSION_STORE).length > 0) {
    await bindDevSessionStore(stack, ctx);
  }
  if (auth.patFeature) {
    bindDevPatVerifier(stack, auth.patFeature, lateBindings);
  }
  // Apply r.config({ seeds }) declared by any registered feature.
  // Runs before user-supplied seed callbacks so those can read /
  // override the deploy-defaults.
  await applyStandardBootSeeds({
    db: stack.db,
    registry: stack.registry,
    admin: effectiveAuth?.admin,
    shortcutSeeds: wiring.shortcutSeeds,
    cipher: bootCrypto.configCipher,
  });
  for (const seed of config.stackSeeds) {
    await seed(stack);
  }
}
