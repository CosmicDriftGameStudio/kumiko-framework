// DX-3.1 — walkthrough-snapshot-test. Reproduces the 3-command path from
// docs.kumiko.so/en/walkthrough/ in-process and asserts what the walkthrough
// claims. Catches drift in scaffoldApp + scaffoldAppFeature against the
// docs without an actual `bunx … && yarn install && bun run boot` CI run.
//
// What this test pins:
//   - scaffoldApp produces the 6 files the walkthrough lists
//   - scaffoldAppFeature scaffolds + auto-mounts (the diff-block shown)
//   - composeFeatures(includeBundled:true) yields the exact feature-count
//     the walkthrough advertises in "Expected output"

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createRegistry, defineFeature, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { composeFeatures } from "../compose-features";
import { scaffoldApp } from "../scaffold-app";
import { scaffoldAppFeature } from "../scaffold-app-feature";

describe("walkthrough — DX-3.1 snapshot", () => {
  let tmp: string;
  let appRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "walkthrough-"));
    appRoot = join(tmp, "my-notes");
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("Step 1 (kumiko new app) — produces walkthrough's 6 files", () => {
    const result = scaffoldApp({ name: "my-notes", destination: appRoot });
    expect(result.files).toEqual([
      "package.json",
      "tsconfig.json",
      "src/run-config.ts",
      "bin/main.ts",
      ".env.example",
      "README.md",
    ]);
  });

  test("Step 2 (kumiko add feature) — auto-mounts + walkthrough diff matches", () => {
    scaffoldApp({ name: "my-notes", destination: appRoot });
    const result = scaffoldAppFeature({ name: "notes", appRoot });
    expect(result.autoMounted).toBe(true);

    const runConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    // Walkthrough's diff-block claims:
    //   + import { notesFeature } from "./features/notes";
    //   + notesFeature  (in APP_FEATURES)
    expect(runConfig).toContain(`import { notesFeature } from "./features/notes";`);
    expect(runConfig).toContain("notesFeature");
    // Foundation still mounted (createSecretsFeature + createSessionsFeature).
    expect(runConfig).toContain("createSecretsFeature()");
    expect(runConfig).toContain("createSessionsFeature()");
  });

  test("Step 3 (boot validation) — scaffolded run-config matches walkthrough's APP_FEATURES claim", () => {
    scaffoldApp({ name: "my-notes", destination: appRoot });
    scaffoldAppFeature({ name: "notes", appRoot });

    // Text-assert: scaffolded run-config.ts contains exactly the 3 features
    // the walkthrough's diff-block shows (secrets + sessions + notesFeature).
    // Dynamic-import would fail because /tmp can't resolve @cosmicdrift/*
    // workspace symlinks — instead we reproduce the equivalent APP_FEATURES
    // array in-process below.
    const runConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    expect(runConfig).toContain("createSecretsFeature()");
    expect(runConfig).toContain("createSessionsFeature()");
    expect(runConfig).toContain("notesFeature");
  });

  test("Step 3 (composeFeatures) — 3 explicit + 4 auto-mounted = 7 features", () => {
    // Reproduces the scaffolded APP_FEATURES in-process. notesFeature gets
    // a dummy defineFeature here — the scaffold-side of "notesFeature"
    // (file-content) is pinned in test 2; this test pins the runtime-side
    // (composeFeatures auto-prepend behaviour the walkthrough claims).
    const notesFeature = defineFeature("notes", () => {});
    const APP_FEATURES = [createSecretsFeature(), createSessionsFeature(), notesFeature];

    const composed = composeFeatures(APP_FEATURES, { includeBundled: true });
    // 3 explicit + 4 auto-mounted bundled = 7 total features.
    expect(composed.length).toBe(7);

    const composedNames = composed.map((f) => f.name).sort();
    expect(composedNames).toEqual([
      "auth-email-password",
      "config",
      "notes",
      "secrets",
      "sessions",
      "tenant",
      "user",
    ]);

    // validateBoot must pass (no missing-requires, no schema-errors).
    expect(() => validateBoot(composed)).not.toThrow();
    // Registry must contain all 7 features.
    const registry = createRegistry(composed);
    expect(registry.features.size).toBe(7);
  });

  test("bin/main.ts contains the auth.admin stub the walkthrough relies on", () => {
    scaffoldApp({ name: "my-notes", destination: appRoot });
    const main = readFileSync(join(appRoot, "bin/main.ts"), "utf-8");
    // composeFeatures(includeBundled:true)-trigger is `auth: { admin: { … } }`.
    // Walkthrough explicitly says this is what auto-mounts the 4 bundled features.
    expect(main).toContain("auth: {");
    expect(main).toContain("admin: {");
    expect(main).toContain("memberships:");
    expect(main).toContain("runProdApp");
  });
});
