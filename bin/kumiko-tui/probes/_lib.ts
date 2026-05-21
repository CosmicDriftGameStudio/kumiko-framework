import { spawn } from "node:child_process";

// Async spawn-wrapper — sammelt stdout/stderr, returnt Exit-Code +
// strings. spawnSync würde den MainThread blocken und React 19's
// Concurrent-Rendering durcheinanderwürfeln ("Should not already be
// working." crash).
export function run(
  cmd: string,
  args: ReadonlyArray<string>,
  opts?: { readonly cwd?: string; readonly env?: Record<string, string>; readonly timeoutMs?: number },
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], {
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
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
