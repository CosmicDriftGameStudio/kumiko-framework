import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergedSpecifier,
  PACKAGE_MERGE_MAPPINGS,
  type PackageMergeMapping,
  transformPackageMergeSource,
} from "../scripts/codemod/package-merge.ts";

const APP_FILE = "/repo/apps/demo/src/index.ts";
const HTTP = "@cosmicdrift/kumiko-http";
const MANIFEST = "@cosmicdrift/kumiko-repo-manifest";
const FW_HTTP = "@cosmicdrift/kumiko-framework/http";
const GUARDS_MANIFEST = "@cosmicdrift/kumiko-guards/repo-manifest";

interface Fixture {
  readonly name: string;
  readonly filePath: string;
  readonly input: string;
  readonly expected: string;
  readonly rewrites: number;
}

const SOURCE_FIXTURES: readonly Fixture[] = [
  {
    name: "import specifier",
    filePath: APP_FILE,
    input: `import { egress } from "${HTTP}";\n`,
    expected: `import { egress } from "${FW_HTTP}";\n`,
    rewrites: 1,
  },
  {
    name: "type-only import and re-export",
    filePath: APP_FILE,
    input: `import type { EgressPolicy } from "${HTTP}";\nexport * from "${HTTP}";\nexport { egress } from "${HTTP}";\n`,
    expected: `import type { EgressPolicy } from "${FW_HTTP}";\nexport * from "${FW_HTTP}";\nexport { egress } from "${FW_HTTP}";\n`,
    rewrites: 3,
  },
  {
    name: "subpath keeps its tail",
    filePath: APP_FILE,
    input: `import { listAppPorts } from "${MANIFEST}/app-ports";\nimport { loadRepoManifest } from "${MANIFEST}";\n`,
    expected: `import { listAppPorts } from "${GUARDS_MANIFEST}/app-ports";\nimport { loadRepoManifest } from "${GUARDS_MANIFEST}";\n`,
    rewrites: 2,
  },
  {
    name: "dynamic import, import() type and mock.module",
    filePath: APP_FILE,
    input: [
      `const lazy = await import("${MANIFEST}/app-ports");`,
      `type Manifest = import("${MANIFEST}").RepoManifest;`,
      `mock.module("${HTTP}", () => ({}));`,
      ``,
    ].join("\n"),
    expected: [
      `const lazy = await import("${GUARDS_MANIFEST}/app-ports");`,
      `type Manifest = import("${GUARDS_MANIFEST}").RepoManifest;`,
      `mock.module("${FW_HTTP}", () => ({}));`,
      ``,
    ].join("\n"),
    rewrites: 3,
  },
  {
    name: "a similarly named package is left alone",
    filePath: APP_FILE,
    input: `import { x } from "${HTTP}-client";\nimport { y } from "@cosmicdrift/kumiko-framework/http";\n`,
    expected: `import { x } from "${HTTP}-client";\nimport { y } from "@cosmicdrift/kumiko-framework/http";\n`,
    rewrites: 0,
  },
  {
    name: "specifier text in strings and comments is not an import",
    filePath: APP_FILE,
    input: `// from "${HTTP}"\nconst name = "${HTTP}";\n`,
    expected: `// from "${HTTP}"\nconst name = "${HTTP}";\n`,
    rewrites: 0,
  },
];

describe("package-merge codemod: sources", () => {
  for (const fixture of SOURCE_FIXTURES) {
    it(fixture.name, () => {
      const result = transformPackageMergeSource(fixture.input, fixture.filePath);
      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toHaveLength(0);
      const again = transformPackageMergeSource(result.output, fixture.filePath);
      expect(again.output).toBe(result.output);
      expect(again.rewrites).toHaveLength(0);
    });
  }
});

describe("package-merge codemod: css", () => {
  const CSS_FILE = "/repo/apps/demo/src/styles.css";
  const WEB = "@cosmicdrift/kumiko-renderer-web";

  it("rewrites @import and @plugin specifiers and leaves other packages alone", () => {
    const input = [
      `@import "${WEB}/styles.css";`,
      `@plugin '${WEB}/theme-plugin';`,
      `@import url("${WEB}/styles.css");`,
      `@import "@cosmicdrift/kumiko-renderer-mail-html/x.css";`,
      ``,
    ].join("\n");
    const result = transformPackageMergeSource(input, CSS_FILE);
    expect(result.output).toBe(
      [
        `@import "@cosmicdrift/kumiko-renderer/web/styles.css";`,
        `@plugin '@cosmicdrift/kumiko-renderer/web/theme-plugin';`,
        `@import url("@cosmicdrift/kumiko-renderer/web/styles.css");`,
        `@import "@cosmicdrift/kumiko-renderer-mail-html/x.css";`,
        ``,
      ].join("\n"),
    );
    expect(result.rewrites.map((site) => site.line)).toEqual([1, 2, 3]);
    expect(transformPackageMergeSource(result.output, CSS_FILE).rewrites).toHaveLength(0);
  });

  it("reports a @source path into the old package as manual", () => {
    const input = `@source "../node_modules/${WEB}/src/**/*.tsx";\n`;
    const result = transformPackageMergeSource(input, CSS_FILE);
    expect(result.output).toBe(input);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(1);
  });
});

