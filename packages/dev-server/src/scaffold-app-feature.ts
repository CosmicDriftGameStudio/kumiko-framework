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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project, SyntaxKind } from "ts-morph";

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

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

export function scaffoldAppFeature(options: ScaffoldAppFeatureOptions): ScaffoldAppFeatureResult {
  if (!KEBAB_RE.test(options.name)) {
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
  const autoMounted = existsSync(runConfigPath)
    ? mountInRunConfig(runConfigPath, options.name)
    : false;

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
// Returns true on success, throws on shape-mismatch (caller swallows the
// scaffolded files but warns).
function mountInRunConfig(runConfigPath: string, name: string): boolean {
  const camel = kebabToCamel(name);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sf = project.addSourceFileAtPath(runConfigPath);

  // Already mounted? short-circuit (idempotent re-runs).
  const existingImport = sf.getImportDeclaration(`./features/${name}`);
  if (existingImport) return true;

  // 1. Prepend import after the last existing import.
  const imports = sf.getImportDeclarations();
  const insertIndex =
    imports.length > 0 ? (imports[imports.length - 1]?.getChildIndex() ?? 0) + 1 : 0;
  sf.insertImportDeclaration(insertIndex, {
    moduleSpecifier: `./features/${name}`,
    namedImports: [`${camel}Feature`],
  });

  // 2. Find `export const APP_FEATURES = [...]` and append the new entry.
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
  arr.addElement(`${camel}Feature`);

  sf.saveSync();
  return true;
}

// Re-export so consumers can hint at the file (e.g. for kumiko-cli output).
export function runConfigPathForApp(appRoot: string): string {
  return join(appRoot, "src", "run-config.ts");
}
