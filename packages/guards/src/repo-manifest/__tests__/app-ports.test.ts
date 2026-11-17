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

  test("shorthand and spread siblings of ports do not hide literal ports", () => {
    const sibling = parseStaticAppConfig(
      "const features = [];\nexport default defineAppConfig({ features, ...rest, client: { entries: ['a'] }, ports: { dev: 1, e2e: 2 } });\n",
    );
    expect(sibling).toEqual({ kind: "defined", ports: { dev: 1, e2e: 2 } });
    const shorthandPorts = parseStaticAppConfig(
      "const ports = { dev: 1, e2e: 2 };\nexport default defineAppConfig({ features: [], client: { entries: ['a'] }, ports });\n",
    );
    expect(shorthandPorts.kind).toBe("invalid");
    const spreadAfter = parseStaticAppConfig(
      "export default defineAppConfig({ ports: { dev: 1, e2e: 2 }, ...rest });\n",
    );
    expect(spreadAfter.kind).toBe("invalid");
  });

  test("a missing file reads as missing, a present one as defined", () => {
    expect(readStaticAppConfig(root)).toEqual({ kind: "missing" });
    writeFileSync(join(root, "kumiko.config.ts"), APP_CONFIG);
    expect(readStaticAppConfig(root).kind).toBe("defined");
  });
});

function writeAppConfig(dir: string, ports: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "kumiko.config.ts"),
    `export default defineAppConfig({ features: [], client: { entries: ["src/client.tsx"] }, ports: ${ports} });\n`,
  );
}

describe("port registry", () => {
  test("scans apps nested under <child>/apps and reports their collisions", () => {
    writeAppConfig(join(root, "app-a"), "{ dev: 4173, e2e: 4183 }");
    writeAppConfig(join(root, "tm", "apps", "server"), "{ dev: 4173, e2e: 4174 }");
    mkdirSync(join(root, "tm", "apps", "mobile"), { recursive: true });
    const apps = scanWorkspaceApps(root);
    expect(apps.map((app) => app.app)).toEqual(["app-a", "tm/apps/server"]);
    expect(findPortCollisions(apps)).toEqual([
      {
        port: 4173,
        claims: [
          { app: "app-a", role: "dev" },
          { app: "tm/apps/server", role: "dev" },
        ],
      },
    ]);
  });

  test("a child with its own config and an apps folder is not scanned twice", () => {
    writeAppConfig(join(root, "mono"), "{ dev: 4200, e2e: 4201 }");
    writeAppConfig(join(root, "mono", "apps", "inner"), "{ dev: 4210, e2e: 4211 }");
    expect(scanWorkspaceApps(root).map((app) => app.app)).toEqual(["mono"]);
  });

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
