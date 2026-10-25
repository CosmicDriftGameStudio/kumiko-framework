// Recommendation 5 from the Sprint 9.8 retro. Tests scaffoldDeploy against this
// sample app — catches Dockerfile.template coverage gaps (start.sh
// missing in 9.6, hasSeeds/hasPrivateGhPackages detection bugs) before
// they show up in real app deploys.
//
// The sample app is the canonical "every bundled feature mounted" — if the
// scaffold works against it, we cover the largest realistic
// app shape.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldDeploy } from "@cosmicdrift/kumiko-dev-server";

const SAMPLE_DIR = join(__dirname, "..", "..");

describe("use-all-bundled scaffoldDeploy", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "use-all-bundled-scaffold-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("scaffolds 3 files without leftover placeholders", () => {
    const result = scaffoldDeploy({
      appName: "use-all-bundled",
      port: 3000,
      destination: tmp,
      sourceDir: SAMPLE_DIR,
    });

    const written = result.files.map((f) => f.path);
    expect(written).toHaveLength(3);
    expect(written.some((p) => p.endsWith("Dockerfile"))).toBe(true);
    expect(written.some((p) => p.endsWith("Dockerfile.dockerignore"))).toBe(true);
    expect(written.some((p) => p.endsWith("migrate-step.sh"))).toBe(true);

    const dockerfile = readFileSync(join(tmp, "deploy/Dockerfile"), "utf-8");
    // Mustache-style placeholders must all be rendered.
    expect(dockerfile.match(/\{\{[^}]+\}\}/g)).toBeNull();
  });

  test("detects no seeds + no private gh-packages for use-all-bundled", () => {
    const result = scaffoldDeploy({
      appName: "use-all-bundled",
      port: 3000,
      destination: tmp,
      sourceDir: SAMPLE_DIR,
    });
    expect(result.detected.hasSeeds).toBe(false);
    expect(result.detected.hasPrivateGhPackages).toBe(false);
  });

  test("Dockerfile emits start.sh inline", () => {
    scaffoldDeploy({
      appName: "use-all-bundled",
      port: 3000,
      destination: tmp,
      sourceDir: SAMPLE_DIR,
    });
    const dockerfile = readFileSync(join(tmp, "deploy/Dockerfile"), "utf-8");
    // 9.8 drama: createBunServer overrides the command to ./start.sh —
    // the Dockerfile had to create the file, since Studio's source tree
    // no longer contains it.
    expect(dockerfile).toContain("start.sh");
    expect(dockerfile).toContain("exec bun run server.js");
  });

  test("Dockerfile uses oven/bun build + oven/bun runtime", () => {
    scaffoldDeploy({
      appName: "use-all-bundled",
      port: 3000,
      destination: tmp,
      sourceDir: SAMPLE_DIR,
    });
    const dockerfile = readFileSync(join(tmp, "deploy/Dockerfile"), "utf-8");
    // Beide Stages sind bun-native (Phase-3 bun-cutover).
    expect(dockerfile).toMatch(/FROM oven\/bun:\$\{BUN_VERSION\}-alpine AS build/);
    expect(dockerfile).toMatch(/FROM oven\/bun:\$\{BUN_VERSION\}-alpine AS runtime/);
  });
});
