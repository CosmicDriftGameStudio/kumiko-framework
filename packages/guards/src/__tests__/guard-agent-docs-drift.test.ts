import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_DOCS_DIR, renderAgentDocs, writeAgentDocs } from "../_lib/agent-docs";
import { check } from "../guard-agent-docs-drift";
import { API_ENTRY_FIXTURE_FILES } from "./agent-docs-entry-fixture";
import { fixtureRoot } from "./parent-workspace-fixture";

const FEATURE_MANIFEST_PATH = "samples/apps/use-all-bundled/feature-manifest.json";
const RECIPE_FEATURE_PATH = "samples/recipes/demo/src/feature.ts";

function manifestWith(description: string): string {
  return JSON.stringify({
    features: [
      {
        name: "mail",
        description,
        requires: [],
        optionalRequires: [],
        exposesApis: [],
        usesApis: [],
        configKeys: [{ key: "limit", type: "number", scope: "system", default: 5 }],
        secrets: [],
      },
    ],
  });
}

const BASE_FILES: Record<string, string> = {
  ...API_ENTRY_FIXTURE_FILES,
  "packages/framework/AGENTS.md": "Start with `agents/features.md`.\n",
  [FEATURE_MANIFEST_PATH]: manifestWith("Does a demo thing."),
  "samples/recipes/demo/package.json": JSON.stringify({ description: "Demo recipe." }),
  "samples/recipes/demo/README.md": "# Demo\n\nReadme body.\n",
  [RECIPE_FEATURE_PATH]: "export const demo = 1;\n",
  "packages/renderer/src/web/index.ts": [
    "/** Shows a card. Second sentence is dropped. */",
    "export function DemoCard(): null {",
    "  return null;",
    "}",
    "",
    "/** Reads the demo state. */",
    "export function useDemoState(): number {",
    "  return 1;",
    "}",
    "",
    "export interface DemoCardProps {",
    "  readonly title: string;",
    "}",
    "",
  ].join("\n"),
};

function makeRepo(overrides: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "agent-docs-drift-guard-"));
  for (const [rel, content] of Object.entries({ ...BASE_FILES, ...overrides })) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function runCheck(root: string) {
  return check.run([
    fixtureRoot("fixture-framework", root, {
      kind: "framework",
      sourceRoots: ["packages/*/src"],
      testGlobs: ["packages/*/src/**/*.test.ts"],
    }),
  ]);
}

function overwrite(root: string, rel: string, content: string): void {
  writeFileSync(join(root, rel), content);
}

describe("agent-docs-drift guard", () => {
  test("is green after the docs were generated", async () => {
    const root = makeRepo();
    try {
      writeAgentDocs(root);
      const outcome = await runCheck(root);
      expect(outcome.violations).toEqual([]);
      expect(outcome.notApplicable).toBe(false);
      expect(outcome.matchedFiles).toBe(17);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags a missing generated file", async () => {
    const root = makeRepo();
    try {
      const outcome = await runCheck(root);
      expect(outcome.violations.map((v) => v.file)).toContain(`${AGENT_DOCS_DIR}/features.md`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags a changed recipe source until regenerated", async () => {
    const root = makeRepo();
    try {
      writeAgentDocs(root);
      overwrite(root, RECIPE_FEATURE_PATH, "export const demo = 2;\n");
      const stale = await runCheck(root);
      expect(stale.violations).toHaveLength(1);
      expect(stale.violations[0]?.file).toBe(`${AGENT_DOCS_DIR}/examples/demo.md`);
      expect(stale.violations[0]?.line).toBeGreaterThan(1);
      writeAgentDocs(root);
      expect((await runCheck(root)).violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags a changed feature manifest until regenerated", async () => {
    const root = makeRepo();
    try {
      writeAgentDocs(root);
      overwrite(root, FEATURE_MANIFEST_PATH, manifestWith("Changed description."));
      const stale = await runCheck(root);
      expect(stale.violations.map((v) => v.file)).toEqual([
        `${AGENT_DOCS_DIR}/features-index.md`,
        `${AGENT_DOCS_DIR}/features.md`,
      ]);
      writeAgentDocs(root);
      expect((await runCheck(root)).violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags a stale extra file in the agents directory", async () => {
    const root = makeRepo();
    try {
      writeAgentDocs(root);
      overwrite(root, `${AGENT_DOCS_DIR}/examples/removed.md`, "old\n");
      const outcome = await runCheck(root);
      expect(outcome.violations.map((v) => v.file)).toEqual([
        `${AGENT_DOCS_DIR}/examples/removed.md`,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags an AGENTS.md reference to a file that is not generated", async () => {
    const root = makeRepo({
      "packages/framework/AGENTS.md": "Intro.\nSee `agents/examples/nope.md`.\n",
    });
    try {
      writeAgentDocs(root);
      const outcome = await runCheck(root);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe("packages/framework/AGENTS.md");
      expect(outcome.violations[0]?.line).toBe(2);
      expect(outcome.violations[0]?.message).toContain("agents/examples/nope.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is not applicable without the framework package", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-docs-drift-guard-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "some-app" }));
      const outcome = await runCheck(root);
      expect(outcome.notApplicable).toBe(true);
      expect(outcome.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("widgets.md lists documented components and hooks but not types", () => {
    const root = makeRepo();
    try {
      writeAgentDocs(root);
      const widgets = readFileSync(join(root, AGENT_DOCS_DIR, "widgets.md"), "utf-8");
      expect(widgets).toContain("| `DemoCard` | Shows a card. |");
      expect(widgets).toContain("| `useDemoState` | Reads the demo state. |");
      expect(widgets).not.toContain("DemoCardProps");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a recipe directory with an invalid slug", () => {
    const root = makeRepo({
      "samples/recipes/Bad_Name/package.json": JSON.stringify({ description: "x" }),
    });
    try {
      expect(() => writeAgentDocs(root)).toThrow(/Bad_Name/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("recipe examples include sources outside src/ but skip generated and vendored files", () => {
    const root = makeRepo({
      "samples/recipes/demo/bin/api.ts": "export const api = 1;\n",
      "samples/recipes/demo/e2e/flow.spec.ts": "export const flow = 1;\n",
      "samples/recipes/demo/.kumiko/routes.generated.ts": "export const generated = 1;\n",
      "samples/recipes/demo/node_modules/dep/index.ts": "export const dep = 1;\n",
    });
    try {
      const example = renderAgentDocs(root).get("examples/demo.md") ?? "";
      expect(example).toContain("### bin/api.ts");
      expect(example).toContain("### e2e/flow.spec.ts");
      expect(example).toContain("### src/feature.ts");
      expect(example).not.toContain("routes.generated");
      expect(example).not.toContain("node_modules");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
