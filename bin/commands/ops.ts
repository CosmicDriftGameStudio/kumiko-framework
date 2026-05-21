import { defineCommand } from "./registry";

export const opsCommand = defineCommand({
  id: "ops",
  label: "ops",
  description: "ES-Operations — kumiko ops seed:new <slug> | seed:status | seed:apply [--dry-run]",
  help: "Event-Store Seed-Workflow:\n  seed:new <slug>     Erstellt neue Seed-Datei mit Template\n  seed:status         Listet pending/applied seeds\n  seed:apply [--dry-run]   Applied pending seeds als events",
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
