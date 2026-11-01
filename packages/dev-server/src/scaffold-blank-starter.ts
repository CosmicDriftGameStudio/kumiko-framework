// The `blank` starter of scaffoldApp: no demo feature and no admin password in the env. The
// person who creates the app is seeded from KUMIKO_BOOTSTRAP_ADMIN_EMAIL and sets a password
// through "forgot password".

import {
  deriveTenantId,
  renderAdminAuthBlock,
  renderSortedImports,
} from "./scaffold-render-helpers.ts";

export const SCAFFOLD_STARTERS = ["demo", "blank"] as const;
export type ScaffoldStarter = (typeof SCAFFOLD_STARTERS)[number];

// Delivery is what the `mail` boot option sends through.
export const BLANK_STARTER_DELIVERY_FEATURE = {
  name: "delivery",
  importPath: "@cosmicdrift/kumiko-bundled-features/delivery",
  exportName: "createDeliveryFeature",
  callExpression: "createDeliveryFeature()",
} as const;

export function renderBlankEnvSchema(): string {
  const imports = renderSortedImports([
    { specifier: "@cosmicdrift/kumiko-dev-server/env-schema", names: ["frameworkCoreEnvSchema"] },
    { specifier: "@cosmicdrift/kumiko-framework/config", names: ["allAppFeatures"] },
    { specifier: "@cosmicdrift/kumiko-framework/env", names: ["composeEnvSchema"] },
  ]);
  return `// Env contract of the production processes (bin/main.ts, bin/kumiko.ts).
// Importing it must not read process.env; validation happens in runProdApp.
// KUMIKO_BOOTSTRAP_ADMIN_EMAIL joins the schema through the seeds option in bin/main.ts.

${imports}
import appConfig from "../kumiko.config";

export const envSchema = composeEnvSchema({
  core: frameworkCoreEnvSchema,
  features: allAppFeatures(appConfig),
});
`;
}

export function renderBlankMain(appName: string): string {
  const imports = renderSortedImports([
    { specifier: "@cosmicdrift/kumiko-server-runtime", names: ["runProdApp"] },
    { specifier: "@cosmicdrift/kumiko-framework/engine", names: ["TenantId"], typeOnly: true },
    {
      specifier: "@cosmicdrift/kumiko-framework/crypto",
      names: ["requireKmsWiring", "resolveKmsWiring"],
    },
    {
      specifier: "@cosmicdrift/kumiko-bundled-features/auth-email-password",
      names: ["DEFAULT_AUTH_PATHS"],
    },
    { specifier: "../src/run-config", names: ["APP_FEATURES"] },
    { specifier: "../kumiko.config", names: [], defaultName: "appConfig" },
    { specifier: "./env-schema", names: ["envSchema"] },
  ]);
  return `// Production-bootstrap. KUMIKO_DRY_RUN_ENV=boot exits after
// composeFeatures + validateBoot + createRegistry without DB/Redis-connect
// (see @cosmicdrift/kumiko-server-runtime runProdApp).

${imports}

const DEFAULT_TENANT_ID = "${deriveTenantId(appName)}" as TenantId;

const kmsOpts = {
  logPrefix: "[${appName}]",
  plaintextReason:
    "no PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL / KUMIKO_BLIND_INDEX_KEY set — see .env.example",
} as const;

const kmsWiring =
  process.env["NODE_ENV"] === "production"
    ? requireKmsWiring(process.env, kmsOpts)
    : resolveKmsWiring(process.env, kmsOpts);

// The bootstrap admin has no password; password reset is the only way it gets one. Without SMTP
// and APP_BASE_URL (local boot) the mail flow stays off and the app still boots.
const appBaseUrl = process.env["APP_BASE_URL"];
const mailAppUrl = process.env["SMTP_HOST"] && appBaseUrl ? appBaseUrl : undefined;

await runProdApp({
  features: APP_FEATURES,
  ...(appConfig.validateBootOptions && { validateBootOptions: appConfig.validateBootOptions }),
  ...(appConfig.rowLevelSecurity && { rowLevelSecurity: appConfig.rowLevelSecurity }),
  envSchema,
  staticDir: "./dist",
  ...kmsWiring,
  ...(mailAppUrl !== undefined && { mail: { transport: "smtp-env" } }),
  auth: {
    ...(mailAppUrl !== undefined && {
      passwordReset: { appUrl: \`\${mailAppUrl}\${DEFAULT_AUTH_PATHS.resetPassword}\` },
    }),
  },
  seeds: {
    bootstrapAdminFromEnv: {
      tenant: { id: DEFAULT_TENANT_ID, key: "${appName}", name: "${appName}" },
    },
  },
});
`;
}

