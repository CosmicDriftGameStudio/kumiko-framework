import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildServerBundle,
  parseKumikoBuildArgs,
  readExtraRuntimeExternals,
} from "../build-server-bundle.ts";

// Builds a mini-app fixture (bin/main.ts and bin/kumiko.ts share a module) and
// verifies variant B: one Bun.build call produces server.js and kumiko.js as
// entries plus a shared chunk instead of two complete bundles.
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "server-bundle-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "fixture-app" })}\n`);
  writeFileSync(join(dir, "src/shared.ts"), "export function shared(): number { return 42; }\n");
  // main.ts is renamed to server.js; kumiko.ts makes findRepoRoot return this
  // fixture's repoRoot, so kumiko.js is built.
  writeFileSync(
    join(dir, "bin/main.ts"),
    `import { shared } from "../src/shared";\nconsole.log("server", shared());\n`,
  );
  writeFileSync(
    join(dir, "bin/kumiko.ts"),
    `import { shared } from "../src/shared";\nconsole.log("migrate", shared());\n`,
  );
  return dir;
}

function importMeilisearchInMain(dir: string): void {
  writeFileSync(
    join(dir, "bin/main.ts"),
    `import { MeiliSearch } from "meilisearch";\nconsole.log("server", MeiliSearch);\n`,
  );
}

function writeFrameworkPeerPin(dir: string): void {
  const frameworkPkgDir = join(dir, "node_modules/@cosmicdrift/kumiko-framework");
  mkdirSync(frameworkPkgDir, { recursive: true });
  writeFileSync(
    join(frameworkPkgDir, "package.json"),
    `${JSON.stringify({
      name: "@cosmicdrift/kumiko-framework",
      peerDependencies: { meilisearch: "^0.58.0" },
      peerDependenciesMeta: { meilisearch: { optional: true } },
    })}\n`,
  );
}

