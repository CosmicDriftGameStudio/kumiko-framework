import { run } from "./_spawn";
import { defineCommand } from "./registry";

export const statusCommand = defineCommand({
  id: "status",
  label: "status",
  description: "Was geht? Services, Git, alles auf einen Blick",
  help: "Zeigt Docker-Services (compose ps) + aktuellen Git-Branch + working-tree-Änderungen.",
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    ctx.out.log("--- Services ---");
    const docker = await run("docker", ["compose", "ps", "--format", "json"], { cwd: ctx.cwd });
    if (docker.status === 0 && docker.stdout.trim()) {
      for (const line of docker.stdout.trim().split("\n").filter(Boolean)) {
        try {
          const svc = JSON.parse(line) as { Service?: string; State?: string; Ports?: string };
          ctx.out.log(`  ${svc.Service ?? "?"}: ${svc.State ?? "?"} (${svc.Ports || "no ports"})`);
        } catch {
          // skip malformed
        }
      }
    } else {
      ctx.out.log("  Docker services not running");
    }

    ctx.out.log("");
    ctx.out.log("--- Git ---");
    const branch = await run("git", ["branch", "--show-current"], { cwd: ctx.cwd });
    if (branch.status !== 0) {
      ctx.out.log("  Not a git repository");
      return 0;
    }
    const statusRes = await run("git", ["status", "--short"], { cwd: ctx.cwd });
    ctx.out.log(`  Branch: ${branch.stdout.trim()}`);
    const changes = statusRes.stdout.trim();
    if (changes) {
      const formatted = changes.split("\n").map((l: string) => `    ${l}`).join("\n");
      ctx.out.log(`  Changes:\n${formatted}`);
    } else {
      ctx.out.log("  Clean");
    }
    return 0;
  },
});
