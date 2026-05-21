import { defineCommand } from "./registry";

export const opsCommand = defineCommand({
  id: "ops",
  label: "ops",
  description: "ES operations — kumiko ops seed:new <slug> | seed:status | seed:apply [--dry-run]",
  help: "Event-store seed workflow:\n  seed:new <slug>          Create a new seed file from template\n  seed:status              List pending/applied seeds\n  seed:apply [--dry-run]   Apply pending seeds as events",
  category: "ops",
  roles: ["maintainer"],
  run: async (ctx) => {
    // ops-Implementation lebt in bin/ops.ts (~500 LOC). Direkt importieren
    // statt Logic zu duplizieren — die Module-Boundary ist sauber.
    const { runOpsCommand } = await import("../ops");
    try {
      await runOpsCommand([...ctx.argv]);
      return 0;
    } catch (e) {
      ctx.out.err(e instanceof Error ? e.message : String(e));
      return 1;
    }
  },
});
