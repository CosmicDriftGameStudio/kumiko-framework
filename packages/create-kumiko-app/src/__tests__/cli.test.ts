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
    const startedAt = performance.now();
    const code = await runCreate({
      name: "demo-app",
      yes: true,
      cwd: tmp,
      log: (line) => logs.push(line),
    });
    const scaffoldMs = performance.now() - startedAt;
    expect(code).toBe(0);
    // Onboarding regression gate: the scaffold step is the first thing a new
    // user waits on. Generous ceiling so slow CI runners pass — what we catch
    // is an order-of-magnitude blowup, not seconds.
    expect(
      scaffoldMs,
      `scaffold took ${Math.round(scaffoldMs)}ms (ceiling 30s)`,
    ).toBeLessThan(30_000);

    const dest = join(tmp, "demo-app");
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(dest, "package.json"))).toBe(true);
    expect(existsSync(join(dest, "bin/main.ts"))).toBe(true);

    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    // Picker-MVP recommended features land in run-config — except the four
    // composeFeatures({ includeBundled: true }) auto-mounts (config, user,
    // tenant, auth-email-password), which scaffold-app filters out so they
    // don't trigger dedupe-warn spam on every dev boot.
    expect(cfg).not.toContain("createAuthEmailPasswordFeature");
    expect(cfg).not.toContain("createUserFeature");
    expect(cfg).not.toContain("createTenantFeature");
    expect(cfg).not.toContain("createConfigFeature");
    expect(cfg).toContain("createDeliveryFeature");
    // mail-transport-smtp is opt-in (not recommended, no transitive require) — should NOT auto-mount.
    expect(cfg).not.toContain("mailTransportSmtpFeature");
    // issue-1174: user-profile (recommended) requires user-data-rights
    // transitively, which trips the GDPR boot-validator unless
    // user-data-rights-defaults (the PII export/delete hooks for `user`)
    // is auto-included too.
    expect(cfg).toContain("createUserDataRightsDefaultsFeature");

    // UX-polish: Next-steps points at `bun dev` (the primary dev path since
    // PR #583 introduced bin/dev.ts), not the CI-only `bun run boot` smoke.
    const out = logs.join("\n");
    expect(out).toContain("bun dev");
    expect(out).toContain("docker compose up -d");
    expect(out).not.toContain("bun run boot");

    // Setup-impact preview lands before the scaffold actually runs.
    expect(out).toMatch(/→ Scaffolding \d+ features? into \.\/demo-app\//);
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
