// Drops orphaned kumiko_test_* databases that setupTestStack leaked.
// Every setupTestStack() call creates a fresh Postgres DB named
// `kumiko_test_<8chars>` and returns a cleanup() function. When a
// process dies before cleanup() runs (test watchers aborted, dev
// server SIGKILL'd, CI pod-kill) the DB sticks around. Over weeks
// they accumulate — thousands is not unusual on a dev workstation.
//
// Usage:
//   yarn tsx scripts/cleanup-test-dbs.ts             → drop all
//   yarn tsx scripts/cleanup-test-dbs.ts --dry-run   → list only
//
// Drops in parallel batches so a cleanup-backlog of thousands finishes
// in minutes not hours. Each DROP is independent — if one DB is in
// active use (current test run), that DROP fails and we skip it.

import postgres from "postgres";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set (expected in .env)`);
  return v;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env["TEST_DATABASE_URL"] ?? requireEnv("DATABASE_URL");
  const adminUrl = url.replace(/\/[^/]+$/, "/postgres");
  const sql = postgres(adminUrl, { max: 1 });

  try {
    const rows = await sql<{ datname: string }[]>`
      SELECT datname FROM pg_database
      WHERE datname LIKE 'kumiko_test_%'
      ORDER BY datname
    `;

    if (rows.length === 0) {
      console.log("No orphan kumiko_test_* databases found. Nothing to do.");
      return;
    }

    console.log(
      `Found ${rows.length} orphan kumiko_test_* database${rows.length === 1 ? "" : "s"}.`,
    );

    if (dryRun) {
      console.log("--dry-run: not dropping. First 10:");
      for (const r of rows.slice(0, 10)) console.log(`  ${r.datname}`);
      if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
      return;
    }

    // Drop in parallel batches.
    const BATCH = 50;
    let dropped = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (r) => {
          try {
            await sql`DROP DATABASE ${sql(r.datname)}`;
            dropped += 1;
          } catch (e) {
            failed += 1;
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`  [skip] ${r.datname}: ${msg}`);
          }
        }),
      );
      console.log(`  dropped ${dropped}/${rows.length}${failed > 0 ? ` (${failed} skipped)` : ""}`);
    }
    console.log(
      `Done. Dropped ${dropped} database${dropped === 1 ? "" : "s"}${
        failed > 0 ? `, skipped ${failed}` : ""
      }.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
