// kumiko-framework#3120: the published `kumiko-guards` CLI rejected every
// `--write-baseline` flag — a consumer had no command to freeze a ratchet
// guard's baseline at all.

import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoManifest } from "@cosmicdrift/kumiko-repo-manifest";
import type { AstGuard } from "../_lib/guard-kit";
import { GUARDS, runGuardsCli } from "../run-guards";
import { fixtureRoot, writeRepo } from "./parent-workspace-fixture";

const FIXTURE_MANIFEST: RepoManifest = {
  kind: "library",
  sourceRoots: ["packages/*/src"],
  testGlobs: ["packages/*/src/**/*.test.ts"],
};

type RatchetGuard = AstGuard & { writeBaseline: NonNullable<AstGuard["writeBaseline"]> };

function isRatchetGuard(g: AstGuard): g is RatchetGuard {
  return g.writeBaseline !== undefined;
}

function mockAllRatchetWriters(): {
  readonly restore: () => void;
  readonly spies: readonly ReturnType<typeof spyOn>[];
} {
  const ratchetGuards = GUARDS.filter(isRatchetGuard);
  const spies = ratchetGuards.map((g) => spyOn(g, "writeBaseline").mockImplementation(() => {}));
  return {
    restore: () => {
      for (const s of spies) s.mockRestore();
    },
    spies,
  };
}

describe("runGuardsCli — --write-baseline", () => {
  test("bare --write-baseline is rejected — baselines freeze one guard at a time, deliberately", () => {
    const { restore, spies } = mockAllRatchetWriters();
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const exitCode = runGuardsCli(["--write-baseline"]);
      expect(exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--guard=<name>"));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      restore();
    }
  });

  test("--write-baseline --guard=<unknown> is rejected", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const exitCode = runGuardsCli(["--write-baseline", "--guard=does-not-exist"]);
      expect(exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown guard "does-not-exist"'),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("--write-baseline --guard=PII-Annotations Guard narrows to that guard only", () => {
    const ratchetGuards = GUARDS.filter(isRatchetGuard);
    const target = ratchetGuards.find((g) => g.name === "PII-Annotations Guard");
    expect(target).toBeDefined();
    // A tiny fixture repo instead of the real checkout: scanning the whole
    // framework synchronously blew the 5s test budget under CI load.
    const fixtureDir = realpathSync(mkdtempSync(join(tmpdir(), "write-baseline-narrow-")));
    writeRepo(fixtureDir, {
      name: "write-baseline-fixture",
      layout: { manifest: FIXTURE_MANIFEST },
    });
    const roots = [fixtureRoot("write-baseline-fixture", fixtureDir, FIXTURE_MANIFEST)];
    const { restore, spies } = mockAllRatchetWriters();
    try {
      const exitCode = runGuardsCli(["--write-baseline", "--guard=PII-Annotations Guard"], {
        writeBaselineRoots: roots,
      });
      expect(exitCode).toBe(0);
      const targetIndex = ratchetGuards.indexOf(target as NonNullable<typeof target>);
      spies.forEach((spy, i) => {
        if (i === targetIndex) expect(spy).toHaveBeenCalledTimes(1);
        else expect(spy).not.toHaveBeenCalled();
      });
      const scannedFiles: Parameters<RatchetGuard["writeBaseline"]>[0] | undefined =
        spies[targetIndex]?.mock.calls[0]?.[0];
      expect(scannedFiles?.map((file) => String(file.getFilePath()))).toEqual([
        join(fixtureDir, "packages/pkg/src/index.ts"),
      ]);
    } finally {
      restore();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test("--write-baseline is a known flag; an unrelated unknown flag is still rejected", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      runGuardsCli(["--write-baseline", "--guard=PII-Annotations Guard", "--bogus-flag"]);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--bogus-flag"));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
