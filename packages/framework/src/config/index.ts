// The app's single config file (kumiko.config.ts). Type-only imports keep it
// loadable by tooling (kumiko check, agent lint, port registry) without
// pulling the engine runtime.

import type { BundledListsOptions } from "@cosmicdrift/kumiko-types/screen";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { ROW_LEVEL_SECURITY_MODES, type RowLevelSecurityMode } from "../db/render-rls-ddl.ts";
import type { ValidateBootOptions } from "../engine/boot-validator.ts";
import type { FeatureDefinition } from "../engine/types/index.ts";
import type { AppClientConfig, AppPortEntry } from "./internals.ts";

export type AppInfraPorts = {
  readonly postgres?: number;
  readonly redis?: number;
  readonly meilisearch?: number;
  /** S3 mock (MinIO) used by integration and E2E runs. */
  readonly s3?: number;
};

export type AppPorts = {
  /** `bun run dev` listens here. */
  readonly dev: number;
  /** The E2E server (playwright.config.ts webServer) listens here. */
  readonly e2e: number;
  /** Local infrastructure of this app. One port per app, so parallel E2E runs
   *  of several apps never share a Meilisearch or Postgres. */
  readonly infra?: AppInfraPorts;
};
/** The boot-validator options an app owns; `env` and the cipher are injected by the runners. */
export type AppValidateBootOptions = Pick<
  ValidateBootOptions,
  | "navAllowlist"
  | "navAllowlistExempt"
  | "requiredLocales"
  | "requireFieldValueTranslations"
  | "warnOnUniqueAccessRoles"
>;

/** Settings of `kumiko api-docs`, the generator for the HTTP API developer docs. */
export type AppApiDocsConfig = {
  /** Locales of the generated pages; default en. */
  readonly locales?: readonly string[];
  readonly outDir?: string;
  /** Host that the curl examples and the OpenAPI `servers` entry point to. */
  readonly baseUrl?: string;
  readonly appName?: string;
  /** One paragraph per locale, appended to the tokens page (plan or tier limits). */
  readonly planNote?: Readonly<Record<string, string>>;
  /** Writes triggered by screens that are deliberately not reachable with an API token. `pattern` is a QN or a glob ending in `*`. */
  readonly uiOnlyWrites?: readonly { readonly pattern: string; readonly reason: string }[];
  /** Paragraph overrides per locale and text key; the page structure stays fixed. */
  readonly texts?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Directory of recorded request/response examples; default `api-examples`. */
  readonly examplesDir?: string;
};

export type AppConfig = {
  /** Features mounted in every environment: dev, tests, prod. */
  readonly features: readonly FeatureDefinition[];
  /** Features mounted only in production on top of `features`. */
  readonly prodFeatures?: readonly FeatureDefinition[];
  /** Whether the app boots with the bundled auth features (config/user/tenant/auth-email-password)
   *  that composeFeatures adds; the schema tooling needs their tables. Unset: derived from the
   *  feature list. */
  readonly includeBundled?: boolean;
  readonly client: AppClientConfig;
  readonly ports: AppPorts;
  /** Passed to validateBoot by `kumiko check` and, via the app's bin files, by the runners. */
  readonly validateBootOptions?: AppValidateBootOptions;
  /** One table block for every list of the bundled features. kumiko/schema.ts passes it to composeFeatures; the app's bin files pass it to the runners, like validateBootOptions. */
  readonly bundledLists?: BundledListsOptions;
  /** "on" enforces tenant isolation in Postgres via row level security; schema tooling and every runner read this one value. Default "on". */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
  readonly apiDocs?: AppApiDocsConfig;
};

export const APP_CONFIG_FILE = "kumiko.config.ts";

const INFRA_PORT_NAMES = [
  "postgres",
  "redis",
  "meilisearch",
  "s3",
] as const satisfies readonly (keyof AppInfraPorts)[];

export type AppPortRole = "dev" | "e2e" | (typeof INFRA_PORT_NAMES)[number];

/** Every port the app claims, in a stable order. */
export function listAppPorts(ports: AppPorts): readonly AppPortEntry[] {
  const entries: AppPortEntry[] = [
    { role: "dev", port: ports.dev },
    { role: "e2e", port: ports.e2e },
  ];
  for (const role of INFRA_PORT_NAMES) {
    const port = ports.infra?.[role];
    if (port !== undefined) entries.push({ role, port });
  }
  return entries;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Problems with the declared ports: out of range or claimed twice by this app. */
export function findAppPortProblems(ports: AppPorts): readonly string[] {
  const problems: string[] = [];
  const owners = new Map<number, AppPortRole>();
  for (const { role, port } of listAppPorts(ports)) {
    if (!isValidPort(port)) {
      problems.push(`ports.${role} must be an integer in 1..65535, got ${port}`);
      continue;
    }
    const owner = owners.get(port);
    if (owner !== undefined) problems.push(`ports.${role} reuses port ${port} of ports.${owner}`);
    else owners.set(port, role);
  }
  return problems;
}

// Entries end up in the server's bundle list and in generated files, so only
// plain relative paths inside the app are accepted.
const CLIENT_ENTRY_RE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./-]+\.(ts|tsx)$/;

/** Problems with the declared `apiDocs` block: empty or duplicate locales, a `uiOnlyWrites` entry without reason. */
export function findApiDocsConfigProblems(apiDocs: AppApiDocsConfig): readonly string[] {
  const problems: string[] = [];
  const { locales, uiOnlyWrites } = apiDocs;
  if (locales !== undefined) {
    if (locales.length === 0) problems.push("apiDocs.locales must not be empty");
    if (new Set(locales).size !== locales.length) {
      problems.push("apiDocs.locales must not contain duplicates");
    }
  }
  for (const entry of uiOnlyWrites ?? []) {
    if (entry.pattern.trim() === "")
      problems.push("apiDocs.uiOnlyWrites: pattern must not be empty");
    if (entry.reason.trim() === "") {
      problems.push(`apiDocs.uiOnlyWrites: "${entry.pattern}" needs a non-empty reason`);
    }
  }
  return problems;
}

export function defineAppConfig(config: AppConfig): AppConfig {
  const problems = [
    ...findAppPortProblems(config.ports),
    ...(config.apiDocs ? findApiDocsConfigProblems(config.apiDocs) : []),
  ];
  if (config.client.entries.length === 0)
    problems.push("client.entries must name at least one entry");
  for (const entry of config.client.entries) {
    if (!CLIENT_ENTRY_RE.test(entry)) {
      problems.push(`client.entries: "${entry}" must be a relative .ts/.tsx path inside the app`);
    }
  }
  if (
    config.rowLevelSecurity !== undefined &&
    !isOneOf(ROW_LEVEL_SECURITY_MODES, config.rowLevelSecurity)
  ) {
    problems.push(
      `rowLevelSecurity must be one of ${ROW_LEVEL_SECURITY_MODES.join(", ")}, got ${String(config.rowLevelSecurity)}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(`defineAppConfig: ${problems.join("; ")}`);
  }
  return config;
}

/**
 * Raw `features` plus `prodFeatures`, without the bundled foundation: the runners compose it,
 * tooling such as `runSchemaCli` takes `FEATURES` from `kumiko/schema`.
 */
export function allAppFeatures(
  config: Pick<AppConfig, "features" | "prodFeatures">,
): readonly FeatureDefinition[] {
  return [...config.features, ...(config.prodFeatures ?? [])];
}
