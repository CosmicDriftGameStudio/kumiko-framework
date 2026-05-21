// Hardcoded command catalog for Sprint A (spike). Replaced by the
// `defineCommand`-Registry in Sprint B.

export type TuiCommand = {
  /** id used as menu-key + selector */
  readonly id: string;
  /** displayed name in the list */
  readonly label: string;
  /** short helptext under the selection */
  readonly description: string;
  /** which arg-list to pass to `yarn kumiko` when executing */
  readonly argv: readonly string[];
};

export const SPIKE_COMMANDS: ReadonlyArray<TuiCommand> = [
  {
    id: "check",
    label: "check",
    description: "Alles prüfen: Biome + TypeScript + Tests + Guards (scoped via KUMIKO_CLI_SCOPE)",
    argv: ["check"],
  },
  {
    id: "fast-check",
    label: "check:fast",
    description: "Skip Integration, Unit-Tests nur --changed",
    argv: ["check:fast"],
  },
  {
    id: "dev",
    label: "dev",
    description: "Docker hochfahren — Postgres + Redis",
    argv: ["dev"],
  },
  {
    id: "down",
    label: "down",
    description: "Docker Services stoppen",
    argv: ["down"],
  },
  {
    id: "status",
    label: "status",
    description: "Services + Git auf einen Blick",
    argv: ["status"],
  },
  {
    id: "codegen",
    label: "codegen",
    description: ".kumiko/define.ts + types.generated.d.ts regenerieren",
    argv: ["codegen"],
  },
];
