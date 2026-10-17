import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import * as z from "zod";

const TESTING_PACKAGE_NAME = "@cosmicdrift/kumiko-testing";
const OPTIONAL_PEER_PACKAGES = [
  "@cosmicdrift/kumiko-bundled-features",
  "@cosmicdrift/kumiko-dev-server",
] as const;

const packageRoot = resolve(import.meta.dir, "..", "..");
const repoPackagesDir = resolve(packageRoot, "..");
const sourceRoot = join(packageRoot, "src");

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
  peerDependencies: z.record(z.string(), z.string()),
  peerDependenciesMeta: z.record(z.string(), z.object({ optional: z.boolean().optional() })),
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

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
});

// Syntactic walk on purpose: getImportStringLiterals() builds a full program per call.
function importSpecifiersOf(absolutePath: string): string[] {
  const sourceFile = project.createSourceFile(absolutePath, readFileSync(absolutePath, "utf8"), {
    overwrite: true,
  });
  const specifiers: string[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    specifiers.push(declaration.getModuleSpecifierValue());
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier !== undefined) specifiers.push(specifier);
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const [firstArgument] = call.getArguments();
    if (
      call.getExpression().getKind() === SyntaxKind.ImportKeyword &&
      Node.isStringLiteral(firstArgument)
    ) {
      specifiers.push(firstArgument.getLiteralText());
    }
  }
  for (const importType of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const argument = importType.getArgument();
    const literal = Node.isLiteralTypeNode(argument) ? argument.getLiteral() : undefined;
    if (Node.isStringLiteral(literal)) specifiers.push(literal.getLiteralText());
  }
  project.removeSourceFile(sourceFile);
  return specifiers;
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

function isOptionalPeerSpecifier(specifier: string): boolean {
  return OPTIONAL_PEER_PACKAGES.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

function coreEntryFiles(): string[] {
  return CORE_ENTRY_KEYS.map((key) => join(packageRoot, manifest.exports[key]?.default ?? ""));
}

function collectCoreGraph(): { files: Set<string>; violations: string[] } {
  const files = new Set<string>();
  const violations: string[] = [];
  const queue = coreEntryFiles();
  const rootEntry = join(sourceRoot, "index.ts");
  const e2eDir = `${join(sourceRoot, "e2e")}/`;

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    if (file === rootEntry || file.startsWith(e2eDir)) {
      violations.push(`${relative(packageRoot, file)} is reachable from a Core entry`);
      continue;
    }
    for (const specifier of importSpecifiersOf(file)) {
      if (isOptionalPeerSpecifier(specifier)) {
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
  test("regular dependencies are only framework, types and zod", () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@cosmicdrift/kumiko-framework",
      "@cosmicdrift/kumiko-types",
      "zod",
    ]);
  });

  test("bundled-features and dev-server are optional peers, not dependencies", () => {
    for (const name of OPTIONAL_PEER_PACKAGES) {
      expect(manifest.dependencies[name]).toBeUndefined();
      expect(manifest.peerDependencies[name]).toBeDefined();
      expect(manifest.peerDependenciesMeta[name]?.optional).toBe(true);
    }
  });
});

describe("kumiko-testing Core import graph", () => {
  const graph = collectCoreGraph();

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

  test("reaches no bundled-features or dev-server specifier, no root entry, no e2e source", () => {
    expect(graph.violations).toEqual([]);
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
