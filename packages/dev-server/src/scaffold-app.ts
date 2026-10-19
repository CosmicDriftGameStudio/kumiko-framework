// scaffoldApp — generate a runnable Kumiko app workspace from a name.
//
// Used by `kumiko new app <name>`. Produces the minimal app shape that
// `KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts` and `kumiko check` run green
// against. Every framework-owned file (deploy, workflows, bunfigs, presets,
// kumiko/schema.ts) comes from the managed-files registry, the same renders
// `kumiko check managed` compares against.
//
// Generated files are emitted already formatted to Biome's output (import
// order, 100-col wrapping, trailing commas) so a fresh app passes `biome check`.
// Static files (package.json, tsconfig, .env, README) stay text-based.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { APP_CONFIG_FILE } from "@cosmicdrift/kumiko-framework/config";
import {
  collectTableMetas,
  generateMigration,
  writeSnapshotJson,
} from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { isKebabSegment } from "./kebab.ts";
import { PREPARE_SCRIPT, resolveManagedAppFacts, syncManagedFiles } from "./managed-files/index.ts";
import { renderAgentsMd, renderClaudeMd, renderMountedFeatureList } from "./scaffold-agent-docs.ts";
import {
  createDemoTasksFeature,
  renderDemoSeedFile,
  renderDemoTasksFeatureFile,
  renderDemoTasksI18n,
  renderDemoTasksIndex,
  renderDemoTasksWebIndex,
} from "./scaffold-demo-tasks.ts";

// Single bundled-feature entry the scaffolder mounts into run-config.ts.
// importPath is the from-spec ("@cosmicdrift/kumiko-bundled-features/files"),
// exportName the named import, callExpression the form that lands in the
// APP_FEATURES array literal — `${exportName}()` for factory-style features.
export type ScaffoldFeatureEntry = {
  readonly name: string;
  readonly importPath: string;
  readonly exportName: string;
  readonly callExpression: string;
  /** Runtime args for factory-style exports that need config the codegen text can't parse back out (e.g. `{ scopes: {} }`). Omit for zero-arg factories and object-style exports. */
  readonly callArgs?: readonly unknown[];
};

// Structural twin of `ScaffoldTestSetup` from @cosmicdrift/kumiko-testing/scaffold —
// dev-server cannot import that package (it depends on dev-server), callers pass it in.
export type ScaffoldTestSetup = {
  readonly files: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly rulesMarkdown: string;
};

export type ScaffoldTestSetupFactory = (input: {
  readonly appName: string;
  readonly frameworkVersion: string;
}) => ScaffoldTestSetup;

// Exact pin (no caret): the generated files are formatted to this Biome's output,
// and a scaffold-lint test keeps it equal to the monorepo's own Biome version.
export const SCAFFOLD_BIOME_VERSION = "2.5.7";

