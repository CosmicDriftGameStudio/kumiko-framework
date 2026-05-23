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

export type ScaffoldAppOptions = {
  /** kebab-case app name (e.g. "my-shop"). Becomes package-name + folder. */
  readonly name: string;
  /** Absolute or cwd-relative target dir. Default: <cwd>/<name>. */
  readonly destination?: string;
  /** npm-version-pin for @cosmicdrift/* deps. Default "*" for latest. */
  readonly frameworkVersion?: string;
};

export type ScaffoldAppResult = {
  readonly destination: string;
  readonly files: readonly string[];
  readonly appName: string;
};

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

export function scaffoldApp(options: ScaffoldAppOptions): ScaffoldAppResult {
  if (!KEBAB_RE.test(options.name)) {
    throw new Error(`scaffoldApp: name must be kebab-case (a-z, 0-9, -); got "${options.name}"`);
  }
  const cwd = process.cwd();
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

  write(join(destination, "src", "run-config.ts"), renderRunConfig());
  files.push("src/run-config.ts");

  write(join(destination, "bin", "main.ts"), renderMain(options.name));
  files.push("bin/main.ts");

  write(join(destination, ".env.example"), renderEnvExample());
  files.push(".env.example");

  write(join(destination, "README.md"), renderReadme(options.name));
  files.push("README.md");

  return { destination, files, appName: options.name };
}

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
        boot: "KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts",
        check: "tsc --noEmit",
      },
      dependencies: {
        "@cosmicdrift/kumiko-bundled-features": version,
        "@cosmicdrift/kumiko-dev-server": version,
        "@cosmicdrift/kumiko-framework": version,
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

function renderRunConfig(): string {
  const project = newTsProject();
  const sf = project.createSourceFile("run-config.ts", "");

  sf.addImportDeclaration({
    moduleSpecifier: "@cosmicdrift/kumiko-bundled-features/secrets",
    namedImports: ["createSecretsFeature"],
  });
  sf.addImportDeclaration({
    moduleSpecifier: "@cosmicdrift/kumiko-bundled-features/sessions",
    namedImports: ["createSessionsFeature"],
  });

  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    isExported: true,
    declarations: [
      {
        name: "APP_FEATURES",
        initializer: "[createSecretsFeature(), createSessionsFeature()] as const",
      },
    ],
  });

  sf.insertText(
    0,
    [
      "// Single source of truth für die Feature-Komposition deiner App.",
      "// Bundled-Foundation: secrets + sessions. config/user/tenant/auth-email-password",
      "// werden via composeFeatures(includeBundled:true) automatisch ergänzt",
      "// wenn runProdApp mit `auth: {…}` aufgerufen wird (siehe bin/main.ts).",
      "//",
      "// Neue features hinzufügen:",
      "//   - bunx kumiko add feature <name>  (DX-2, automatisch)",
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
    namedImports: ["frameworkCoreEnvSchema", "runProdApp"],
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

  sf.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "envSchema",
        initializer: "composeEnvSchema({ core: frameworkCoreEnvSchema, features: APP_FEATURES })",
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
      "// passiert via `bunx kumiko dev` mit Docker-stack — DX-1.0 deckt nur",
      "// den boot-mode-Pfad ab; `kumiko dev` kommt in einer späteren DX-Phase.",
      "",
      "",
    ].join("\n"),
  );

  return sf.getFullText();
}

function renderEnvExample(): string {
  return `# Required env-vars für boot-mode + dev. Production: über Pulumi/k8s-Secrets.
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app
REDIS_URL=redis://127.0.0.1:6379

# JWT_SECRET: min 32 chars. Generate with: openssl rand -base64 32
JWT_SECRET=change-me-min-32-chars-change-me-min-32

# KUMIKO_SECRETS_MASTER_KEY_V1: base64-encoded 32 bytes (AES-256 KEK).
# Generate with: openssl rand -base64 32
KUMIKO_SECRETS_MASTER_KEY_V1=
`;
}

function renderReadme(appName: string): string {
  return `# ${appName}

Scaffolded by \`kumiko new app\`. Boots out-of-the-box with secrets + sessions
mounted (foundation set). Add features with \`bunx kumiko add feature <name>\`.

## First boot

\`\`\`sh
yarn install
cp .env.example .env
# edit .env — set JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1
bun run boot
\`\`\`

Expected: \`[runProdApp] boot validation OK (… features, … registry entries)\` + exit 0.

## Adding features

\`\`\`sh
bunx kumiko add feature my-domain
# → editiert src/run-config.ts automatisch + scaffolded src/features/my-domain/
\`\`\`

## Architecture

- \`src/run-config.ts\` — single source of truth: which features your app mounts.
- \`bin/main.ts\` — production-bootstrap. Reads env, mounts features, starts server.

For full docs see https://docs.kumiko.so.
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
