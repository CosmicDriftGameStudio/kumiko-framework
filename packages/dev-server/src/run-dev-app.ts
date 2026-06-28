// runDevApp — high-level dev-server wrapper für Sample-Apps und
// Showcases. Mischt die Standard-Features (config/user/tenant/auth-
// email-password) automatisch dazu wenn auth-mode aktiv ist, wired das
// AuthRoutesConfig + Login-Error-Map, und ruft seedAdmin() im
// onAfterSetup. Reduziert den Sample-Bootstrap von 50 Zeilen auf 5-10.
//
// Auto-mix passiert NUR im auth-mode. Ohne `auth`-Block bleibt der
// Server im Auto-Mint-JWT-Modus (Dev-Default) und mischt nichts dazu —
// Showcases die nur eine Domain demonstrieren wollen ohne Login-Flow
// haben so nicht plötzlich vier zusätzliche Features in der Registry.
//
// Wer maximale Kontrolle braucht (z.B. abweichende Auth-Wiring,
// alternativer Membership-Query, eigener LoginRateLimiter): geht direkt
// auf `createKumikoServer` aus @cosmicdrift/kumiko-dev-server.

import { AuthErrors, AuthHandlers } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdmin,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  buildEnvConfigOverrides,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createSessionCallbacks,
  type SessionCallbacks,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { TenantQueries } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { SessionMetadata } from "@cosmicdrift/kumiko-framework/api";
