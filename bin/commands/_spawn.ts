import { spawn } from "node:child_process";

const GIT_ENV_VARS_TO_STRIP = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"];

/** Strips GIT_DIR/GIT_WORK_TREE/etc from the current env — a `git` hook
 *  (e.g. pre-push) sets these for itself, and without stripping them any
 *  `git` subprocess spawned from here (incl. inside a temp-repo test)
 *  silently targets the hook's repo instead of its own `cwd`. */
export function envWithoutGitOverrides(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of GIT_ENV_VARS_TO_STRIP) delete env[key];
  return env;
}

/** Async-spawn — sammelt stdout/stderr, returnt Exit-Code + strings.
 *  Zentral damit alle Commands denselben Pattern haben. spawnSync
 *  geht NICHT (blockt MainThread). */
export function run(
  cmd: string,
  args: ReadonlyArray<string>,
  opts?: { readonly cwd?: string; readonly env?: Record<string, string>; readonly timeoutMs?: number },
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], {
      cwd: opts?.cwd,
      env: opts?.env ? { ...envWithoutGitOverrides(), ...opts.env } : envWithoutGitOverrides(),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (status: number): void => {
      if (settled) return;
      settled = true;
      resolve({ status, stdout, stderr });
    };
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf-8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf-8");
    });
    child.on("error", () => settle(-1));
    child.on("exit", (code) => settle(code ?? 0));
    if (opts?.timeoutMs) {
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          settle(-1);
        }
      }, opts.timeoutMs);
    }
  });
}

/** Stream-mode: spawn + pipe stdout/stderr through ctx.out, return
 *  exit-code. Für commands die LIVE-Output zeigen müssen (check, test). */
export function runStreaming(
  cmd: string,
  args: ReadonlyArray<string>,
  out: { readonly log: (m: string) => void },
  opts?: { readonly cwd?: string; readonly env?: Record<string, string> },
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], {
      cwd: opts?.cwd,
      env: opts?.env ? { ...envWithoutGitOverrides(), ...opts.env } : envWithoutGitOverrides(),
    });
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf-8");
      for (const line of text.split("\n")) {
        if (line) out.log(line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => resolve(code ?? 0));
  });
}
