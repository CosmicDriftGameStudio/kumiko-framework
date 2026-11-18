import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../check-runtime-isolation";
import {
  createDirectiveClassifier,
  createKumikoPackageClassifier,
} from "../runtime-isolation-classify";
import { fixtureRoot } from "./parent-workspace-fixture";

describe("Runtime-Isolation check.run — repo kind scope", () => {
  test("a tooling root is notApplicable, an app root with a source file is not", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-isolation-kind-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "plain.ts"), "export const value = 1;\n");
      const manifest = { sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] };

      const tooling = check.run([
        fixtureRoot("tooling-repo", dir, { ...manifest, kind: "tooling" }),
      ]);
      expect(tooling).toMatchObject({ notApplicable: true, violations: [] });

      const app = check.run([fixtureRoot("app-repo", dir, { ...manifest, kind: "app" })]);
      expect(app).toMatchObject({ notApplicable: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Runtime-Isolation check.run — violation line resolution", () => {
  test("each regression points at its own import line, not the file's first violation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-isolation-lines-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "dev-a.ts"), "// @runtime dev\nexport const a = 1;\n");
      writeFileSync(join(dir, "src", "dev-b.ts"), "// @runtime dev\nexport const b = 1;\n");
      writeFileSync(
        join(dir, "src", "entry.ts"),
        [
          "// @runtime runtime",
          'import { a } from "./dev-a";',
          "",
          "",
          'import { b } from "./dev-b";',
          "export const both = [a, b];",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(dir, ".kumiko-runtime-isolation-baseline.json"),
        JSON.stringify({ format: 1, generated: "fixture", total: 0, perFile: {} }),
      );
      const manifest = {
        kind: "app" as const,
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      };

      const { violations } = await check.run([fixtureRoot("app-repo", dir, manifest)]);

      const lineByViolationKey = Object.fromEntries(
        violations.map((v) => [v.file, v.line] as const),
      );
      expect(violations).toHaveLength(2);
      expect(lineByViolationKey).toEqual({
        "src/entry.ts::./dev-a": 2,
        "src/entry.ts::./dev-b": 5,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Incident: a feature's i18n.ts, reached from the browser entry, imported
// handlerTranslationKeys from kumiko-framework/engine instead of /ui-types; pino
// landed in the client bundle and the app did not start in the browser.
// The fixture package name stays outside this repo's tsconfig `paths`, which would
// otherwise resolve @cosmicdrift/kumiko-framework to packages/framework here.
const FIXTURE_PACKAGE = "@cosmicdrift/kumiko-fixture-framework";

function mkdirP(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Runtime-Isolation check.run — client code importing a Kumiko server entry", () => {
  // "published" mirrors the npm tarball: only compiled dist/ ships, exports point at dist/*.d.ts.
  function appWithFrameworkPackage(i18nSource: string, layout: "source" | "published"): string {
    const dir = mkdtempSync(join(tmpdir(), "runtime-isolation-server-entry-"));
    const pkgRoot = join(dir, `node_modules/${FIXTURE_PACKAGE}`);
    const outDir = layout === "source" ? "src" : "dist";
    const typesFile = (name: string) =>
      layout === "source" ? `./src/${name}/index.ts` : `./dist/${name}/index.d.ts`;
    const entry = (name: string) => ({
      types: typesFile(name),
      default: layout === "source" ? typesFile(name) : `./dist/${name}/index.js`,
    });
    writeFileSync(
      join(mkdirP(pkgRoot), "package.json"),
      JSON.stringify({
        name: FIXTURE_PACKAGE,
        kumiko: { runtime: "runtime" },
        repository: { directory: "packages/framework" },
        exports: {
          "./engine": entry("engine"),
          "./ui-types": entry("ui-types"),
          "./time": entry("time"),
          "./biome": "./presets/biome-app.json",
        },
      }),
    );
    const declare = (source: string, declaration: string) =>
      layout === "source" ? source : declaration;
    writeFileSync(
      join(mkdirP(join(pkgRoot, outDir, "ui-types")), typesFile("ui-types").split("/").pop() ?? ""),
      declare(
        "export const handlerTranslationKeys = (feature: string) => feature;\nexport type TranslationValue = string;\n",
        "export declare const handlerTranslationKeys: (feature: string) => string;\nexport type TranslationValue = string;\n",
      ),
    );
    writeFileSync(
      join(mkdirP(join(pkgRoot, outDir, "engine")), typesFile("engine").split("/").pop() ?? ""),
      declare(
        'export { handlerTranslationKeys } from "../ui-types/index";\nexport const createLogger = () => 1;\n',
        'export { handlerTranslationKeys } from "../ui-types/index";\nexport declare const createLogger: () => number;\n',
      ),
    );
    // time/ is client only through the framework-scoped PATH_RULE on packages/framework/src/.
    writeFileSync(
      join(mkdirP(join(pkgRoot, outDir, "time")), typesFile("time").split("/").pop() ?? ""),
      declare("export const today = () => 1;\n", "export declare const today: () => number;\n"),
    );
    mkdirSync(join(dir, "src/features/publish/web"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }));
    writeFileSync(
      join(dir, ".kumiko-runtime-isolation-baseline.json"),
      JSON.stringify({ format: 1, generated: "fixture", total: 0, perFile: {} }),
    );
    writeFileSync(
      join(dir, "src/client.tsx"),
      'import { PublishScreen } from "./features/publish/web/publish-screen";\nexport const screens = [PublishScreen];\n',
    );
    writeFileSync(
      join(dir, "src/features/publish/web/publish-screen.ts"),
      'import { PUBLISH_I18N } from "../i18n";\nexport const PublishScreen = PUBLISH_I18N;\n',
    );
    writeFileSync(join(dir, "src/features/publish/i18n.ts"), i18nSource);
    return dir;
  }

  const manifest = { kind: "app" as const, sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] };

  async function runOn(i18nSource: string, layout: "source" | "published" = "source") {
    const dir = appWithFrameworkPackage(i18nSource, layout);
    try {
      return await check.run([fixtureRoot("app-repo", dir, manifest)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a client-reachable value import of /engine is a violation naming chain and replacement", async () => {
    const { violations } = await runOn(
      `import { handlerTranslationKeys } from "${FIXTURE_PACKAGE}/engine";\nexport const PUBLISH_I18N = handlerTranslationKeys("publish");\n`,
    );
    expect(violations).toHaveLength(1);
    const [violation] = violations;
    expect(violation).toMatchObject({
      file: "src/features/publish/i18n.ts",
      line: 1,
      neverFrozen: true,
    });
    expect(violation?.message).toContain(`"${FIXTURE_PACKAGE}/engine"`);
    expect(violation?.message).toContain(
      "src/client.tsx -> src/features/publish/web/publish-screen.ts -> src/features/publish/i18n.ts",
    );
    expect(violation?.message).toContain(
      `import handlerTranslationKeys from "${FIXTURE_PACKAGE}/ui-types"`,
    );
  });

  test("the published layout (dist only) is judged by the source-path rules", async () => {
    const fromEngine = await runOn(
      `import { handlerTranslationKeys } from "${FIXTURE_PACKAGE}/engine";\nexport const PUBLISH_I18N = handlerTranslationKeys("publish");\n`,
      "published",
    );
    expect(fromEngine.violations).toHaveLength(1);
    expect(fromEngine.violations[0]?.message).toContain(
      `import handlerTranslationKeys from "${FIXTURE_PACKAGE}/ui-types"`,
    );
    const fromTime = await runOn(
      `import { today } from "${FIXTURE_PACKAGE}/time";\nexport const PUBLISH_I18N = today();\n`,
      "published",
    );
    expect(fromTime.violations).toEqual([]);
  });

  test("the same import from the client-safe /ui-types entry is allowed", async () => {
    const { violations } = await runOn(
      `import { handlerTranslationKeys } from "${FIXTURE_PACKAGE}/ui-types";\nexport const PUBLISH_I18N = handlerTranslationKeys("publish");\n`,
    );
    expect(violations).toEqual([]);
  });

  test("a type-only import of /engine is not a violation", async () => {
    const { violations } = await runOn(
      `import type { createLogger } from "${FIXTURE_PACKAGE}/engine";\nexport type Logger = typeof createLogger;\nexport const PUBLISH_I18N = "publish";\n`,
    );
    expect(violations).toEqual([]);
  });

  test("a server-only import without a client-safe counterpart lists the package's client entries", async () => {
    const { violations } = await runOn(
      `import { createLogger } from "${FIXTURE_PACKAGE}/engine";\nexport const PUBLISH_I18N = createLogger();\n`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain(
      `client-safe entries of ${FIXTURE_PACKAGE}: ${FIXTURE_PACKAGE}/ui-types, ${FIXTURE_PACKAGE}/time;`,
    );
  });
});

// The client-safe entries are derived, not listed: the real framework package.json
// exports plus the guard's own PATH_RULES must keep yielding this split.
describe("createKumikoPackageClassifier — the framework's own exports", () => {
  const frameworkSrc = join(import.meta.dir, "../../../framework/src");
  const judge = createKumikoPackageClassifier({}, createDirectiveClassifier());

  test.each(["engine/index.ts", "db/index.ts", "event-store/index.ts", "i18n/index.ts"])(
    "%s is a server entry",
    (file) => {
      expect(judge(join(frameworkSrc, file), ["*"])?.runtime).toBe("runtime");
    },
  );

  // auth/ only re-exports the ROLES constants; publicstatus imports them in browser code.
  test.each([
    "auth/index.ts",
    "ui-types/index.ts",
    "engine/types/index.ts",
    "errors/index.ts",
    "time/index.ts",
    "utils/index.ts",
  ])("%s is client-safe", (file) => {
    expect(judge(join(frameworkSrc, file), ["*"])).toBeUndefined();
  });

  test("the hint lists exactly the client-safe exports", () => {
    expect(judge(join(frameworkSrc, "engine/index.ts"), ["*"])?.replacement).toBe(
      "this import is not exported by the client-safe entries of @cosmicdrift/kumiko-framework: @cosmicdrift/kumiko-framework/engine/types, @cosmicdrift/kumiko-framework/errors, @cosmicdrift/kumiko-framework/auth, @cosmicdrift/kumiko-framework/time, @cosmicdrift/kumiko-framework/ui-types, @cosmicdrift/kumiko-framework/utils; keep it in server-only code.",
    );
  });
});
