// `kumiko schema` — drizzle-free migration path (dev CLI surface).
//
// Thin wrapper: delegates to the shared `runSchemaCli` core
// (@cosmicdrift/kumiko-framework/schema-cli), which is the SAME core the
// shipped `kumiko-schema` bin (dev-server) uses — apps and the dev CLI share
// one implementation, no drift.
//
//   generate <name>  collect kumiko/schema.ts → ENTITY_METAS, diff vs snapshot,
//                    write kumiko/migrations/NNNN_<name>.sql + .snapshot.json
//   apply            apply pending checked-in SQL (checksum-tracked, idempotent)
//   baseline         mark checked-in migrations applied without running SQL
//   status           list applied vs pending against DATABASE_URL

import { defineCommand } from "./registry";

export const schemaCommand = defineCommand({
  id: "schema",
  label: "schema",
  description: "DB-schema migrations (NO-MAGIC-ON-DATA pipeline) — generate | apply | baseline | status",
  help: [
    "Subcommands:",
    "  generate <name>   kumiko/schema.ts → ENTITY_METAS, diff vs snapshot,",
    "                    write kumiko/migrations/NNNN_<name>.sql + .snapshot.json.",
    "  apply             apply pending checked-in SQL (checksum-tracked, idempotent).",
    "  baseline          mark checked-in migrations applied WITHOUT running SQL",
    "                    (adopt an existing DB — cutover from legacy drizzle).",
    "  status            list applied vs pending against DATABASE_URL.",
    "",
    "Apps run the same via the shipped bin: `bunx kumiko-schema <sub>`.",
  ].join("\n"),
  category: "ops",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const { runSchemaCli } = await import("@cosmicdrift/kumiko-framework/schema-cli");
    const appCwd = process.env["INIT_CWD"] ?? ctx.cwd;
    return runSchemaCli(ctx.argv, appCwd, ctx.out);
  },
});