describe("package-merge codemod: package.json", () => {
  const PKG_FILE = "/repo/apps/demo/package.json";

  it("replaces the dependency with the target package and keeps the range", () => {
    const input = `${JSON.stringify(
      {
        name: "demo",
        dependencies: { "@cosmicdrift/kumiko-guards": "^1.0.0", [HTTP]: "^0.375.0" },
      },
      null,
      2,
    )}\n`;
    const result = transformPackageMergeSource(input, PKG_FILE);
    expect(JSON.parse(result.output)).toEqual({
      name: "demo",
      dependencies: {
        "@cosmicdrift/kumiko-framework": "^0.375.0",
        "@cosmicdrift/kumiko-guards": "^1.0.0",
      },
    });
    expect(result.output.endsWith("\n")).toBe(true);
    expect(result.rewrites).toHaveLength(1);
  });

  it("handles each block on its own and maps repo-manifest to guards", () => {
    const input = JSON.stringify({
      dependencies: { [HTTP]: "workspace:*" },
      devDependencies: { [MANIFEST]: "^0.375.0" },
      peerDependencies: { [MANIFEST]: ">=0.370.0 <1.0.0" },
    });
    const result = transformPackageMergeSource(input, PKG_FILE);
    expect(JSON.parse(result.output)).toEqual({
      dependencies: { "@cosmicdrift/kumiko-framework": "workspace:*" },
      devDependencies: { "@cosmicdrift/kumiko-guards": "^0.375.0" },
      peerDependencies: { "@cosmicdrift/kumiko-guards": ">=0.370.0 <1.0.0" },
    });
    expect(result.rewrites).toHaveLength(3);
  });

  it("drops the old entry without touching a target the block already has", () => {
    const input = JSON.stringify({
      dependencies: { "@cosmicdrift/kumiko-framework": "^0.380.0", [HTTP]: "^0.375.0" },
    });
    const result = transformPackageMergeSource(input, PKG_FILE);
    expect(JSON.parse(result.output)).toEqual({
      dependencies: { "@cosmicdrift/kumiko-framework": "^0.380.0" },
    });
  });

  it("does not add a dependency of a package on itself", () => {
    const input = JSON.stringify({
      name: "@cosmicdrift/kumiko-framework",
      dependencies: { [HTTP]: "workspace:*" },
    });
    const result = transformPackageMergeSource(input, PKG_FILE);
    expect(JSON.parse(result.output)).toEqual({
      name: "@cosmicdrift/kumiko-framework",
      dependencies: {},
    });
  });

  it("keeps the indent and leaves unrelated manifests byte-identical", () => {
    const tabs = `{\n\t"dependencies": {\n\t\t"${HTTP}": "^1.0.0"\n\t}\n}`;
    expect(transformPackageMergeSource(tabs, PKG_FILE).output).toBe(
      `{\n\t"dependencies": {\n\t\t"@cosmicdrift/kumiko-framework": "^1.0.0"\n\t}\n}`,
    );
    const unrelated = `{\n  "dependencies": { "zod": "^4.0.0" }\n}\n`;
    const result = transformPackageMergeSource(unrelated, PKG_FILE);
    expect(result.output).toBe(unrelated);
    expect(result.rewrites).toHaveLength(0);
  });

  it("is idempotent", () => {
    const input = JSON.stringify({ dependencies: { [HTTP]: "^1.0.0" } }, null, 2);
    const once = transformPackageMergeSource(input, PKG_FILE);
    const twice = transformPackageMergeSource(once.output, PKG_FILE);
    expect(twice.output).toBe(once.output);
    expect(twice.rewrites).toHaveLength(0);
  });

  it("reports invalid JSON as manual", () => {
    const result = transformPackageMergeSource("{ not json", PKG_FILE);
    expect(result.output).toBe("{ not json");
    expect(result.manual).toHaveLength(1);
  });
});