const SCAFFOLD_GITIGNORE = `node_modules/
dist/
dist-server/
.env
test-results/
playwright-report/
`;

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
  /** Bundled-features to mount in run-config.ts. Default: secrets + auth-foundation + sessions
   *  (the historical foundation). create-kumiko-app passes the picker output
   *  here so the generated APP_FEATURES reflects the user's selection. */
  readonly features?: ReadonlyArray<ScaffoldFeatureEntry>;
  /** Test wiring (scripts, example tests, e2e) — `renderTestSetup` from
   *  @cosmicdrift/kumiko-testing/scaffold. Without it the app gets the managed
   *  bunfigs but no example tests and fewer standard scripts. */
  readonly testSetup?: ScaffoldTestSetupFactory;
  /** Infra tag written to `package.json#kumiko.deploy.infraRef`. Unset: the managed
   *  workflows call infra at `main` and `kumiko check managed` warns. */
  readonly infraRef?: string;
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
  const testSetup = options.testSetup?.({ appName: options.name, frameworkVersion: version });

  mkdirSync(join(destination, "bin"), { recursive: true });
  mkdirSync(join(destination, "src"), { recursive: true });
  mkdirSync(join(destination, "kumiko"), { recursive: true });

  const files: string[] = [];

  write(
    join(destination, "package.json"),
    renderPackageJson(options.name, version, testSetup, options.infraRef),
  );
  files.push("package.json");

  write(join(destination, "kumiko.json"), renderKumikoManifest());
  files.push("kumiko.json");

  write(join(destination, ".gitignore"), SCAFFOLD_GITIGNORE);
  files.push(".gitignore");

  write(join(destination, "src", "run-config.ts"), renderRunConfig(options.features));
  files.push("src/run-config.ts");

  mkdirSync(join(destination, "src", "features", "tasks", "web"), { recursive: true });
  write(join(destination, "src", "features", "tasks", "feature.ts"), renderDemoTasksFeatureFile());
  files.push("src/features/tasks/feature.ts");
  write(join(destination, "src", "features", "tasks", "i18n.ts"), renderDemoTasksI18n());
  files.push("src/features/tasks/i18n.ts");
  write(join(destination, "src", "features", "tasks", "index.ts"), renderDemoTasksIndex());
  files.push("src/features/tasks/index.ts");
  write(
    join(destination, "src", "features", "tasks", "web", "index.ts"),
    renderDemoTasksWebIndex(),
  );
  files.push("src/features/tasks/web/index.ts");
  write(join(destination, "src", "seed.ts"), renderDemoSeedFile());
  files.push("src/seed.ts");

  write(join(destination, APP_CONFIG_FILE), renderAppConfig());
  files.push(APP_CONFIG_FILE);

  write(join(destination, "bin", "main.ts"), renderMain(options.name));
  files.push("bin/main.ts");

  write(join(destination, "bin", "server.ts"), renderServer(options.name));
  files.push("bin/server.ts");

  write(join(destination, "bin", "env-schema.ts"), renderEnvSchema(options.name));
  files.push("bin/env-schema.ts");

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

  if (testSetup !== undefined) {
    for (const [rel, content] of Object.entries(testSetup.files)) {
      mkdirSync(dirname(join(destination, rel)), { recursive: true });
      write(join(destination, rel), content);
      files.push(rel);
    }
  }

  const managedFacts = resolveManagedAppFacts({
    appRoot: destination,
    appName: options.name,
    uiRoots: SCAFFOLD_UI_ROOTS,
  });
  for (const action of syncManagedFiles(managedFacts, { write: true, adopt: false })) {
    if (action.action === "create") files.push(action.path);
  }

  write(
    join(destination, "README.md"),
    `${renderReadme(options.name, options.features)}${testSetup === undefined ? "" : `\n${testSetup.rulesMarkdown}`}`,
  );
  files.push("README.md");

  write(
    join(destination, "AGENTS.md"),
    renderAgentsMd({
      productName: options.name,
      features: options.features,
      scriptNames: Object.keys(appScripts(testSetup)),
    }),
  );
  files.push("AGENTS.md");
  write(join(destination, "CLAUDE.md"), renderClaudeMd());
  files.push("CLAUDE.md");

  return { destination, files, appName: options.name };
}

// @wrapper-known semantic-alias
function write(path: string, content: string): void {
  writeFileSync(path, content);
}

function appScripts(testSetup: ScaffoldTestSetup | undefined): Record<string, string> {
  return {
    dev: "bun --watch bin/server.ts",
    build: "bun kumiko-build",
    start: "bun run bin/main.ts",
    boot: "KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts",
    typecheck: "tsc --noEmit",
    lint: "biome check .",
    check: "kumiko check",
    ...(testSetup?.scripts ?? { test: "bun --config=bunfig.toml test --dots" }),
    "schema:apply": "bun kumiko-schema apply",
    "schema:generate": "bun kumiko-schema generate",
    prepare: PREPARE_SCRIPT,
  };
}

