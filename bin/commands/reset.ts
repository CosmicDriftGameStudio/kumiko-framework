import { run } from "./_spawn";
import { defineCommand } from "./registry";

async function waitForPostgres(cwd: string, retries = 30): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    const r = await run(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "kumiko"],
      { cwd, timeoutMs: 2000 },
    );
    if (r.status === 0) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

export const resetCommand = defineCommand({
  id: "reset",
  label: "reset",
  description: "Tabula rasa. Wipe everything, start fresh",
  help: "DESTRUCTIVE: docker compose down -v (= volume wipe) + fresh up -d.\nAll local data is gone. Use for tests or corruption recovery.",
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    ctx.out.log("Wiping everything and starting fresh...");
    const down = await run("docker", ["compose", "down", "-v"], { cwd: ctx.cwd });
    if (down.status !== 0) {
      ctx.out.err(`docker compose down -v failed: ${down.stderr}`);
      return down.status;
    }
    const up = await run("docker", ["compose", "up", "-d"], { cwd: ctx.cwd });
    if (up.status !== 0) {
      ctx.out.err(`docker compose up failed: ${up.stderr}`);
      return up.status;
    }
    const ok = await waitForPostgres(ctx.cwd);
    if (!ok) {
      ctx.out.err("Postgres is not responding after reset");
      return 1;
    }
    ctx.out.log("Good as new. Not a byte survived.");
    return 0;
  },
});
