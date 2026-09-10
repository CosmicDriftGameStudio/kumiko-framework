// Proves the PUBLISHED tarball ships the `kumiko` bin with agent/project/
// consumer wired in — not just that the source files exist locally. Packs,
// unpacks and installs the package like npm would, then runs the real bin
// (#2707).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

const PEER_PACKAGES = ["kumiko-framework", "kumiko-bundled-features", "kumiko-dev-server"] as const;

type PackedManifest = {
  readonly bin: Record<string, string>;
};

let installRoot: string;
let tgzPath: string;
let installedPkgRoot: string;
let manifest: PackedManifest;
let KUMIKO_BIN: string;

beforeAll(() => {
  installRoot = mkdtempSync(join(tmpdir(), "kumiko-cli-published-"));

  const pack = Bun.spawnSync(["bun", "pm", "pack", "--destination", installRoot], {
    cwd: PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (pack.exitCode !== 0) {
    throw new Error(`bun pm pack failed: ${pack.stderr.toString()}`);
  }

  const packed = readdirSync(installRoot).find((f) => f.endsWith(".tgz"));
  if (!packed) {
    throw new Error(`bun pm pack produced no .tgz in ${installRoot}`);
  }
  tgzPath = join(installRoot, packed);

  mkdirSync(join(installRoot, "node_modules", "@cosmicdrift"), { recursive: true });

  const extract = Bun.spawnSync(["tar", "-xzf", tgzPath, "-C", installRoot]);
  if (extract.exitCode !== 0) {
    throw new Error(`tar -xzf failed: ${extract.stderr.toString()}`);
  }

  installedPkgRoot = join(installRoot, "node_modules", "@cosmicdrift", "kumiko-cli");
  renameSync(join(installRoot, "package"), installedPkgRoot);

  for (const name of PEER_PACKAGES) {
    symlinkSync(
      join(REPO_ROOT, "node_modules", "@cosmicdrift", name),
      join(installRoot, "node_modules", "@cosmicdrift", name),
    );
  }
  symlinkSync(join(REPO_ROOT, "node_modules", "zod"), join(installRoot, "node_modules", "zod"));

  manifest = JSON.parse(
    readFileSync(join(installedPkgRoot, "package.json"), "utf-8"),
  ) as PackedManifest;
  const binTarget = resolve(installedPkgRoot, manifest.bin["kumiko"] ?? "");
  chmodSync(binTarget, 0o755);

  mkdirSync(join(installRoot, "node_modules", ".bin"), { recursive: true });
  symlinkSync(binTarget, join(installRoot, "node_modules", ".bin", "kumiko"));
  KUMIKO_BIN = join(installRoot, "node_modules", ".bin", "kumiko");
});

afterAll(() => {
  rmSync(installRoot, { recursive: true, force: true });
});

function runKumiko(args: readonly string[], cwd: string): { code: number; out: string } {
  const p = Bun.spawnSync([KUMIKO_BIN, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: `${p.stdout.toString()}${p.stderr.toString()}` };
}

describe("published @cosmicdrift/kumiko-cli tarball", () => {
  test("tarball declares the kumiko bin", () => {
    expect(manifest.bin["kumiko"]).toBeTruthy();
    const binTarget = resolve(installedPkgRoot, manifest.bin["kumiko"] ?? "");
    expect(() => readFileSync(binTarget, "utf-8")).not.toThrow();
  });

  test("the packed bin lists the app commands in --help", () => {
    const res = runKumiko(["--help"], installRoot);
    expect(res.code).toBe(0);
    expect(res.out).toContain("kumiko agent");
    expect(res.out).toContain("kumiko project");
    expect(res.out).toContain("kumiko consumer");
  });

  test("kumiko agent --help works from the packed install", () => {
    const res = runKumiko(["agent", "--help"], installRoot);
    expect(res.code).toBe(0);
    expect(res.out).not.toContain("not found");
    expect(res.out).toContain("lint");
  }, 20_000);

  test("kumiko project --help works from the packed install", () => {
    const res = runKumiko(["project", "--help"], installRoot);
    expect(res.code).toBe(0);
    expect(res.out).not.toContain("not found");
    expect(res.out).toContain("rebuild");
  }, 20_000);

  test("kumiko consumer --help works from the packed install", () => {
    const res = runKumiko(["consumer", "--help"], installRoot);
    expect(res.code).toBe(0);
    expect(res.out).not.toContain("not found");
    expect(res.out).toContain("restart");
  }, 20_000);

  test("kumiko agent lint reports a doc gap from the packed install", () => {
    const appDir = join(installRoot, "app-with-gap");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, "kumiko.config.ts"),
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const feature = defineFeature("published-cli-fixture", (r) => {
  r.queryHandler("widget:publishedCliGapHandler", z.object({ id: z.string() }), async () => ({}), {
    access: { roles: ["admin"] },
    agent: { expose: true },
  });
});

export default { features: [feature] };
`,
    );

    const res = runKumiko(["agent", "lint"], appDir);
    expect(res.code).toBe(1);
    expect(res.out).toContain("published-cli-gap-handler");
  }, 20_000);

  test("kumiko agent lint passes for a documented handler", () => {
    const appDir = join(installRoot, "app-with-clean-handler");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, "kumiko.config.ts"),
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const feature = defineFeature("published-cli-fixture-clean", (r) => {
  r.queryHandler("widget:publishedCliCleanHandler", z.object({ id: z.string() }), async () => ({}), {
    access: { roles: ["admin"] },
    description: "Looks up a widget by id.",
  });
});

export default { features: [feature] };
`,
    );

    const res = runKumiko(["agent", "lint"], appDir);
    expect(res.code).toBe(0);
    expect(res.out).toContain("No AI-agent doc gaps found");
  }, 20_000);

  test("the tarball ships no test files", () => {
    const list = Bun.spawnSync(["tar", "-tzf", tgzPath]);
    const entries = list.stdout.toString().split("\n");
    expect(entries.some((e) => e.includes("__tests__"))).toBe(false);
  });

  test("every @cosmicdrift specifier the app commands import is a declared subpath export", () => {
    const sourceFiles = ["agent.ts", "project.ts", "consumer.ts"].map((f) =>
      join(PACKAGE_ROOT, "src", "commands", f),
    );
    const specifiers = new Set<string>();
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8");
      for (const match of content.matchAll(/["'](@cosmicdrift\/[^"']+)["']/g)) {
        specifiers.add(match[1] ?? "");
      }
    }
    expect(specifiers.size).toBeGreaterThanOrEqual(3);

    for (const specifier of specifiers) {
      const slashIndex = specifier.indexOf("/", specifier.indexOf("/") + 1);
      const hasSubpath = slashIndex >= 0;
      const packageName = hasSubpath ? specifier.slice(0, slashIndex) : specifier;
      const subpath = hasSubpath ? `.${specifier.slice(slashIndex)}` : ".";

      const pkgJsonPath = join(REPO_ROOT, "node_modules", packageName, "package.json");
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
        readonly exports: Record<string, unknown>;
      };
      expect(Object.keys(pkg.exports)).toContain(subpath);
    }
  });
});
