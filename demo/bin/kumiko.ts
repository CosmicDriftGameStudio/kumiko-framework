#!/usr/bin/env bun

// Standalone kumiko schema-CLI for the production bundle. The deploy
// migrate-step runs `bun /app/kumiko.js schema apply`; kumiko-build bundles
// this file to dist-server/kumiko.js.

import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";
import { APP_FEATURES, HAS_AUTH } from "../src/run-config";

const [, , cmd, ...rest] = Bun.argv;
if (cmd !== "schema") {
  // biome-ignore lint/suspicious/noConsole: CLI output is the feature.
  console.error(
    "\n  Unbekannt: kumiko " + (cmd ?? "") + " — nur 'kumiko schema <sub>' im Standalone-Bundle.\n",
  );
  process.exit(1);
}

const features = composeFeatures([...APP_FEATURES], { includeBundled: HAS_AUTH });
// biome-ignore lint/suspicious/noConsole: CLI output is the feature.
const out = { log: (l: string) => console.log(l), err: (l: string) => console.error(l) };
process.exit(await runSchemaCli(rest, process.env.INIT_CWD ?? process.cwd(), out, { features }));
