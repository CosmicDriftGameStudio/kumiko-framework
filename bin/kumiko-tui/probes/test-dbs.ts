import { defineProbe } from "./registry";
import { run } from "./_lib";

export const testDbsProbe = defineProbe({
  id: "test-dbs",
  label: "Test-DBs",
  roles: ["maintainer"],
  collect: async () => {
    const url =
      process.env["DATABASE_URL"] ??
      "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev";
    const r = await run(
      "psql",
      [url, "-tAc", "SELECT count(*) FROM pg_database WHERE datname LIKE 'kumiko_test_%'"],
      { timeoutMs: 3000 },
    );
    if (r.status !== 0) {
      return { level: "warn", summary: "psql ?" };
    }
    const count = Number.parseInt(r.stdout.trim(), 10);
    if (Number.isNaN(count)) return { level: "warn", summary: "?" };
    if (count === 0) return { level: "ok", summary: "0 stale" };
    if (count <= 5) return { level: "warn", summary: `${count} stale` };
    return { level: "action", summary: `${count} stale` };
  },
});
