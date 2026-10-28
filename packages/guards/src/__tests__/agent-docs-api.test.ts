import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderAgentDocs } from "../_lib/agent-docs";
import { API_ENTRY_FIXTURE_FILES } from "./agent-docs-entry-fixture";

const BASE_FILES: Readonly<Record<string, string>> = {
  ...API_ENTRY_FIXTURE_FILES,
  "samples/apps/use-all-bundled/feature-manifest.json": JSON.stringify({
    features: [
      {
        name: "mail",
        description: "Sends mail through a provider. Retries are handled by jobs.",
        requires: ["jobs", "secrets"],
        optionalRequires: [],
        exposesApis: [],
        usesApis: [],
        configKeys: [],
        secrets: [],
      },
    ],
  }),
  "packages/renderer/src/web/index.ts": "export {};\n",
};

function withRepo(overrides: Readonly<Record<string, string>>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "agent-docs-api-"));
  try {
    for (const [rel, content] of Object.entries({ ...BASE_FILES, ...overrides })) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function renderedFile(root: string, rel: string): string {
  const content = renderAgentDocs(root).get(rel);
  if (content === undefined) throw new Error(`${rel} was not generated`);
  return content;
}

describe("agent docs API reference", () => {
  test("renders options types as property lists with the first doc sentence", () => {
    withRepo({}, (root) => {
      const engine = renderedFile(root, "api/framework-engine.md");
      expect(engine).toContain("type DemoScreenOptions = { // Options of a demo screen.\n");
      expect(engine).toContain("  id: string;\n");
      expect(engine).toContain("  columns?: ListColumnSpec[]; // Columns shown in the list.\n");
      expect(engine).toContain('  density: "compact" | "comfortable";\n');
      expect(engine).toContain(
        "function defineDemoScreen(options: DemoScreenOptions): DemoScreenOptions; // Builds a demo screen.",
      );
      expect(engine).toContain(
        "const DemoRoles: { admin; user; owner; reader; writer; auditor; operator };",
      );
      expect(engine).not.toContain("Second sentence");
      expect(engine).not.toContain("Line comment");
    });
  });

  test("leaves out @internal declarations and members, and what only they reference", () => {
    withRepo({}, (root) => {
      const docs = renderAgentDocs(root);
      const all = [...docs.values()].join("\n");
      expect(all).not.toContain("InternalOnly");
      expect(all).not.toContain("secretHook");
      expect(all).not.toContain("HiddenHook");
    });
  });

  test("lists referenced but unexported types once in api/types.md", () => {
    withRepo({}, (root) => {
      const types = renderedFile(root, "api/types.md");
      expect(types).toContain("type Sizing = {\n  width: number;\n};");
      expect(types).not.toContain("ListColumnSpec");
      expect(renderedFile(root, "api/framework-engine.md")).toContain(
        "type ListColumnSpec = { // One list column.",
      );
    });
  });

  test("points a later entry point at the file that already documents a shared export", () => {
    withRepo({}, (root) => {
      expect(renderedFile(root, "api/framework-ui-types.md")).toContain(
        "Also exported here, documented in `api/framework-engine.md`: `DemoScreenOptions`",
      );
    });
  });

  test("indexes every entry point and writes no absolute paths", () => {
    withRepo({}, (root) => {
      const docs = renderAgentDocs(root);
      expect(docs.get("api.md")).toContain(
        "| `@cosmicdrift/kumiko-renderer/web` | `api/renderer-web.md` | 0 |",
      );
      for (const content of docs.values()) {
        expect(content).not.toContain(root);
        expect(content).not.toContain("import(");
      }
    });
  });

  test("fails when an entry point is missing from the package exports", () => {
    withRepo(
      {
        "packages/dev-server/package.json": JSON.stringify({
          name: "@cosmicdrift/kumiko-dev-server",
          exports: {},
        }),
      },
      (root) => {
        expect(() => renderAgentDocs(root)).toThrow(/exports\["\.\/testing"\]\.types/);
      },
    );
  });

  test("fails when a re-export does not resolve", () => {
    withRepo(
      { "packages/framework/src/db/index.ts": 'export { gone } from "./missing.ts";\n' },
      (root) => {
        expect(() => renderAgentDocs(root)).toThrow(/cannot resolve re-export "\.\/missing\.ts"/);
      },
    );
  });
});

describe("agent docs feature index", () => {
  test("has one row per feature with the first sentence and the required features", () => {
    withRepo({}, (root) => {
      expect(renderedFile(root, "features-index.md")).toContain(
        "| `mail` | Sends mail through a provider. | `jobs`, `secrets` |",
      );
    });
  });
});
