import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

// check ist 300+ LOC mit parallel-Lock, Tee-Logging und multi-step
// pool-runner. Sprint B nutzt subprocess-delegation an die existing
// implementation in bin/kumiko-legacy.ts. Sprint C macht das echte
// Extracting (siehe TODO im plan).
const LEGACY_BIN = "bin/kumiko-legacy.ts";

export const checkCommand = defineCommand({
  id: "check",
  label: "check",
  description: "Alles pruefen: Lint, Types, Tests",
  help: "Voller Quality-Pass: Biome + TS + Guards + Tests.\nParallel-Lock: gleichzeitige Aufrufe folgen dem Lead-Run.\n\n(Sprint B: subprocess-dispatch an legacy implementation.\nSprint C: native extraction in bin/commands/_check/)",
  category: "quality",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    return await runStreaming(
      process.execPath,
      [join(ctx.repoRoot, LEGACY_BIN), "check"],
      ctx.out,
      { cwd: ctx.cwd },
    );
  },
});
