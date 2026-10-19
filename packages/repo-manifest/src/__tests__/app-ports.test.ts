import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findPortCollisions,
  parseStaticAppConfig,
  readStaticAppConfig,
  scanWorkspaceApps,
} from "../app-ports/index.ts";

const APP_CONFIG = `import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";
export default defineAppConfig({
  features: [],
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4400, e2e: 4401, infra: { meilisearch: 17710 } },
});
`;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kumiko-app-ports-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
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

  test("a missing file reads as missing, a present one as defined", () => {
    expect(readStaticAppConfig(root)).toEqual({ kind: "missing" });
    writeFileSync(join(root, "kumiko.config.ts"), APP_CONFIG);
    expect(readStaticAppConfig(root).kind).toBe("defined");
  });
});

describe("port registry", () => {
  test("reports a port claimed by two apps across roles", () => {
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
  });
});
