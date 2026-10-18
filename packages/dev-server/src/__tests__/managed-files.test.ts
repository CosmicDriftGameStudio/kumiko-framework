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
  checkAppScripts,
  checkManagedFiles,
  findPortCollisions,
  isManagedDrift,
  type ManagedAppFacts,
  type ManagedFileReport,
  PREPARE_SCRIPT,
  parseStaticAppConfig,
  readManagedMarker,
  resolveManagedAppFacts,
  STANDARD_APP_SCRIPTS,
  scanWorkspaceApps,
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

describe("kumiko.config.ts static read", () => {
  test("defined, legacy and invalid configs", () => {
    expect(parseStaticAppConfig(APP_CONFIG)).toEqual({
      kind: "defined",
      ports: { dev: 4400, e2e: 4401, infra: { meilisearch: 17710 } },
    });
    expect(parseStaticAppConfig("export default { features: [] };\n")).toEqual({
      kind: "legacy",
    });
    const spread = parseStaticAppConfig(
      "import { defineAppConfig } from 'x';\nconst p = { dev: 1, e2e: 2 };\nexport default defineAppConfig({ features: [], client: { entries: ['a'] }, ports: { ...p } });\n",
    );
    expect(spread.kind).toBe("invalid");
  });
});

describe("port registry", () => {
  test("reports a port claimed by two apps across roles", () => {
    const root = mkdtempSync(join(tmpdir(), "kumiko-ports-"));
    try {
      for (const [name, ports] of [
        ["app-a", "{ dev: 4320, e2e: 4321 }"],
        ["app-b", "{ dev: 4330, e2e: 4320, infra: { postgres: 15432 } }"],
        ["app-c", "{ dev: 4340, e2e: 4341, infra: { postgres: 15433 } }"],
      ] as const) {
        mkdirSync(join(root, name));
        writeFileSync(
          join(root, name, "kumiko.config.ts"),
          `export default defineAppConfig({ features: [], client: { entries: ["src/client.tsx"] }, ports: ${ports} });\n`,
        );
      }
      const apps = scanWorkspaceApps(root);
      expect(apps.map((app) => app.app)).toEqual(["app-a", "app-b", "app-c"]);
      expect(findPortCollisions(apps)).toEqual([
        {
          port: 4320,
          claims: [
            { app: "app-a", role: "dev" },
            { app: "app-b", role: "e2e" },
          ],
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  test("test:dom is only required with uiRoots", () => {
    expect(checkAppScripts({}, { hasUi: false }).missing).not.toContain("test:dom");
    expect(checkAppScripts({}, { hasUi: true }).missing).toContain("test:dom");
  });
});
