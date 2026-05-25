import { run } from "./_spawn";
import { defineCommand } from "./registry";

async function waitForPostgres(cwd: string, retries = 30): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    const r = await run(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "kumiko"],
      { cwd, timeoutMs: 2000 },
    );
    if (r.status === 0) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

export const devCommand = defineCommand({
  id: "dev",
  label: "dev",
  description: "Bring up local Docker services (Postgres, Redis, Meilisearch, MinIO)",
  help: "Boots Postgres + Redis + Meilisearch + MinIO via docker compose up -d.\nIdempotent — no-op if already running.",
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    ctx.out.log("Starting PostgreSQL and Redis...");
    const up = await run("docker", ["compose", "up", "-d"], { cwd: ctx.cwd });
    if (up.status !== 0) {
      ctx.out.err(`docker compose failed: ${up.stderr}`);
      return up.status;
    }
    const ok = await waitForPostgres(ctx.cwd);
    if (!ok) {
      ctx.out.err("Postgres is not responding — check `docker compose logs postgres`");
      return 1;
    }
    const pg = process.env["KUMIKO_PG_PORT"] ?? "15432";
    const redis = process.env["KUMIKO_REDIS_PORT"] ?? "16379";
    const meili = process.env["KUMIKO_MEILI_PORT"] ?? "17700";
    const minio = process.env["KUMIKO_MINIO_PORT"] ?? "19000";
    ctx.out.log(`  PostgreSQL   localhost:${pg}`);
    ctx.out.log(`  Redis        localhost:${redis}`);
    ctx.out.log(`  Meilisearch  localhost:${meili}`);
    ctx.out.log(`  MinIO (S3)   localhost:${minio}`);
    ctx.out.log("");
    ctx.out.log("Up and running. Happy coding.");
    return 0;
  },
});