function renderPackageJson(
  name: string,
  version: string,
  testSetup: ScaffoldTestSetup | undefined,
  infraRef: string | undefined,
): string {
  return `${JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      ...(infraRef === undefined ? {} : { kumiko: { deploy: { infraRef } } }),
      scripts: appScripts(testSetup),
      dependencies: {
        "@cosmicdrift/kumiko-bundled-features": version,
        "@cosmicdrift/kumiko-dev-server": version,
        "@cosmicdrift/kumiko-framework": version,
        "@cosmicdrift/kumiko-renderer-web": version,
        "@cosmicdrift/kumiko-server-runtime": version,
        react: "^19.2.6",
        "react-dom": "^19.2.6",
        zod: "^4.4.3",
      },
      devDependencies: sortedByName({
        "@biomejs/biome": SCAFFOLD_BIOME_VERSION,
        "@cosmicdrift/kumiko-cli": version,
        "@tailwindcss/cli": "^4.3.0",
        "@types/react": "^19.2.0",
        "@types/react-dom": "^19.2.0",
        "bun-types": "^1.4.0",
        tailwindcss: "^4.3.0",
        typescript: "^6.0.3",
        ...testSetup?.devDependencies,
      }),
    },
    null,
    2,
  )}\n`;
}

function sortedByName(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));
}

