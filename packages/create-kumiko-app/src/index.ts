// `bun create kumiko-app <name>` → bunx create-kumiko-app <name>.
//
// Flow: parse args → load vendored manifest → run picker (unless
// --print-manifest / --yes) → resolve deps → map to scaffold entries →
// scaffoldApp() → print next-steps.

import { type ScaffoldFeatureEntry, scaffoldApp } from "@cosmicdrift/kumiko-dev-server";
import { resolveDeps } from "./dep-resolver";
import { FEATURE_CONSTRUCTORS } from "./feature-constructors";
import { loadManifest, type Manifest } from "./manifest";
import { buildChoices, runPicker } from "./picker";

export type CliArgs = {
  /** App name (kebab-case). Required for `scaffold` mode. */
  readonly name?: string;
  /** Print the picker choices as JSON and exit (CI snapshot test). */
  readonly printManifest?: boolean;
  /** Skip the interactive picker, take every `recommended:true` feature. */
  readonly yes?: boolean;
  /** Override cwd for scaffoldApp (mostly for the smoke test). */
  readonly cwd?: string;
  /** Override stdout sink (default: console.log). */
  readonly log?: (line: string) => void;
};

export async function runCreate(args: CliArgs): Promise<number> {
  const log = args.log ?? ((line) => console.log(line));
  const manifest = loadManifest();

  if (args.printManifest) {
    log(JSON.stringify(buildChoices(manifest), null, 2));
    return 0;
  }

  if (!args.name) {
    log("Usage: bun create kumiko-app <name> [--yes] [--print-manifest]");
    return 1;
  }

  const selected = args.yes ? defaultSelection(manifest) : await runPicker(manifest);
  if (selected.length === 0) {
    log("Keine Features gewählt — Abbruch.");
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

  const result = await scaffoldApp({
    name: args.name,
    cwd: args.cwd,
    features,
  });

  log("");
  log(`✓ ${result.appName} scaffolded → ${result.destination}`);
  log("");
  log("Nächste Schritte:");
  log(`  cd ${args.name}`);
  log("  bun install");
  log("  cp .env.example .env  # JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1 setzen");
  log("  docker compose up -d   # wenn noch kein PG + Redis läuft");
  log("  bun dev                # startet den Dev-Server + zeigt URL/Login");
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
    else if (!arg.startsWith("-") && out.name === undefined) out.name = arg;
  }
  return out;
}
