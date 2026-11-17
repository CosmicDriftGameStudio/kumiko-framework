import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_INFRA_REF,
  checkAppScripts,
  checkManagedFiles,
  findKumikoPinErrors,
  isManagedDrift,
  type ManagedAppFacts,
  type ManagedFileReport,
  PREPARE_SCRIPT,
  readManagedMarker,
  renderManagedTemplates,
  resolveManagedAppFacts,
  STANDARD_APP_SCRIPTS,
  syncManagedFiles,
} from "../managed-files/index.ts";
import { render } from "../scaffold-deploy.ts";

const APP_CONFIG = `import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";
export default defineAppConfig({
  features: [],
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4400, e2e: 4401, infra: { meilisearch: 17710 } },
});
`;

let appRoot: string;

beforeEach(() => {
  appRoot = mkdtempSync(join(tmpdir(), "kumiko-managed-"));
  writeFileSync(join(appRoot, "package.json"), JSON.stringify({ name: "shop-app" }));
  writeFileSync(join(appRoot, "kumiko.config.ts"), APP_CONFIG);
});
afterEach(() => {
  rmSync(appRoot, { recursive: true, force: true });
});

function facts(): ManagedAppFacts {
  return resolveManagedAppFacts({ appRoot, uiRoots: ["src/features/*/web"] });
}

function report(path: string): ManagedFileReport {
  const found = checkManagedFiles(facts()).files.find((file) => file.path === path);
  if (found === undefined) throw new Error(`no report for ${path}`);
  return found;
}

function syncAll(): void {
  syncManagedFiles(facts(), { write: true, adopt: false });
}

describe("managed marker", () => {
  test("reads managed, local, unmarked and invalid markers", () => {
    expect(readManagedMarker("# kumiko-managed\nx\n")).toEqual({ kind: "managed" });
    expect(readManagedMarker("#!/bin/sh\n# kumiko-managed\nx\n")).toEqual({ kind: "managed" });
    expect(readManagedMarker("// kumiko-managed\n// kumiko-managed: local needs minio\n")).toEqual({
      kind: "local",
      reason: "needs minio",
    });
    expect(readManagedMarker("name: ci\n")).toEqual({ kind: "unmarked" });
    expect(readManagedMarker("# kumiko-managed\n# kumiko-managed: local \n").kind).toBe("invalid");
  });
});

