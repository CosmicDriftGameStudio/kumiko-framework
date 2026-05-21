// `bunx kumiko ops <subcommand>` — ES-Operations CLI.
//
// Phase 1: seed-migrations.
//   ops seed:new <slug>    — scaffold seeds/<date>-<slug>.ts
//   ops seed:status        — was applied, was pending
//   ops seed:apply [--dry-run]  — apply pending (für CI / manual)
//
// Wird aus bin/kumiko.ts unter `commands.ops` aufgerufen.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

const SEEDS_DIR_DEFAULT = "./seeds";

function todayDate(): string {
  // YYYY-MM-DD — chronologisch sortierbar als filename-prefix.
  return new Date().toISOString().slice(0, 10);
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function usage(): void {
  console.log(
    "\n  Usage: yarn kumiko ops <subcommand>\n\n" +
      "  Subcommands:\n" +
      "    seed:new <slug>          Scaffold seeds/<date>-<slug>.ts\n" +
      "    seed:status              Liste applied + pending seed-migrations\n" +
      "    seed:apply [--dry-run]   Applies pending seed-migrations\n\n" +
      "  Optional: --seeds-dir <path>   (default: ./seeds)\n",
  );
}

function readSeedsDirArg(argv: readonly string[]): string {
  const idx = argv.indexOf("--seeds-dir");
  if (idx >= 0 && argv[idx + 1]) return resolvePath(argv[idx + 1]!);
  return resolvePath(SEEDS_DIR_DEFAULT);
}

// --- ops seed:new -----------------------------------------------------------

function seedNew(argv: readonly string[]): void {
  const slug = argv[0];
  if (!slug) {
    console.error("\n  Missing <slug>. Usage: yarn kumiko ops seed:new <slug>\n");
    process.exit(1);
  }
  const sanitized = sanitizeSlug(slug);
  if (!sanitized) {
    console.error("\n  Invalid slug — only a-z, 0-9, - allowed.\n");
    process.exit(1);
  }

  const seedsDir = readSeedsDirArg(argv);
  if (!existsSync(seedsDir)) mkdirSync(seedsDir, { recursive: true });

  const filename = `${todayDate()}-${sanitized}.ts`;
  const filePath = join(seedsDir, filename);

  if (existsSync(filePath)) {
    console.error(`\n  ${filePath} existiert bereits — überschreibe nicht.\n`);
    process.exit(1);
  }

  const template = `// ${filename}
//
// Seed-Migration. Wird beim nächsten App-Boot automatisch ausgeführt
// (vorausgesetzt KUMIKO_SKIP_ES_OPS != "1") und in kumiko_es_operations
// als applied markiert. Fail → Boot bricht ab, Retry beim nächsten Boot.
//
// ctx.systemWriteAs(<handlerQualifiedName>, payload) ruft existing
// write-handler als System-User — gleicher Pfad den ein UI-Click triggern
// würde, nur ohne Access-Check.

import type { SeedMigration } from "@cosmicdrift/kumiko-framework/es-ops";

export default {
  description: "TODO: kurze Beschreibung was diese Migration tut",
  run: async (_ctx) => {
    // TODO: Implementiere die Migration.
    //
    // Beispiel (admin-roles-fix):
    //   const admin = await ctx.findUserByEmail("admin@example.com");
    //   if (!admin) return;
    //   for (const m of await ctx.findMembershipsOfUser(admin.id)) {
    //     if (m.roles.includes("TenantAdmin")) continue;
    //     await ctx.systemWriteAs("tenant:write:updateMemberRoles", {
    //       userId: admin.id,
    //       tenantId: m.tenantId,
    //       roles: [...m.roles, "TenantAdmin"],
    //     });
    //   }
  },
} satisfies SeedMigration;
`;

  writeFileSync(filePath, template);
  console.log(`\n  ✓ ${filePath}\n  Edit + commit. Wird beim nächsten Boot oder via 'yarn kumiko ops seed:apply' angewendet.\n`);
}

// --- ops seed:status ---------------------------------------------------------

async function seedStatus(argv: readonly string[]): Promise<void> {
  const seedsDir = readSeedsDirArg(argv);

  const onDisk = listSeedFilesSync(seedsDir);
  if (onDisk.length === 0) {
    console.log(`\n  ${seedsDir} — keine seeds vorhanden.\n`);
    return;
  }

  const applied = await loadAppliedFromDb();
  for (const id of onDisk) {
    const isApplied = applied.has(id);
    const marker = isApplied ? "✓" : "⏳";
    console.log(`  ${marker} ${id}${isApplied ? " (applied)" : " (pending)"}`);
  }
  console.log();
}

// --- ops seed:apply ---------------------------------------------------------

async function seedApply(argv: readonly string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const seedsDir = readSeedsDirArg(argv);

  if (dryRun) {
    const onDisk = listSeedFilesSync(seedsDir);
    const applied = await loadAppliedFromDb();
    const pending = onDisk.filter((id) => !applied.has(id));
    console.log(`\n  Dry-Run: ${pending.length} pending\n`);
    for (const id of pending) console.log(`    ⏳ ${id}`);
    console.log();
    return;
  }

  // Real apply needs a configured Dispatcher — the runner is a low-level
  // primitive. CLI-apply bootstraps a minimal stack via the app's runProdApp
  // entry. For Phase 1 the simplest path is "let the app boot apply them".
  console.log(
    "\n  CLI-apply ist Phase-1 nicht aktiviert — start die App, sie wendet beim\n" +
      "  Boot alle pending Seeds automatisch an. (Phase 1: bunx kumiko ops\n" +
      "  seed:apply ohne --dry-run ist no-op. Geplant für Phase 1.5.)\n",
  );
}

// --- helpers ----------------------------------------------------------------

function listSeedFilesSync(seedsDir: string): readonly string[] {
  if (!existsSync(seedsDir)) return [];
  return readdirSync(seedsDir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".mts") || name.endsWith(".js"))
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .sort()
    .map((name) => name.replace(/\.(ts|mts|js)$/, ""));
}

async function loadAppliedFromDb(): Promise<Set<string>> {
  const dbUrl = Bun.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("  DATABASE_URL not set — can't query kumiko_es_operations\n");
    return new Set();
  }
  const postgresMod = await import("postgres");
  const postgres = postgresMod.default;
  const sql = postgres(dbUrl);
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM kumiko_es_operations WHERE operation_type = 'seed-migration'
    `;
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    // Table doesn't exist yet (first ever boot) → treat as empty applied-set.
    if (err instanceof Error && err.message.includes("relation") && err.message.includes("does not exist")) {
      return new Set();
    }
    throw err;
  } finally {
    await sql.end();
  }
}

// --- entry-point -----------------------------------------------------------

export async function runOpsCommand(argv: readonly string[]): Promise<void> {
  const sub = argv[0];
  if (!sub) {
    usage();
    return;
  }
  const rest = argv.slice(1);
  switch (sub) {
    case "seed:new":
      seedNew(rest);
      return;
    case "seed:status":
      await seedStatus(rest);
      return;
    case "seed:apply":
      await seedApply(rest);
      return;
    default:
      console.error(`\n  Unbekannt: "${sub}"\n`);
      usage();
      process.exit(1);
  }
}
