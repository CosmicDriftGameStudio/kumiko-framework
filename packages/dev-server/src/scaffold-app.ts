// scaffoldApp — generate a runnable Kumiko app workspace from a name.
//
// Used by `kumiko new app <name>`. Produces the minimal app shape that
// `KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts` runs successfully against:
// run-config with 5 foundation features, bin/main.ts with auth-admin
// stub, package.json with @cosmicdrift/* deps, tsconfig, .env.example,
// README.
//
// .ts files are built via ts-morph (same tool [[scaffoldAppFeature]] uses
// to auto-mount features). Means a single AST representation for both
// generate + later modify — no template-string ↔ ts-morph divergence.
// Static files (package.json, tsconfig, .env, README) stay text-based.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IndentationText, Project, VariableDeclarationKind } from "ts-morph";
import { isKebabSegment } from "./kebab";

// Single bundled-feature entry the scaffolder mounts into run-config.ts.
// importPath is the from-spec ("@cosmicdrift/kumiko-bundled-features/files"),
// exportName the named import, callExpression the form that lands in the
// APP_FEATURES array literal — typically `${exportName}()` for factory-style
// features and just `${exportName}` for object-style ones (e.g. billingFoundationFeature).
export type ScaffoldFeatureEntry = {
  readonly name: string;
  readonly importPath: string;
  readonly exportName: string;
  readonly callExpression: string;
};

export type ScaffoldAppOptions = {
  /** kebab-case app name (e.g. "my-shop"). Becomes package-name + folder. */
  readonly name: string;
  /** Absolute or cwd-relative target dir. Default: <cwd>/<name>. */
  readonly destination?: string;
  /** Base dir a relative `destination` (or the name-default) resolves
   *  against. Defaults to process.cwd(). Callers with their own cwd-notion
   *  (the CLI's ctx.cwd) MUST pass it so the scaffold lands where the
   *  command's output claims it does. */
  readonly cwd?: string;
  /** npm-version-pin for @cosmicdrift/* deps. Default "*" for latest. */
  readonly frameworkVersion?: string;
  /** Bundled-features to mount in run-config.ts. Default: secrets + sessions
   *  (the historical foundation). create-kumiko-app passes the picker output
   *  here so the generated APP_FEATURES reflects the user's selection. */
  readonly features?: ReadonlyArray<ScaffoldFeatureEntry>;
};

export type ScaffoldAppResult = {
  readonly destination: string;
  readonly files: readonly string[];
  readonly appName: string;
};

export function scaffoldApp(options: ScaffoldAppOptions): ScaffoldAppResult {
  if (!isKebabSegment(options.name)) {
    throw new Error(`scaffoldApp: name must be kebab-case (a-z, 0-9, -); got "${options.name}"`);
  }
  const cwd = options.cwd ?? process.cwd();
  const destination = resolve(cwd, options.destination ?? options.name);
  if (existsSync(destination)) {
    throw new Error(`scaffoldApp: ${destination} already exists — refusing to overwrite`);
  }
  const version = options.frameworkVersion ?? "*";

  mkdirSync(join(destination, "bin"), { recursive: true });
  mkdirSync(join(destination, "src"), { recursive: true });

  const files: string[] = [];

  write(join(destination, "package.json"), renderPackageJson(options.name, version));
  files.push("package.json");

  write(join(destination, "tsconfig.json"), renderTsconfig());
  files.push("tsconfig.json");

  write(join(destination, "src", "run-config.ts"), renderRunConfig(options.features));
  files.push("src/run-config.ts");

  write(join(destination, "bin", "main.ts"), renderMain(options.name));
  files.push("bin/main.ts");

  write(join(destination, "bin", "dev.ts"), renderDev(options.name));
  files.push("bin/dev.ts");

  write(join(destination, "src", "client.tsx"), renderClient());
  files.push("src/client.tsx");

  write(join(destination, ".env.example"), renderEnvExample(options.name));
  files.push(".env.example");

  write(join(destination, "docker-compose.yml"), renderDockerCompose());
  files.push("docker-compose.yml");

  write(join(destination, "README.md"), renderReadme(options.name, options.features));
  files.push("README.md");

  return { destination, files, appName: options.name };
}