describe("kumiko check managed", () => {
  test("freshly synced files match the template", () => {
    syncAll();
    const result = checkManagedFiles(facts());
    expect(result.adopted).toBe(true);
    const drift = result.files.filter(isManagedDrift).map((file) => file.path);
    // Seeds are app-owned and only checked for existence.
    expect(drift.sort()).toEqual(["bin/env-schema.ts", "bin/server.ts"]);
    expect(report(".github/workflows/ci.yml").state).toBe("ok");
    expect(report("bunfig.dom.toml").state).toBe("ok");
  });

  test("one changed line is drift with a diff naming both sides", () => {
    syncAll();
    const path = join(appRoot, ".github/workflows/cache-cleanup.yml");
    const lines = readFileSync(path, "utf-8").split("\n");
    const target = lines.findIndex((line) => line.includes("runs-on:"));
    lines[target] = "    runs-on: macos-latest";
    writeFileSync(path, lines.join("\n"));

    const drifted = report(".github/workflows/cache-cleanup.yml");
    expect(drifted.state).toBe("differs");
    if (drifted.state !== "differs") return;
    expect(drifted.diff).toContain("+     runs-on: macos-latest");
    expect(drifted.diff).toContain("-     runs-on: ubuntu-latest");
  });

  test("a local marker skips the file and lists the reason", () => {
    syncAll();
    const path = join(appRoot, ".github/workflows/release.yml");
    const content = readFileSync(path, "utf-8").replace(
      "# kumiko-managed\n",
      "# kumiko-managed\n# kumiko-managed: local deploys via argo\nchanged: true\n",
    );
    writeFileSync(path, content);

    const local = report(".github/workflows/release.yml");
    expect(local).toMatchObject({ state: "local", reason: "deploys via argo" });
    expect(isManagedDrift(local)).toBe(false);
  });

  test("structural files must extend the framework presets", () => {
    syncAll();
    writeFileSync(join(appRoot, "biome.json"), JSON.stringify({ formatter: { enabled: true } }));
    expect(isManagedDrift(report("biome.json"))).toBe(true);
    writeFileSync(
      join(appRoot, "tsconfig.json"),
      `{\n  // app override\n  "extends": "@cosmicdrift/kumiko-framework/tsconfig.app.json",\n  "include": ["src"],\n}\n`,
    );
    expect(report("tsconfig.json").state).toBe("ok");
  });

  test("ci.yml switches service inputs from the infra ports", () => {
    syncAll();
    const ci = readFileSync(join(appRoot, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toContain("meilisearch: true");
    expect(ci).not.toContain("minio: true");
    expect(ci).toContain("${{ ");
  });

  test("the test job grants the read permissions the v2 reusable test workflow asks for", () => {
    syncAll();
    const ci = readFileSync(join(appRoot, ".github/workflows/ci.yml"), "utf-8");
    expect(ci).toMatch(
      /\n {2}test:\n {4}if: contains\(fromJSON\('\["pull_request","merge_group"\]'\), github\.event_name\)\n {4}permissions:\n {6}contents: read\n {6}packages: read\n {6}pull-requests: read\n {4}uses: /,
    );
  });
});

describe("bin/kumiko.ts template", () => {
  test("bin/kumiko.ts is a managed template running the standalone CLI", () => {
    const entry = renderManagedTemplates(facts()).find((file) => file.path === "bin/kumiko.ts");
    if (entry === undefined) throw new Error("no bin/kumiko.ts template");
    expect(entry.content).toContain("runStandaloneCli");
    expect(entry.content).toContain("requireKms");
    expect(readManagedMarker(entry.content).kind).toBe("managed");
  });
});

describe("kumiko sync-managed", () => {
  test("never overwrites an unmarked file without --adopt", () => {
    mkdirSync(join(appRoot, ".github/workflows"), { recursive: true });
    const path = join(appRoot, ".github/workflows/ci.yml");
    writeFileSync(path, "name: hand-written\n");

    const actions = syncManagedFiles(facts(), { write: true, adopt: false });
    expect(actions.find((action) => action.path === ".github/workflows/ci.yml")?.action).toBe(
      "skip",
    );
    expect(readFileSync(path, "utf-8")).toBe("name: hand-written\n");

    syncManagedFiles(facts(), { write: true, adopt: true });
    expect(readManagedMarker(readFileSync(path, "utf-8"))).toEqual({ kind: "managed" });
  });

  test("keeps local files and app-owned files untouched", () => {
    syncAll();
    const release = join(appRoot, ".github/workflows/release.yml");
    const local = "# kumiko-managed\n# kumiko-managed: local custom rollout\nname: own\n";
    writeFileSync(release, local);
    writeFileSync(join(appRoot, "biome.json"), '{ "extends": ["x"] }\n');

    syncManagedFiles(facts(), { write: true, adopt: true });
    expect(readFileSync(release, "utf-8")).toBe(local);
    expect(readFileSync(join(appRoot, "biome.json"), "utf-8")).toBe('{ "extends": ["x"] }\n');
    expect(readFileSync(join(appRoot, "kumiko.config.ts"), "utf-8")).toBe(APP_CONFIG);
  });

  test("refuses to write through a symlinked directory", () => {
    const outside = mkdtempSync(join(tmpdir(), "kumiko-managed-outside-"));
    try {
      symlinkSync(outside, join(appRoot, "deploy"));
      const actions = syncManagedFiles(facts(), { write: true, adopt: true });
      const dockerfile = actions.find((action) => action.path === "deploy/Dockerfile");
      expect(dockerfile).toMatchObject({ action: "skip", skippedBecause: "deploy is a symlink" });
      expect(existsSync(join(outside, "Dockerfile"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("dry run writes nothing", () => {
    const actions = syncManagedFiles(facts(), { write: false, adopt: false });
    expect(actions.some((action) => action.action === "create")).toBe(true);
    expect(existsSync(join(appRoot, ".github"))).toBe(false);
  });
});

describe("template values", () => {
  test("rejects an app name that could inject into workflows or shell", () => {
    expect(() => resolveManagedAppFacts({ appRoot, appName: "shop$(id)", uiRoots: [] })).toThrow(
      /kebab-case/,
    );
  });

  test("rejects a release namespace that is no Kubernetes name", () => {
    writeFileSync(
      join(appRoot, "package.json"),
      JSON.stringify({ name: "shop-app", kumiko: { deploy: { namespace: "prod\nrun: evil" } } }),
    );
    expect(() => syncManagedFiles(facts(), { write: false, adopt: false })).toThrow();
  });

  test("render leaves GitHub expressions alone", () => {
    // Joined so the literal does not read as a JS template placeholder.
    const githubExpression = ["$", "{{ github.sha }}"].join("");
    expect(render(`${githubExpression} {{appName}}`, { appName: "shop-app" }, {})).toBe(
      `${githubExpression} shop-app`,
    );
  });

  test("the husky template equals the framework's own pre-push hook", () => {
    const template = readFileSync(
      join(import.meta.dir, "..", "..", "templates", "managed", "husky-pre-push.template"),
      "utf-8",
    );
    const hook = readFileSync(
      join(import.meta.dir, "..", "..", "..", "guards", "hooks", "pre-push"),
      "utf-8",
    );
    expect(template).toBe(hook);
  });
});

describe("infraRef, visibility and app jobs", () => {
  function setDeploy(deploy: Record<string, unknown>): void {
    writeFileSync(
      join(appRoot, "package.json"),
      JSON.stringify({ name: "shop-app", kumiko: { deploy } }),
    );
  }
  const read = (path: string) => readFileSync(join(appRoot, path), "utf-8");

  test("infraRef pins every private reusable workflow to the tag", () => {
    setDeploy({ infraRef: "infra-v3" });
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    const release = read(".github/workflows/release.yml");
    expect(ci).toContain("@infra-v3");
    expect(ci).not.toContain("@main");
    expect(release).toContain("_app-deploy.yml@infra-v3");
    expect(checkManagedFiles(facts()).errors).toEqual([]);
  });

  test("without infraRef the workflows pin the framework's infra tag and the check passes", () => {
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain(`_app-test.yml@${CURRENT_INFRA_REF}`);
    expect(ci).not.toContain("@main");
    expect(read(".github/workflows/release.yml")).toContain(`_app-deploy.yml@${CURRENT_INFRA_REF}`);
    expect(checkManagedFiles(facts()).errors).toEqual([]);
  });

  test("an infraRef that could inject into a workflow is rejected", () => {
    setDeploy({ infraRef: "main\nrun: evil" });
    expect(() => syncManagedFiles(facts(), { write: false, adopt: false })).toThrow();
  });

  test("public visibility has no private reusables and only a rollout hint", () => {
    setDeploy({ visibility: "public" });
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    const release = read(".github/workflows/release.yml");
    expect(ci).not.toContain("_app-deploy.yml");
    expect(ci).not.toContain("infra/.github");
    expect(release).not.toContain("_app-deploy.yml");
    expect(release).toContain(
      "gh workflow run public-app-rollout.yml --repo cosmicdriftgamestudio/infra -f app=shop-app",
    );
    expect(checkManagedFiles(facts()).errors).toEqual([]);
  });

  test("public ci.yml points the integration step at the meilisearch service port", () => {
    setDeploy({ visibility: "public" });
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("MEILI_URL: http://localhost:17700");
    expect(ci).toContain("MEILI_MASTER_KEY: kumiko-dev-key");
  });

  test("docStatusGuard false renders the input, the default does not", () => {
    syncAll();
    expect(read(".github/workflows/ci.yml")).not.toContain("doc-status-guard");
    setDeploy({ docStatusGuard: false });
    syncAll();
    expect(read(".github/workflows/ci.yml")).toContain("doc-status-guard: false");
  });

  test("checks run on pull requests only and the build does not wait for them", () => {
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(
      /\n {2}integration:\n {4}if: contains\(fromJSON\('\["pull_request","merge_group"\]'\), github\.event_name\)\n/,
    );
    expect(ci).not.toContain("needs:");
  });

  test("e2eShards and e2eChromiumFull render the e2e inputs, the defaults do not", () => {
    syncAll();
    expect(read(".github/workflows/ci.yml")).not.toContain("shards:");
    expect(read(".github/workflows/ci.yml")).not.toContain("chromium-full");
    setDeploy({ e2eShards: 4, e2eChromiumFull: true });
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("      shards: 4\n");
    expect(ci).toContain("      chromium-full: true\n");
  });

  test("e2eShards 1 renders no shards input", () => {
    setDeploy({ e2eShards: 1 });
    syncAll();
    expect(read(".github/workflows/ci.yml")).not.toContain("shards:");
  });

  test("an e2eShards below 1 is rejected", () => {
    setDeploy({ e2eShards: 0 });
    expect(() => syncManagedFiles(facts(), { write: false, adopt: false })).toThrow();
  });

  test("public ci.yml caches the install and runs comment-lang and agent lint", () => {
    setDeploy({ visibility: "public" });
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("path: ~/.bun/install/cache");
    expect(ci).toContain("run: bun kumiko-guards comment-lang");
    expect(ci).toContain("run: bun kumiko agent lint");
  });

  const APP_JOB =
    "  app-seed-check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo own\n";

  test("an app-* job is no drift and survives a sync", () => {
    syncAll();
    const path = join(appRoot, ".github/workflows/ci.yml");
    writeFileSync(path, `${read(".github/workflows/ci.yml").replace(/\n+$/, "")}\n\n${APP_JOB}`);

    expect(report(".github/workflows/ci.yml").state).toBe("ok");
    syncAll();
    expect(read(".github/workflows/ci.yml")).toContain("app-seed-check:");
  });

  test("a sync after a template change keeps the app job", () => {
    syncAll();
    const path = join(appRoot, ".github/workflows/ci.yml");
    writeFileSync(path, `${read(".github/workflows/ci.yml").replace(/\n+$/, "")}\n\n${APP_JOB}`);
    setDeploy({ infraRef: "infra-v4" });

    expect(report(".github/workflows/ci.yml").state).toBe("differs");
    syncAll();
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("@infra-v4");
    expect(ci).toContain("app-seed-check:");
    expect(report(".github/workflows/ci.yml").state).toBe("ok");
  });

  test("a changed managed job next to an app job is still drift", () => {
    syncAll();
    const path = join(appRoot, ".github/workflows/ci.yml");
    writeFileSync(
      path,
      `${read(".github/workflows/ci.yml").replace("name: CI", "name: Own CI").replace(/\n+$/, "")}\n\n${APP_JOB}`,
    );
    expect(report(".github/workflows/ci.yml").state).toBe("differs");
  });

  test("the pre-push template has no bypass variable", () => {
    const template = readFileSync(
      join(import.meta.dir, "..", "..", "templates", "managed", "husky-pre-push.template"),
      "utf-8",
    );
    expect(template).not.toContain("PRE_PUSH_SKIP");
  });
});

describe("script standard", () => {
  test("lists missing standard scripts and classifies extras", () => {
    const scripts = Object.fromEntries(
      STANDARD_APP_SCRIPTS.filter((name) => name !== "screenshots").map((name) => [name, "x"]),
    );
    const report = checkAppScripts(
      { ...scripts, prepare: PREPARE_SCRIPT, shots: "x", "eval:triage": "x" },
      { hasUi: true },
    );
    expect(report.missing).toEqual(["screenshots"]);
    expect(report.knownExtras).toEqual(["shots"]);
    expect(report.appExtras).toEqual(["eval:triage"]);
  });

  describe("test command timeouts", () => {
    const GOOD = {
      test: "bun test --dots",
      "test:dom": "bun test --dots --config=bunfig.dom.toml .test.tsx",
      "test:real": "bun --config=bunfig.real.toml test --timeout=240000 real.test.ts",
      "test:integration": "bun kumiko-testing integration",
      "test:e2e": "bunx --bun playwright test",
      check: "bun run test && bun run lint",
    };
    const errorsOf = (scripts: Record<string, string>): readonly string[] =>
      checkAppScripts(scripts, { hasUi: true }).testCommandErrors;

    test("accepts commands that match their class", () => {
      expect(errorsOf(GOOD)).toEqual([]);
    });

    test("flags a dom script with a raised timeout", () => {
      const errors = errorsOf({
        ...GOOD,
        "test:dom": "bun test --dots --config=bunfig.dom.toml --timeout=15000 .test.tsx",
      });
      expect(errors).toEqual([expect.stringContaining("--timeout=5000 (TEST_TIMEOUT_MS.dom)")]);
    });

    test("flags a real script without --timeout", () => {
      const errors = errorsOf({ ...GOOD, "test:real": "bun --config=bunfig.real.toml test" });
      expect(errors).toEqual([expect.stringContaining("TEST_TIMEOUT_MS.real")]);
    });

    test("flags integration tests that bypass kumiko-testing", () => {
      const errors = errorsOf({
        ...GOOD,
        "test:integration": "bun test --config=bunfig.integration.toml",
      });
      expect(errors).toContainEqual(expect.stringContaining("must delegate to"));
    });

    test("skips configs it does not know", () => {
      expect(
        errorsOf({ ...GOOD, "test:lib-coverage": "bun test src --config=bunfig.coverage.toml" }),
      ).toEqual([]);
    });
  });

  test("test:dom is only required with uiRoots", () => {
    expect(checkAppScripts({}, { hasUi: false }).missing).not.toContain("test:dom");
    expect(checkAppScripts({}, { hasUi: true }).missing).toContain("test:dom");
  });
});

describe("Kumiko dependency pins", () => {
  function pins(
    dependencies: Record<string, string>,
    devDependencies: Record<string, string> = {},
  ) {
    return findKumikoPinErrors({ name: "shop-app", dependencies, devDependencies });
  }

  test("peerDependencies keep their lower bound", () => {
    expect(
      findKumikoPinErrors({ peerDependencies: { "@cosmicdrift/kumiko-framework": ">=0.379.0" } }),
    ).toEqual([]);
  });

  test("exact versions on one version per scope pass", () => {
    expect(
      pins(
        {
          "@cosmicdrift/kumiko-framework": "0.379.0",
          "@cosmicdrift/kumiko-renderer": "0.379.0",
          "@cosmicdriftgamestudio/kumiko-enterprise": "0.61.0",
          react: "^19.0.0",
        },
        { "create-kumiko-app": "0.379.0", "@cosmicdrift/kumiko-testing": "0.379.0" },
      ),
    ).toEqual([]);
  });

  test("workspace: specs are allowed", () => {
    expect(pins({ "@cosmicdrift/kumiko-framework": "workspace:*" })).toEqual([]);
  });

  test("a caret range is an error naming the package", () => {
    const errors = pins({ "@cosmicdrift/kumiko-framework": "^0.379.0" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("@cosmicdrift/kumiko-framework@^0.379.0");
  });

  test("tilde, dist-tag and git specs are errors too", () => {
    expect(
      pins({
        "@cosmicdrift/kumiko-types": "~0.379.0",
        "@cosmicdrift/kumiko-cli": "latest",
        "@cosmicdriftgamestudio/kumiko-enterprise": "github:org/repo",
      }),
    ).toHaveLength(3);
  });

  test("two versions inside one scope are an error, across scopes they are not", () => {
    const errors = pins(
      { "@cosmicdrift/kumiko-framework": "0.379.0" },
      { "@cosmicdrift/kumiko-testing": "0.378.0" },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "@cosmicdrift packages are pinned to 2 versions (0.378.0, 0.379.0)",
    );
  });

  test("check reports pin errors from the app's package.json", () => {
    writeFileSync(
      join(appRoot, "package.json"),
      JSON.stringify({
        name: "shop-app",
        kumiko: { deploy: { infraRef: "reusables-v1.0.0" } },
        dependencies: { "@cosmicdrift/kumiko-framework": "^0.379.0" },
      }),
    );
    expect(checkManagedFiles(facts()).errors).toHaveLength(1);
  });
});
