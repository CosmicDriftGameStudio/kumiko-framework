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
import { join, relative, resolve } from "node:path";
import {
  collectTableMetas,
  generateMigration,
  writeSnapshotJson,
} from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { IndentationText, Project, VariableDeclarationKind } from "ts-morph";
import { composeFeatures } from "./compose-features";
import { isKebabSegment } from "./kebab";
import {
  createDemoTasksFeature,
  renderDemoSeedFile,
  renderDemoTasksFeatureFile,
  renderDemoTasksIndex,
} from "./scaffold-demo-tasks";
import { scaffoldDeploy } from "./scaffold-deploy";

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

export async function scaffoldApp(options: ScaffoldAppOptions): Promise<ScaffoldAppResult> {
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
  mkdirSync(join(destination, "kumiko"), { recursive: true });

  const files: string[] = [];

  write(join(destination, "package.json"), renderPackageJson(options.name, version));
  files.push("package.json");

  write(join(destination, "tsconfig.json"), renderTsconfig());
  files.push("tsconfig.json");

  write(join(destination, "biome.json"), renderBiomeJson());
  files.push("biome.json");

  write(join(destination, "bunfig.toml"), renderBunfigToml());
  files.push("bunfig.toml");

  write(join(destination, "bunfig.ci.toml"), renderBunfigCiToml());
  files.push("bunfig.ci.toml");

  write(join(destination, "src", "run-config.ts"), renderRunConfig(options.features));
  files.push("src/run-config.ts");

  mkdirSync(join(destination, "src", "features", "tasks"), { recursive: true });
  write(join(destination, "src", "features", "tasks", "feature.ts"), renderDemoTasksFeatureFile());
  files.push("src/features/tasks/feature.ts");
  write(join(destination, "src", "features", "tasks", "index.ts"), renderDemoTasksIndex());
  files.push("src/features/tasks/index.ts");
  write(join(destination, "src", "seed.ts"), renderDemoSeedFile());
  files.push("src/seed.ts");

  write(join(destination, "kumiko", "schema.ts"), renderKumikoSchema());
  files.push("kumiko/schema.ts");

  write(join(destination, "bin", "main.ts"), renderMain(options.name));
  files.push("bin/main.ts");

  write(join(destination, "bin", "dev.ts"), renderDev(options.name));
  files.push("bin/dev.ts");

  write(join(destination, "bin", "kumiko.ts"), renderBinKumiko());
  files.push("bin/kumiko.ts");

  write(join(destination, "src", "client.tsx"), renderClient(options.name));
  files.push("src/client.tsx");

  write(join(destination, "src", "styles.css"), renderStylesCss());
  files.push("src/styles.css");

  write(join(destination, ".env.example"), renderEnvExample(options.name));
  files.push(".env.example");

  write(join(destination, "docker-compose.yml"), renderDockerCompose());
  files.push("docker-compose.yml");

  await writeInitMigration(destination, options.features);
  files.push("kumiko/migrations/0001_init.sql", "kumiko/migrations/.snapshot.json");

  const deploy = scaffoldDeploy({ appName: options.name, destination });
  for (const f of deploy.files) {
    if (f.written) {
      files.push(relative(destination, f.path));
    }
  }

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
        build: "bun kumiko-build",
        start: "bun run bin/main.ts",
        boot: "KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts",
        typecheck: "tsc --noEmit",
        lint: "biome check .",
        test: "bun --config=bunfig.ci.toml test --dots",
        "schema:apply": "bun kumiko-schema apply",
        "schema:generate": "bun kumiko-schema generate",
      },
      dependencies: {
        "@cosmicdrift/kumiko-bundled-features": version,
        "@cosmicdrift/kumiko-dev-server": version,
        "@cosmicdrift/kumiko-framework": version,
        "@cosmicdrift/kumiko-renderer-web": version,
        react: "^19.2.6",
        "react-dom": "^19.2.6",
        zod: "^4.4.3",
      },
      devDependencies: {
        "@biomejs/biome": "^2.4.15",
        "@tailwindcss/cli": "^4.3.0",
        "@types/react": "^19.2.0",
        "@types/react-dom": "^19.2.0",
        "bun-types": "^1.3.14",
        tailwindcss: "^4.3.0",
        typescript: "^6.0.3",
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
        lib: ["ESNext", "DOM"],
        types: ["bun-types"],
        jsx: "react-jsx",
        noEmit: true,
      },
      include: ["bin", "src", "kumiko"],
    },
    null,
    2,
  )}\n`;
}

function renderBiomeJson(): string {
  return `${JSON.stringify(
    {
      $schema: "https://biomejs.dev/schemas/2.4.15/schema.json",
      vcs: {
        enabled: true,
        clientKind: "git",
        useIgnoreFile: true,
        defaultBranch: "main",
      },
      files: {
        includes: ["src/**", "bin/**", "kumiko/**", "!**/dist", "!kumiko/migrations"],
      },
      formatter: {
        enabled: true,
        indentStyle: "space",
        indentWidth: 2,
        lineWidth: 100,
        lineEnding: "lf",
      },
      css: {
        parser: { cssModules: false, tailwindDirectives: true },
      },
      javascript: {
        formatter: {
          quoteStyle: "double",
          jsxQuoteStyle: "double",
          semicolons: "always",
          trailingCommas: "all",
          arrowParentheses: "always",
        },
      },
      json: { formatter: { indentWidth: 2, lineWidth: 80 } },
      linter: {
        enabled: true,
        rules: {
          recommended: true,
          correctness: { noUnusedVariables: "error", noUnusedImports: "error" },
          suspicious: { noExplicitAny: "error", noDebugger: "error", noConsole: "warn" },
          complexity: { useLiteralKeys: "off" },
          style: { useConst: "error" },
          nursery: { noFloatingPromises: "error" },
        },
      },
      overrides: [
        {
          includes: ["**/*.test.ts", "**/*.spec.ts", "**/*.integration.ts", "**/*.e2e.ts"],
          linter: {
            rules: {
              suspicious: { noConsole: "off" },
              style: { noNonNullAssertion: "off" },
            },
          },
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function renderBunfigToml(): string {
  return `[install]
linker = "hoisted"

[test]
concurrency = 8
pathIgnorePatterns = [
  "**/e2e/**",
  "**/*.spec.ts",
  "**/dist/**",
]
`;
}

function renderBunfigCiToml(): string {
  return `[install]
linker = "hoisted"

[test]
concurrency = 8
pathIgnorePatterns = [
  "**/e2e/**",
  "**/*.spec.ts",
  "**/dist/**",
]
`;
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
  sf.addImportDeclaration({
    moduleSpecifier: "./features/tasks",
    namedImports: ["tasksFeature"],
  });

  const callExprs = [...effective.map((f) => f.callExpression), "tasksFeature"];
  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    isExported: true,
    declarations: [
      {
        name: "APP_FEATURES",
        initializer: `[${callExprs.join(", ")}] as const`,
      },
    ],
  });

  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    isExported: true,
    declarations: [{ name: "HAS_AUTH", initializer: "true" }],
  });

  sf.insertText(
    0,
    [
      "// Single source of truth for your app's feature composition.",
      "// config/user/tenant/auth-email-password are added automatically",
      "// via composeFeatures(includeBundled:true) when runProdApp is called",
      "// with `auth: {…}` (see bin/main.ts).",
      "//",
      "// Add new features:",
      "//   - bunx @cosmicdrift/kumiko-cli add feature <name>  (DX-2, automatic)",
      "//   - or: hand-edit + add the import below",
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
    namedImports: ["APP_FEATURES", "HAS_AUTH"],
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
  // auth-email-password via composeFeatures(includeBundled:HAS_AUTH); compose the
  // identical set here so the auth feature's JWT_SECRET (min-32) declaration
  // is part of the boot-gate — otherwise a too-short JWT_SECRET slips through.
  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "bootFeatures",
        initializer: "composeFeatures(APP_FEATURES, { includeBundled: HAS_AUTH })",
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
        writer.writeLine('staticDir: "./dist",');
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
      "// (see @cosmicdrift/kumiko-dev-server runProdApp). The real dev boot",
      "// runs via `bunx kumiko dev` (in-repo dev-tool) with a Docker stack — DX-1.0",
      "// only covers the boot-mode path; `kumiko dev` lands in a later DX phase.",
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
  sf.addImportDeclaration({
    moduleSpecifier: "../src/seed",
    namedImports: ["seedDemoTasks"],
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
        writer.writeLine("seeds: [seedDemoTasks],");
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
      "// Dev bootstrap. `bun --watch bin/dev.ts` (see package.json scripts.dev)",
      "// starts a full-featured dev server with auto-reload on code changes.",
      "// setupTestStack creates missing entity tables automatically — a new",
      "// r.entity(...) in a feature becomes a CREATE TABLE on the next reboot,",
      "// no manual `kumiko schema apply` needed (that's prod-only).",
      "// Persistent DB via KUMIKO_DEV_DB_NAME (.env) so admin + data survive reboots.",
      "",
      "",
    ].join("\n"),
  );

  return sf.getFullText();
}

function renderClient(appName: string): string {
  return [
    "// Browser entry. runDevApp's clientEntry option bundles this file to",
    "// /client.js and the default HTML loads it. createKumikoApp reads the",
    "// schema from the window global (injectSchema in the dev-server sets it)",
    "// and mounts the routes.",
    "//",
    "// AppShell wraps DefaultAppShell to supply `brand` — createKumikoApp's",
    "// shell option only injects schema + children. Without `shell` the",
    "// active screen renders with no layout wrapper (a bare banner after",
    "// login instead of the app). emailPasswordClient() brings the login",
    "// screen + session provider — without it /login stays empty.",
    "//",
    "// Add new client plugins (e.g. notificationsClient()) to clientFeatures",
    "// here — symmetric to APP_FEATURES on the server side.",
    "",
    'import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";',
    'import { type AppSchema, createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";',
    'import type { ReactNode } from "react";',
    "",
    "function AppShell({ children, schema }: { children: ReactNode; schema: AppSchema }): ReactNode {",
    "  return (",
    `    <DefaultAppShell brand={<span className="font-semibold tracking-tight">${appName}</span>} schema={schema}>`,
    "      {children}",
    "    </DefaultAppShell>",
    "  );",
    "}",
    "",
    "createKumikoApp({",
    "  shell: AppShell,",
    "  clientFeatures: [emailPasswordClient()],",
    "});",
    "",
  ].join("\n");
}

function renderEnvExample(appName: string): string {
  const devDb = `${appName.replace(/-/g, "_")}_dev`;
  return `# bun dev (runDevApp → setupTestStack) needs TEST_DATABASE_URL.
# Production (bun bin/main.ts → runProdApp) needs DATABASE_URL.
# Both default to the same local Postgres — runDevApp creates its own
# "<KUMIKO_DEV_DB_NAME>" database underneath.
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app
REDIS_URL=redis://127.0.0.1:6379

# JWT_SECRET: min 32 chars. Generate with: openssl rand -base64 32
JWT_SECRET=change-me-min-32-chars-change-me-min-32

# KUMIKO_SECRETS_MASTER_KEY_V1: base64-encoded 32 bytes (AES-256 KEK).
# Generate with: openssl rand -base64 32
KUMIKO_SECRETS_MASTER_KEY_V1=

# Dev-only: persistent DB for \`bun dev\`. Without this var every reboot starts
# a fresh kumiko_test_<random> DB → admin login + data gone on every edit.
# With it the DB persists across reboots (schema pushes are idempotent).
KUMIKO_DEV_DB_NAME=${devDb}
`;
}

// Ports + credentials match the *_URL defaults in renderEnvExample, so
// `docker compose up -d` just works with the generated .env. Named pg volume
// so dev data survives `docker compose down` (pairs with KUMIKO_DEV_DB_NAME
// persistence) — the loopback-binding rationale is in the generated file's
// own comment (657/1), no need to duplicate it here.
function renderDockerCompose(): string {
  return `# Local Postgres + Redis for \`bun dev\`. Matches the *_URL defaults in .env.example.
# Start: docker compose up -d   ·   Stop: docker compose down   ·   Reset: docker compose down -v
# Ports bind to 127.0.0.1 only — weak dev credentials must not be exposed on the LAN.
services:
  postgres:
    # Pinned to the project's own compose-file tag (663/1) — Alpine variant
    # (~90MB vs ~400MB) and a reproducible patch version, bump on PG18 minors.
    image: postgres:18.3-alpine
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
      ? [...features.map((f) => `- \`${f.name}\``), "- `tasks` (demo — list + edit screens)"].join(
          "\n",
        )
      : "- `secrets` (foundation)\n- `sessions` (foundation)\n- `tasks` (demo — list + edit screens)";
  return `# ${appName}

Scaffolded by \`kumiko new app\`. Includes a demo **tasks** feature with list +
edit screens, sidebar nav, and seeded rows — \`bun dev\` shows a working admin UI
after login. Add more features via \`bunx @cosmicdrift/kumiko-cli add feature <name>\`.

## Mounted features

${featureList}

Edit \`src/run-config.ts\` to add bundled features. The demo lives in
\`src/features/tasks/\`.

## First run (browser)

\`\`\`sh
bun install
cp .env.example .env
# set JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1 in .env
docker compose up -d   # local Postgres + Redis (skip if you already have them)
bun dev
\`\`\`

The welcome banner prints the URL (default \`http://localhost:4173\`) and admin
login. Sign in as \`admin@${appName}.local\` / \`changeme\`, then open **Tasks**
in the sidebar — demo rows are pre-seeded.

## Boot-only smoke (no DB needed)

\`\`\`sh
bun run boot
\`\`\`

Runs \`KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts\` — validates feature composition
+ env schema, exits 0 without touching DB/Redis. Useful in CI.

## Production build + schema

\`\`\`sh
bun run build          # kumiko-build → dist/ + dist-server/
bun run schema:apply   # apply checked-in kumiko/migrations (needs DATABASE_URL)
bun run start          # runProdApp against dist/
\`\`\`

After adding entities/features, regenerate migrations:

\`\`\`sh
bun run schema:generate <name>
\`\`\`

## Deploy

\`deploy/Dockerfile\` + \`deploy/migrate-step.sh\` are scaffolded for container
deploys. Build context = app repo root; migrations ship in \`kumiko/migrations/\`.

## Architecture

- \`src/run-config.ts\` — single source of truth: which features your app mounts (\`APP_FEATURES\`, \`HAS_AUTH\`).
- \`src/features/tasks/\` — demo feature (entity + handlers + screens + nav).
- \`src/seed.ts\` — dev seed for demo tasks (\`bun dev\` only).
- \`kumiko/schema.ts\` — same feature set → \`ENTITY_METAS\` for \`kumiko schema\`.
- \`bin/dev.ts\` — dev-server entry (\`bun dev\`).
- \`bin/main.ts\` — production-bootstrap (\`bun run start\`).
- \`bin/kumiko.ts\` — schema-CLI bundled into \`dist-server/kumiko.js\`.
- \`docker-compose.yml\` — local Postgres + Redis for \`bun dev\`.

For full docs see https://docs.kumiko.rocks.
`;
}

function renderStylesCss(): string {
  return [
    '@import "@cosmicdrift/kumiko-renderer-web/styles.css";',
    "",
    '@source "./**/*.{ts,tsx}";',
    "",
  ].join("\n");
}

function renderKumikoSchema(): string {
  return [
    "// Live ENTITY_METAS source for `kumiko schema generate|apply|status`.",
    "//",
    "// Computes table-metas from the SAME composeFeatures(APP_FEATURES) the",
    "// runtime sees (runProdApp/runDevApp) — migration and runtime cannot drift.",
    "",
    'import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";',
    'import { collectTableMetas, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";',
    'import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";',
    'import { APP_FEATURES, HAS_AUTH } from "../src/run-config";',
    "",
    "export const FEATURES: readonly FeatureDefinition[] = composeFeatures([...APP_FEATURES], {",
    "  includeBundled: HAS_AUTH,",
    "});",
    "",
    "export const ENTITY_METAS: readonly EntityTableMeta[] = collectTableMetas(FEATURES);",
    "",
  ].join("\n");
}

function renderBinKumiko(): string {
  return [
    "#!/usr/bin/env bun",
    "",
    "// Standalone kumiko schema-CLI for the production bundle. The deploy",
    "// migrate-step runs `bun /app/kumiko.js schema apply`; kumiko-build bundles",
    "// this file to dist-server/kumiko.js.",
    "",
    'import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";',
    'import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";',
    'import { APP_FEATURES, HAS_AUTH } from "../src/run-config";',
    "",
    "const [, , cmd, ...rest] = Bun.argv;",
    'if (cmd !== "schema") {',
    "  // biome-ignore lint/suspicious/noConsole: CLI output is the feature.",
    '  console.error("\\n  Unknown: kumiko " + (cmd ?? "") + " — only \'kumiko schema <sub>\' in the standalone bundle.\\n");',
    "  process.exit(1);",
    "}",
    "",
    "const features = composeFeatures([...APP_FEATURES], { includeBundled: HAS_AUTH });",
    "// biome-ignore lint/suspicious/noConsole: CLI output is the feature.",
    "const out = { log: (l: string) => console.log(l), err: (l: string) => console.error(l) };",
    "process.exit(await runSchemaCli(rest, process.env.INIT_CWD ?? process.cwd(), out, { features }));",
    "",
  ].join("\n");
}

async function instantiateScaffoldFeatures(
  features?: ReadonlyArray<ScaffoldFeatureEntry>,
): Promise<readonly FeatureDefinition[]> {
  const base = features?.length ? features : FOUNDATION_FEATURES;
  const effective = base.filter((f) => !COMPOSE_AUTO_MOUNTED_NAMES.has(f.name));
  const instances: FeatureDefinition[] = [];
  for (const entry of effective) {
    const mod = (await import(entry.importPath)) as Record<string, unknown>;
    const exp = mod[entry.exportName];
    if (exp === undefined) {
      throw new Error(
        `scaffoldApp: ${entry.importPath} missing export ${entry.exportName} for ${entry.callExpression}`,
      );
    }
    if (entry.callExpression.endsWith("()")) {
      if (typeof exp !== "function") {
        throw new Error(`scaffoldApp: ${entry.exportName} is not callable (${entry.importPath})`);
      }
      instances.push((exp as () => FeatureDefinition)());
    } else {
      instances.push(exp as FeatureDefinition);
    }
  }
  instances.push(createDemoTasksFeature());
  return instances;
}

async function writeInitMigration(
  destination: string,
  features?: ReadonlyArray<ScaffoldFeatureEntry>,
): Promise<void> {
  const instances = await instantiateScaffoldFeatures(features);
  const composed = composeFeatures(instances, { includeBundled: true });
  const metas = collectTableMetas(composed);
  const result = generateMigration({
    metas,
    prevSnapshot: null,
    name: "init",
    sequenceNumber: 1,
  });
  const migrationsDir = join(destination, "kumiko", "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, result.filename), result.sqlContent);
  writeSnapshotJson(join(migrationsDir, ".snapshot.json"), result.snapshot);
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