describe("package-merge codemod: mapping table", () => {
  const extra: readonly PackageMergeMapping[] = [
    ...PACKAGE_MERGE_MAPPINGS,
    { from: "@cosmicdrift/kumiko-example", to: "@cosmicdrift/kumiko-target" },
    { from: "@cosmicdrift/kumiko-example/special", to: "@cosmicdrift/kumiko-target/elsewhere" },
  ];

  it("ships the http and repo-manifest moves", () => {
    expect(mergedSpecifier(HTTP)).toBe(FW_HTTP);
    expect(mergedSpecifier(`${MANIFEST}/app-ports`)).toBe(`${GUARDS_MANIFEST}/app-ports`);
    expect(mergedSpecifier("@cosmicdrift/kumiko-framework/http")).toBeUndefined();
  });

  it("ships the headless and dispatcher-live moves into renderer subpaths", () => {
    expect(mergedSpecifier("@cosmicdrift/kumiko-headless")).toBe(
      "@cosmicdrift/kumiko-renderer/headless",
    );
    expect(mergedSpecifier("@cosmicdrift/kumiko-headless/locale-routing")).toBe(
      "@cosmicdrift/kumiko-renderer/headless/locale-routing",
    );
    expect(mergedSpecifier("@cosmicdrift/kumiko-dispatcher-live")).toBe(
      "@cosmicdrift/kumiko-renderer/live",
    );
    expect(mergedSpecifier("@cosmicdrift/kumiko-renderer")).toBeUndefined();
  });

  it("maps renderer-web onto the renderer web subpath without touching its siblings", () => {
    expect(mergedSpecifier("@cosmicdrift/kumiko-renderer-web")).toBe(
      "@cosmicdrift/kumiko-renderer/web",
    );
    expect(mergedSpecifier("@cosmicdrift/kumiko-renderer-web/styles.css")).toBe(
      "@cosmicdrift/kumiko-renderer/web/styles.css",
    );
    expect(mergedSpecifier("@cosmicdrift/kumiko-renderer-mail-html")).toBeUndefined();
    expect(mergedSpecifier("@cosmicdrift/kumiko-renderer/web")).toBeUndefined();
  });

  it("replaces the headless and dispatcher-live dependencies with renderer once", () => {
    const result = transformPackageMergeSource(
      JSON.stringify({
        dependencies: {
          "@cosmicdrift/kumiko-dispatcher-live": "^1.0.0",
          "@cosmicdrift/kumiko-headless": "^1.0.0",
        },
      }),
      "/repo/package.json",
    );
    expect(JSON.parse(result.output)).toEqual({
      dependencies: { "@cosmicdrift/kumiko-renderer": "^1.0.0" },
    });
  });

  it("takes additional rows, longest from first", () => {
    expect(mergedSpecifier("@cosmicdrift/kumiko-example/special", extra)).toBe(
      "@cosmicdrift/kumiko-target/elsewhere",
    );
    expect(mergedSpecifier("@cosmicdrift/kumiko-example/other", extra)).toBe(
      "@cosmicdrift/kumiko-target/other",
    );
    const result = transformPackageMergeSource(
      JSON.stringify({ dependencies: { "@cosmicdrift/kumiko-example": "^1.0.0" } }),
      "/repo/package.json",
      extra,
    );
    expect(JSON.parse(result.output)).toEqual({
      dependencies: { "@cosmicdrift/kumiko-target": "^1.0.0" },
    });
  });
});

describe("package-merge codemod: CLI modes", () => {
  const script = join(import.meta.dir, "../scripts/codemod/package-merge.ts");
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "package-merge-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/index.ts"), `import { egress } from "${HTTP}";\n`);
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ dependencies: { [HTTP]: "^1.0.0" } }, null, 2)}\n`,
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(...flags: string[]): number {
    return Bun.spawnSync({ cmd: ["bun", script, dir, ...flags], stdout: "pipe", stderr: "pipe" })
      .exitCode;
  }

  it("--check reports without writing, --write fixes, a second --check is clean", () => {
    const before = readFileSync(join(dir, "src/index.ts"), "utf8");
    expect(run("--check")).toBe(1);
    expect(readFileSync(join(dir, "src/index.ts"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain(HTTP);

    expect(run("--write", "--no-format")).toBe(0);
    expect(readFileSync(join(dir, "src/index.ts"), "utf8")).toContain(FW_HTTP);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain(
      "@cosmicdrift/kumiko-framework",
    );
    expect(run("--check")).toBe(0);
  });
});
