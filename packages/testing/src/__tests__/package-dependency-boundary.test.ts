import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ts } from "ts-morph";
import * as z from "zod";

const TESTING_PACKAGE_NAME = "@cosmicdrift/kumiko-testing";
const INJECTED_PACKAGES = [
  "@cosmicdrift/kumiko-bundled-features",
  "@cosmicdrift/kumiko-dev-server",
] as const;

const packageRoot = resolve(import.meta.dir, "..", "..");
const repoPackagesDir = resolve(packageRoot, "..");
const sourceRoot = join(packageRoot, "src");

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
  peerDependencies: z.record(z.string(), z.string()),
  exports: z.record(z.string(), z.object({ default: z.string() })),
});
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
);

const CORE_ENTRY_KEYS = Object.keys(manifest.exports).filter(
  (key) =>
    key === "./stack" ||
    key === "./helpers" ||
    key.startsWith("./helpers/") ||
    key.startsWith("./preload/") ||
    key === "./bunfig" ||
    key === "./integration-runner",
);

function isCoreSubpath(subpath: string): boolean {
  return CORE_ENTRY_KEYS.includes(`./${subpath}`);
}

// The pre-processor scanner covers static, re-export, dynamic and type-level imports without
// building an AST; a full ts-morph walk over every consumer test file is too slow for the suite.
function importSpecifiersOf(absolutePath: string): string[] {
  const { importedFiles } = ts.preProcessFile(readFileSync(absolutePath, "utf8"), true, true);
  return importedFiles.map((reference) => reference.fileName);
}

function resolveRelativeSource(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  const withoutJsExtension = base.replace(/\.js$/, "");
  const candidates = [
    base,
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ];
  return candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
}

function selfSubpathOf(specifier: string): string | undefined {
  if (specifier === TESTING_PACKAGE_NAME) return "";
  return specifier.startsWith(`${TESTING_PACKAGE_NAME}/`)
    ? specifier.slice(TESTING_PACKAGE_NAME.length + 1)
    : undefined;
}

function isInjectedPackageSpecifier(specifier: string): boolean {
  return INJECTED_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function entryFiles(keys: readonly string[]): string[] {
  return keys.map((key) => join(packageRoot, manifest.exports[key]?.default ?? ""));
}

function collectImportGraph(keys: readonly string[]): { files: Set<string>; violations: string[] } {
  const files = new Set<string>();
  const violations: string[] = [];
  const queue = entryFiles(keys);

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    for (const specifier of importSpecifiersOf(file)) {
      if (isInjectedPackageSpecifier(specifier)) {
        violations.push(`${relative(packageRoot, file)} imports ${specifier}`);
        continue;
      }
      const selfSubpath = selfSubpathOf(specifier);
      if (selfSubpath !== undefined) {
        const target = manifest.exports[selfSubpath === "" ? "." : `./${selfSubpath}`];
        if (target === undefined) {
          violations.push(`${relative(packageRoot, file)} imports unknown ${specifier}`);
          continue;
        }
        queue.push(join(packageRoot, target.default));
        continue;
      }
      if (specifier.startsWith(".")) {
        const target = resolveRelativeSource(file, specifier);
        if (target === undefined) {
          violations.push(`${relative(packageRoot, file)} imports unresolvable ${specifier}`);
          continue;
        }
        queue.push(target);
      }
    }
  }
  return { files, violations };
}

describe("kumiko-testing package manifest", () => {
  test("regular dependencies are only framework, repo-manifest, types and zod", () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@cosmicdrift/kumiko-framework",
      "@cosmicdrift/kumiko-repo-manifest",
      "@cosmicdrift/kumiko-types",
      "zod",
    ]);
  });

  test("bundled-features and dev-server are neither dependencies nor peers; they are injected", () => {
    for (const name of INJECTED_PACKAGES) {
      expect(manifest.dependencies[name]).toBeUndefined();
      expect(manifest.peerDependencies[name]).toBeUndefined();
    }
  });
});

describe("kumiko-testing Core import graph", () => {
  const graph = collectImportGraph(CORE_ENTRY_KEYS);
  const fullGraph = collectImportGraph(Object.keys(manifest.exports));

  test("the Core entries are the stack, helpers, preload, bunfig and integration-runner subpaths", () => {
    expect(CORE_ENTRY_KEYS).toEqual(
      expect.arrayContaining([
        "./stack",
        "./helpers",
        "./helpers/real-providers",
        "./helpers/e2e-generator",
        "./preload/dom",
        "./bunfig",
        "./integration-runner",
      ]),
    );
  });

  test("the walk visits the stack and helpers sources", () => {
    expect(graph.files.has(join(sourceRoot, "stack", "test-stack.ts"))).toBe(true);
    expect(graph.files.has(join(sourceRoot, "helpers", "wait-for.ts"))).toBe(true);
  });

  test("reaches no bundled-features or dev-server specifier", () => {
    expect(graph.violations).toEqual([]);
  });

  test("the root and e2e entries reach none either; injection replaces the optional peers", () => {
    expect(fullGraph.files.has(join(sourceRoot, "seed-tenant.ts"))).toBe(true);
    expect(fullGraph.files.has(join(sourceRoot, "e2e", "seed-route.ts"))).toBe(true);
    expect(fullGraph.violations).toEqual([]);
  });
});

describe("framework, bundled-features and dev-server tests", () => {
  const consumerPackages = ["framework", "bundled-features", "dev-server"];

  function isTestSupportFile(relativePath: string): boolean {
    return (
      relativePath.includes("/__tests__/") ||
      /\.(test|integration)\.tsx?$/.test(relativePath) ||
      /\.integration\.ts$/.test(relativePath)
    );
  }

  function scanConsumerTests(): { offenders: string[]; filesImportingTesting: number } {
    const offenders: string[] = [];
    let filesImportingTesting = 0;
    for (const packageName of consumerPackages) {
      const packageDir = join(repoPackagesDir, packageName);
      const glob = new Bun.Glob("{src,bin}/**/*.{ts,tsx}");
      for (const relativePath of glob.scanSync({ cwd: packageDir })) {
        if (
          relativePath.includes("node_modules/") ||
          relativePath.startsWith("dist/") ||
          relativePath.includes("/fixtures/") ||
          !isTestSupportFile(`/${relativePath}`)
        ) {
          continue;
        }
        const absolutePath = join(packageDir, relativePath);
        if (!readFileSync(absolutePath, "utf8").includes(TESTING_PACKAGE_NAME)) continue;
        filesImportingTesting += 1;
        for (const specifier of importSpecifiersOf(absolutePath)) {
          const subpath = selfSubpathOf(specifier);
          if (subpath === undefined || isCoreSubpath(subpath)) continue;
          offenders.push(`packages/${packageName}/${relativePath} imports ${specifier}`);
        }
      }
    }
    return { offenders, filesImportingTesting };
  }

  test("import only Core subpaths of kumiko-testing, never the root or /e2e", () => {
    const { offenders, filesImportingTesting } = scanConsumerTests();

    expect(filesImportingTesting).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
