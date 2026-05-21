import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "./registry";

export const projectCommand = defineCommand({
  id: "project",
  label: "project",
  description: "Projections verwalten (list | status <name> | rebuild <name>)",
  help: "Liest kumiko.config.ts im cwd, baut Registry, dispatched gegen die\nProjection-State-Tabelle in DATABASE_URL.\n\nSubcommands:\n  list                 Alle Projections + ihr State\n  status <name>        Detail-State einer Projection\n  rebuild <name>       Full rebuild + report",
  category: "ops",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const sub = ctx.argv[0];
    const arg = ctx.argv[1];

    const configPath = join(ctx.cwd, "kumiko.config.ts");
    if (!existsSync(configPath)) {
      ctx.out.err("");
      ctx.out.err(`  kumiko.config.ts nicht gefunden: ${configPath}`);
      ctx.out.err("");
      ctx.out.err("  Erstelle eine Datei, die deine features exportiert:");
      ctx.out.err("    // kumiko.config.ts");
      ctx.out.err('    import { myFeature } from "./src/features/my-feature";');
      ctx.out.err("    export default { features: [myFeature] };");
      ctx.out.err("");
      return 1;
    }

    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      ctx.out.err("");
      ctx.out.err("  DATABASE_URL not set. Run against a configured env.");
      ctx.out.err("");
      return 1;
    }

    const config = (await import(configPath)).default as {
      features: readonly import("@cosmicdrift/kumiko-framework/engine").FeatureDefinition[];
    };
    const { createRegistry } = await import("@cosmicdrift/kumiko-framework/engine");
    const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
    const {
      listProjectionsWithState,
      getProjectionState,
      rebuildProjection,
      createProjectionStateTable,
    } = await import("@cosmicdrift/kumiko-framework/pipeline");

    const registry = createRegistry(config.features);
    const { db, close } = createDbConnection(databaseUrl);
    await createProjectionStateTable(db);

    try {
      switch (sub) {
        case "list": {
          const entries = await listProjectionsWithState(db, registry);
          if (entries.length === 0) {
            ctx.out.log("");
            ctx.out.log("  Keine Projections registriert.");
            ctx.out.log("");
            return 0;
          }
          ctx.out.log("");
          ctx.out.log("  Registrierte Projections:");
          ctx.out.log("");
          for (const e of entries) {
            const when = e.lastRebuildAt ? e.lastRebuildAt.toISOString() : "never";
            ctx.out.log(
              `    ${e.name.padEnd(40)} ${e.status.padEnd(15)} source=${e.sources.join(",")} last=${when}`,
            );
          }
          ctx.out.log("");
          return 0;
        }
        case "status": {
          if (!arg) {
            ctx.out.err("");
            ctx.out.err("  Usage: kumiko project status <projection-name>");
            ctx.out.err("");
            return 1;
          }
          const state = await getProjectionState(db, arg);
          if (!state) {
            const registered = registry.getAllProjections().has(arg);
            if (!registered) {
              ctx.out.err("");
              ctx.out.err(`  Projection "${arg}" ist nicht registriert.`);
              ctx.out.err("");
              return 1;
            }
            ctx.out.log("");
            ctx.out.log(`  ${arg}: never-rebuilt`);
            ctx.out.log("");
            return 0;
          }
          ctx.out.log("");
          ctx.out.log(`  ${state.name}`);
          ctx.out.log(`    status:        ${state.status}`);
          ctx.out.log(`    last event id: ${state.lastProcessedEventId}`);
          ctx.out.log(`    last rebuild:  ${state.lastRebuildAt?.toISOString() ?? "never"}`);
          ctx.out.log(`    updated at:    ${state.updatedAt.toISOString()}`);
          if (state.lastError) {
            ctx.out.log(`    last error:    ${state.lastError}`);
          }
          ctx.out.log("");
          return 0;
        }
        case "rebuild": {
          if (!arg) {
            ctx.out.err("");
            ctx.out.err("  Usage: kumiko project rebuild <projection-name>");
            ctx.out.err("");
            return 1;
          }
          ctx.out.log("");
          ctx.out.log(`  Rebuilding ${arg} ...`);
          try {
            const result = await rebuildProjection(arg, { db, registry });
            ctx.out.log("");
            ctx.out.log(`  ✓ ${result.projection}: ${result.eventsProcessed} events, ${result.durationMs}ms`);
            ctx.out.log("");
            return 0;
          } catch (e) {
            ctx.out.err("");
            ctx.out.err(`  ✗ Rebuild failed: ${e instanceof Error ? e.message : e}`);
            ctx.out.err("");
            return 1;
          }
        }
        default:
          ctx.out.log("");
          ctx.out.log("  Usage: kumiko project <list | status <name> | rebuild <name>>");
          ctx.out.log("");
          return 1;
      }
    } finally {
      await close();
    }
  },
});
