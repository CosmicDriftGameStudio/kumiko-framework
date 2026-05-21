import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const migrateCommand = defineCommand({
  id: "migrate",
  label: "migrate",
  description: "DB-Schema (per-app) migrieren — generate-schema | generate | apply | validate | status | drop",
  help: "Subcommands:\n  generate-schema   Regeneriere drizzle/schema.generated.ts aus Entities\n  generate          generate-schema + drizzle-kit generate\n  apply             drizzle-kit migrate (pending Migrations anwenden)\n  validate          Schema-Drift-Check (DB vs. Journal/Snapshot)\n  status            drizzle-kit check\n  drop              drizzle-kit drop",
  category: "ops",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const sub = ctx.argv[0];

    const appCwd = process.env["INIT_CWD"] ?? ctx.cwd;
    const drizzleConfig = join(appCwd, "drizzle.config.ts");
    if (!existsSync(drizzleConfig)) {
      ctx.out.err("");
      ctx.out.err(`  Kein drizzle.config.ts in ${appCwd}.`);
      ctx.out.err("  'kumiko migrate' läuft pro App-Workspace — wechsle ins App-Verzeichnis.");
      ctx.out.err("");
      return 1;
    }

    const repoRoot = process.env["KUMIKO_REPO_ROOT"] ?? resolvePath(ctx.repoRoot, "..");
    const drizzleKitBin = resolvePath(repoRoot, "node_modules/.bin/drizzle-kit");
    if (!existsSync(drizzleKitBin)) {
      ctx.out.err("");
      ctx.out.err(`  drizzle-kit nicht gefunden unter ${drizzleKitBin}.`);
      ctx.out.err("  Wahrscheinlich ist 'yarn install' nicht gelaufen.");
      ctx.out.err("");
      return 1;
    }

    switch (sub) {
      case "generate-schema": {
        ctx.out.log(`Generiere Schema aus Entities (${appCwd})…`);
        return await runStreaming("bun", ["run", "drizzle/generate.ts"], ctx.out, { cwd: appCwd });
      }
      case "generate": {
        ctx.out.log(`Generiere Schema + Migration-File (${appCwd})…`);
        const sc = await runStreaming("bun", ["run", "drizzle/generate.ts"], ctx.out, { cwd: appCwd });
        if (sc !== 0) return sc;
        const gen = await runStreaming("node", [drizzleKitBin, "generate"], ctx.out, { cwd: appCwd });
        if (gen !== 0) return gen;
        if (existsSync(join(appCwd, "drizzle/migration-hooks.ts"))) {
          return await runStreaming("bun", ["run", "drizzle/migration-hooks.ts", "write-rebuild-marker"], ctx.out, { cwd: appCwd });
        }
        return 0;
      }
      case "apply": {
        // runMigrateApply ist 80 LOC in bin/kumiko.ts. Hier ein Slim-Bridge
        // bis Sprint C es richtig extrahiert.
        return await runStreaming("node", [drizzleKitBin, "migrate"], ctx.out, { cwd: appCwd });
      }
      case "validate": {
        ctx.out.log(`Prüfe Schema-Drift (${appCwd})…`);
        try {
          const dbUrl = process.env["DATABASE_URL"];
          if (!dbUrl) {
            ctx.out.err("  DATABASE_URL nicht gesetzt.");
            return 1;
          }
          const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
          const { detectDrift, formatDriftReport } = await import(
            "@cosmicdrift/kumiko-framework/migrations"
          );
          const { db, close } = createDbConnection(dbUrl);
          try {
            const report = await detectDrift(db, join(appCwd, "drizzle/migrations"));
            ctx.out.log("");
            ctx.out.log(`  ${formatDriftReport(report)}`);
            ctx.out.log("");
            return report.ok ? 0 : 1;
          } finally {
            await close();
          }
        } catch (e) {
          ctx.out.err(e instanceof Error ? e.message : String(e));
          return 1;
        }
      }
      case "status": {
        ctx.out.log(`Prüfe Migration-File-Konsistenz (${appCwd})…`);
        return await runStreaming("node", [drizzleKitBin, "check"], ctx.out, { cwd: appCwd });
      }
      case "drop": {
        return await runStreaming("node", [drizzleKitBin, "drop"], ctx.out, { cwd: appCwd });
      }
      default: {
        ctx.out.log("");
        ctx.out.log("  Subcommands:");
        ctx.out.log("    generate-schema   Regeneriere drizzle/schema.generated.ts");
        ctx.out.log("    generate          generate-schema + drizzle-kit generate");
        ctx.out.log("    apply             pending Migrations anwenden");
        ctx.out.log("    validate          Schema-Drift-Check");
        ctx.out.log("    status            drizzle-kit check");
        ctx.out.log("    drop              latest Migration löschen");
        ctx.out.log("");
        return 0;
      }
    }
  },
});
