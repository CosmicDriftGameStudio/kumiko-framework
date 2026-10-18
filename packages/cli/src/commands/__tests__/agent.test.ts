import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCommand } from "../agent";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A config in tmpdir cannot resolve workspace packages by name, so the imports are absolute.
const ENGINE_PATH = Bun.resolveSync("@cosmicdrift/kumiko-framework/engine", import.meta.dir);
const ZOD_PATH = Bun.resolveSync("zod", import.meta.dir);
const CONFIG_PATH = Bun.resolveSync("@cosmicdrift/kumiko-framework/config", import.meta.dir);

const FEATURE_PRELUDE = `
import { defineFeature } from "${ENGINE_PATH}";
import * as z from "${ZOD_PATH}";
const access = { openToAll: { reason: "cli test handler" } };
const handler = async () => ({ isSuccess: true, data: {} });
`;

async function runLint(
  featureBody: string,
  exportLine = "export default { features: [feature] };",
): Promise<{ code: number; lines: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-agent-lint-"));
  tmpDirs.push(dir);
  writeFileSync(
    join(dir, "kumiko.config.ts"),
    `${FEATURE_PRELUDE}\nconst feature = defineFeature("cli-demo", (r) => {\n${featureBody}\n});\n${exportLine}\n`,
  );
  const lines: string[] = [];
  const code = await agentCommand.run({
    argv: ["lint"],
    cwd: dir,
    out: { log: (l) => lines.push(l), err: (l) => lines.push(l) },
  });
  return { code, lines };
}

describe("kumiko agent lint exit code", () => {
  test("only warning gaps (missing translations) -> exit 0 and still listed", async () => {
    const { code, lines } = await runLint(
      `r.writeHandler({ name: "do-x", schema: z.object({}), handler, access, description: "Does X." });`,
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("cli-demo:write:do-x");
  });

  test("prodFeatures are linted like features", async () => {
    const { code, lines } = await runLint(
      `r.writeHandler({ name: "do-x", schema: z.object({ at: z.instanceof(Date) }), handler, access, description: "Does X." });`,
      `import { defineAppConfig } from "${CONFIG_PATH}";\nexport default defineAppConfig({ features: [], prodFeatures: [feature], client: { entries: ["src/client.tsx"] }, ports: { dev: 4400, e2e: 4401 } });`,
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("cli-demo:write:do-x");
  });

  test("an error gap (non-expressible schema) -> exit 1", async () => {
    const { code } = await runLint(
      `r.writeHandler({ name: "do-x", schema: z.object({ at: z.instanceof(Date) }), handler, access, description: "Does X." });`,
    );
    expect(code).toBe(1);
  });
});
