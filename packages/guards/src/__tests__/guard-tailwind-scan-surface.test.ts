import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project } from "ts-morph";
import { findLocalRepo, type RepoRoot } from "../_lib/roots";
import {
  analyse,
  baselineCounts,
  type Finding,
  guard,
  type PublishedScanSurfaceFinding,
  type SourceCoverageFinding,
  scanPublishedScanSurface,
  scanSourceCoverage,
  sourceCoverageBaselineCounts,
} from "../guard-tailwind-scan-surface";
import { fixtureRoot } from "./parent-workspace-fixture";

// The guard resolves its baseline against the local repo root
// (findLocalRepo()?.absPath), not cwd — mirror that here so the test reads
// and writes the same file the guard does, regardless of where `bun test`
// was invoked from.
const BASELINE_ROOT = findLocalRepo()?.absPath ?? process.cwd();
const BASELINE_PATH = path.join(BASELINE_ROOT, ".kumiko-tailwind-scan-surface-baseline.json");

let preExistingBaseline: string | null = null;
beforeEach(() => {
  preExistingBaseline = existsSync(BASELINE_PATH) ? readFileSync(BASELINE_PATH, "utf-8") : null;
});
afterEach(() => {
  if (preExistingBaseline === null) {
    if (existsSync(BASELINE_PATH)) rmSync(BASELINE_PATH);
  } else {
    writeFileSync(BASELINE_PATH, preExistingBaseline);
  }
});

function writeBaseline(perFile: Record<string, number>): void {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ format: 1, generated: "2026-01-01", total: 0, perFile }),
  );
}

function parse(source: string, file: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(file, source);
}

const FLAT_APP_MANIFEST = {
  kind: "app" as const,
  sourceRoots: ["src"],
  testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
};

const RELATIVE_TARGET_FILE = "packages/bundled-features/src/demo/web/x.tsx";
const TARGET_FILE = path.join(process.cwd(), RELATIVE_TARGET_FILE);
const ALLOW_FILE = path.join(process.cwd(), "packages/renderer-web/src/widgets/y.tsx");
const SAMPLES_ALLOW_FILE = path.join(process.cwd(), "samples/apps/demo/src/screen.tsx");

function runFor(
  targetSource: string,
  allowSource: string,
  allowFile: string = ALLOW_FILE,
): { warnings: string[]; violations: number } {
  const warnSpy = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const targetSf = parse(targetSource, TARGET_FILE);
    const allowSf = parse(allowSource, allowFile);
    const outcome = guard.run([targetSf, allowSf]);
    return { warnings, violations: outcome.violations.length };
  } finally {
    console.warn = warnSpy;
  }
}