// @wrapper-known semantic-alias
function write(path: string, content: string): void {
  writeFileSync(path, content);
}

function renderPackageJson(name: string, version: string): string {
  return `${JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "bun --watch bin/dev.ts",
        boot: "KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts",
        check: "tsc --noEmit",
      },
      dependencies: {
        "@cosmicdrift/kumiko-bundled-features": version,
        "@cosmicdrift/kumiko-dev-server": version,
        "@cosmicdrift/kumiko-framework": version,
        "@cosmicdrift/kumiko-renderer-web": version,
        zod: "^4.4.3",
      },
    },
    null,
    2,
  )}\n`;
}

function renderTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noUncheckedIndexedAccess: true,
        forceConsistentCasingInFileNames: true,
        verbatimModuleSyntax: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        esModuleInterop: true,
        skipLibCheck: true,
        lib: ["ESNext"],
        types: ["bun-types"],
        noEmit: true,
      },
      include: ["bin", "src"],
    },
    null,
    2,
  )}\n`;
}

function newTsProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: 99, module: 99, strict: true },
    manipulationSettings: { indentationText: IndentationText.TwoSpaces },
  });
}

const FOUNDATION_FEATURES: ReadonlyArray<ScaffoldFeatureEntry> = [
  {
    name: "secrets",
    importPath: "@cosmicdrift/kumiko-bundled-features/secrets",
    exportName: "createSecretsFeature",
    callExpression: "createSecretsFeature()",
  },
  {
    name: "sessions",
    importPath: "@cosmicdrift/kumiko-bundled-features/sessions",
    exportName: "createSessionsFeature",
    callExpression: "createSessionsFeature()",
  },
];

// composeFeatures({ includeBundled: true }) auto-mountet diese 4 Foundation-
// Features. Sie hier nochmal in APP_FEATURES zu schreiben löste den dedupe-
// warn-Spam im scaffolded `bun dev` aus (PR #599 hat den createRegistry-
// Crash gefangen, der Spam blieb bis hier). Filter wirkt defensiv: auch wenn
// jemand scaffoldApp() direkt mit allen Bundled-Feature-Entries aufruft
// rutschen die 4 nicht in run-config.ts.
const COMPOSE_AUTO_MOUNTED_NAMES = new Set(["config", "user", "tenant", "auth-email-password"]);

function renderRunConfig(features?: ReadonlyArray<ScaffoldFeatureEntry>): string {
  const project = newTsProject();
  const sf = project.createSourceFile("run-config.ts", "");

  // Fallback decided BEFORE filtering: if the caller passed features (even
  // if every one of them is an auto-mounted name), an all-filtered-out empty
  // result is the correct outcome — falling back to FOUNDATION_FEATURES here
  // would silently substitute a different feature set than the caller asked
  // for.
  const base = features?.length ? features : FOUNDATION_FEATURES;
  const effective = base.filter((f) => !COMPOSE_AUTO_MOUNTED_NAMES.has(f.name));
  const grouped = new Map<string, string[]>();
  for (const entry of effective) {
    const existing = grouped.get(entry.importPath) ?? [];
    if (!existing.includes(entry.exportName)) existing.push(entry.exportName);
    grouped.set(entry.importPath, existing);
  }
  for (const [importPath, namedImports] of grouped) {
    sf.addImportDeclaration({ moduleSpecifier: importPath, namedImports });
  }

  const callList = effective.map((f) => f.callExpression).join(", ");
  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    isExported: true,
    declarations: [
      {
        name: "APP_FEATURES",
        initializer: `[${callList}] as const`,
      },
    ],
  });

  sf.insertText(
    0,
    [
      "// Single source of truth für die Feature-Komposition deiner App.",
      "// config/user/tenant/auth-email-password werden via",
      "// composeFeatures(includeBundled:true) automatisch ergänzt wenn",
      "// runProdApp mit `auth: {…}` aufgerufen wird (siehe bin/main.ts).",
      "//",
      "// Neue features hinzufügen:",
      "//   - bunx @cosmicdrift/kumiko-cli add feature <name>  (DX-2, automatisch)",
      "//   - oder: hand-edit + import unten ergänzen",
      "",
      "",
    ].join("\n"),
  );

  return sf.getFullText();
}

function renderMain(appName: string): string {
  const tenantId = deriveTenantId(appName);
  const project = newTsProject();
  const sf = project.createSourceFile("main.ts", "");

  sf.addImportDeclaration({
    moduleSpecifier: "@cosmicdrift/kumiko-dev-server",
    namedImports: ["composeFeatures", "frameworkCoreEnvSchema", "runProdApp"],
  });
  sf.addImportDeclaration({
    moduleSpecifier: "@cosmicdrift/kumiko-framework/engine",
    isTypeOnly: true,
    namedImports: ["TenantId"],
  });
  sf.addImportDeclaration({
    moduleSpecifier: "@cosmicdrift/kumiko-framework/env",
    namedImports: ["composeEnvSchema"],
  });
  sf.addImportDeclaration({
    moduleSpecifier: "../src/run-config",
    namedImports: ["APP_FEATURES"],
  });

  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "DEFAULT_TENANT_ID",
        initializer: `"${tenantId}" as TenantId`,
      },
    ],
  });

  // The envSchema must cover the SAME features runProdApp mounts at boot.
  // `auth: { admin: … }` below makes runProdApp auto-mix config/user/tenant/
  // auth-email-password via composeFeatures(includeBundled:true); compose the
  // identical set here so the auth feature's JWT_SECRET (min-32) declaration
  // is part of the boot-gate — otherwise a too-short JWT_SECRET slips through.
  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "bootFeatures",
        initializer: "composeFeatures(APP_FEATURES, { includeBundled: true })",
      },
    ],
  });

  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "envSchema",
        initializer: "composeEnvSchema({ core: frameworkCoreEnvSchema, features: bootFeatures })",
      },
    ],
  });

  sf.addStatements((writer) => {
    writer
      .write("await runProdApp(")
      .inlineBlock(() => {
        writer.writeLine("features: APP_FEATURES,");
        writer.writeLine("envSchema,");
        writer.writeLine("migrations: false,");
        writer.write("auth: ").inlineBlock(() => {
          writer.write("admin: ").inlineBlock(() => {
            writer.writeLine(`email: "admin@${appName}.local",`);
            writer.writeLine(`password: "change-me-on-first-deploy",`);
            writer.writeLine(`displayName: "Admin",`);
            writer.write("memberships: [");
            writer.indent(() => {
              writer.inlineBlock(() => {
                writer.writeLine("tenantId: DEFAULT_TENANT_ID,");
                writer.writeLine(`tenantKey: "${appName}",`);
                writer.writeLine(`tenantName: "${appName}",`);
                writer.writeLine(`roles: ["TenantAdmin"],`);
              });
              writer.write(",");
            });
            writer.write("],");
          });
        });
      })
      .write(");");
  });

  sf.insertText(
    0,
    [
      "// Production-bootstrap. KUMIKO_DRY_RUN_ENV=boot exits after",
      "// composeFeatures + validateBoot + createRegistry without DB/Redis-connect",
      "// (siehe @cosmicdrift/kumiko-dev-server runProdApp). Echter Dev-Boot",
      "// passiert via `bunx kumiko dev` (in-repo dev-tool) mit Docker-stack — DX-1.0 deckt nur",
      "// den boot-mode-Pfad ab; `kumiko dev` kommt in einer späteren DX-Phase.",
      "",
      "",
    ].join("\n"),
  );

  return sf.getFullText();
}

function renderDev(appName: string): string {
  const tenantId = deriveTenantId(appName);
  const project = newTsProject();
  const sf = project.createSourceFile("dev.ts", "");

  sf.addImportDeclaration({
    moduleSpecifier: "@cosmicdrift/kumiko-dev-server",
    namedImports: ["runDevApp"],
  });
  sf.addImportDeclaration({
    moduleSpecifier: "@cosmicdrift/kumiko-framework/engine",
    isTypeOnly: true,
    namedImports: ["TenantId"],
  });
  sf.addImportDeclaration({
    moduleSpecifier: "../src/run-config",
    namedImports: ["APP_FEATURES"],
  });

  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "DEFAULT_TENANT_ID",
        initializer: `"${tenantId}" as TenantId`,
      },
    ],
  });

  sf.addStatements((writer) => {
    writer
      .write("await runDevApp(")
      .inlineBlock(() => {
        writer.writeLine("features: APP_FEATURES,");
        writer.writeLine("welcomeBanner: true,");
        writer.writeLine(`clientEntry: "./src/client.tsx",`);
        writer.write("auth: ").inlineBlock(() => {
          writer.write("admin: ").inlineBlock(() => {
            writer.writeLine(`email: "admin@${appName}.local",`);
            writer.writeLine(`password: "changeme",`);
            writer.writeLine(`displayName: "Admin",`);
            writer.write("memberships: [");
            writer.indent(() => {
              writer.inlineBlock(() => {
                writer.writeLine("tenantId: DEFAULT_TENANT_ID,");
                writer.writeLine(`tenantKey: "${appName}",`);
                writer.writeLine(`tenantName: "${appName}",`);
                writer.writeLine(`roles: ["TenantAdmin"],`);
              });
              writer.write(",");
            });
            writer.write("],");
          });
        });
      })
      .write(");");
  });

  sf.insertText(
    0,
    [
      "// Dev-bootstrap. `bun --watch bin/dev.ts` (siehe package.json scripts.dev)",
      "// startet einen full-featured Dev-Server mit Auto-Reload bei Code-Änderungen.",
      "// setupTestStack legt fehlende Entity-Tabellen automatisch an — neues",
      "// r.entity(...) in einem Feature führt beim nächsten Reboot zu CREATE TABLE,",
      "// kein manuelles `kumiko schema apply` nötig (das gilt nur für Prod).",
      "// Persistent-DB via KUMIKO_DEV_DB_NAME (.env) damit Admin + Daten Reboots überleben.",
      "",
      "",
    ].join("\n"),
  );

  return sf.getFullText();
}

function renderClient(): string {
  return [
    "// Browser-Entry. runDevApp's clientEntry-Option bundlet diese Datei zu",
    "// /client.js und das Default-HTML lädt sie. createKumikoApp liest das",
    "// Schema aus dem window-globalen (das injectSchema im dev-server setzt)",
    "// und mountet die Routen.",
    "//",
    "// DefaultAppShell liefert die Sidebar + Topbar — ohne `shell` rendert",
    "// createKumikoApp das aktive Screen ohne Layout-Wrapper (= nach Login",
    "// nur ein nackter Banner statt der App). emailPasswordClient() bringt",
    "// Login-Screen + Session-Provider — ohne ihn bliebe /login leer.",
    "//",
    "// Neue Client-Plugins (z.B. notificationsClient()) hier in clientFeatures",
    "// hinzu — symmetrisch zu APP_FEATURES auf der Server-Seite.",
    "",
    'import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";',
    'import { createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";',
    "",
    "createKumikoApp({",
    "  shell: DefaultAppShell,",
    "  clientFeatures: [emailPasswordClient()],",
    "});",
    "",
  ].join("\n");
}

function renderEnvExample(appName: string): string {
  const devDb = `${appName.replace(/-/g, "_")}_dev`;
  return `# bun dev (runDevApp → setupTestStack) braucht TEST_DATABASE_URL.