import {
  collectWriteHandlerQns,
  createRegistry,
  type EffectiveFeaturesResolver,
  type FeatureDefinition,
  findTierResolverUsage,
  type Registry,
  type SessionUser,
  type TenantId,
  type TierResolverPlugin,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import type { TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { warnIfNonUtcServerTimeZone } from "@cosmicdrift/kumiko-framework/time";
import { applyBootSeeds } from "./boot/apply-boot-seeds";

import { watchAndRegenerate } from "./codegen";
import { buildComposeAuthOptions, composeFeatures } from "./compose-features";
import {
  type CreateKumikoServerOptions,
  createKumikoServer,
  type KumikoServerHandle,
} from "./create-kumiko-server";
import { renderWelcomeBanner } from "./welcome-banner";

// Re-export der shared Auth-Setup-Types damit Apps nur einen Import-Pfad
// brauchen. PasswordResetSetup / EmailVerificationSetup leben in
// run-prod-app.ts (single source of truth) — hier nur durchgereicht.
export type {
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "./run-prod-app";

import type {
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  SignupSetup,
} from "./run-prod-app";
import { addConfigAccessorFactory } from "./run-prod-app";

export type RunDevAppAuthOptions = {
  /** Admin user to seed at boot. Idempotent — re-runs in persistent-DB
   *  mode reuse the existing user. */
  readonly admin: SeedAdminOptions;
  /** Optional override of the login error → HTTP status map. Default
   *  maps invalidCredentials → 401, noMembership → 403. */
  readonly loginErrorStatusMap?: Readonly<Record<string, number>>;
  /** Opt-in: revocable server-side sessions. Caller MUSS
   *  `createSessionsFeature()` zu `features` adden — runDevApp wired
   *  hier nur die Auth-Callbacks (creator/revoker/checker) gegen
   *  stack.db, plus sessionStrictMode=true.
   *
   *  Standardverhalten ohne diese Option: stateless JWTs ohne sid,
   *  Logout ist client-side cookie-clear, Karten­haus existing-Apps
   *  bleibt unangefasst. */
  readonly sessions?: {
    readonly expiresInMs?: number;
  };
  /** Password-reset flow. Wenn gesetzt werden /api/auth/request-password-
   *  reset + /api/auth/reset-password als Public-Routes gemounted UND
   *  der request/confirm-Handler im auth-email-password-Feature wird
   *  registriert. Symmetrisch zu RunProdAppAuthOptions.passwordReset. */
  readonly passwordReset?: PasswordResetSetup;
  /** Email-verification flow. Symmetric zu passwordReset. */
  readonly emailVerification?: EmailVerificationSetup;
  /** Self-Signup flow (Magic-Link). Symmetric zu RunProdAppAuthOptions. */
  readonly signup?: SignupSetup;
  /** Tenant-Invite flow (Magic-Link). Symmetric. */
  readonly invite?: InviteSetup;
  /** Domain attribute for both auth cookies (see
   *  AuthRoutesConfig.cookieDomain). Symmetric zu RunProdAppAuthOptions. */
  readonly cookieDomain?: string;
  /** Server-side Origin allowlist for the CSRF guard (see
   *  AuthRoutesConfig.allowedOrigins). Symmetric zu RunProdAppAuthOptions —
   *  required once `cookieDomain` is set. */
  readonly allowedOrigins?: readonly string[];
  /** Opt out of the Origin guard. Symmetric zu RunProdAppAuthOptions. */
  readonly unsafeSkipOriginCheck?: boolean;
};

/** Hook for app-specific seeding (demo data, fixtures). Runs after the
 *  admin (when auth is active) in declared order. */
export type SeedFn = (stack: TestStack) => Promise<void>;

export type RunDevAppOptions = {
  /** App-spezifische Features. Im auth-mode werden config/user/tenant/
   *  auth-email-password automatisch dazu gemischt — KEIN doppeltes
   *  manuelles Hinzufügen nötig. */
  readonly features: readonly FeatureDefinition[];
  /** Pfad zum Browser-Entry-Modul. Bun.build bündelt es zu /client.js.
   *  Mutually exclusive mit `clientEntries`. */
  readonly clientEntry?: string;
  /** Multi-Entry-Mode: pro Entry ein eigenes Bundle (`/client-<name>.js`)
   *  + ein eigenes HTML-Template. `hostDispatch` wählt zur Request-Zeit
   *  welcher Entry kommt. Symmetric zur kumiko-build-Convention
   *  `src/client-<name>.tsx`. Mutually exclusive mit `clientEntry`. */
  readonly clientEntries?: CreateKumikoServerOptions["clientEntries"];
  /** Multi-Entry-Mode: Routing per Request. Wird für Multi-Entry mit
   *  geforderten — sonst weiß der Server nicht welche HTML er liefern
   *  soll. */
  readonly hostDispatch?: CreateKumikoServerOptions["hostDispatch"];
  /** CSS-Entry. Default: package-export `@cosmicdrift/kumiko-renderer-web/styles.css`
   *  wenn ein client-Entry gesetzt ist. `false` deaktiviert die CSS-Pipeline. */
  readonly stylesheet?: string | false;
  /** Eigenes HTML-Template; sonst minimal-Default (#root + client.js).
   *  Im Multi-Entry-Mode ist es das Fallback-Template, wenn ein einzelner
   *  Entry kein eigenes htmlPath setzt. */
  readonly htmlPath?: string;
  /** Listen-Port. Default 4173 (oder $PORT). */
  readonly port?: number;
  /** Extra-Verzeichnisse für den File-Watcher (Trigger Hot-Reload). */
  readonly watchDirs?: readonly string[];
  /** SIGINT/SIGTERM-Handler installieren (Default true; in Tests auf
   *  false damit repeated boots keine Listener akkumulieren). */
  readonly installSignalHandlers?: boolean;
  /** Auth-Mode: Standard-Features dazu, Auth-Routes wired, seedAdmin
   *  läuft im onAfterSetup. Ohne `auth` läuft der Server im Auto-Mint-
   *  JWT-Modus. */
  readonly auth?: RunDevAppAuthOptions;
  /** Eigene Seed-Funktionen, laufen nach dem Admin (wenn auth) in
   *  Array-Reihenfolge. */
  readonly seeds?: readonly SeedFn[];
  /** Extra-AppContext-Keys. Im auth-mode wird `configResolver` automatisch
   *  hinzugefügt — kein Override durch den Caller nötig. */
  readonly extraContext?: CreateKumikoServerOptions["extraContext"];
  /** Env-Quelle für die ENV→config-app-override-Brücke (Keys mit `env:`
   *  bekommen ihren env-Wert als app-override-Default — symmetrisch zu
   *  runProdApp). Default `process.env`. Injizierbar als Test-Seam, damit
   *  Tests eigene env-Werte reichen statt `process.env` global zu mutieren. */
  readonly envSource?: Record<string, string | undefined>;
  /** Anonymous-Access für Public-Endpoints — Requests ohne JWT laufen
   *  als Pseudo-User mit Rolle `anonymous` durch, wenn der Handler die
   *  Rolle in `access.roles` führt. */
  readonly anonymousAccess?: CreateKumikoServerOptions["anonymousAccess"];
  /** File-Storage-Provider — aktiviert die Upload-Routes (/api/files) +
   *  `ctx.files`. Demos: `{ storageProvider: createInMemoryFileProvider() }`. */
  readonly files?: CreateKumikoServerOptions["files"];
  /** App-eigene HTTP-Routes (z.B. /feed.xml, /sitemap.xml) — wird ans
   *  Hono-app gehängt, läuft VOR dem static-asset-Pfad. Symmetrisch zur
   *  gleichnamigen Option in runProdApp. */
  readonly extraRoutes?: CreateKumikoServerOptions["extraRoutes"];
  /** Feature-toggle resolver — durchgereicht an createKumikoServer →
   *  setupTestStack. Sprint-8 Tier-Composition: per-Tenant unterschied-
   *  liche features aktiv via globalFeatureToggleRuntime. Pattern in
   *  bin/server.ts: createLateBoundHolder + post-boot runtime.initialize
   *  in einem seed-fn, weil die runtime stack.db braucht und die seed-
   *  Funktionen nach setupTestStack laufen. */
  readonly effectiveFeatures?: CreateKumikoServerOptions["effectiveFeatures"];
  /** Print a first-run banner after the server starts (URL, admin login,
   *  hot-reload hint, docs link). Default: off — apps that already log
   *  their own startup shouldn't get double-printed. The scaffold template
   *  (create-kumiko-app) flips this on so the first `bun dev` ends on
   *  something the user can click. Pass an object to override the
   *  features-dir hint or the docs URL. */
  readonly welcomeBanner?: boolean | { readonly featuresDir?: string; readonly docsUrl?: string };
};

export async function runDevApp(options: RunDevAppOptions): Promise<KumikoServerHandle> {
  // Auto-mix Standard-Features im auth-mode via composeFeatures (single
  // source of truth — auch runProdApp und der per-app drizzle-Schema-
  // Generator nutzen denselben Helper, damit Migration und Runtime nie
  // auseinanderdriften können).
  const composeAuthOptions = buildComposeAuthOptions(options.auth);
  const features = composeFeatures(options.features, {
    includeBundled: !!options.auth,
    ...(composeAuthOptions && { authOptions: composeAuthOptions }),
  });

  // Ein explizit gewireter File-Provider (options.files) erfüllt das
  // FILE_STORAGE_PROVIDER-Boot-Gate — der Provider IST konfiguriert, nur
  // nicht über die env-Bridge. Setzen bevor validateBoot greift.
  if (options.files !== undefined && process.env["FILE_STORAGE_PROVIDER"] === undefined) {
    process.env["FILE_STORAGE_PROVIDER"] = "configured";
  }

  // Boot-Validation als allererstes — vor fs-Watcher und Server. Dieselbe
  // Fehlerklasse (unqualifizierte nav-/handler-QNs, screen-access etc.),
  // die früher nur runProdApp fing und sonst erst den Prod-Pod im
  // CrashLoopBackOff sterben ließ (#359). Wirft synchron, bevor ein
  // Socket oder Watcher (codegen-Write) aufgeht.
  validateBoot(features);
  warnIfNonUtcServerTimeZone();
  validateAppCustomScreenWriteQns(process.cwd(), collectWriteHandlerQns(features));

  // Codegen + File-Watcher — schreibt `<appRoot>/.kumiko/types.generated.d.ts`
  // + `define.ts` aus den r.defineEvent-Aufrufen der App, einmal beim
  // Boot UND danach bei jeder relevanten Änderung unter `<appRoot>/src/`.
  // Idempotent (writeIfChanged) — der TS-Sprachserver kriegt nur einen
  // Reload-Tick wenn sich tatsächlich was geändert hat.
  //
  // App-Root ist process.cwd() (bun-dev läuft vom App-Workspace). Der
  // Watcher läuft solange der Dev-Server lebt; close() bei Shutdown
  // wird über das createKumikoServer-Handle implizit erledigt (Bun's
  // process-exit räumt fs.watch-handles auf).
  // Sammelt alle Write-Handler-QNs für den Codegen — damit
  // `types.generated.d.ts` eine `WriteHandlerQn`-Union exportieren
  // kann, die dispatcher.write-Aufrufe client-seitig typisiert.
  const handlerQns = collectWriteHandlerQns(features);
  watchAndRegenerate({ appRoot: process.cwd(), handlerQns: [...handlerQns] });

  // Sprint-8a Tier-Composition auto-wire: scan features for a
  // tenantTierResolver-extension. If found AND user didn't supply own
  // effectiveFeatures, we wire a late-bound wrapper here and fill it
  // in onAfterSetup (where stack.db + stack.registry are available).
  // App-Author sees nothing — `createTierEngineFeature(opts)` mounts +
  // framework auto-wires.
  const tierResolverUsage = options.effectiveFeatures ? undefined : findTierResolverUsage(features);
  const tierResolverHolder: { resolver: EffectiveFeaturesResolver | undefined } = {
    resolver: undefined,
  };
  const finalEffectiveFeatures: EffectiveFeaturesResolver | undefined =
    options.effectiveFeatures ??
    (tierResolverUsage
      ? Object.assign(
          (tenantId: TenantId) => {
            // Defensive: Server starts AFTER onAfterSetup completes, so the
            // resolver is filled before any request comes in. Throwing here
            // means a programming error (boot order) rather than silent
            // "all-features-on" misbehavior.
            if (!tierResolverHolder.resolver) {
              throw new Error(
                "tier-resolver: extension found but resolver not yet built — boot order issue?",
              );
            }
            return tierResolverHolder.resolver(tenantId);
          },
          {
            // Late-bind: der echte trialGate hängt erst nach plugin.build() am
            // holder.resolver. Delegieren (nicht kopieren), weil dieses
            // Wrapper-Closure vor build() konstruiert wird. Kein Trial → false.
            trialGate: (tenantId: TenantId, featureName: string): Promise<boolean> =>
              tierResolverHolder.resolver?.trialGate?.(tenantId, featureName) ??
              Promise.resolve(false),
          },
        )
      : undefined);

  // configResolver-default fürs config-feature — im auth-mode immer
  // hinzufügen, im no-auth-mode dem Caller überlassen. Factory-form
  // wird gewrap't damit der spread auf das aufgerufene Result greift,
  // nicht auf die function selbst (no-op). Die ENV→config-Brücke (Keys mit
  // `env:` → app-override-Default) läuft symmetrisch zu runProdApp; die
  // throwaway-Registry hier extrahiert nur die config-Keys, weil der
  // configResolver vor dem Server-Boot konstruiert wird (stack.registry
  // gibt's erst onAfterSetup) — createKumikoServer baut intern seine eigene.
  const extraContext = options.auth
    ? mergeConfigResolverDefault(
        options.extraContext,
        createRegistry(features),
        options.envSource ?? process.env,
      )
    : options.extraContext;

  // Sessions opt-in: Holder lebt im closure, `createSessionCallbacks`
  // kennt erst nach setupTestStack die echte db-connection. Inline
  // statt @cosmicdrift/kumiko-framework/testing's createLateBoundHolder zu reusen,
  // weil dev-server (dev-runtime) keine Tooling aus framework/testing
  // (test-runtime) importieren darf — Runtime-Isolation Guard.
  // Server-Start passiert NACH onAfterSetup (siehe create-kumiko-server.ts),
  // daher ist `sessionCallbacks` zur ersten Login-Request konkret.
  let sessionCallbacks: SessionCallbacks | undefined;
  const requireSessions = (): SessionCallbacks => {
    if (!sessionCallbacks) {
      throw new Error("[runDevApp] session-callbacks accessed before onAfterSetup");
    }
    return sessionCallbacks;
  };
  const sessionAuthFragment =
    options.auth?.sessions !== undefined
      ? {
          sessionCreator: (user: SessionUser, meta: SessionMetadata) =>
            requireSessions().sessionCreator(user, meta),
          sessionRevoker: (sid: string) => requireSessions().sessionRevoker(sid),
          sessionChecker: (sid: string, userId: string) =>
            requireSessions().sessionChecker(sid, userId),
          // strict-mode: jede neue Plattform-App startet ohne legacy-
          // JWTs ohne sid, daher safe als Default. Wer Sessions opt-in
          // wählt, will explizite Server-side Revocation — strict-mode
          // ist der einzige Modus der das tatsächlich erzwingt.
          sessionStrictMode: true,
        }
      : {};

  const handle = await createKumikoServer({
    features,
    ...(options.clientEntry !== undefined && { clientEntry: options.clientEntry }),
    ...(options.clientEntries !== undefined && { clientEntries: options.clientEntries }),
    ...(options.hostDispatch !== undefined && { hostDispatch: options.hostDispatch }),
    ...(options.stylesheet !== undefined && { stylesheet: options.stylesheet }),
    ...(options.htmlPath !== undefined && { htmlPath: options.htmlPath }),
    ...(options.port !== undefined && { port: options.port }),
    ...(options.watchDirs !== undefined && { watchDirs: options.watchDirs }),
    ...(options.installSignalHandlers !== undefined && {
      installSignalHandlers: options.installSignalHandlers,
    }),
    ...(extraContext !== undefined && { extraContext }),
    ...(options.anonymousAccess !== undefined && { anonymousAccess: options.anonymousAccess }),
    ...(options.files !== undefined && { files: options.files }),
    ...(options.extraRoutes !== undefined && { extraRoutes: options.extraRoutes }),
    ...(finalEffectiveFeatures !== undefined && {
      effectiveFeatures: finalEffectiveFeatures,
    }),
    ...(options.auth && {
      auth: {
        membershipQuery: TenantQueries.memberships,
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: options.auth.loginErrorStatusMap ?? {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
        ...(options.auth.cookieDomain !== undefined && {
          cookieDomain: options.auth.cookieDomain,
        }),
        ...(options.auth.allowedOrigins !== undefined && {
          allowedOrigins: options.auth.allowedOrigins,
        }),
        ...(options.auth.unsafeSkipOriginCheck !== undefined && {
          unsafeSkipOriginCheck: options.auth.unsafeSkipOriginCheck,
        }),
        ...sessionAuthFragment,
        ...(options.auth.passwordReset && {
          passwordReset: {
            requestHandler: AuthHandlers.requestPasswordReset,
            confirmHandler: AuthHandlers.resetPassword,
            sendResetEmail: options.auth.passwordReset.sendResetEmail,
            appResetUrl: options.auth.passwordReset.appResetUrl,
          },
        }),
        ...(options.auth.emailVerification && {
          emailVerification: {
            requestHandler: AuthHandlers.requestEmailVerification,
            confirmHandler: AuthHandlers.verifyEmail,
            sendVerificationEmail: options.auth.emailVerification.sendVerificationEmail,
            appVerifyUrl: options.auth.emailVerification.appVerifyUrl,
          },
        }),
        ...(options.auth.signup && {
          signup: {
            requestHandler: AuthHandlers.signupRequest,
            confirmHandler: AuthHandlers.signupConfirm,
            sendActivationEmail: options.auth.signup.sendActivationEmail,
            appActivationUrl: options.auth.signup.appActivationUrl,
          },
        }),
        ...(options.auth.invite && {
          invite: {
            acceptHandler: AuthHandlers.inviteAccept,
            acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
            signupCompleteHandler: AuthHandlers.inviteSignupComplete,
            sendInviteEmail: options.auth.invite.sendInviteEmail,
            appAcceptUrl: options.auth.invite.appAcceptUrl,
          },
        }),
      },
    }),
    onAfterSetup: async (stack) => {
      // Sprint-8a: build tier-resolver BEFORE any seeds so seeds can rely
      // on the resolver being live (e.g. seed that writes a SystemAdmin's
      // tier-assignment can immediately read tier-cuts).
      if (tierResolverUsage) {
        const plugin = tierResolverUsage.options as TierResolverPlugin;
        tierResolverHolder.resolver = await plugin.build({
          db: stack.db,
          registry: stack.registry,
        });
      }
      if (options.auth?.sessions !== undefined) {
        const expiresInMs = options.auth.sessions.expiresInMs;
        sessionCallbacks = createSessionCallbacks({
          db: stack.db,
          ...(expiresInMs !== undefined && { expiresInMs }),
        });
      }
      if (options.auth) {
        await seedAdmin(stack.db, options.auth.admin);
      }
      // Apply r.config({ seeds }) declared by any registered feature.
      // Runs before user-supplied seed callbacks so those can read /
      // override the deploy-defaults. The helper indirection is what
      // config-seed-boot.integration.ts pins — keep it as a single call.
      await applyBootSeeds({ registry: stack.registry, db: stack.db });
      for (const seed of options.seeds ?? []) {
        await seed(stack);
      }
    },
  });

  if (options.welcomeBanner) {
    const overrides = typeof options.welcomeBanner === "object" ? options.welcomeBanner : {};
    const port = handle.server?.port ?? options.port ?? 3000;
    const banner = renderWelcomeBanner({
      url: `http://localhost:${port}`,
      ...(options.auth?.admin && {
        admin: {
          email: options.auth.admin.email,
          password: options.auth.admin.password,
        },
      }),
      ...(overrides.featuresDir !== undefined && { featuresDir: overrides.featuresDir }),
      ...(overrides.docsUrl !== undefined && { docsUrl: overrides.docsUrl }),
    });
    // biome-ignore lint/suspicious/noConsole: boot-time UX print, opt-in via welcomeBanner.
    console.log(`\n${banner}\n`);
  }

  return handle;
}

// Exported for the wiring-contract test (config-resolver-default.integration):
// pins that the dev configResolver-default carries the ENV→app-override bridge
// and that a caller-supplied configResolver still overrides it. Not re-exported
// from the package barrel (index.ts lists only runDevApp).
export function mergeConfigResolverDefault(
  ctx: CreateKumikoServerOptions["extraContext"],
  registry: Registry,
  envSource: Record<string, string | undefined>,
): CreateKumikoServerOptions["extraContext"] {
  const defaults = {
    configResolver: createConfigResolver({
      appOverrides: buildEnvConfigOverrides(registry, envSource),
    }),
  };
  // ctx.config wird per-Request aus _configAccessorFactory geminted (siehe
  // addConfigAccessorFactory) — sonst bleibt ctx.config undefined und Handler
  // die es lesen (createFileProviderForTenant) werfen. Aus dem EFFEKTIVEN
  // Resolver (Caller-Override gewinnt) gebaut, symmetrisch zu runProdApp.
  if (ctx === undefined) return addConfigAccessorFactory(defaults, registry);
  if (typeof ctx === "function") {
    return (deps) => addConfigAccessorFactory({ ...defaults, ...ctx(deps) }, registry);
  }
  return addConfigAccessorFactory({ ...defaults, ...ctx }, registry);
}
