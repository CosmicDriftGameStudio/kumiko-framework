// `kumiko upgrade` — thin wrapper: delegates to the shared `runUpgradeCli`
// core (@cosmicdrift/kumiko-framework/upgrade-cli), which is the SAME core
// the published `kumiko-upgrade` bin (in @cosmicdrift/kumiko-cli and
// dev-server) uses — apps and the dev CLI share one implementation.
// upgrade-help.test.ts keeps the flag list below in sync with that core.

import { defineCommand } from "./registry";

export const upgradeCommand = defineCommand({
  id: "upgrade",
  label: "upgrade",
  description: "Show what changed since your Kumiko version — migration hints for breaking changes",
  help: [
    "Usage: kumiko upgrade [--from <version>] [--dir <path>] [--json] [--verbose]",
    "       kumiko upgrade --apply [--dir <path>] [--dry-run] [--from <version>]",
    '       kumiko upgrade --resolve <id|version>[,<id|version>...] --reason "<text>" [--not-applicable] [--dir <path>]',
    "",
    "Reads changes.json from all bundled features plus the framework core",
    "and shows what's new since your current (or specified) Kumiko version.",
    "",
    "--apply runs the codemod referenced by every pending breaking change's",
    "`codemod` field (oldest version first), against --dir (default: cwd).",
    "Codemods ship inside the installed @cosmicdrift/kumiko-framework package",
    "(src/scripts/codemod/) — --apply works from a plain npm/bun install.",
    "Stops on the first failure; codemods that already ran stay recorded in a partial",
    ".kumiko/upgrade-state.json marker, and a re-run resumes at the failed one.",
    "Manual migrations stay open in the marker (`pendingManual`) until --resolve",
    "marks them done (`resolvedManual`).",
    "",
    "Flags:",
    "  --from <ver>       Baseline version (default: last applied marker, else the installed version)",
    "  --dir <path>       Target directory to check, apply or resolve against (default: cwd)",
    "  --json             Machine-readable output (for agents)",
    "  --verbose          Show detail + migration text",
    "  --apply            Run pending breaking changes' codemods instead of reporting",
    "  --dry-run          With --apply: run codemods without writing files or the marker",
    "  --resolve <refs>   Mark open manual migrations as done; ref = full id or a version",
    "                     with exactly one open entry, comma-separated",
    "  --reason <text>    Required with --resolve, max 500 characters",
    "  --not-applicable   With --resolve: record entries as not applicable instead of migrated",
    "  --help, -h         Print this usage and exit",
    "",
    "Examples:",
    "  kumiko upgrade",
    "  kumiko upgrade --from 0.160.0 --verbose",
    "  kumiko upgrade --json",
    "  kumiko upgrade --apply --dry-run",
    '  kumiko upgrade --resolve 0.349.0 --reason "migrated by hand"',
  ].join("\n"),
  category: "lifecycle",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const { runUpgradeCli } = await import("@cosmicdrift/kumiko-framework/upgrade-cli");
    const appCwd = process.env["INIT_CWD"] ?? ctx.cwd;
    return runUpgradeCli(ctx.argv, appCwd, ctx.out, { repoRoot: ctx.repoRoot });
  },
});
