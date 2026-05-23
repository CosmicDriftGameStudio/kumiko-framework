// scaffoldApp — generate a runnable Kumiko app workspace from a name.
//
// Used by `kumiko new app <name>`. Produces the minimal app shape that
// `KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts` runs successfully against:
// run-config with 5 foundation features, bin/main.ts with auth-admin
// stub, package.json with @cosmicdrift/* deps, tsconfig, .env.example,
// README.
//
// Intentionally NOT included in DX-1.0:
// - drizzle/ setup (DX-1.1 — needs FEATURE_IMPORT_REGISTRY decision from DX-4)
// - deploy/Dockerfile (already covered by scaffoldDeploy — separate cmd)
// - first feature scaffold (use scaffoldFeature after this)
//
// The generated app is born "boots cleanly, mounts nothing fancy". User
// runs `kumiko add feature` (DX-2) or hand-edits src/run-config.ts to grow.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

function renderRunConfig(): string {
  return `// Single source of truth für die Feature-Komposition deiner App.
// Bundled-Foundation: secrets + sessions. config/user/tenant/auth-email-password
// werden via composeFeatures(includeBundled:true) automatisch ergänzt
// wenn runProdApp mit \`auth: {…}\` aufgerufen wird (siehe bin/main.ts).
//
// Neue features hinzufügen:
//   - bunx kumiko add feature <name>  (DX-2, automatisch)
//   - oder: hand-edit + import unten ergänzen

import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";

export const APP_FEATURES = [
  createSecretsFeature(),
  createSessionsFeature(),
] as const;
`;
}

function renderMain(appName: string): string {
  // Deterministic tenant-UUID derived from appName for the seed-admin
  // membership. Reproducible across boots; tenants table sees the same
  // ID. Format: 8-4-4-4-12 hex chars, version-4 marker at position 14.
  // We hash the name into the digits using a tiny PRNG so two apps
  // get different IDs without bun's crypto dependency.
  const tenantId = deriveTenantId(appName);
  return `// Production-bootstrap. KUMIKO_DRY_RUN_ENV=boot exits after
// composeFeatures + validateBoot + createRegistry without DB/Redis-connect
// (siehe @cosmicdrift/kumiko-dev-server runProdApp). Echter Dev-Boot
// passiert via \`bunx kumiko dev\` mit Docker-stack — DX-1.0 deckt nur
// den boot-mode-Pfad ab; \`kumiko dev\` kommt in einer späteren DX-Phase.

import { frameworkCoreEnvSchema, runProdApp } from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { APP_FEATURES } from "../src/run-config";

const DEFAULT_TENANT_ID = "${tenantId}" as TenantId;

const envSchema = composeEnvSchema({
  core: frameworkCoreEnvSchema,
  features: APP_FEATURES,
});

await runProdApp({
  features: APP_FEATURES,
  envSchema,
  migrations: false,
  auth: {
    admin: {
      email: "admin@${appName}.local",
      password: "change-me-on-first-deploy",
      displayName: "Admin",
      memberships: [
        {
          tenantId: DEFAULT_TENANT_ID,
          tenantKey: "${appName}",
          tenantName: "${appName}",
          roles: ["TenantAdmin"],
        },
      ],
    },
  },
});
`;
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
  // Tiny xorshift PRNG seeded from the name's char-codes. Same name →
  // same ID. Sufficient for "give every scaffolded app a deterministic
  // default tenant" — production sets its own via the create-tenant
  // flow anyway.
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
  // version-4 marker at first char of 3rd group:
  state ^= state >>> 17;
  state >>>= 0;
  const c = `4${hex(state, 3)}`;
  // RFC 4122 variant: 10xx (set top two bits of 4th group to 10):
  state ^= state << 5;
  state >>>= 0;
  const d4 = (0x8 | (state & 0x3)).toString(16);
  const d = `${d4}${hex(state >>> 4, 3)}`;
  state = Math.imul(state, 16777619) >>> 0;
  const e = hex(state, 12);
  return `${a}-${b}-${c}-${d}-${e}`;
}
