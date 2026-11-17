import { BUNFIG_FILES, TEST_TIMEOUT_MS } from "@cosmicdrift/kumiko-testing/bunfig";

// The package.json scripts every app exposes, so agents and CI call the same
// names in every repo.
export const STANDARD_APP_SCRIPTS = [
  "dev",
  "build",
  "start",
  "typecheck",
  "lint",
  "check",
  "test",
  "test:unit",
  "test:integration",
  "test:integration:ci",
  "test:dom",
  "test:real",
  "e2e",
  "e2e:real",
  "screenshots",
  "prepare",
] as const;

export type StandardAppScript = (typeof STANDARD_APP_SCRIPTS)[number];

/** Extras every app may carry; they are listed but expected. */
export const KNOWN_EXTRA_APP_SCRIPTS = [
  "test:verbose",
  "test:bunfig",
  "test:lib-coverage",
  "shots",
  "test:build",
] as const;

export type AppScriptsReport = {
  readonly missing: readonly StandardAppScript[];
  readonly knownExtras: readonly string[];
  readonly appExtras: readonly string[];
  readonly testCommandErrors: readonly string[];
};

type TestVariant = keyof typeof BUNFIG_FILES;

// bunfig has no timeout key; only --timeout raises bun's default.
const BUN_DEFAULT_TEST_TIMEOUT_MS = 5000;
const COMMAND_SEPARATOR = /&&|\|\||;|\|/;
const BUN_TEST_SEGMENT = /\bbun\s+(?:--\S+\s+)*test\b/;
const CONFIG_FLAG = /--config[=\s]+(\S+)/;
const TIMEOUT_FLAG = /--timeout[=\s]+(\d+)/;
const INTEGRATION_DELEGATE = "kumiko-testing integration";

function isTestVariant(name: string): name is TestVariant {
  return Object.hasOwn(BUNFIG_FILES, name);
}

function variantOfConfigFile(file: string): TestVariant | undefined {
  for (const [variant, configFile] of Object.entries(BUNFIG_FILES)) {
    if (configFile === file && isTestVariant(variant)) return variant;
  }
  return undefined;
}

function variantOfSegment(segment: string): TestVariant | undefined {
  const config = CONFIG_FLAG.exec(segment)?.[1];
  if (config === undefined) return "unit";
  return variantOfConfigFile(config.replace(/^["']|["']$/g, "").replace(/^\.\//, ""));
}

export function testCommandErrors(scripts: Readonly<Record<string, string>>): string[] {
  const errors: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (name.startsWith("test:integration") && !command.includes(INTEGRATION_DELEGATE)) {
      errors.push(`${name}: must delegate to \`bun ${INTEGRATION_DELEGATE}\``);
    }
    for (const segment of command.split(COMMAND_SEPARATOR)) {
      if (!BUN_TEST_SEGMENT.test(segment)) continue;
      const variant = variantOfSegment(segment);
      if (variant === undefined) continue;
      if (variant === "integration") {
        errors.push(`${name}: run integration tests through \`bun ${INTEGRATION_DELEGATE}\`, not \`bun test\``);
        continue;
      }
      const timeoutFlag = TIMEOUT_FLAG.exec(segment)?.[1];
      const actual = timeoutFlag === undefined ? BUN_DEFAULT_TEST_TIMEOUT_MS : Number(timeoutFlag);
      const expected = TEST_TIMEOUT_MS[variant];
      if (actual !== expected) {
        errors.push(
          `${name}: bun test (${variant}) runs with ${actual} ms; use --timeout=${expected} (TEST_TIMEOUT_MS.${variant})`,
        );
      }
    }
  }
  return errors;
}

export function checkAppScripts(
  scripts: Readonly<Record<string, string>>,
  options: { readonly hasUi: boolean },
): AppScriptsReport {
  const required = STANDARD_APP_SCRIPTS.filter((name) => name !== "test:dom" || options.hasUi);
  const standard = new Set<string>(STANDARD_APP_SCRIPTS);
  const known = new Set<string>(KNOWN_EXTRA_APP_SCRIPTS);
  const extras = Object.keys(scripts).filter((name) => !standard.has(name));
  return {
    missing: required.filter((name) => scripts[name] === undefined),
    knownExtras: extras.filter((name) => known.has(name)),
    appExtras: extras.filter((name) => !known.has(name)),
    testCommandErrors: testCommandErrors(scripts),
  };
}

// The hooks path line every app already carries; HUSKY=0 (CI) skips it.
export const PREPARE_SCRIPT =
  '[ "$HUSKY" = "0" ] || git config core.hooksPath .husky 2>/dev/null || true';