describe("buildServerBundle (multi-entry + splitting)", () => {
  test("produces server.js + kumiko.js as entries + a shared chunk", async () => {
    const dir = makeFixture();
    try {
      const result = await buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server") });
      const outDir = result.outDir;

      expect(existsSync(join(outDir, "server.js"))).toBe(true);
      expect(existsSync(join(outDir, "main.js"))).toBe(false);
      expect(existsSync(join(outDir, "kumiko.js"))).toBe(true);

      const entryFiles = result.entries.map((e) => e.file).sort();
      expect(entryFiles).toEqual(["kumiko.js", "server.js"]);

      // The shared module is placed in a chunk rather than inlined into both entries.
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      const serverSrc = readFileSync(join(outDir, "server.js"), "utf8");
      expect(serverSrc).toContain("chunk-");

      // No legacy Drizzle output remains.
      expect(existsSync(join(outDir, "migration-hooks.js"))).toBe(false);
      expect(existsSync(join(outDir, "drizzle.config.ts"))).toBe(false);

      // Runtime package.json includes a start script without drizzle dependencies.
      const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8"));
      expect(pkg.scripts.start).toBe("bun run server.js");
      expect(Object.keys(pkg.dependencies)).not.toContain("drizzle-kit");
      expect(Object.keys(pkg.dependencies)).not.toContain("drizzle-orm");
      // Positive counterpart: a runtime external accidentally dropped from RUNTIME_EXTERNALS
      // (into BUILD_ONLY_EXTERNALS instead) would slip through silently.
      expect(Object.keys(pkg.dependencies)).toContain("sharp");

      expect(result.totalBytes).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bundles bin/worker.ts as worker.js sharing the chunk; absent worker.ts → no worker.js", async () => {
    const withoutWorker = makeFixture();
    const withWorker = makeFixture();
    try {
      writeFileSync(
        join(withWorker, "bin/worker.ts"),
        `import { shared } from "../src/shared";\nconsole.log("worker", shared());\n`,
      );
      const plain = await buildServerBundle({
        cwd: withoutWorker,
        outDir: join(withoutWorker, "dist-server"),
      });
      expect(existsSync(join(plain.outDir, "worker.js"))).toBe(false);

      const result = await buildServerBundle({
        cwd: withWorker,
        outDir: join(withWorker, "dist-server"),
      });
      expect(result.entries.map((e) => e.file).sort()).toEqual([
        "kumiko.js",
        "server.js",
        "worker.js",
      ]);
      expect(readFileSync(join(result.outDir, "worker.js"), "utf8")).toContain("chunk-");
      const run = Bun.spawnSync([process.execPath, join(result.outDir, "worker.js")]);
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      expect(run.stdout.toString().trim()).toBe("worker 42");
    } finally {
      rmSync(withoutWorker, { recursive: true, force: true });
      rmSync(withWorker, { recursive: true, force: true });
    }
  });

  test("bundles bin/bootstrap.ts as bootstrap.js sharing the chunk; absent bootstrap.ts → no bootstrap.js", async () => {
    const withoutBootstrap = makeFixture();
    const withBootstrap = makeFixture();
    try {
      writeFileSync(
        join(withBootstrap, "bin/bootstrap.ts"),
        `import { shared } from "../src/shared";\nconsole.log("bootstrap", shared());\n`,
      );
      const plain = await buildServerBundle({
        cwd: withoutBootstrap,
        outDir: join(withoutBootstrap, "dist-server"),
      });
      expect(existsSync(join(plain.outDir, "bootstrap.js"))).toBe(false);

      const result = await buildServerBundle({
        cwd: withBootstrap,
        outDir: join(withBootstrap, "dist-server"),
      });
      expect(result.entries.map((e) => e.file).sort()).toEqual([
        "bootstrap.js",
        "kumiko.js",
        "server.js",
      ]);
      expect(readFileSync(join(result.outDir, "bootstrap.js"), "utf8")).toContain("chunk-");
      const run = Bun.spawnSync([process.execPath, join(result.outDir, "bootstrap.js")]);
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      expect(run.stdout.toString().trim()).toBe("bootstrap 42");
    } finally {
      rmSync(withoutBootstrap, { recursive: true, force: true });
      rmSync(withBootstrap, { recursive: true, force: true });
    }
  });

  test("bundles bin/main.js with bin/worker.js as server.js and worker.js", async () => {
    const dir = makeFixture();
    try {
      rmSync(join(dir, "bin/main.ts"));
      writeFileSync(
        join(dir, "bin/main.js"),
        `import { shared } from "../src/shared";\nconsole.log("server", shared());\n`,
      );
      writeFileSync(
        join(dir, "bin/worker.js"),
        `import { shared } from "../src/shared";\nconsole.log("worker", shared());\n`,
      );
      const result = await buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server") });
      expect(result.entries.map((e) => e.file).sort()).toEqual([
        "kumiko.js",
        "server.js",
        "worker.js",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pins runtime-deps from node_modules/@cosmicdrift/* for consumer apps without a packages/ dir", async () => {
    // For a consumer app, findRepoRoot returns the app root itself (with no
    // packages/ directory), so versions must come from the installed
    // node_modules/@cosmicdrift/* packages rather than "*".
    const dir = makeFixture();
    importMeilisearchInMain(dir);
    try {
      const frameworkPkgDir = join(dir, "node_modules/@cosmicdrift/kumiko-framework");
      mkdirSync(frameworkPkgDir, { recursive: true });
      writeFileSync(
        join(frameworkPkgDir, "package.json"),
        `${JSON.stringify({ name: "@cosmicdrift/kumiko-framework", dependencies: { meilisearch: "^0.58.0" } })}\n`,
      );
      const bundledFeaturesPkgDir = join(dir, "node_modules/@cosmicdrift/kumiko-bundled-features");
      mkdirSync(bundledFeaturesPkgDir, { recursive: true });
      writeFileSync(
        join(bundledFeaturesPkgDir, "package.json"),
        `${JSON.stringify({ name: "@cosmicdrift/kumiko-bundled-features", dependencies: { ioredis: "^5.4.1" } })}\n`,
      );

      const result = await buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server") });

      expect(result.runtimeDeps["meilisearch"]).toBe("^0.58.0");
      expect(result.runtimeDeps["ioredis"]).toBe("^5.4.1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pins a runtime external the framework only lists as an optional peer", async () => {
    const dir = makeFixture();
    importMeilisearchInMain(dir);
    try {
      const frameworkPkgDir = join(dir, "node_modules/@cosmicdrift/kumiko-framework");
      mkdirSync(frameworkPkgDir, { recursive: true });
      writeFileSync(
        join(frameworkPkgDir, "package.json"),
        `${JSON.stringify({
          name: "@cosmicdrift/kumiko-framework",
          peerDependencies: { meilisearch: "^0.58.0" },
          peerDependenciesMeta: { meilisearch: { optional: true } },
        })}\n`,
      );

      const result = await buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server") });

      expect(result.runtimeDeps["meilisearch"]).toBe("^0.58.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prefers node_modules/@cosmicdrift/* over packages/* when both declare a version", async () => {
    // Framework-monorepo checkout: both the installed node_modules package
    // (symlinked in real life, diverging here) and packages/framework exist.
    // node_modules must win — it reflects what actually gets shipped/installed
    // for the consumer, packages/framework is only a repo-root fallback.
    const dir = makeFixture();
    importMeilisearchInMain(dir);
    try {
      const frameworkPkgDir = join(dir, "node_modules/@cosmicdrift/kumiko-framework");
      mkdirSync(frameworkPkgDir, { recursive: true });
      writeFileSync(
        join(frameworkPkgDir, "package.json"),
        `${JSON.stringify({ name: "@cosmicdrift/kumiko-framework", dependencies: { meilisearch: "^0.58.0" } })}\n`,
      );

      mkdirSync(join(dir, "packages/framework"), { recursive: true });
      writeFileSync(
        join(dir, "packages/framework/package.json"),
        `${JSON.stringify({ name: "@cosmicdrift/kumiko-framework", dependencies: { meilisearch: "^0.30.0" } })}\n`,
      );

      const result = await buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server") });

      expect(result.runtimeDeps["meilisearch"]).toBe("^0.58.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildServerBundle meilisearch runtime dependency", () => {
  async function runtimeDepsOf(dir: string): Promise<{
    readonly result: Awaited<ReturnType<typeof buildServerBundle>>;
    readonly packageJsonDependencies: Record<string, string>;
  }> {
    writeFrameworkPeerPin(dir);
    const result = await buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server") });
    const pkg = JSON.parse(readFileSync(join(dir, "dist-server/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    return { result, packageJsonDependencies: pkg.dependencies };
  }

  test("an app that neither imports nor declares meilisearch does not install it", async () => {
    const dir = makeFixture();
    try {
      const { result, packageJsonDependencies } = await runtimeDepsOf(dir);
      expect(result.runtimeDeps).not.toHaveProperty("meilisearch");
      expect(packageJsonDependencies).not.toHaveProperty("meilisearch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["a static import", `import { MeiliSearch } from "meilisearch";\nconsole.log(MeiliSearch);\n`],
    ["a dynamic import", `const search = await import("meilisearch");\nconsole.log(search);\n`],
    ["a require call", `const search = require("meilisearch");\nconsole.log(search);\n`],
  ])(
    "installs meilisearch with the framework version when the bundle has %s",
    async (_label, source) => {
      const dir = makeFixture();
      try {
        writeFileSync(join(dir, "bin/main.ts"), source);
        const { result, packageJsonDependencies } = await runtimeDepsOf(dir);
        expect(result.runtimeDeps["meilisearch"]).toBe("^0.58.0");
        expect(packageJsonDependencies["meilisearch"]).toBe("^0.58.0");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test("installs meilisearch when only a shared chunk imports it", async () => {
    const dir = makeFixture();
    try {
      writeFileSync(
        join(dir, "src/shared.ts"),
        `import { MeiliSearch } from "meilisearch";\nexport function shared(): unknown { return MeiliSearch; }\n`,
      );
      const { result } = await runtimeDepsOf(dir);
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.runtimeDeps["meilisearch"]).toBe("^0.58.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["dependencies", { dependencies: { meilisearch: "^0.58.0" } }],
    ["optionalDependencies", { optionalDependencies: { meilisearch: "^0.58.0" } }],
  ])("installs meilisearch when the app declares it in %s", async (_label, declaration) => {
    const dir = makeFixture();
    try {
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "fixture-app", ...declaration })}\n`,
      );
      const { result, packageJsonDependencies } = await runtimeDepsOf(dir);
      expect(result.runtimeDeps["meilisearch"]).toBe("^0.58.0");
      expect(packageJsonDependencies["meilisearch"]).toBe("^0.58.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readExtraRuntimeExternals (package.json kumiko field)", () => {
  test("reads string list from kumiko.extraRuntimeExternals", () => {
    const dir = mkdtempSync(join(tmpdir(), "extra-ext-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({
          name: "app",
          kumiko: { extraRuntimeExternals: ["@napi-rs/canvas", "pdf-parse"] },
        })}\n`,
      );
      expect(readExtraRuntimeExternals(dir)).toEqual(["@napi-rs/canvas", "pdf-parse"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing / invalid shapes yield empty list", () => {
    const dir = mkdtempSync(join(tmpdir(), "extra-ext-bad-"));
    try {
      writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "app" })}\n`);
      expect(readExtraRuntimeExternals(dir)).toEqual([]);
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "app", kumiko: { extraRuntimeExternals: "nope" } })}\n`,
      );
      expect(readExtraRuntimeExternals(dir)).toEqual([]);
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({
          name: "app",
          kumiko: { extraRuntimeExternals: ["ok", 1, "", "  "] },
        })}\n`,
      );
      expect(readExtraRuntimeExternals(dir)).toEqual(["ok"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildServerBundle + package.json extras", () => {
  test("extraRuntimeExternals from options land in runtimeDeps with app pin", async () => {
    const dir = makeFixture();
    try {
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({
          name: "fixture-app",
          dependencies: { "@napi-rs/canvas": "0.1.65" },
          kumiko: { extraRuntimeExternals: ["@napi-rs/canvas"] },
        })}\n`,
      );
      const extras = readExtraRuntimeExternals(dir);
      const result = await buildServerBundle({
        cwd: dir,
        outDir: join(dir, "dist-server"),
        extraRuntimeExternals: extras,
      });
      expect(result.runtimeDeps["@napi-rs/canvas"]).toBe("0.1.65");
      const distPkg = JSON.parse(readFileSync(join(dir, "dist-server/package.json"), "utf-8")) as {
        dependencies: Record<string, string>;
      };
      expect(distPkg.dependencies["@napi-rs/canvas"]).toBe("0.1.65");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("app package.json does not override framework runtime pins", async () => {
    const dir = makeFixture();
    try {
      const frameworkPkgDir = join(dir, "node_modules/@cosmicdrift/kumiko-framework");
      mkdirSync(frameworkPkgDir, { recursive: true });
      writeFileSync(
        join(frameworkPkgDir, "package.json"),
        `${JSON.stringify({
          name: "@cosmicdrift/kumiko-framework",
          dependencies: { meilisearch: "^0.58.0" },
        })}\n`,
      );
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({
          name: "fixture-app",
          dependencies: { meilisearch: "^0.1.0", "@napi-rs/canvas": "0.1.65" },
          kumiko: { extraRuntimeExternals: ["@napi-rs/canvas"] },
        })}\n`,
      );
      const result = await buildServerBundle({
        cwd: dir,
        outDir: join(dir, "dist-server"),
        extraRuntimeExternals: readExtraRuntimeExternals(dir),
      });
      expect(result.runtimeDeps["meilisearch"]).toBe("^0.58.0");
      expect(result.runtimeDeps["@napi-rs/canvas"]).toBe("0.1.65");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildServerBundle extraEntries", () => {
  function writeProbe(dir: string, relativePath: string, label: string): void {
    mkdirSync(join(dir, relativePath, ".."), { recursive: true });
    writeFileSync(
      join(dir, relativePath),
      `import { shared } from "../src/shared";\nconsole.log("${label}", shared());\n`,
    );
  }

  test("emits <basename>.js per extra entry, sharing the framework chunk", async () => {
    const dir = makeFixture();
    try {
      writeProbe(dir, "bin/remote-probe.ts", "probe");
      const result = await buildServerBundle({
        cwd: dir,
        outDir: join(dir, "dist-server"),
        extraEntries: ["bin/remote-probe.ts"],
      });
      expect(result.entries.map((e) => e.file).sort()).toEqual([
        "kumiko.js",
        "remote-probe.js",
        "server.js",
      ]);
      expect(readFileSync(join(result.outDir, "remote-probe.js"), "utf8")).toContain("chunk-");
      const run = Bun.spawnSync(["bun", join(result.outDir, "remote-probe.js")]);
      expect(run.stdout.toString().trim()).toBe("probe 42");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing extra entry throws naming the path and leaves the previous output alone", async () => {
    const dir = makeFixture();
    try {
      mkdirSync(join(dir, "dist-server"));
      writeFileSync(join(dir, "dist-server/previous.js"), "// previous build\n");
      await expect(
        buildServerBundle({
          cwd: dir,
          outDir: join(dir, "dist-server"),
          extraEntries: ["bin/not-there.ts"],
        }),
      ).rejects.toThrow("bin/not-there.ts");
      expect(existsSync(join(dir, "dist-server/previous.js"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["server.js (main.ts is renamed to it)", "tools/main.ts"],
    ["kumiko.js", "tools/kumiko.ts"],
    ["worker.js", "tools/worker.ts"],
    ["bootstrap.js", "tools/bootstrap.ts"],
  ])("an extra entry colliding with %s throws", async (_label, entry) => {
    const dir = makeFixture();
    try {
      writeProbe(dir, entry, "dup");
      await expect(
        buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server"), extraEntries: [entry] }),
      ).rejects.toThrow("built-in entry");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two extra entries with the same basename throw", async () => {
    const dir = makeFixture();
    try {
      writeProbe(dir, "bin/a/probe.ts", "a");
      writeProbe(dir, "bin/b/probe.ts", "b");
      await expect(
        buildServerBundle({
          cwd: dir,
          outDir: join(dir, "dist-server"),
          extraEntries: ["bin/a/probe.ts", "bin/b/probe.ts"],
        }),
      ).rejects.toThrow("both emit probe.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseKumikoBuildArgs", () => {
  test("collects repeatable --entry flags (both spellings) and the app dir", () => {
    expect(parseKumikoBuildArgs(["apps/shop", "--entry", "bin/a.ts", "--entry=bin/b.ts"])).toEqual({
      appDir: "apps/shop",
      extraEntries: ["bin/a.ts", "bin/b.ts"],
    });
    expect(parseKumikoBuildArgs([])).toEqual({ appDir: undefined, extraEntries: [] });
  });

  test("a flag before the app dir does not turn into the app dir", () => {
    expect(parseKumikoBuildArgs(["--entry", "bin/a.ts", "apps/shop"])).toEqual({
      appDir: "apps/shop",
      extraEntries: ["bin/a.ts"],
    });
  });

  test.each([[["--entry"]], [["--entry="]], [["--bogus"]], [["a", "b"]]])(
    "%j is rejected",
    (args) => {
      expect(() => parseKumikoBuildArgs(args)).toThrow("kumiko-build:");
    },
  );
});
