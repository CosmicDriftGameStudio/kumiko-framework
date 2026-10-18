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
] as const;

export type AppScriptsReport = {
  readonly missing: readonly StandardAppScript[];
  readonly knownExtras: readonly string[];
  readonly appExtras: readonly string[];
};

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
  };
}

// The hooks path line every app already carries; HUSKY=0 (CI) skips it.
export const PREPARE_SCRIPT =
  '[ "$HUSKY" = "0" ] || git config core.hooksPath .husky 2>/dev/null || true';