# Production (bun bin/main.ts → runProdApp) braucht DATABASE_URL.
# Beide zeigen im Default auf denselben lokalen Postgres — runDevApp legt
# darunter eine eigene "<KUMIKO_DEV_DB_NAME>"-Datenbank an.
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app
REDIS_URL=redis://127.0.0.1:6379

# JWT_SECRET: min 32 chars. Generate with: openssl rand -base64 32
JWT_SECRET=change-me-min-32-chars-change-me-min-32

# KUMIKO_SECRETS_MASTER_KEY_V1: base64-encoded 32 bytes (AES-256 KEK).
# Generate with: openssl rand -base64 32
KUMIKO_SECRETS_MASTER_KEY_V1=

# Dev-only: persistente DB für \`bun dev\`. Ohne diesen Var startet jeder Reboot
# eine frische kumiko_test_<random>-DB → Admin-Login + Daten weg bei jedem Edit.
# Mit Var bleibt die DB zwischen Reboots erhalten (Schema-Pushes sind idempotent).
KUMIKO_DEV_DB_NAME=${devDb}
`;
}

// Local Postgres + Redis for `bun dev`. Ports + credentials match the *_URL
// defaults in renderEnvExample, so `docker compose up -d` (referenced by the
// README) just works with the generated .env. Named pg volume so dev data
// survives `docker compose down` (pairs with KUMIKO_DEV_DB_NAME persistence).
// Ports bind to 127.0.0.1 only: the dev DB (postgres/postgres) and auth-less
// Redis must not be reachable from the LAN on a machine without a firewall.
function renderDockerCompose(): string {
  return `# Local Postgres + Redis for \`bun dev\`. Matches the *_URL defaults in .env.example.
