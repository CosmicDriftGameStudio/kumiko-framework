// CLI smoke: `bun create kumiko-app demo --yes` scaffolds an app whose
// run-config.ts imports the recommended features. Full boot is out of
// scope here (needs DB/Redis) — the gate is "scaffold succeeds, files
// look right".

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgv, runCreate } from "../index";

describe("create-kumiko-app CLI", () => {
  let tmp: string;
  let logs: string[];
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "create-kumiko-app-"));
    logs = [];
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test("--yes scaffolds the recommended stack", async () => {
    const code = await runCreate({
      name: "demo-app",
      yes: true,
      cwd: tmp,
      log: (line) => logs.push(line),
    });
    expect(code).toBe(0);

    const dest = join(tmp, "demo-app");
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(dest, "package.json"))).toBe(true);
    expect(existsSync(join(dest, "bin/main.ts"))).toBe(true);

    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    // Picker-MVP recommended features land in run-config.
    expect(cfg).toContain("createAuthEmailPasswordFeature");
    expect(cfg).toContain("createUserFeature");
    expect(cfg).toContain("createTenantFeature");
    expect(cfg).toContain("createDeliveryFeature");
    // mail-transport-smtp is opt-in (not recommended, no transitive require) — should NOT auto-mount.
    expect(cfg).not.toContain("mailTransportSmtpFeature");
  });

  test("--print-manifest emits JSON, no name needed", async () => {
    const code = await runCreate({
      printManifest: true,
      log: (line) => logs.push(line),
    });
    expect(code).toBe(0);
    const json = JSON.parse(logs.join(""));
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
  });

  test("missing name prints usage + exits 1", async () => {
    const code = await runCreate({ log: (line) => logs.push(line) });
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("Usage:");
  });
});

describe("parseArgv", () => {
  test("first positional is the app name", () => {
    expect(parseArgv(["my-app"]).name).toBe("my-app");
  });

  test("--yes / -y flips yes flag", () => {
    expect(parseArgv(["--yes"]).yes).toBe(true);
    expect(parseArgv(["-y"]).yes).toBe(true);
  });

  test("--print-manifest works alone (no name)", () => {
    const args = parseArgv(["--print-manifest"]);
    expect(args.printManifest).toBe(true);
    expect(args.name).toBeUndefined();
  });
});
