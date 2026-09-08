import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CheckLockPaths = {
  readonly lockDir: string;
  readonly logPath: string;
  readonly resultPath: string;
};

const SAFE_SCOPE_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Scopes the lock/log/result file names by `KUMIKO_CLI_SCOPE` (the repo the
 *  pre-push hook is checking) so concurrent `kumiko check` runs for
 *  different repos never share a lock — without a scope, both landed on the
 *  same literal file names once the pre-push hook cd's into the shared
 *  parent workspace, letting one repo's run adopt another's exit code. */
export function checkLockPaths(scope: string | undefined, baseDir = ""): CheckLockPaths {
  if (scope !== undefined && scope !== "") {
    if (!SAFE_SCOPE_PATTERN.test(scope) || scope === "." || scope === "..") {
      throw new Error(
        `KUMIKO_CLI_SCOPE "${scope}" is not a safe lock-file suffix — only a single path segment of [A-Za-z0-9._-] is allowed`,
      );
    }
  }
  const suffix = scope ? `.${scope}` : "";
  return {
    lockDir: join(baseDir, `.kumiko-check.lock${suffix}`),
    logPath: join(baseDir, `.kumiko-check.log${suffix}`),
    resultPath: join(baseDir, `.kumiko-check.result${suffix}`),
  };
}

export function acquireCheckLock(lockDir: string, logPath: string, resultPath: string): boolean {
  // mkdirSync without recursive is atomic — EEXIST decides the race
  // between two concurrent calls. Stale locks (owner is dead) get
  // cleaned up once and then retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "pid"), String(process.pid));
      writeFileSync(logPath, "");
      rmSync(resultPath, { force: true });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (isLockHolderAlive(lockDir)) return false;
      rmSync(lockDir, { recursive: true, force: true });
    }
  }
  return false;
}

function isLockHolderAlive(lockDir: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(join(lockDir, "pid"), "utf8"), 10);
    if (!Number.isFinite(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function registerLockCleanup(lockDir: string): void {
  const release = (): void => {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // ignore — best effort
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(143);
  });
}

export async function followCheck(lockDir: string, logPath: string, resultPath: string): Promise<number> {
  console.log("kumiko check laeuft schon — haenge mich dran...\n");
  // tail -F (capital F) follows the log even before it exists and
  // survives file rotation. This covers the race where we see the lock
  // but the owner hasn't created the log file yet.
  const tail = Bun.spawn(["tail", "-n", "+1", "-F", logPath], {
    stdout: "inherit",
    stderr: "inherit",
  });

  while (existsSync(lockDir)) {
    await Bun.sleep(200);
  }
  tail.kill();
  await tail.exited;

  if (!existsSync(resultPath)) {
    console.error("\nLaufender Run beendet, aber kein Result gefunden — vermutlich gecrasht.");
    return 1;
  }
  const raw = readFileSync(resultPath, "utf8").trim();
  const code = Number.parseInt(raw, 10);
  return Number.isFinite(code) ? code : 1;
}
