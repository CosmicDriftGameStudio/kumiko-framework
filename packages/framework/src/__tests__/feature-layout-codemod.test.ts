import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyFeatureLayout } from "../scripts/codemod/feature-layout.ts";

const SCRIPT = join(import.meta.dir, "../scripts/codemod/feature-layout.ts");
const ROOT = "/repo/src/features/demo";

function run(files: Record<string, string>) {
  return applyFeatureLayout(new Map(Object.entries(files)));
}

describe("feature-layout codemod: moves", () => {
  it("moves a client file below web/, keeps the sub-structure and drops the marker", () => {
    const result = run({
      [`${ROOT}/consumer-protection/locale.ts`]: `// @runtime client\nexport const L = 1;\n`,
    });
    expect(result.moves).toEqual([
      {
        from: `${ROOT}/consumer-protection/locale.ts`,
        to: `${ROOT}/web/consumer-protection/locale.ts`,
      },
    ]);
    expect(result.writes.get(`${ROOT}/web/consumer-protection/locale.ts`)).toBe(
      `export const L = 1;\n`,
    );
    expect(result.removals).toEqual([`${ROOT}/consumer-protection/locale.ts`]);
  });

  it("rewrites import, re-export, import(), import type and mock.module in server files and tests", () => {
    const result = run({
      [`${ROOT}/constants.ts`]: `// @runtime client\nexport const C = 1;\n`,
      [`${ROOT}/feature.ts`]: [
        `import { C } from "./constants.ts";`,
        `export { C as again } from "./constants.ts";`,
        `export type T = typeof import("./constants.ts");`,
        `export const lazy = () => import("./constants.ts");`,
        ``,
      ].join("\n"),
      [`${ROOT}/__tests__/c.test.ts`]: [
        `import { C } from "../constants.ts";`,
        `mock.module("../constants.ts", () => ({ C }));`,
        ``,
      ].join("\n"),
    });
    expect(result.writes.get(`${ROOT}/feature.ts`)).toBe(
      [
        `import { C } from "./web/constants.ts";`,
        `export { C as again } from "./web/constants.ts";`,
        `export type T = typeof import("./web/constants.ts");`,
        `export const lazy = () => import("./web/constants.ts");`,
        ``,
      ].join("\n"),
    );
    expect(result.writes.get(`${ROOT}/__tests__/c.test.ts`)).toBe(
      [
        `import { C } from "../web/constants.ts";`,
        `mock.module("../web/constants.ts", () => ({ C }));`,
        ``,
      ].join("\n"),
    );
  });

  it("keeps the extension style of each specifier", () => {
    const result = run({
      [`${ROOT}/constants.ts`]: `// @runtime client\nexport const C = 1;\n`,
      [`${ROOT}/a.ts`]: `import "./constants";\nimport "./constants.js";\n`,
    });
    expect(result.writes.get(`${ROOT}/a.ts`)).toBe(
      `import "./web/constants";\nimport "./web/constants.js";\n`,
    );
  });

  it("rewrites the imports of the moved file itself", () => {
    const result = run({
      [`${ROOT}/i18n.ts`]: `// @runtime client\nimport { x } from "./sibling.ts";\nimport { y } from "../other/y.ts";\nexport const z = x + y;\n`,
      [`${ROOT}/sibling.ts`]: `export const x = 1;\n`,
      [`/repo/src/features/other/y.ts`]: `export const y = 1;\n`,
    });
    expect(result.writes.get(`${ROOT}/web/i18n.ts`)).toBe(
      `import { x } from "../sibling.ts";\nimport { y } from "../../other/y.ts";\nexport const z = x + y;\n`,
    );
  });

  it("leaves two moved files that import each other consistent", () => {
    const result = run({
      [`${ROOT}/a.ts`]: `// @runtime client\nimport { b } from "./b.ts";\nexport const a = b;\n`,
      [`${ROOT}/b.ts`]: `// @runtime client\nexport const b = 1;\n`,
    });
    expect(result.writes.get(`${ROOT}/web/a.ts`)).toBe(
      `import { b } from "./b.ts";\nexport const a = b;\n`,
    );
  });

  it("treats a root web.tsx as client by path and only strips its marker", () => {
    const result = run({ [`${ROOT}/web.tsx`]: `// @runtime client\nexport const client = 1;\n` });
    expect(result.moves).toHaveLength(0);
    expect(result.writes.get(`${ROOT}/web.tsx`)).toBe(`export const client = 1;\n`);
  });

  it("rewrites package.json export targets, src and dist mirror", () => {
    const pkg = JSON.stringify(
      {
        exports: { "./demo/constants": "./src/demo/constants.ts" },
        publishConfig: {
          exports: {
            "./demo/constants": {
              types: "./dist/demo/constants.d.ts",
              default: "./dist/demo/constants.js",
            },
          },
        },
      },
      null,
      2,
    );
    const result = applyFeatureLayout(
      new Map([
        ["/repo/packages/bundled-features/package.json", pkg],
        [
          "/repo/packages/bundled-features/src/demo/constants.ts",
          `// @runtime client\nexport const C = 1;\n`,
        ],
      ]),
    );
    const next = result.writes.get("/repo/packages/bundled-features/package.json") ?? "";
    expect(next).toContain(`"./src/demo/web/constants.ts"`);
    expect(next).toContain(`"./dist/demo/web/constants.d.ts"`);
    expect(next).toContain(`"./dist/demo/web/constants.js"`);
    expect(next).not.toContain(`"./src/demo/constants.ts"`);
  });
});

