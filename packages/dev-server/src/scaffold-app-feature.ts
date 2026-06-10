// scaffoldAppFeature — DX-2. Scaffolds a fresh feature inside an
// existing Kumiko-app workspace + auto-mounts it in src/run-config.ts.
//
// Sister to `scaffoldFeature` (which targets samples/recipes/ for the
// framework workspace). This one targets `src/features/<name>/` of an
// already-scaffolded app (output of `kumiko new app`).
//
// Auto-mount via ts-morph: opens src/run-config.ts, finds
// `export const APP_FEATURES = [...]`, prepends import + appends entry.
// User's promise "defineFeature → nichts woanders eintragen" is met
// for the run-config side. Drizzle FEATURE_IMPORT_REGISTRY is NOT
// touched here — DX-4 auto-discovery resolves that.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import { isKebabSegment } from "./kebab";

export type ScaffoldAppFeatureOptions = {
  /** kebab-case feature name (e.g. "product-catalog"). */
  readonly name: string;
  /** App workspace root. Defaults to cwd. */
  readonly appRoot?: string;
};

export type ScaffoldAppFeatureResult = {
  readonly featureName: string;
  readonly featureDir: string;
  readonly files: readonly string[];
  /** Whether src/run-config.ts was auto-mounted. False if run-config
   *  is missing — caller gets the scaffolded files but must hand-mount. */
  readonly autoMounted: boolean;
};

export function scaffoldAppFeature(options: ScaffoldAppFeatureOptions): ScaffoldAppFeatureResult {
  // Segment-strict guard: a trailing/double hyphen (`product-`, `foo--bar`)
  // would make kebabToCamel produce an invalid identifier.
  if (!isKebabSegment(options.name)) {
    throw new Error(
      `scaffoldAppFeature: name must be kebab-case (a-z, 0-9, -); got "${options.name}"`,
    );
  }
  const appRoot = resolve(options.appRoot ?? process.cwd());
  const featureDir = join(appRoot, "src", "features", options.name);
  if (existsSync(featureDir)) {
    throw new Error(`scaffoldAppFeature: ${featureDir} already exists — refusing to overwrite`);
  }
  mkdirSync(featureDir, { recursive: true });

  const files: string[] = [];
  const featureFile = join(featureDir, "feature.ts");
  writeFileSync(featureFile, renderFeature(options.name));
  files.push(`src/features/${options.name}/feature.ts`);

  const indexFile = join(featureDir, "index.ts");
  writeFileSync(indexFile, renderIndex(options.name));
  files.push(`src/features/${options.name}/index.ts`);

  const runConfigPath = join(appRoot, "src", "run-config.ts");
  let autoMounted = false;
  if (existsSync(runConfigPath)) {
    try {
      autoMounted = mountInRunConfig(runConfigPath, options.name);
    } catch (err) {
      // Roll back the freshly-written feature dir so a re-run isn't blocked
      // by this function's own "already exists" guard. Without this, a
      // shape-mismatch in run-config leaves feature.ts + index.ts on disk and
      // the user is stuck having to hand-delete before retrying.
      rmSync(featureDir, { recursive: true, force: true });
      throw err;
    }
  }

  return {
    featureName: options.name,
    featureDir,
    files,
    autoMounted,
  };
}

function renderFeature(name: string): string {
  const camel = kebabToCamel(name);
  return `// ${name} feature — scaffolded by \`kumiko add feature\`. Edit freely.
//
// Doc-Pointer: https://docs.kumiko.rocks/en/patterns/ for the \`r.*\` API
// (r.entity, r.writeHandler, r.queryHandler, hooks, …).

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const ${camel}Feature = defineFeature("${name}", (r) => {
  // Starter: declare an entity. Drop and replace with your domain.
  r.entity("${name}-item", {
    fields: {
      title: { type: "text", required: true },
    },
  });
});
`;
}

function renderIndex(name: string): string {
  const camel = kebabToCamel(name);
  return `export { ${camel}Feature } from "./feature";\n`;
}

function kebabToCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

// ts-morph: open run-config, prepend import, append APP_FEATURES entry.
// Returns true on success, throws on shape-mismatch — the caller rolls back
// the scaffolded feature dir and re-throws so a re-run isn't blocked.
function mountInRunConfig(runConfigPath: string, name: string): boolean {
  const camel = kebabToCamel(name);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sf = project.addSourceFileAtPath(runConfigPath);

  // Import and APP_FEATURES entry are checked independently so a half-applied
  // state self-heals: if the import exists but the entry was hand-removed (or
  // vice versa), re-running adds only the missing half instead of short-
  // circuiting on the import alone and leaving the feature unmounted.
  let changed = false;

  // 1. Prepend import after the last existing import — only if absent.
  if (!sf.getImportDeclaration(`./features/${name}`)) {
    const imports = sf.getImportDeclarations();
    const insertIndex =
      imports.length > 0 ? (imports[imports.length - 1]?.getChildIndex() ?? 0) + 1 : 0;
    sf.insertImportDeclaration(insertIndex, {
      moduleSpecifier: `./features/${name}`,
      namedImports: [`${camel}Feature`],
    });
    changed = true;
  }

  // 2. Find `export const APP_FEATURES = [...]` and append the entry — only if absent.
  const appFeaturesDecl = sf.getVariableDeclaration("APP_FEATURES");
  if (!appFeaturesDecl) {
    throw new Error(
      `mountInRunConfig: ${runConfigPath} has no 'APP_FEATURES' declaration — ` +
        `cannot auto-mount. Hand-edit: add '${camel}Feature' to APP_FEATURES.`,
    );
  }
  const initializer =
    appFeaturesDecl.getInitializerIfKind(SyntaxKind.AsExpression) ??
    appFeaturesDecl.getInitializer();
  if (!initializer) {
    throw new Error(`mountInRunConfig: APP_FEATURES has no initializer — cannot auto-mount.`);
  }
  // Strip `as const` wrapper if present.
  const arr =
    initializer.getKind() === SyntaxKind.AsExpression
      ? initializer.getFirstChildByKind(SyntaxKind.ArrayLiteralExpression)
      : initializer.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!arr) {
    throw new Error(`mountInRunConfig: APP_FEATURES is not an array literal — cannot auto-mount.`);
  }
  const alreadyListed = arr.getElements().some((el) => el.getText() === `${camel}Feature`);
  if (!alreadyListed) {
    arr.addElement(`${camel}Feature`);
    changed = true;
  }

  if (changed) sf.saveSync();
  return true;
}

// Re-export so consumers can hint at the file (e.g. for kumiko-cli output).
export function runConfigPathForApp(appRoot: string): string {
  return join(appRoot, "src", "run-config.ts");
}