# Start: docker compose up -d   ·   Stop: docker compose down   ·   Reset: docker compose down -v
# Ports bind to 127.0.0.1 only — weak dev credentials must not be exposed on the LAN.
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - kumiko-pg:/var/lib/postgresql/data
  redis:
    image: redis:7
    ports:
      - "127.0.0.1:6379:6379"
volumes:
  kumiko-pg:
`;
}

function renderReadme(
  appName: string,
  features: ReadonlyArray<ScaffoldFeatureEntry> | undefined,
): string {
  const featureList =
    features && features.length > 0
      ? features.map((f) => `- \`${f.name}\``).join("\n")
      : "- `secrets` (foundation)\n- `sessions` (foundation)";
  return `# ${appName}

Scaffolded by \`bun create kumiko-app\`. Boots out-of-the-box with the picked
feature stack mounted. Add features by editing \`src/run-config.ts\` or via
\`bunx @cosmicdrift/kumiko-cli add feature <name>\`.

## Mounted features

${featureList}

Edit \`src/run-config.ts\` to add or remove.

## First run

\`\`\`sh
bun install
cp .env.example .env
# edit .env — set JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1, point DATABASE_URL/REDIS_URL at a real PG+Redis
docker compose up -d   # if you don't have PG+Redis running already
bun dev
\`\`\`

The dev-server prints a welcome banner with the URL + admin login when ready.
Edits to \`src/features/**\` trigger a process restart (\`bun --watch\`); new
\`r.entity(...)\` calls auto-create tables on reboot — no manual migration.

## Boot-only smoke (no DB needed)

\`\`\`sh
bun run boot
\`\`\`

Runs \`KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts\` — validates feature composition
+ env schema, exits 0 without touching DB/Redis. Useful in CI.

## Architecture

- \`src/run-config.ts\` — single source of truth: which features your app mounts.
- \`bin/dev.ts\` — dev-server entry (\`bun dev\`).
- \`bin/main.ts\` — production-bootstrap (\`bun run boot\` smoke + production deploy).
- \`docker-compose.yml\` — local Postgres + Redis for \`bun dev\`.

For full docs see https://docs.kumiko.rocks.
`;
}

// Deterministic tenant-ID from app-name. Format: UUID-v4 with the
// version-marker at the right spot. NOT cryptographically random —
// just a stable per-app default the user can change later.
function deriveTenantId(name: string): string {
  let state = 2166136261;
  for (const ch of name) {
    state ^= ch.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  // @wrapper-known semantic-alias
  const hex = (n: number, len: number): string => n.toString(16).padStart(len, "0").slice(0, len);
  const a = hex(state, 8);
  state ^= state << 13;
  state >>>= 0;
  const b = hex(state, 4);
  state ^= state >>> 17;
  state >>>= 0;
  const c = `4${hex(state, 3)}`;
  state ^= state << 5;
  state >>>= 0;
  const d4 = (0x8 | (state & 0x3)).toString(16);
  const d = `${d4}${hex(state >>> 4, 3)}`;
  state = Math.imul(state, 16777619) >>> 0;
  const e = hex(state, 12);
  return `${a}-${b}-${c}-${d}-${e}`;
}
