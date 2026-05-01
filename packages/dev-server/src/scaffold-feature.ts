// scaffoldFeature — generate a fresh feature workspace from a name.
// Used by `yarn kumiko create <name>` and (later) by the Designer when
// a tenant scaffolds a new feature inside their repo. Wraps the
// canonical-form renderer (feature-ast/render.ts) so every freshly
// scaffolded feature is born in canonical Object-Form with the
// schema-version header set.
//
// The generated workspace is intentionally minimal: a single entity
// pattern as a starter, so the user has something to point a "yarn
// kumiko dev" at and immediately see something on screen. Adding more
// patterns is the user's job (or the Designer's / AI's, on top of this
// scaffolding).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type FeaturePattern,
  renderFeatureFile,
  type SourceLocation,
} from "@kumiko/framework/engine";

// =============================================================================
// Public API
// =============================================================================

export type ScaffoldFeatureOptions = {
  /** camelCase feature name. Must be a valid JS identifier. */
  readonly name: string;
  /**
   * Absolute or repo-relative path where the feature workspace gets
   * created. Defaults to `samples/recipes/<kebab-name>/` under the
   * resolved repo root.
   */
  readonly destination?: string;
  /** Repo root used to resolve the default destination. Defaults to cwd. */
  readonly repoRoot?: string;
};

export type ScaffoldFeatureResult = {
  readonly destination: string;
  readonly featureFile: string;
  readonly packageJsonFile: string;
  readonly tsconfigFile: string;
  readonly featureName: string;
  readonly packageName: string;
};

/**
 * Generate a starter feature workspace at `destination`. Throws when
 * the destination already exists — refuses to overwrite. The caller is
 * expected to run `yarn install` afterwards to wire the workspace.
 */
export function scaffoldFeature(options: ScaffoldFeatureOptions): ScaffoldFeatureResult {
  const featureName = validateFeatureName(options.name);
  const repoRoot = options.repoRoot ?? process.cwd();
  const kebab = camelToKebab(featureName);
  const destination = resolve(
    options.destination
      ? resolveDestination(options.destination, repoRoot)
      : join(repoRoot, "samples", "recipes", kebab),
  );

  if (existsSync(destination)) {
    throw new Error(
      `scaffoldFeature: destination already exists at ${destination} — refusing to overwrite`,
    );
  }

  mkdirSync(join(destination, "src"), { recursive: true });

  const packageName = `@kumiko/sample-${kebab}`;
  const packageJson = renderPackageJson(packageName);
  const packageJsonFile = join(destination, "package.json");
  writeFileSync(packageJsonFile, packageJson);

  const tsconfigFile = join(destination, "tsconfig.json");
  writeFileSync(tsconfigFile, renderTsconfig());

  const featureFile = join(destination, "src", "feature.ts");
  const featureSource = renderFeatureFile({
    featureName,
    patterns: starterPatterns(),
  });
  writeFileSync(featureFile, featureSource);

  return {
    destination,
    featureFile,
    packageJsonFile,
    tsconfigFile,
    featureName,
    packageName,
  };
}

// =============================================================================
// Internal — name + path validation
// =============================================================================

const RESERVED_WORDS: ReadonlySet<string> = new Set([
  // Subset of TS reserved words that would be confusing as feature names.
  "default",
  "delete",
  "function",
  "import",
  "export",
  "class",
  "interface",
  "enum",
  "type",
  "module",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "void",
  "null",
  "true",
  "false",
]);

const NAME_RE = /^[a-z][A-Za-z0-9]*$/;

function validateFeatureName(raw: string): string {
  if (!raw) {
    throw new Error("scaffoldFeature: feature name is required");
  }
  if (!NAME_RE.test(raw)) {
    throw new Error(
      `scaffoldFeature: "${raw}" is not a valid feature name — use camelCase starting with a lowercase letter (e.g. "todoList")`,
    );
  }
  if (RESERVED_WORDS.has(raw)) {
    throw new Error(`scaffoldFeature: "${raw}" is a reserved word and cannot be a feature name`);
  }
  return raw;
}

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function resolveDestination(dest: string, repoRoot: string): string {
  // Allow callers to pass either an absolute path or a repo-relative
  // one — keep both ergonomic. `resolve(repoRoot, dest)` is a no-op for
  // absolute paths.
  return resolve(repoRoot, dest);
}

// =============================================================================
// Internal — content generators
// =============================================================================

function renderPackageJson(packageName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      description: "Kumiko sample feature — scaffolded by `yarn kumiko create`",
      private: true,
      dependencies: {
        "@kumiko/framework": "workspace:*",
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Standard tsconfig matching the rest of the sample workspaces:
 * strict, ESNext, bundler-resolution, no-emit. Without this file
 * `yarn install + tsc` immediately complains about missing config —
 * scaffolded features should compile cleanly out of the box.
 */
function renderTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noUncheckedIndexedAccess: true,
        noPropertyAccessFromIndexSignature: true,
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
      include: ["src/**/*"],
    },
    null,
    2,
  )}\n`;
}

// Synthetic SourceLocation — the renderer reads `.raw` only for opaque
// (closure-bearing) bodies. Static patterns like `entity` don't touch
// `source.raw` at render-time, so an empty placeholder is fine.
const SYNTHETIC_LOC: SourceLocation = {
  file: "<scaffold>",
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
  raw: "",
};

function starterPatterns(): readonly FeaturePattern[] {
  // One entity, one field. Smallest interesting output: parses, renders,
  // can be `yarn kumiko dev`'d, and gives the user something to extend.
  return [
    {
      kind: "entity",
      source: SYNTHETIC_LOC,
      entityName: "item",
      definition: {
        fields: {
          title: { type: "text", required: true },
        },
      },
    },
  ];
}
