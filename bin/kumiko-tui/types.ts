// Hardcoded command catalog for Sprint A (spike). Replaced by the
// `defineCommand`-Registry in Sprint B — but the role + category fields
// here pre-shadow that schema so the TUI-code can already be written
// against the future shape.

export type Role = "maintainer" | "app-dev";

export type Category =
  | "lifecycle" // dev/down/reset/status
  | "quality" // check / fast-check / test
  | "code" // codegen / create / build
  | "ops"; // events / projections / cleanup

export type TuiCommand = {
  /** id used as menu-key + selector */
  readonly id: string;
  /** displayed name in the list */
  readonly label: string;
  /** short helptext (1 line) */
  readonly description: string;
  /** longer explanation shown in detail pane (multi-line ok) */
  readonly help: string;
  /** category for grouping */
  readonly category: Category;
  /** roles this command applies to */
  readonly roles: ReadonlyArray<Role>;
  /** which arg-list to pass when executing */
  readonly argv: readonly string[];
};

export const SPIKE_COMMANDS: ReadonlyArray<TuiCommand> = [
  {
    id: "check",
    label: "check",
    description: "Biome + TypeScript + Tests + Guards",
    help: "Voller Quality-Pass. Im maintainer-Modus über alle 5 Kumiko-Repos\nim Parent-Workspace, im app-dev-Modus nur diese App.\nScopable via KUMIKO_CLI_SCOPE env-var.",
    category: "quality",
    roles: ["maintainer", "app-dev"],
    argv: ["check"],
  },
  {
    id: "fast-check",
    label: "check:fast",
    description: "Schneller Check — skip Integration",
    help: "Nur Unit-Tests --changed + Biome + TS. Für Pre-Commit-Loops.",
    category: "quality",
    roles: ["maintainer"],
    argv: ["check:fast"],
  },
  {
    id: "dev",
    label: "dev",
    description: "Docker hochfahren (Postgres + Redis)",
    help: "Bootet die lokalen Services für die Entwicklung.\nIdempotent — wenn schon laufen, no-op.",
    category: "lifecycle",
    roles: ["maintainer", "app-dev"],
    argv: ["dev"],
  },
  {
    id: "down",
    label: "down",
    description: "Docker Services stoppen",
    help: "Stoppt Postgres + Redis. Daten bleiben im Volume.",
    category: "lifecycle",
    roles: ["maintainer", "app-dev"],
    argv: ["down"],
  },
  {
    id: "status",
    label: "status",
    description: "Services + Git auf einen Blick",
    help: "Zeigt was läuft (Docker), was geändert wurde (Git), wo du stehst.",
    category: "lifecycle",
    roles: ["maintainer", "app-dev"],
    argv: ["status"],
  },
  {
    id: "codegen",
    label: "codegen",
    description: ".kumiko/define.ts + types regenerieren",
    help: "Liest r.defineEvent-Aufrufe im Source-Tree und schreibt\n.kumiko/define.ts + types.generated.d.ts. Idempotent.",
    category: "code",
    roles: ["maintainer", "app-dev"],
    argv: ["codegen"],
  },
];
