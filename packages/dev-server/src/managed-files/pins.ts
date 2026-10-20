import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

// peerDependencies stay out: libraries declare a lower bound (>=x.y.z) on purpose.
const DEPENDENCY_BLOCKS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

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

/** Errors for Kumiko dependencies of an app: every one exact, and one version per scope. */
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
  for (const [scope, versions] of versionsByScope) {
    if (versions.size > 1) {
      errors.push(
        `package.json: ${scope} packages are pinned to ${versions.size} versions (${[...versions].sort().join(", ")}). Use one version per scope.`,
      );
    }
  }
  return errors;
}
