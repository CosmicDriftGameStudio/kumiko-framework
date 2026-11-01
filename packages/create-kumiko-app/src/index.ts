// `bun create kumiko-app <name>` → bunx create-kumiko-app <name>.
//
// Flow: parse args → load vendored manifest → run picker (unless
// --print-manifest / --yes) → resolve deps → map to scaffold entries →
// scaffoldApp() → print next-steps.

import type { ScaffoldFeatureEntry, ScaffoldStarter } from "@cosmicdrift/kumiko-dev-server";
import { resolveDeps } from "./dep-resolver";
import { FEATURE_CONSTRUCTORS } from "./feature-constructors";
import { loadManifest, type Manifest } from "./manifest";
import { buildChoices, runPicker } from "./picker";

const USAGE =
  "Usage: bun create kumiko-app <name> [--yes] [--blank] [--print-manifest] [-h | --help]";

export type CliArgs = {
  /** App name (kebab-case). Required for `scaffold` mode. */
  readonly name?: string;
  /** Print the picker choices as JSON and exit (CI snapshot test). */
  readonly printManifest?: boolean;
  /** Skip the interactive picker, take every `recommended:true` feature. */
  readonly yes?: boolean;
  /** `blank` scaffolds no demo tasks and no seeded password; the creator sets one via password reset. */
  readonly starter?: ScaffoldStarter;
  /** Print usage and exit 0 without scaffolding. */
  readonly help?: boolean;
  /** Override cwd for scaffoldApp (mostly for the smoke test). */
  readonly cwd?: string;
  /** Override stdout sink (default: console.log). */
  readonly log?: (line: string) => void;
};

export async function runCreate(args: CliArgs): Promise<number> {
  const log = args.log ?? ((line) => console.log(line));
  if (args.help) {
    log(USAGE);
    return 0;
  }
  const manifest = loadManifest();

  if (args.printManifest) {
    log(JSON.stringify(buildChoices(manifest), null, 2));
    return 0;
  }

  if (!args.name) {
    log(USAGE);
    return 1;
  }

  const selected = args.yes ? defaultSelection(manifest) : await runPicker(manifest);
  if (selected.length === 0) {
    log("No features selected — aborting.");
    return 1;
  }

  const resolved = resolveDeps(selected, manifest);
  const features = resolved.featureNames
    .map((name) => FEATURE_CONSTRUCTORS[name])
    .filter((entry): entry is ScaffoldFeatureEntry => entry !== undefined);

  // config/user/tenant/auth-email-password are auto-mounted by
  // composeFeatures(includeBundled:true) at boot — only log auto-adds
  // that actually land in the explicit APP_FEATURES list.
  const reportableAutoAdds = resolved.autoAdded.filter((n) =>
    Object.hasOwn(FEATURE_CONSTRUCTORS, n),
  );
  if (reportableAutoAdds.length > 0) {
    log(`Auto-included via requires: ${reportableAutoAdds.join(", ")}`);
  }
  log("");
  log(
    `→ Scaffolding ${features.length} feature${features.length === 1 ? "" : "s"} into ./${args.name}/ …`,
  );

  // The dev-server barrel pulls in framework, server-runtime and renderer (~0.6 s cold);
  // loading it here keeps --help and --print-manifest fast.
  const { scaffoldApp } = await import("@cosmicdrift/kumiko-dev-server");
  const { renderTestSetup } = await import("@cosmicdrift/kumiko-testing/scaffold");
  const result = await scaffoldApp({
    name: args.name,
    cwd: args.cwd,
    features,
    testSetup: renderTestSetup,
    ...(args.starter !== undefined && { starter: args.starter }),
  });

  log("");
  log(`✓ ${result.appName} scaffolded → ${result.destination}`);
  log("");
  log("Next steps:");
  log(`  cd ${args.name}`);
  log("  bun install");
  log("  cp .env.example .env  # set JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1");
  log("  docker compose up -d   # if you don't have Postgres + Redis running yet");
  log(
    args.starter === "blank"
      ? "  bun dev                # URL + local dev login in the banner; prod admin: see README"
      : "  bun dev                # demo tasks are pre-seeded — URL + login in the banner",
  );
  return 0;
}

function defaultSelection(manifest: Manifest): readonly string[] {
  return buildChoices(manifest)
    .filter((c) => c.recommended)
    .map((c) => c.name);
}

export function parseArgv(argv: readonly string[]): CliArgs {
  const out: { -readonly [K in keyof CliArgs]?: CliArgs[K] } = {};
  for (const arg of argv) {
    if (arg === "--print-manifest") out.printManifest = true;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg === "--blank") out.starter = "blank";
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!arg.startsWith("-") && out.name === undefined) out.name = arg;
  }
  return out;
}
