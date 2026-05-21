import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext, Output, Role } from "./types";

/** In-memory output spy. Replaces stdout/stderr so tests can assert
 *  on what a command emitted without scribbling to the test runner. */
export function makeSpyOutput(): {
  readonly out: Output;
  readonly logs: ReadonlyArray<string>;
  readonly warns: ReadonlyArray<string>;
  readonly errs: ReadonlyArray<string>;
} {
  const logs: string[] = [];
  const warns: string[] = [];
  const errs: string[] = [];
  return {
    logs,
    warns,
    errs,
    out: {
      log: (m: string) => logs.push(m),
      warn: (m: string) => warns.push(m),
      err: (m: string) => errs.push(m),
    },
  };
}

/** Erstellt ein cwd-Verzeichnis das beim afterEach via cleanup() weg
 *  ist. Wenn `files` gegeben sind, werden sie reingelegt. */
export function makeTempCwd(files?: Record<string, string>): {
  readonly cwd: string;
  readonly cleanup: () => void;
} {
  const cwd = mkdtempSync(join(tmpdir(), "kumiko-cmd-"));
  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(cwd, relPath);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content, "utf-8");
    }
  }
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

export function makeContext(overrides: {
  readonly cwd: string;
  readonly argv?: ReadonlyArray<string>;
  readonly role?: Role;
  readonly scope?: string;
  readonly binPath?: string;
  readonly repoRoot?: string;
  readonly out?: Output;
}): CommandContext {
  const spy = overrides.out ?? makeSpyOutput().out;
  return {
    cwd: overrides.cwd,
    argv: overrides.argv ?? [],
    role: overrides.role ?? "maintainer",
    scope: overrides.scope,
    binPath: overrides.binPath ?? join(overrides.cwd, "node_modules", ".bin"),
    repoRoot: overrides.repoRoot ?? overrides.cwd,
    out: spy,
  };
}
