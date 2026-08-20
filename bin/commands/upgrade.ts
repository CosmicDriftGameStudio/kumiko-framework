// `kumiko upgrade` — thin wrapper: delegates to the shared `runUpgradeCli`
// core (@cosmicdrift/kumiko-framework/upgrade-cli), which is the SAME core
// the shipped `kumiko-upgrade` bin (dev-server) uses — apps and the dev CLI
// share one implementation, no drift.

import { defineCommand } from "./registry";

export const upgradeCommand = defineCommand({
  id: "upgrade",
  label: "upgrade",
  description: "Show what changed since your Kumiko version — migration hints for breaking changes",
  help: [
    "Usage: kumiko upgrade [--from <version>] [--json] [--verbose]",
    "       kumiko upgrade --apply [--dir <path>] [--dry-run] [--from <version>]",
    "",
    "Reads changes.json from all bundled features plus the framework core",
    "and shows what's new since your current (or specified) Kumiko version.",
    "",
    "--apply runs the codemod referenced by every pending breaking change's",
    "`codemod` field (oldest version first), against --dir (default: cwd).",
    "Codemod scripts must live under <repo>/scripts/codemod/ — this only",
    "works from a checkout that has the framework repo locally (workspace",
    "member), not a plain npm install. Writes .kumiko/upgrade-state.json on",
    "full success; stops on the first codemod failure without writing it.",
    "",
    "Flags:",
    "  --from <ver>   Override current version (default: auto-detect from node_modules)",
    "  --json         Machine-readable output (for agents)",
    "  --verbose      Show detail + migration text",
    "  --apply        Run pending breaking changes' codemods instead of reporting",
    "  --dir <path>   Target directory for --apply (default: cwd)",
    "  --dry-run      With --apply: run codemods without writing files or the marker",
    "",
    "Examples:",
    "  kumiko upgrade",
    "  kumiko upgrade --from 0.160.0 --verbose",
    "  kumiko upgrade --json",
    "  kumiko upgrade --apply --dry-run",
  ].join("\n"),
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const { runUpgradeCli } = await import("@cosmicdrift/kumiko-framework/upgrade-cli");
    const appCwd = process.env["INIT_CWD"] ?? ctx.cwd;
    return runUpgradeCli(ctx.argv, appCwd, ctx.out, { repoRoot: ctx.repoRoot });
  },
});