export function renderBlankServer(appName: string): string {
  const imports = renderSortedImports([
    { specifier: "@cosmicdrift/kumiko-dev-server", names: ["runDevApp"] },
    { specifier: "@cosmicdrift/kumiko-framework/engine", names: ["TenantId"], typeOnly: true },
    { specifier: "../src/run-config", names: ["APP_FEATURES"] },
    { specifier: "../kumiko.config", names: [], defaultName: "appConfig" },
  ]);
  const authBlock = renderAdminAuthBlock(appName, [
    'password: "changeme",',
    'displayName: "Admin",',
  ]);
  return `// Dev bootstrap. \`bun --watch bin/server.ts\` (see package.json scripts.dev)
// starts a full-featured dev server with auto-reload on code changes.
// setupTestStack creates missing entity tables automatically — a new
// r.entity(...) in a feature becomes a CREATE TABLE on the next reboot,
// no manual \`kumiko schema apply\` needed (that's prod-only).
// Persistent DB via KUMIKO_DEV_DB_NAME (.env) so admin + data survive reboots.
// The local admin below is dev-only: no mail runs locally, so there is no password reset.

${imports}

const DEFAULT_TENANT_ID = "${deriveTenantId(appName)}" as TenantId;

await runDevApp({
  features: APP_FEATURES,
  ...(appConfig.validateBootOptions && { validateBootOptions: appConfig.validateBootOptions }),
  welcomeBanner: true,
  clientEntry: "./src/client.tsx",
${authBlock}
});
`;
}

export const BLANK_ENV_EXAMPLE_ADMIN_BLOCK = `# KUMIKO_BOOTSTRAP_ADMIN_EMAIL: login of the person who created the app. The first prod
# boot makes it the admin WITHOUT a password; set one via "forgot password". That needs
# SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM) and APP_BASE_URL (e.g.
# https://app.example.com); without them the reset mail flow stays off.
# KUMIKO_BOOTSTRAP_ADMIN_EMAIL=
# SMTP_HOST=
# APP_BASE_URL=
`;

export type ReadmeCopy = {
  readonly intro: string;
  readonly runConfigNote: string;
  readonly devLogin: string;
  readonly bootEnvNote: string;
  readonly prodSeed: string;
  readonly demoArchitectureLines: string;
};

export function blankReadmeCopy(appName: string): ReadmeCopy {
  return {
    intro:
      "Scaffolded by `kumiko new app --blank`. An empty app with login, tenants and sessions.\nAdd features via `bunx @cosmicdrift/kumiko-cli add feature <name>`.",
    runConfigNote: "Edit `src/run-config.ts` to add bundled features.",
    devLogin: `The welcome banner prints the URL (default \`http://localhost:4173\`) and the local\ndev login \`admin@${appName}.local\` / \`changeme\` (dev server only).`,
    bootEnvNote: "a missing one exits 0 without validating the wiring.",
    prodSeed:
      'The first prod boot makes `KUMIKO_BOOTSTRAP_ADMIN_EMAIL` the admin of the app, without a\npassword. Open the app, choose "forgot password" and set one through the mail link. That\nneeds `SMTP_HOST` (+ `SMTP_*`) and `APP_BASE_URL`; without them nobody can set a password.\nWhile the variable is unset, nobody is seeded.',
    demoArchitectureLines: "",
  };
}