describe("feature-layout codemod: markers the path already implies", () => {
  it("only strips the marker in web/ and in __tests__/, nothing moves", () => {
    const result = run({
      [`${ROOT}/web/a.tsx`]: `// @runtime client\nexport const a = 1;\n`,
      [`${ROOT}/web/__tests__/a.test.tsx`]: `// @runtime test\nexport const t = 1;\n`,
      [`${ROOT}/__tests__/b.test.ts`]: `// @runtime client\nexport const b = 1;\n`,
    });
    expect(result.moves).toHaveLength(0);
    expect(result.writes.get(`${ROOT}/web/a.tsx`)).toBe(`export const a = 1;\n`);
    expect(result.writes.get(`${ROOT}/web/__tests__/a.test.tsx`)).toBe(`export const t = 1;\n`);
    expect(result.writes.get(`${ROOT}/__tests__/b.test.ts`)).toBe(`export const b = 1;\n`);
    expect(result.markersRemoved).toHaveLength(3);
  });

  it("reports a collision and a marker without a path rule as manual and leaves both files alone", () => {
    const result = run({
      [`${ROOT}/i18n.ts`]: `// @runtime client\nexport const I = 1;\n`,
      [`${ROOT}/web/i18n.ts`]: `export const W = 1;\n`,
      [`${ROOT}/seed.ts`]: `// @runtime dev\nexport const s = 1;\n`,
    });
    expect(result.manual.map((site) => site.file).sort()).toEqual([
      `${ROOT}/i18n.ts`,
      `${ROOT}/seed.ts`,
    ]);
    expect(result.writes.size).toBe(0);
    expect(result.moves).toHaveLength(0);
  });

  it("ignores files outside any feature directory", () => {
    const result = run({
      "/repo/packages/renderer/src/a.ts": `// @runtime client\nexport const a = 1;\n`,
    });
    expect(result.writes.size).toBe(0);
    expect(result.manual).toHaveLength(0);
  });

  it("finds features through --feature-dir and --features-root", () => {
    const files = new Map([
      ["/repo/lib/designer/src/constants.ts", `// @runtime client\nexport const C = 1;\n`],
      ["/repo/lib/groups/billing/constants.ts", `// @runtime client\nexport const B = 1;\n`],
    ]);
    const result = applyFeatureLayout(files, {
      featureDirs: ["/repo/lib/designer/src"],
      featuresRoots: ["/repo/lib/groups"],
    });
    expect(result.moves.map((move) => move.to).sort()).toEqual([
      "/repo/lib/designer/src/web/constants.ts",
      "/repo/lib/groups/billing/web/constants.ts",
    ]);
  });
});

describe("feature-layout codemod: CLI", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "feature-layout-"));
    const files: Record<string, string> = {
      "src/features/demo/constants.ts": `// @runtime client\nexport const C = 1;\n`,
      "src/features/demo/feature.ts": `import { C } from "./constants.ts";\nexport const f = C;\n`,
    };
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function cli(...args: string[]): Promise<number> {
    const proc = Bun.spawn({
      cmd: ["bun", SCRIPT, dir, "--no-format", ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return proc.exited;
  }

  it("--check exits 1 while a client file is outside web/ and touches nothing", async () => {
    expect(await cli("--check")).toBe(1);
    expect(existsSync(join(dir, "src/features/demo/constants.ts"))).toBe(true);
  });

  it("--dry-run reports and exits 0 without writing", async () => {
    expect(await cli("--dry-run")).toBe(0);
    expect(existsSync(join(dir, "src/features/demo/web/constants.ts"))).toBe(false);
  });

  it("writes by default, is idempotent, and --check is clean afterwards", async () => {
    expect(await cli()).toBe(0);
    expect(existsSync(join(dir, "src/features/demo/constants.ts"))).toBe(false);
    expect(readFileSync(join(dir, "src/features/demo/web/constants.ts"), "utf8")).toBe(
      `export const C = 1;\n`,
    );
    const featureAfterFirstRun = readFileSync(join(dir, "src/features/demo/feature.ts"), "utf8");
    expect(featureAfterFirstRun).toBe(
      `import { C } from "./web/constants.ts";\nexport const f = C;\n`,
    );
    expect(await cli()).toBe(0);
    expect(readFileSync(join(dir, "src/features/demo/feature.ts"), "utf8")).toBe(
      featureAfterFirstRun,
    );
    expect(await cli("--check")).toBe(0);
  });
});