describe("guard-tailwind-scan-surface", () => {
  test("flags a className token missing from the allow-surface", () => {
    const { warnings } = runFor(
      'export function X() { return <div className="mb-2 rogue-token" />; }',
      'export const x = "mb-2";',
    );
    expect(warnings.some((w) => w.includes('"rogue-token"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"mb-2"'))).toBe(false);
  });

  test("does not flag a token present as a plain className string on the scan surface", () => {
    const { warnings } = runFor(
      'export function X() { return <div className="mb-2" />; }',
      'export function Y() { return <span className="mb-2 flex" />; }',
    );
    expect(warnings).toHaveLength(0);
  });

  test("allow-set is generous: a token only reachable via cn(...) on the scan surface still counts", () => {
    const { warnings } = runFor(
      'export function X() { return <div className="rogue-token" />; }',
      `import { cn } from "x";
export function Y({ active }: { active: boolean }) {
  return <span className={cn("rogue-token", active && "flex")} />;
}`,
    );
    expect(warnings).toHaveLength(0);
  });

  test("modifier prefixes are NOT stripped — hover:mb-2 is distinct from mb-2", () => {
    const { warnings } = runFor(
      'export function X() { return <div className="hover:mb-2" />; }',
      'export const x = "mb-2";',
    );
    expect(warnings.some((w) => w.includes('"hover:mb-2"'))).toBe(true);
  });

  test("V1 scope: className={cn(...)} expressions in bundled-features are not extracted", () => {
    const { warnings } = runFor(
      `import { cn } from "x";
export function X() { return <div className={cn("rogue-token")} />; }`,
      'export const x = "";',
    );
    expect(warnings).toHaveLength(0);
  });

  test("ignore-tag on the previous line suppresses a flagged token", () => {
    const { warnings } = runFor(
      `export function X() {
  return (
    // kumiko-lint-ignore tailwind-scan-surface Brand-Ausnahme
    <div className="rogue-token" />
  );
}`,
      'export const x = "";',
    );
    expect(warnings).toHaveLength(0);
  });

  test("test files under bundled-features are excluded from scanning", () => {
    const testFile = path.join(
      process.cwd(),
      "packages/bundled-features/src/demo/web/__tests__/x.test.tsx",
    );
    const warnSpy = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const targetSf = parse(
        'export function X() { return <div className="rogue-token" />; }',
        testFile,
      );
      const allowSf = parse('export const x = "";', ALLOW_FILE);
      guard.run([targetSf, allowSf]);
    } finally {
      console.warn = warnSpy;
    }
    expect(warnings).toHaveLength(0);
  });

  test("renderer/src and samples/**/src also feed the allow-set", () => {
    const { warnings } = runFor(
      'export function X() { return <div className="rogue-token" />; }',
      'export function Y() { return <span className="rogue-token" />; }',
      SAMPLES_ALLOW_FILE,
    );
    expect(warnings).toHaveLength(0);
  });

  test("without a baseline file, a flagged token stays warning-only", () => {
    if (existsSync(BASELINE_PATH)) rmSync(BASELINE_PATH);
    const { warnings, violations } = runFor(
      'export function X() { return <div className="rogue-token" />; }',
      'export const x = "";',
    );
    expect(warnings.some((w) => w.includes('"rogue-token"'))).toBe(true);
    expect(violations).toBe(0);
  });

  test("with a baseline, a new flagged token fails as a regression", () => {
    writeBaseline({});
    const { violations } = runFor(
      'export function X() { return <div className="rogue-token" />; }',
      'export const x = "";',
    );
    expect(violations).toBeGreaterThan(0);
  });

  test("with a baseline covering the existing count, no new violations", () => {
    writeBaseline({ [RELATIVE_TARGET_FILE]: 1 });
    const { violations } = runFor(
      'export function X() { return <div className="rogue-token" />; }',
      'export const x = "";',
    );
    expect(violations).toBe(0);
  });
});

describe("baselineCounts", () => {
  const finding = (file: string, line = 1, token = "rogue-token"): Finding => ({
    file,
    line,
    token,
  });

  test("counts findings per file", () => {
    expect(
      baselineCounts([
        finding("packages/bundled-features/src/a/web/x.tsx"),
        finding("packages/bundled-features/src/a/web/x.tsx", 9),
      ]),
    ).toEqual({ "packages/bundled-features/src/a/web/x.tsx": 2 });
  });
});

