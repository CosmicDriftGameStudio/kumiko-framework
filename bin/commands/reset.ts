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
  description: "Tabula rasa. Alles platt, alles neu",
  help: "DESTRUKTIV: docker compose down -v (= Volume-Wipe) + frischer up -d.\nAlle lokalen Daten weg. Nutze für tests oder corruption-recovery.",
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    ctx.out.log("Loesche alles und starte frisch...");
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
      ctx.out.err("Postgres antwortet nicht nach Reset");
      return 1;
    }
    ctx.out.log("Wie neu. Kein Byte ueberlebt.");
    return 0;
  },
});
