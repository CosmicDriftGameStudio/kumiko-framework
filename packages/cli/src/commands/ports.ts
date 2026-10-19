import { resolve } from "node:path";
import {
  findPortCollisions,
  listAppPorts,
  scanWorkspaceApps,
} from "@cosmicdrift/kumiko-guards/repo-manifest/app-ports";
import type { CliCommand, CliCommandContext } from "./types";

// Fixed column order so the table reads the same in every run.
const PORT_COLUMNS = ["dev", "e2e", "postgres", "redis", "meilisearch", "s3"] as const;

export async function runPorts(ctx: CliCommandContext): Promise<number> {
  if (ctx.argv.length > 1 || ctx.argv.some((arg) => arg.startsWith("-"))) {
    ctx.out.err("  usage: kumiko ports [workspace-root]");
    return 1;
  }
  const root = resolve(ctx.cwd, ctx.argv[0] ?? ".");
  const apps = scanWorkspaceApps(root);
  if (apps.length === 0) {
    ctx.out.err(`  No app with kumiko.config.ts directly below ${root}.`);
    return 1;
  }
  ctx.out.log("");
  ctx.out.log(`  ${"app".padEnd(20)}${PORT_COLUMNS.map((column) => column.padEnd(12)).join("")}`);
  let undeclared = 0;
  for (const { app, config: appConfig } of apps) {
    if (appConfig.kind !== "defined") {
      undeclared++;
      const reason = appConfig.kind === "invalid" ? appConfig.message : "no defineAppConfig ports";
      ctx.out.log(`  ${app.padEnd(20)}(${reason})`);
      continue;
    }
    const byRole = new Map(listAppPorts(appConfig.ports).map(({ role, port }) => [role, port]));
    ctx.out.log(
      `  ${app.padEnd(20)}${PORT_COLUMNS.map((column) => String(byRole.get(column) ?? "-").padEnd(12)).join("")}`,
    );
  }
  const collisions = findPortCollisions(apps);
  ctx.out.log("");
  for (const { port, claims } of collisions) {
    ctx.out.err(`  ✗ port ${port}: ${claims.map(({ app, role }) => `${app} ${role}`).join(", ")}`);
  }
  if (undeclared > 0)
    ctx.out.log(
      `  ${undeclared} app(s) without readable ports are not part of the collision check.`,
    );
  if (collisions.length === 0)
    ctx.out.log(`  No port collisions among ${apps.length - undeclared} of ${apps.length} app(s).`);
  ctx.out.log("");
  return collisions.length > 0 ? 1 : 0;
}

export const portsCommand: CliCommand = {
  id: "ports",
  description: "List the ports of every app in a workspace and report collisions",
  help: [
    "Scans the direct children of [workspace-root] (default: cwd) for kumiko.config.ts,",
    "reads ports.dev, ports.e2e and ports.infra statically (no app code runs) and",
    "exits 1 when two apps, or two roles of one app, claim the same port.",
  ].join("\n"),
  run: runPorts,
};