// Cross-package @source coverage: a consuming app (studio, publicstatus, …)
// must @source every Framework/Enterprise package it imports that ships
// .tsx className usage — reproduces the studio#289 (kumiko-designer) and
// publicstatus#442 (kumiko-ai-agent) cases as an isolated fixture instead of
// depending on real sibling checkouts on disk.
describe("scanSourceCoverage", () => {
  function makeAppFixture(opts: {
    readonly dependencyName: string;
    readonly extraSourceEntry?: string;
  }): { readonly root: RepoRoot; readonly cleanup: () => void } {
    const appRoot = mkdtempSync(path.join(tmpdir(), "tailwind-app-"));
    writeFileSync(
      path.join(appRoot, "package.json"),
      JSON.stringify({
        name: "studio-fixture",
        dependencies: { [opts.dependencyName]: "^1.0.0" },
      }),
    );
    mkdirSync(path.join(appRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(appRoot, "src/styles.css"),
      [
        '@import "@cosmicdrift/kumiko-renderer-web/styles.css";',
        '@source "./**/*.{ts,tsx}";',
        opts.extraSourceEntry ?? "",
      ].join("\n"),
    );
    const pkgSrc = path.join(appRoot, "node_modules", opts.dependencyName, "src/web");
    mkdirSync(pkgSrc, { recursive: true });
    writeFileSync(
      path.join(pkgSrc, "pattern-form.tsx"),
      'export function PatternForm() { return <div className="min-w-[16rem]" />; }',
    );
    return {
      root: fixtureRoot("studio-fixture", appRoot, FLAT_APP_MANIFEST),
      cleanup: () => rmSync(appRoot, { recursive: true, force: true }),
    };
  }

  test("flags an enterprise package with className .tsx and no @source entry (studio#289, red)", () => {
    const { root, cleanup } = makeAppFixture({
      dependencyName: "@cosmicdriftgamestudio/kumiko-designer",
    });
    try {
      const findings = scanSourceCoverage([root]);
      expect(findings.some((f) => f.packageName === "@cosmicdriftgamestudio/kumiko-designer")).toBe(
        true,
      );
    } finally {
      cleanup();
    }
  });

  test("an @source entry for the package clears the finding (studio#289, green)", () => {
    const { root, cleanup } = makeAppFixture({
      dependencyName: "@cosmicdriftgamestudio/kumiko-designer",
      extraSourceEntry:
        '@source "./node_modules/@cosmicdriftgamestudio/kumiko-designer/src/**/*.{ts,tsx}";',
    });
    try {
      const findings = scanSourceCoverage([root]);
      expect(findings.some((f) => f.packageName === "@cosmicdriftgamestudio/kumiko-designer")).toBe(
        false,
      );
    } finally {
      cleanup();
    }
  });

  test("a package without any className .tsx needs no @source entry", () => {
    const appRoot = mkdtempSync(path.join(tmpdir(), "tailwind-app-"));
    try {
      writeFileSync(
        path.join(appRoot, "package.json"),
        JSON.stringify({
          name: "studio-fixture",
          dependencies: { "@cosmicdrift/kumiko-headless": "^1.0.0" },
        }),
      );
      mkdirSync(path.join(appRoot, "src"), { recursive: true });
      writeFileSync(
        path.join(appRoot, "src/styles.css"),
        '@import "@cosmicdrift/kumiko-renderer-web/styles.css";\n@source "./**/*.{ts,tsx}";\n',
      );
      const pkgSrc = path.join(appRoot, "node_modules/@cosmicdrift/kumiko-headless/src");
      mkdirSync(pkgSrc, { recursive: true });
      writeFileSync(path.join(pkgSrc, "index.ts"), "export const x = 1;");
      const root = fixtureRoot("studio-fixture", appRoot, FLAT_APP_MANIFEST);
      expect(scanSourceCoverage([root])).toEqual([]);
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  test("an app without the renderer-web @source convention is out of scope", () => {
    const { root, cleanup } = makeAppFixture({
      dependencyName: "@cosmicdriftgamestudio/kumiko-designer",
    });
    try {
      writeFileSync(path.join(root.absPath, "src/styles.css"), "body { margin: 0; }");
      expect(scanSourceCoverage([root])).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("a repo whose manifest is not a flat src/ layout is skipped entirely", () => {
    const { root, cleanup } = makeAppFixture({
      dependencyName: "@cosmicdriftgamestudio/kumiko-designer",
    });
    try {
      const frameworkRoot: RepoRoot = fixtureRoot("framework-fixture", root.absPath, {
        kind: "framework",
        sourceRoots: ["packages/*/src", "samples", "scripts"],
        testGlobs: ["packages/*/src/**/*.{test,integration}.{ts,tsx}"],
      });
      expect(scanSourceCoverage([frameworkRoot])).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

// Follow-up: coverage can also come through the app's `@import` chain — the
// imported CSS's OWN @source lines, resolved relative to where it actually
// lives on disk in this install layout (e.g. renderer-web ships @source
// entries for the framework's scan surface; once it adds one for
// bundled-features, apps that only @import it need no line of their own).
describe("scanSourceCoverage — @import chain resolution", () => {
  function makeImportChainFixture(rendererWebSourceEntry: string): {
    readonly root: RepoRoot;
    readonly cleanup: () => void;
  } {
    const appRoot = mkdtempSync(path.join(tmpdir(), "tailwind-import-chain-"));
    writeFileSync(
      path.join(appRoot, "package.json"),
      JSON.stringify({
        name: "studio-fixture",
        dependencies: {
          "@cosmicdriftgamestudio/kumiko-designer": "^1.0.0",
        },
      }),
    );
    mkdirSync(path.join(appRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(appRoot, "src/styles.css"),
      ['@import "@cosmicdrift/kumiko-renderer-web/styles.css";', '@source "./**/*.{ts,tsx}";'].join(
        "\n",
      ),
    );
    const designerSrc = path.join(
      appRoot,
      "node_modules/@cosmicdriftgamestudio/kumiko-designer/src/web",
    );
    mkdirSync(designerSrc, { recursive: true });
    writeFileSync(
      path.join(designerSrc, "pattern-form.tsx"),
      'export function PatternForm() { return <div className="min-w-[16rem]" />; }',
    );
    const rendererWebDir = path.join(appRoot, "node_modules/@cosmicdrift/kumiko-renderer-web");
    mkdirSync(rendererWebDir, { recursive: true });
    writeFileSync(
      path.join(rendererWebDir, "styles.css"),
      `@source "./**/*.{ts,tsx}";\n${rendererWebSourceEntry}\n`,
    );
    const root = fixtureRoot("studio-fixture", appRoot, FLAT_APP_MANIFEST);
    return {
      root,
      cleanup: () => rmSync(appRoot, { recursive: true, force: true }),
    };
  }

  test("(a) an @source line in the imported CSS that resolves to the package's real dir clears the finding", () => {
    const { root, cleanup } = makeImportChainFixture(
      '@source "../../@cosmicdriftgamestudio/kumiko-designer/src/**/*.{ts,tsx}";',
    );
    try {
      const findings = scanSourceCoverage([root]);
      expect(findings.some((f) => f.packageName === "@cosmicdriftgamestudio/kumiko-designer")).toBe(
        false,
      );
    } finally {
      cleanup();
    }
  });

  test("(b) no @source line anywhere in the import chain still flags it (today's designer case)", () => {
    const { root, cleanup } = makeImportChainFixture("");
    try {
      const findings = scanSourceCoverage([root]);
      expect(findings.some((f) => f.packageName === "@cosmicdriftgamestudio/kumiko-designer")).toBe(
        true,
      );
    } finally {
      cleanup();
    }
  });

  test("(c) an @source line whose resolved path does not exist in this layout does not count as coverage", () => {
    const { root, cleanup } = makeImportChainFixture(
      '@source "../../@cosmicdriftgamestudio/kumiko-designer-does-not-exist/src/**/*.{ts,tsx}";',
    );
    try {
      const findings = scanSourceCoverage([root]);
      expect(findings.some((f) => f.packageName === "@cosmicdriftgamestudio/kumiko-designer")).toBe(
        true,
      );
    } finally {
      cleanup();
    }
  });
});

// Fourth rule (studio#289 follow-up): an @source line can already resolve on
// disk and still match nothing once the referenced package is installed from
// a registry instead of a workspace symlink — the symlink exposes the
// package's full source checkout, a registry tarball only ships what its
// package.json `files` allowlists.
describe("scanPublishedScanSurface", () => {
  function makePublishedSurfaceFixture(opts: {
    readonly filesField?: readonly string[];
    readonly extraSourceEntry?: string;
  }): { readonly root: RepoRoot; readonly cleanup: () => void } {
    const appRoot = mkdtempSync(path.join(tmpdir(), "tailwind-published-"));
    mkdirSync(path.join(appRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(appRoot, "src/styles.css"),
      [
        '@source "../node_modules/@cosmicdriftgamestudio/kumiko-designer/src/**/*.{ts,tsx}";',
        opts.extraSourceEntry ?? "",
      ].join("\n"),
    );
    const pkgDir = path.join(appRoot, "node_modules/@cosmicdriftgamestudio/kumiko-designer");
    mkdirSync(pkgDir, { recursive: true });
    const pkgJson: Record<string, unknown> = {
      name: "@cosmicdriftgamestudio/kumiko-designer",
      version: "0.31.0",
    };
    if (opts.filesField !== undefined) pkgJson["files"] = opts.filesField;
    writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkgJson));
    return {
      root: fixtureRoot("app-fixture", appRoot, FLAT_APP_MANIFEST),
      cleanup: () => rmSync(appRoot, { recursive: true, force: true }),
    };
  }

  function findingFor(
    findings: readonly PublishedScanSurfaceFinding[],
    packageName: string,
  ): PublishedScanSurfaceFinding | undefined {
    return findings.find((f) => f.packageName === packageName);
  }

  test("(a) only a src glob, files=[dist] → finding (the real studio#289 bug)", () => {
    const { root, cleanup } = makePublishedSurfaceFixture({
      filesField: ["dist"],
    });
    try {
      const findings = scanPublishedScanSurface([root]);
      const finding = findingFor(findings, "@cosmicdriftgamestudio/kumiko-designer");
      expect(finding?.segment).toBe("src");
      expect(finding?.filesField).toEqual(["dist"]);
    } finally {
      cleanup();
    }
  });

  test("(b) a second glob hits a published path (dist) → no finding for the dead src glob", () => {
    const { root, cleanup } = makePublishedSurfaceFixture({
      filesField: ["dist"],
      extraSourceEntry:
        '@source "../node_modules/@cosmicdriftgamestudio/kumiko-designer/dist/**/*.js";',
    });
    try {
      const findings = scanPublishedScanSurface([root]);
      expect(findingFor(findings, "@cosmicdriftgamestudio/kumiko-designer")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("(c) files already includes src → no finding", () => {
    const { root, cleanup } = makePublishedSurfaceFixture({
      filesField: ["src", "LICENSE"],
    });
    try {
      const findings = scanPublishedScanSurface([root]);
      expect(findingFor(findings, "@cosmicdriftgamestudio/kumiko-designer")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("(d) package.json has no files field → no finding (files-less package publishes everything)", () => {
    const { root, cleanup } = makePublishedSurfaceFixture({});
    try {
      const findings = scanPublishedScanSurface([root]);
      expect(findingFor(findings, "@cosmicdriftgamestudio/kumiko-designer")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("(e) a framework-style package that already publishes src → no finding", () => {
    const { root, cleanup } = makePublishedSurfaceFixture({
      filesField: ["src", "README.md", "LICENSE"],
    });
    try {
      const findings = scanPublishedScanSurface([root]);
      expect(findingFor(findings, "@cosmicdriftgamestudio/kumiko-designer")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  // The whole point of the rule: this must be a hard failure, not a
  // warning — a warning is exactly what let studio#289 through unnoticed.
  test("a src-only glob is a real GuardOutcome violation via analyse(), not just a console warning", () => {
    const { root, cleanup } = makePublishedSurfaceFixture({
      filesField: ["dist"],
    });
    try {
      const outcome = analyse([], true, [root]);
      expect(
        outcome.violations.some(
          (v) =>
            v.message.includes("@cosmicdriftgamestudio/kumiko-designer") &&
            v.message.includes("only publishes [dist]"),
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("sourceCoverageBaselineCounts", () => {
  const finding = (
    file: string,
    packageName = "@cosmicdriftgamestudio/kumiko-designer",
  ): SourceCoverageFinding => ({
    file,
    line: 1,
    packageName,
    example: "src/web/x.tsx",
  });

  test("counts findings per file", () => {
    expect(sourceCoverageBaselineCounts([finding("src/styles.css")])).toEqual({
      "src/styles.css": 1,
    });
  });
});
