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
// auf `createKumikoServer` aus @kumiko/dev-server.

import { AuthErrors, AuthHandlers } from "@kumiko/bundled-features/auth-email-password";
import {
  type SeedAdminOptions,
  seedAdmin,
} from "@kumiko/bundled-features/auth-email-password/seeding";
import { createConfigResolver } from "@kumiko/bundled-features/config";
import { TenantQueries } from "@kumiko/bundled-features/tenant";

import type { FeatureDefinition } from "@kumiko/framework/engine";
import type { TestStack } from "@kumiko/framework/stack";

import { runCodegen } from "./codegen";
import { composeFeatures } from "./compose-features";
import {
  type CreateKumikoServerOptions,
  createKumikoServer,
  type KumikoServerHandle,
} from "./create-kumiko-server";

export type RunDevAppAuthOptions = {
  /** Admin user to seed at boot. Idempotent — re-runs in persistent-DB
   *  mode reuse the existing user. */
  readonly admin: SeedAdminOptions;
  /** Optional override of the login error → HTTP status map. Default
   *  maps invalidCredentials → 401, noMembership → 403. */
  readonly loginErrorStatusMap?: Readonly<Record<string, number>>;
};

/** Hook for app-specific seeding (demo data, fixtures). Runs after the
 *  admin (when auth is active) in declared order. */
export type SeedFn = (stack: TestStack) => Promise<void>;

export type RunDevAppOptions = {
  /** App-spezifische Features. Im auth-mode werden config/user/tenant/
   *  auth-email-password automatisch dazu gemischt — KEIN doppeltes
   *  manuelles Hinzufügen nötig. */
  readonly features: readonly FeatureDefinition[];
  /** Pfad zum Browser-Entry-Modul. Bun.build bündelt es zu /client.js. */
  readonly clientEntry?: string;
  /** CSS-Entry. Default: package-export `@kumiko/renderer-web/styles.css`
   *  wenn clientEntry gesetzt. `false` deaktiviert die CSS-Pipeline. */
  readonly stylesheet?: string | false;
  /** Eigenes HTML-Template; sonst minimal-Default (#root + client.js). */
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
  /** Anonymous-Access für Public-Endpoints — Requests ohne JWT laufen
   *  als Pseudo-User mit Rolle `anonymous` durch, wenn der Handler die
   *  Rolle in `access.roles` führt. */
  readonly anonymousAccess?: CreateKumikoServerOptions["anonymousAccess"];
  /** App-eigene HTTP-Routes (z.B. /feed.xml, /sitemap.xml) — wird ans
   *  Hono-app gehängt, läuft VOR dem static-asset-Pfad. Symmetrisch zur
   *  gleichnamigen Option in runProdApp. */
  readonly extraRoutes?: CreateKumikoServerOptions["extraRoutes"];
};

export async function runDevApp(options: RunDevAppOptions): Promise<KumikoServerHandle> {
  // Codegen-Pass am Boot — schreibt `<appRoot>/.kumiko/define.ts` +
  // `types.generated.d.ts` aus den r.defineEvent-Aufrufen der App. Der
  // TS-Sprachserver in der IDE merkt das beim nächsten file-touch und
  // bietet sofort strict-checked ctx.appendEvent-Completions. Idempotent
  // — wenn nichts geändert hat, wird kein File neu geschrieben (kein
  // mtime-touch, kein TS-language-server-Reload).
  //
  // App-Root ist process.cwd() (yarn-dev läuft vom App-Workspace). Wer
  // einen anderen Root will, kann aktuell den Codegen separat über die
  // CLI antreiben (`yarn kumiko codegen <path>`) — File-Watch-Auto-
  // codegen läuft hier auf process.cwd(). Weil die meisten Apps das
  // Standard-Layout nutzen, reicht das.
  try {
    const cgResult = runCodegen({ appRoot: process.cwd() });
    if (cgResult.warnings.length > 0) {
      for (const w of cgResult.warnings) {
        console.warn(`[codegen] ${w.file}:${w.line} — ${w.reason}`);
      }
    }
  } catch (err) {
    // Codegen-Fehler dürfen den Dev-Server NICHT killen — der Dev-Mode
    // ist tolerant gegenüber halb-fertigen Files (User editiert gerade
    // ein r.defineEvent-Aufruf, Datei hat eine Sekunde lang invaliden
    // Syntax). Wir loggen + machen weiter; der Watcher-Pass auf der
    // nächsten gültigen Speicherung gleicht das aus.
    console.warn(
      `[codegen] failed to generate .kumiko/* — continuing with stale files: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Auto-mix Standard-Features im auth-mode via composeFeatures (single
  // source of truth — auch runProdApp und der per-app drizzle-Schema-
  // Generator nutzen denselben Helper, damit Migration und Runtime nie
  // auseinanderdriften können).
  const features = composeFeatures(options.features, { includeBundled: !!options.auth });

  // configResolver braucht das config-feature — im auth-mode immer
  // hinzufügen, im no-auth-mode dem Caller überlassen.
  const extraContext = options.auth
    ? { configResolver: createConfigResolver(), ...(options.extraContext ?? {}) }
    : options.extraContext;

  return createKumikoServer({
    features,
    ...(options.clientEntry !== undefined && { clientEntry: options.clientEntry }),
    ...(options.stylesheet !== undefined && { stylesheet: options.stylesheet }),
    ...(options.htmlPath !== undefined && { htmlPath: options.htmlPath }),
    ...(options.port !== undefined && { port: options.port }),
    ...(options.watchDirs !== undefined && { watchDirs: options.watchDirs }),
    ...(options.installSignalHandlers !== undefined && {
      installSignalHandlers: options.installSignalHandlers,
    }),
    ...(extraContext !== undefined && { extraContext }),
    ...(options.anonymousAccess !== undefined && { anonymousAccess: options.anonymousAccess }),
    ...(options.extraRoutes !== undefined && { extraRoutes: options.extraRoutes }),
    ...(options.auth && {
      auth: {
        membershipQuery: TenantQueries.memberships,
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: options.auth.loginErrorStatusMap ?? {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
      },
    }),
    onAfterSetup: async (stack) => {
      if (options.auth) {
        await seedAdmin(stack.db, options.auth.admin);
      }
      for (const seed of options.seeds ?? []) {
        await seed(stack);
      }
    },
  });
}
