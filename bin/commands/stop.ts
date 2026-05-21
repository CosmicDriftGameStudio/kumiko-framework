import { run } from "./_spawn";
import { defineCommand } from "./registry";

export const stopCommand = defineCommand({
  id: "stop",
  label: "stop",
  description: "Feierabend. Docker Services stoppen",
  help: "Stoppt Postgres + Redis + Meilisearch (docker compose down). Daten bleiben im Volume.",
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    ctx.out.log("Fahre alles runter...");
    const r = await run("docker", ["compose", "down"], { cwd: ctx.cwd });
    if (r.status !== 0) {
      ctx.out.err(`docker compose down failed: ${r.stderr}`);
      return r.status;
    }
    ctx.out.log("Alles aus. Bis morgen!");
    return 0;
  },
});
