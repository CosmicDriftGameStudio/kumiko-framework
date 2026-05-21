import { run } from "./_spawn";
import { defineCommand } from "./registry";

export const stopCommand = defineCommand({
  id: "stop",
  label: "stop",
  description: "Closing time. Stop docker services",
  help: "Stops Postgres + Redis + Meilisearch (docker compose down). Data stays in the volume.",
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    ctx.out.log("Shutting everything down...");
    const r = await run("docker", ["compose", "down"], { cwd: ctx.cwd });
    if (r.status !== 0) {
      ctx.out.err(`docker compose down failed: ${r.stderr}`);
      return r.status;
    }
    ctx.out.log("All off. See you tomorrow.");
    return 0;
  },
});
