import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./_spawn";
import { defineCommand } from "./registry";

const REQUIRED_ENVS = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "REDIS_URL",
  "MEILI_URL",
  "MEILI_MASTER_KEY",
  "JWT_SECRET",
] as const;

const DIAGNOSES = [
  "Everything seems fine. Probably. Don't quote me on this.",
  "Patient is stable. Vital signs acceptable. Soul status unknown.",
  "No symptoms detected. Doesn't mean there's no disease.",
  "Looks healthy — in this light, from this angle, today.",
  "Diagnosis: inconclusive, but encouraging.",
  "All clear. Back to coding. Don't look too closely.",
];

type Check = { readonly name: string; readonly ok: boolean; readonly hint?: string };

export const doctorCommand = defineCommand({
  id: "doctor",
  label: "doctor",
  description: "Health check. Probably everything is fine.",
  help: "Checks .env, env vars, node_modules, docker services, postgres readiness.\nPrints hints when something is off.",
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const checks: Check[] = [];

    const envPath = join(ctx.cwd, ".env");
    checks.push({
      name: ".env file",
      ok: existsSync(envPath),
      hint: existsSync(envPath) ? undefined : "cp .env.example .env",
    });

    const missingEnvs = REQUIRED_ENVS.filter((e) => !process.env[e]);
    checks.push({
      name: "required env vars",
      ok: missingEnvs.length === 0,
      hint: missingEnvs.length ? `missing: ${missingEnvs.join(", ")}` : undefined,
    });

    const nm = join(ctx.cwd, "node_modules");
    checks.push({
      name: "node_modules",
      ok: existsSync(nm),
      hint: existsSync(nm) ? undefined : "bun install",
    });

    const dockerPs = await run("docker", ["compose", "ps", "--format", "json"], { cwd: ctx.cwd });
    const dockerOk = dockerPs.status === 0 && dockerPs.stdout.trim().length > 0;
    checks.push({
      name: "docker services",
      ok: dockerOk,
      hint: dockerOk ? undefined : "kumiko dev",
    });

    const pgReady = await run(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "kumiko"],
      { cwd: ctx.cwd, timeoutMs: 2000 },
    );
    checks.push({
      name: "postgres ready",
      ok: pgReady.status === 0,
      hint: pgReady.status === 0 ? undefined : "check: docker compose logs postgres",
    });

    ctx.out.log("");
    for (const c of checks) {
      const mark = c.ok ? "✓" : "✗";
      const note = c.hint ? ` (${c.hint})` : "";
      ctx.out.log(`  ${mark} ${c.name}${note}`);
    }
    ctx.out.log("");

    if (checks.every((c) => c.ok)) {
      const pick = DIAGNOSES[Math.floor(Math.random() * DIAGNOSES.length)] ?? DIAGNOSES[0]!;
      ctx.out.log(`  ${pick}`);
      ctx.out.log("");
      return 0;
    }
    ctx.out.log("  Not great. See the ✗ above — the hints tell you what to do.");
    ctx.out.log("");
    return 1;
  },
});
