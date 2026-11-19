import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

// peerDependencies stay out: libraries declare a lower bound (>=x.y.z) on purpose.
const DEPENDENCY_BLOCKS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

const OVERRIDE_BLOCKS = ["overrides", "resolutions"] as const;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

type PinScope = "@cosmicdrift" | "@cosmicdriftgamestudio";

function pinScopeOf(name: string): PinScope | undefined {
  if (name === "create-kumiko-app" || name.startsWith("@cosmicdrift/kumiko-")) {
    return "@cosmicdrift";
  }
  if (name.startsWith("@cosmicdriftgamestudio/kumiko-")) return "@cosmicdriftgamestudio";
  return undefined;
}

function dependencyEntries(block: unknown): readonly [string, string][] {
  if (!isPlainObject(block)) return [];
  return Object.entries(block).flatMap(([name, spec]): [string, string][] =>
    typeof spec === "string" ? [[name, spec]] : [],
  );
}

function overrideNames(block: unknown): readonly string[] {
  return isPlainObject(block) ? Object.keys(block) : [];
}

/** Errors for Kumiko dependencies of an app: every one exact, one version per scope, and no override of them. */
export function findKumikoPinErrors(packageJson: unknown): readonly string[] {
  const errors: string[] = [];
  const versionsByScope = new Map<PinScope, Set<string>>();
  for (const blockName of DEPENDENCY_BLOCKS) {
    const block = propertyOf(packageJson, blockName);
    for (const [name, spec] of dependencyEntries(block)) {
      const scope = pinScopeOf(name);
      if (scope === undefined || spec.startsWith("workspace:")) continue;
      if (!EXACT_VERSION.test(spec)) {
        errors.push(
          `package.json#${blockName}: ${name}@${spec} is not an exact version. Pin it without ^ or ~ (kumiko-upgrade --apply rewrites the pins).`,
        );
        continue;
      }
      const versions = versionsByScope.get(scope) ?? new Set<string>();
      versions.add(spec);
      versionsByScope.set(scope, versions);
    }
  }
  for (const blockName of OVERRIDE_BLOCKS) {
    for (const name of overrideNames(propertyOf(packageJson, blockName))) {
      if (pinScopeOf(name) === undefined) continue;
      errors.push(
        `package.json#${blockName}: ${name} is overridden. Kumiko packages pin each other exactly, so the override only hides a drift; remove it and pin the dependency directly.`,
      );
    }
  }
  for (const [scope, versions] of versionsByScope) {
    if (versions.size > 1) {
      errors.push(
        `package.json: ${scope} packages are pinned to ${versions.size} versions (${[...versions].sort().join(", ")}). Use one version per scope.`,
      );
    }
  }
  return errors;
}
