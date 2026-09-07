import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { agentCommand } from "../agent";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

// A generated config that imports real framework symbols must live inside
// the repo tree — bare-specifier resolution for `@cosmicdrift/...` walks up
// from the importing file to find node_modules, and os.tmpdir() sits
// outside that tree.
function makeConfigCwd(configContent: string): { readonly cwd: string; readonly cleanup: () => void } {
  const cwd = mkdtempSync(join(import.meta.dir, ".tmp-agent-cfg-"));
  writeFileSync(join(cwd, "kumiko.config.ts"), configContent, "utf-8");
  return {
    cwd,
    cleanup: () => {
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // ignore — best-effort
      }
    },
  };
}

const UNDOCUMENTED_CONFIG = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const feature = defineFeature("agent-lint-fixture", (r) => {
  r.queryHandler("widget:agentLintGapHandler", z.object({ id: z.string() }), async () => ({}), {
    access: { roles: ["admin"] },
    agent: { expose: true },
  });
});

export default { features: [feature] };
`;

const CLEAN_CONFIG = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const feature = defineFeature("agent-lint-fixture-clean", (r) => {
  r.queryHandler("widget:agentLintCleanHandler", z.object({ id: z.string() }), async () => ({}), {
    access: { roles: ["admin"] },
    description: "Looks up a widget by id.",
  });
});

export default { features: [feature] };
`;

describe("agent command", () => {
  test("registered + both roles", () => {
    expect(agentCommand.id).toBe("agent");
    expect(agentCommand.roles).toContain("maintainer");
    expect(agentCommand.roles).toContain("app-dev");
  });

  test("unknown subcommand prints usage and fails", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await agentCommand.run(makeContext({ cwd: t.cwd, argv: ["bogus"], out: spy.out }));
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/Usage: kumiko agent/);
  });

  test("missing subcommand prints usage and fails", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await agentCommand.run(makeContext({ cwd: t.cwd, argv: [], out: spy.out }));
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/Usage: kumiko agent/);
  });

  test("missing kumiko.config.ts emits helpful error", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await agentCommand.run(makeContext({ cwd: t.cwd, argv: ["lint"], out: spy.out }));
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/kumiko\.config\.ts not found at: /);
    expect(spy.errs.join("\n")).toContain(t.cwd);
  });

  test("reports gaps for handlers the AI agent can't describe", async () => {
    const t = makeConfigCwd(UNDOCUMENTED_CONFIG);
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await agentCommand.run(makeContext({ cwd: t.cwd, argv: ["lint"], out: spy.out }));
    expect(exit).toBe(1);
    expect(spy.logs.join("\n")).toContain("agent-lint-gap-handler");
  });

  test("clean config reports no gaps", async () => {
    const t = makeConfigCwd(CLEAN_CONFIG);
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await agentCommand.run(makeContext({ cwd: t.cwd, argv: ["lint"], out: spy.out }));
    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).not.toContain("agent-lint-clean-handler");
  });
});
