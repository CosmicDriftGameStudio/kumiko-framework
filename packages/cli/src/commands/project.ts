import { join } from "node:path";
import type { CliCommand, CliCommandContext } from "./types";

export const projectCommand: CliCommand = {
  id: "project",
  description: "Manage projections (list | status <name> | rebuild <name>)",
  help: "Reads kumiko.config.ts in cwd, builds the registry, dispatches against the\nprojection-state table in DATABASE_URL.\n\nSubcommands:\n  list                 List all projections and their state\n  status <name>        Show detail state for one projection\n  rebuild <name>       Full rebuild + report",
  run: async (ctx) => {
    const sub = ctx.argv[0];
    const arg = ctx.argv[1];

    const configPath = join(ctx.cwd, "kumiko.config.ts");
    if (!(await Bun.file(configPath).exists())) {
      ctx.out.err("");
      ctx.out.err(`  kumiko.config.ts not found at: ${configPath}`);
      ctx.out.err("");
      ctx.out.err("  Create a file that exports your features:");
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
        case "list":
          return await listProjections(ctx, db, registry, listProjectionsWithState);
        case "status":
          return await showProjectionStatus(ctx, db, arg, registry, getProjectionState);
        case "rebuild":
          return await rebuildOne(ctx, db, arg, registry, rebuildProjection);
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
};

async function listProjections(
  ctx: CliCommandContext,
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection,
  registry: ReturnType<typeof import("@cosmicdrift/kumiko-framework/engine").createRegistry>,
  listProjectionsWithState: typeof import("@cosmicdrift/kumiko-framework/pipeline").listProjectionsWithState,
): Promise<number> {
  const entries = await listProjectionsWithState(db, registry);
  if (entries.length === 0) {
    ctx.out.log("");
    ctx.out.log("  No projections registered.");
    ctx.out.log("");
    return 0;
  }
  ctx.out.log("");
  ctx.out.log("  Registered projections:");
  ctx.out.log("");
  for (const e of entries) {
    const when = e.lastRebuildAt ? e.lastRebuildAt.toString() : "never";
    ctx.out.log(
      `    ${e.name.padEnd(40)} ${e.status.padEnd(15)} source=${e.sources.join(",")} last=${when}`,
    );
  }
  ctx.out.log("");
  return 0;
}

async function showProjectionStatus(
  ctx: CliCommandContext,
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection,
  arg: string | undefined,
  registry: ReturnType<typeof import("@cosmicdrift/kumiko-framework/engine").createRegistry>,
  getProjectionState: typeof import("@cosmicdrift/kumiko-framework/pipeline").getProjectionState,
): Promise<number> {
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
      ctx.out.err(`  Projection "${arg}" is not registered.`);
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
  ctx.out.log(`    last rebuild:  ${state.lastRebuildAt?.toString() ?? "never"}`);
  ctx.out.log(`    updated at:    ${state.updatedAt.toString()}`);
  if (state.lastError) {
    ctx.out.log(`    last error:    ${state.lastError}`);
  }
  ctx.out.log("");
  return 0;
}

async function rebuildOne(
  ctx: CliCommandContext,
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection,
  arg: string | undefined,
  registry: ReturnType<typeof import("@cosmicdrift/kumiko-framework/engine").createRegistry>,
  rebuildProjection: typeof import("@cosmicdrift/kumiko-framework/pipeline").rebuildProjection,
): Promise<number> {
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
    ctx.out.log(
      `  ✓ ${result.projection}: ${result.eventsProcessed} events, ${result.durationMs}ms`,
    );
    ctx.out.log("");
    return 0;
  } catch (e) {
    ctx.out.err("");
    ctx.out.err(`  ✗ Rebuild failed: ${e instanceof Error ? e.message : e}`);
    ctx.out.err("");
    return 1;
  }
}