const FOUNDATION_FEATURES: ReadonlyArray<ScaffoldFeatureEntry> = [
  {
    name: "secrets",
    importPath: "@cosmicdrift/kumiko-bundled-features/secrets",
    exportName: "createSecretsFeature",
    callExpression: "createSecretsFeature()",
  },
  // sessions' `sessionStore` extension requires auth-foundation to be mounted.
  {
    name: "auth-foundation",
    importPath: "@cosmicdrift/kumiko-bundled-features/auth-foundation",
    exportName: "createAuthFoundationFeature",
    callExpression: "createAuthFoundationFeature()",
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

const MAX_LINE_WIDTH = 100;

// Mirrors Biome's import sort so generated files pass `biome check` untouched:
// packages alphabetically by specifier, relative paths last.
function compareImportKeys(a: string, b: string): number {
  const lowerA = a.replace(/^type /, "").toLowerCase();
  const lowerB = b.replace(/^type /, "").toLowerCase();
  if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

type ImportSpec = {
  readonly specifier: string;
  readonly names: readonly string[];
  readonly typeOnly?: boolean;
  readonly defaultName?: string;
};

function renderImportLine({ specifier, names, typeOnly, defaultName }: ImportSpec): string {
  if (defaultName !== undefined) return `import ${defaultName} from "${specifier}";`;
  const sorted = [...names].sort(compareImportKeys);
  const keyword = typeOnly === true ? "import type" : "import";
  const oneLine = `${keyword} { ${sorted.join(", ")} } from "${specifier}";`;
  if (sorted.length === 1 || oneLine.length <= MAX_LINE_WIDTH) return oneLine;
  return `${keyword} {\n${sorted.map((n) => `  ${n},`).join("\n")}\n} from "${specifier}";`;
}

function renderSortedImports(imports: readonly ImportSpec[]): string {
  return [...imports]
    .sort((a, b) => {
      const relativeA = isRelativeSpecifier(a.specifier);
      const relativeB = isRelativeSpecifier(b.specifier);
      if (relativeA !== relativeB) return relativeA ? 1 : -1;
      return compareImportKeys(a.specifier, b.specifier);
    })
    .map(renderImportLine)
    .join("\n");
}

function renderRunConfig(features?: ReadonlyArray<ScaffoldFeatureEntry>): string {
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
  const imports: ImportSpec[] = [
    ...[...grouped].map(([specifier, names]) => ({ specifier, names })),
    { specifier: "./features/tasks", names: ["tasksFeature"] },
  ];

  const callExprs = [...effective.map((f) => f.callExpression), "tasksFeature"];
  const oneLineFeatures = `export const APP_FEATURES = [${callExprs.join(", ")}] as const;`;
  const appFeatures =
    oneLineFeatures.length <= MAX_LINE_WIDTH
      ? oneLineFeatures
      : `export const APP_FEATURES = [\n${callExprs.map((c) => `  ${c},`).join("\n")}\n] as const;`;

  return `// Single source of truth for your app's feature composition.
// config/user/tenant/auth-email-password are added automatically
// via composeFeatures(includeBundled:true) when runProdApp is called
// with \`auth: {…}\` (see bin/main.ts).
//
// Add new features:
//   - bunx @cosmicdrift/kumiko-cli add feature <name>  (DX-2, automatic)
//   - or: hand-edit + add the import below

${renderSortedImports(imports)}

${appFeatures}

export const HAS_AUTH = true;
`;
}

function renderAdminAuthBlock(appName: string, extraAdminLines: readonly string[]): string {
  const passwordAndExtras = extraAdminLines.map((l) => `      ${l}`).join("\n");
  return `  auth: {
    admin: {
      email: "admin@${appName}.local",
${passwordAndExtras}
      memberships: [
        {
          tenantId: DEFAULT_TENANT_ID,
          tenantKey: "${appName}",
          tenantName: "${appName}",
          roles: ["TenantAdmin"],
        },
      ],
    },
  },`;
}

// Ports match runDevApp's default and kumiko-testing's SCAFFOLD_E2E_PORT.
const SCAFFOLD_DEV_PORT = 4173;
const SCAFFOLD_E2E_PORT = 4174;

function renderAppConfig(): string {
  const imports = renderSortedImports([
    { specifier: "@cosmicdrift/kumiko-framework/config", names: ["defineAppConfig"] },
    {
      specifier: "@cosmicdrift/kumiko-server-runtime/compose-features",
      names: ["composeFeatures"],
    },
    { specifier: "./src/run-config", names: ["APP_FEATURES", "HAS_AUTH"] },
  ]);
  return `// The one place the tooling reads: features for schema, migrations and agent
// lint, client entries, and the ports this app claims (see \`kumiko ports\`).
// features is the composed list, so the bundled auth features count too.

${imports}

export default defineAppConfig({
  features: composeFeatures([...APP_FEATURES], { includeBundled: HAS_AUTH }),
  client: { entries: ["src/client.tsx"] },
  ports: { dev: ${SCAFFOLD_DEV_PORT}, e2e: ${SCAFFOLD_E2E_PORT} },
});
`;
}

function renderEnvSchema(appName: string): string {
  const imports = renderSortedImports([
    { specifier: "@cosmicdrift/kumiko-dev-server/env-schema", names: ["frameworkCoreEnvSchema"] },
    { specifier: "@cosmicdrift/kumiko-framework/config", names: ["allAppFeatures"] },
    { specifier: "@cosmicdrift/kumiko-framework/env", names: ["composeEnvSchema"] },
    { specifier: "zod", names: ["z"] },
  ]);
  // The schema must cover the SAME features runProdApp mounts at boot:
  // `auth: { admin: … }` makes runProdApp auto-mix config/user/tenant/
  // auth-email-password, so their JWT_SECRET (min-32) declaration is part of the
  // boot gate. kumiko.config.ts already holds that composed list.
  return `// Env contract of the production processes (bin/main.ts, bin/kumiko.ts).
// Importing it must not read process.env; validation happens in runProdApp.

${imports}
import appConfig from "../kumiko.config";

export const envSchema = composeEnvSchema({
  core: frameworkCoreEnvSchema,
  features: allAppFeatures(appConfig),
  extend: z.object({
    DEMO_ADMIN_PASSWORD: z
      .string()
      .min(12)
      .describe(
        "Password of the admin seeded on first boot (admin@${appName}.local). Generate with: openssl rand -hex 24",
      )
      .meta({ kumiko: { pulumi: { secret: true } } }),
  }),
});
`;
}

function renderMain(appName: string): string {
  const tenantId = deriveTenantId(appName);
  const imports = renderSortedImports([
    { specifier: "@cosmicdrift/kumiko-server-runtime", names: ["runProdApp"] },
    { specifier: "@cosmicdrift/kumiko-framework/engine", names: ["TenantId"], typeOnly: true },
    {
      specifier: "@cosmicdrift/kumiko-framework/crypto",
      names: ["requireKmsWiring", "resolveKmsWiring"],
    },
    { specifier: "../src/run-config", names: ["APP_FEATURES"] },
    { specifier: "../kumiko.config", names: [], defaultName: "appConfig" },
    { specifier: "./env-schema", names: ["envSchema"] },
  ]);
  const authBlock = renderAdminAuthBlock(appName, [
    "// runProdApp validates envSchema before seeding: a missing or short value aborts the boot.",
    'password: process.env["DEMO_ADMIN_PASSWORD"] ?? "",',
    'displayName: "Admin",',
  ]);

  // Subject-key KMS is optional locally (plaintext + loud warning) but required
  // under NODE_ENV=production (fw#2317 / #2339).
  return `// Production-bootstrap. KUMIKO_DRY_RUN_ENV=boot exits after
// composeFeatures + validateBoot + createRegistry without DB/Redis-connect
// (see @cosmicdrift/kumiko-server-runtime runProdApp).

${imports}

const DEFAULT_TENANT_ID = "${tenantId}" as TenantId;

const kmsOpts = {
  logPrefix: "[${appName}]",
  plaintextReason:
    "no PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL / KUMIKO_BLIND_INDEX_KEY set — see .env.example",
} as const;

const kmsWiring =
  process.env["NODE_ENV"] === "production"
    ? requireKmsWiring(process.env, kmsOpts)
    : resolveKmsWiring(process.env, kmsOpts);

await runProdApp({
  features: APP_FEATURES,
  ...(appConfig.validateBootOptions && { validateBootOptions: appConfig.validateBootOptions }),
  envSchema,
  staticDir: "./dist",
  ...kmsWiring,
${authBlock}
});
`;
}

function renderServer(appName: string): string {
  const tenantId = deriveTenantId(appName);
  const imports = renderSortedImports([
    { specifier: "@cosmicdrift/kumiko-dev-server", names: ["runDevApp"] },
    { specifier: "@cosmicdrift/kumiko-framework/engine", names: ["TenantId"], typeOnly: true },
    { specifier: "../src/run-config", names: ["APP_FEATURES"] },
    { specifier: "../kumiko.config", names: [], defaultName: "appConfig" },
    { specifier: "../src/seed", names: ["seedDemoTasks"] },
  ]);
  // Dev-only emailVerified skips the login verify gate for the seeded admin;
  // prod's bin/main.ts leaves it unset because the verify flow must run there.
  const authBlock = renderAdminAuthBlock(appName, [
    'password: "changeme",',
    'displayName: "Admin",',
    "emailVerified: true,",
  ]);

  return `// Dev bootstrap. \`bun --watch bin/server.ts\` (see package.json scripts.dev)
// starts a full-featured dev server with auto-reload on code changes.
// setupTestStack creates missing entity tables automatically — a new
// r.entity(...) in a feature becomes a CREATE TABLE on the next reboot,
// no manual \`kumiko schema apply\` needed (that's prod-only).
// Persistent DB via KUMIKO_DEV_DB_NAME (.env) so admin + data survive reboots.

${imports}

const DEFAULT_TENANT_ID = "${tenantId}" as TenantId;

await runDevApp({
  features: APP_FEATURES,
  ...(appConfig.validateBootOptions && { validateBootOptions: appConfig.validateBootOptions }),
  welcomeBanner: true,
  clientEntry: "./src/client.tsx",
  seeds: [seedDemoTasks],
${authBlock}
});
`;
}

// Tiers mirror how Biome wraps the JSX as the name grows.
function renderDefaultAppShellElement(appName: string): string {
  const spanOpen = '<span className="font-semibold tracking-tight">';
  // html-ok: appName is kebab-validated (a-z/0-9/-); this is generated .tsx source, not runtime HTML.
  const brandInline = `${spanOpen}${appName}</span>`;
  const singleLine = `    <DefaultAppShell brand={${brandInline}} schema={schema}>`;
  if (singleLine.length <= MAX_LINE_WIDTH) return singleLine;
  const brandAttrInline = `      brand={${brandInline}}`;
  const brandAttribute =
    brandAttrInline.length <= MAX_LINE_WIDTH
      ? brandAttrInline
      : `${[
          "      brand={",
          ...(`        ${brandInline}`.length <= MAX_LINE_WIDTH
            ? [`        ${brandInline}`]
            : [`        ${spanOpen}`, `          ${appName}`, "        </span>"]),
          "      }",
        ].join("\n")}`;
  return ["    <DefaultAppShell", brandAttribute, "      schema={schema}", "    >"].join("\n");
}

function renderClient(appName: string): string {
  const imports = renderSortedImports([
    {
      specifier: "@cosmicdrift/kumiko-bundled-features/auth-email-password/web",
      names: ["emailPasswordClient"],
    },
    { specifier: "./features/tasks/web", names: ["tasksClient"] },
    {
      specifier: "@cosmicdrift/kumiko-renderer-web",
      names: ["type AppSchema", "createKumikoApp", "DefaultAppShell"],
    },
    { specifier: "react", names: ["ReactNode"], typeOnly: true },
  ]);
  return `// Browser entry. runDevApp's clientEntry option bundles this file to
// /client.js and the default HTML loads it. createKumikoApp fetches the
// AppSchema itself from the authenticated GET /api/schema and mounts
// the routes.
//
// AppShell wraps DefaultAppShell to supply \`brand\` — createKumikoApp's
// shell option only injects schema + children. Without \`shell\` the
// active screen renders with no layout wrapper (a bare banner after
// login instead of the app). emailPasswordClient() brings the login
// screen + session provider — without it /login stays empty.
//
// Add new client plugins (e.g. notificationsClient()) to clientFeatures
// here — symmetric to APP_FEATURES on the server side.

${imports}

function AppShell({ children, schema }: { children: ReactNode; schema: AppSchema }): ReactNode {
  return (
${renderDefaultAppShellElement(appName)}
      {children}
    </DefaultAppShell>
  );
}

createKumikoApp({
  shell: AppShell,
  clientFeatures: [emailPasswordClient(), tasksClient],
});
`;
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

# DEMO_ADMIN_PASSWORD: password of the admin seeded on first prod boot
# (admin@${appName}.local). Required by \`bun run boot\` and \`bun run start\`,
# min 12 chars. Generate with: openssl rand -hex 24
DEMO_ADMIN_PASSWORD=

# Subject-keys KMS for PII fields (user, tenant-invitation, fileRef). All-or-none.
# Unset → local boot with plaintext PII + warning; NODE_ENV=production requires
# the trio (requireKmsWiring). Generate PLATFORM_KEK / KUMIKO_BLIND_INDEX_KEY
# with: openssl rand -base64 32. SUBJECT_KEYS_DATABASE_URL must be a dedicated
# subject-keys cluster (not the app DB) — see kms-adapter.md.
PLATFORM_KEK=
# Separate Postgres instance for subject keys — never DATABASE_URL (retention
# must outlive app-DB backups for crypto-shredding).
SUBJECT_KEYS_DATABASE_URL=
KUMIKO_BLIND_INDEX_KEY=

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
      POSTGRES_DB: app
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - kumiko-pg:/var/lib/postgresql
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
  const featureList = renderMountedFeatureList(features);
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
+ env schema, exits 0 without touching DB/Redis. Useful in CI. It prints every
variable with its feature and status, never the value. An invalid value exits 1;
a missing one exits 0 without validating the wiring, so set
\`DEMO_ADMIN_PASSWORD\` (min 12 chars, \`openssl rand -hex 24\`) in \`.env\`.

Without \`PLATFORM_KEK\` / \`SUBJECT_KEYS_DATABASE_URL\` / \`KUMIKO_BLIND_INDEX_KEY\`
set (see \`.env.example\`), both \`bun run boot\` and \`bun run start\` boot with
PII fields (user, tenant-invitation, fileRef) stored in plaintext and a loud
warning — set all three before a real deploy.

## Production build + schema

\`\`\`sh
bun run build          # kumiko-build → dist/ + dist-server/
bun run schema:apply   # apply checked-in kumiko/migrations (needs DATABASE_URL)
bun run start          # runProdApp against dist/
\`\`\`

The first prod boot seeds \`admin@${appName}.local\` with the password from
\`DEMO_ADMIN_PASSWORD\` (required, min 12 chars). Log in with that.

After adding entities/features, regenerate migrations:

\`\`\`sh
bun run schema:generate <name>
\`\`\`

## Deploy

\`deploy/Dockerfile\` + \`deploy/migrate-step.sh\` are scaffolded for container
deploys. Build context = app repo root; migrations ship in \`kumiko/migrations/\`.

## Managed files

Files whose first line reads \`kumiko-managed\` (deploy/, .github/workflows/,
.husky/pre-push, the bunfigs, kumiko/schema.ts) belong to the framework.
\`bun run check\` reports drift against the installed version;
\`bunx kumiko sync-managed --write\` restores them. To keep a local change, add
\`# kumiko-managed: local <reason>\` as line 2.

## Architecture

- \`src/run-config.ts\` — single source of truth: which features your app mounts (\`APP_FEATURES\`, \`HAS_AUTH\`).
- \`src/features/tasks/\` — demo feature (entity + handlers + screens + nav).
- \`src/seed.ts\` — dev seed for demo tasks (\`bun dev\` only).
- \`kumiko.config.ts\` — the composed feature list, client entries and ports the tooling reads.
- \`kumiko/schema.ts\` — generated (\`kumiko-managed\`): \`ENTITY_METAS\` from kumiko.config.ts for \`kumiko schema\`.
- \`bin/server.ts\` — dev-server entry (\`bun dev\`).
- \`bin/env-schema.ts\` — env contract of the production processes.
- \`bin/main.ts\` — production-bootstrap (\`bun run start\`).
- \`bin/kumiko.ts\` — schema + consumer-ops CLI bundled into \`dist-server/kumiko.js\`.
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

// `kumiko check` fails a kind "app" without uiRoots, so a fresh app must declare them.
const SCAFFOLD_UI_ROOTS = ["src/features/*/web"] as const;

function renderKumikoManifest(): string {
  return `${JSON.stringify(
    {
      kind: "app",
      sourceRoots: ["src", "bin"],
      testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
      uiRoots: SCAFFOLD_UI_ROOTS,
      excludes: ["**/node_modules/**", "**/dist/**"],
    },
    null,
    2,
  )}\n`;
}

function renderBinKumiko(): string {
  return [
    "#!/usr/bin/env bun",
    "",
    "// Standalone kumiko CLI for the production bundle. The deploy migrate-step",
    "// runs `bun /app/kumiko.js schema apply`; ops runs `bun /app/kumiko.js",
    "// consumer status|restart <name>` to recover a dead event consumer without",
    "// ad-hoc SQL. kumiko-build bundles this file to dist-server/kumiko.js.",
    "",
    'import { allAppFeatures } from "@cosmicdrift/kumiko-framework/config";',
    'import { runConsumerCli } from "@cosmicdrift/kumiko-framework/consumer-cli";',
    'import { kmsSlotsOf } from "@cosmicdrift/kumiko-framework/env";',
    'import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";',
    'import appConfig from "../kumiko.config";',
    'import { envSchema } from "./env-schema";',
    "",
    "const [, , cmd, ...rest] = Bun.argv;",
    "const out = { log: (l: string) => console.log(l), err: (l: string) => console.error(l) };",
    "",
    'if (cmd === "schema") {',
    "  const features = allAppFeatures(appConfig);",
    "  const kmsSlots = kmsSlotsOf(envSchema.schema);",
    "  process.exit(",
    "    await runSchemaCli(rest, process.env.INIT_CWD ?? process.cwd(), out, { features, kmsSlots }),",
    "  );",
    "}",
    "",
    'if (cmd === "consumer") {',
    "  process.exit(await runConsumerCli(rest, out));",
    "}",
    "",
    "console.error(",
    `  \`\\n  Unknown: kumiko \${cmd ?? ""} — the standalone bundle only runs 'kumiko schema' and 'kumiko consumer'.\\n\`,`,
    ");",
    "process.exit(1);",
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
    const looksCallable = entry.callExpression.endsWith(")");
    if (looksCallable !== (typeof exp === "function")) {
      throw new Error(
        `scaffoldApp: ${entry.importPath} export ${entry.exportName} is ${
          typeof exp === "function" ? "" : "not "
        }callable but callExpression "${entry.callExpression}" says otherwise`,
      );
    }
    if (typeof exp === "function") {
      instances.push((exp as (...args: unknown[]) => FeatureDefinition)(...(entry.callArgs ?? [])));
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
