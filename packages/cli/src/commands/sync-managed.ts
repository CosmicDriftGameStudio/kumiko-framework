import { loadRepoManifest, REPO_MANIFEST_FILE } from "../repo-manifest";
import type { CliCommand, CliCommandContext } from "./types";

const SYNC_FLAGS = ["--write", "--adopt"] as const;

export async function runSyncManaged(ctx: CliCommandContext): Promise<number> {
  const unknown = ctx.argv.filter((arg) => !SYNC_FLAGS.some((flag) => flag === arg));
  if (unknown.length > 0) {
    ctx.out.err(
      `  Unknown argument(s) for "sync-managed": ${unknown.join(", ")}. Known flags: ${SYNC_FLAGS.join(", ")}`,
    );
    return 1;
  }
  const { manifest } = loadRepoManifest(ctx.cwd, {
    warn: (message) => ctx.out.err(`  ${message}`),
  });
  if (manifest.kind !== "app") {
    ctx.out.err(
      `  sync-managed needs kind "app" in ${REPO_MANIFEST_FILE}, got "${manifest.kind}".`,
    );
    return 1;
  }
  const write = ctx.argv.includes("--write");
  const managed = await import("@cosmicdrift/kumiko-dev-server/managed-files");
  const facts = managed.resolveManagedAppFacts({
    appRoot: ctx.cwd,
    uiRoots: manifest.uiRoots ?? [],
  });
  const actions = managed.syncManagedFiles(facts, { write, adopt: ctx.argv.includes("--adopt") });
  ctx.out.log("");
  for (const entry of actions) {
    if (entry.action === "unchanged") continue;
    const verb = write ? entry.action : `would ${entry.action}`;
    ctx.out.log(
      entry.action === "skip"
        ? `  skip    ${entry.path}: ${entry.skippedBecause}`
        : `  ${verb.padEnd(7)} ${entry.path}`,
    );
  }
  const pending = actions.filter(
    (entry) => entry.action !== "unchanged" && entry.action !== "skip",
  );
  ctx.out.log("");
  if (!write && pending.length > 0)
    ctx.out.log("  Dry run. Write the changes with: kumiko sync-managed --write");
  if (pending.length === 0) ctx.out.log("  All writable managed files are up to date.");
  ctx.out.log("");
  return 0;
}

export const syncManagedCommand: CliCommand = {
  id: "sync-managed",
  description: "Write the framework-owned files of an app from the installed templates",
  help: [
    "Renders the managed files (deploy/, .husky/pre-push, .github/workflows, bunfigs,",
    "kumiko/schema.ts) from the installed @cosmicdrift/kumiko-dev-server and writes",
    "the ones that differ. Without --write it only lists what would change.",
    "",
    "Only files that carry the kumiko-managed marker are overwritten. A file with",
    "`kumiko-managed: local <reason>` on the line after the marker is left alone.",
    "",
    "Flags:",
    "  --write    write the changes",
    "  --adopt    also take over existing files without a marker (first adoption)",
  ].join("\n"),
  run: runSyncManaged,
};
