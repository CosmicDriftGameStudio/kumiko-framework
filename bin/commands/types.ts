// Command-Definition + dispatch-context. Symmetrisch zum Probe-Pattern
// in bin/kumiko-tui/probes — jeder Command lebt in einer eigenen Datei,
// registriert sich beim Import via defineCommand und wird ge-dispatched
// via runCommand(id, ctx).

export type Role = "maintainer" | "app-dev";

export type Category = "lifecycle" | "quality" | "code" | "ops";

/** Was an stdout/stderr geht — pluggable damit Tests den Output
 *  einsammeln können statt direkt aufs Terminal zu schreiben. */
export type Output = {
  readonly log: (msg: string) => void;
  readonly warn: (msg: string) => void;
  readonly err: (msg: string) => void;
};

export type CommandContext = {
  /** Args nach dem Command-Namen (entspricht Bun.argv.slice(3) im Legacy). */
  readonly argv: ReadonlyArray<string>;
  /** Wo der User den Command aufgerufen hat (NICHT framework-root). */
  readonly cwd: string;
  /** Aus cwd-Detection, oder via --as Override. */
  readonly role: Role;
  /** node_modules/.bin Pfad — Repo-root bevorzugt, sonst cwd. */
  readonly binPath: string;
  /** REPO_ROOT = workspace-parent (cosmicdriftgamestudio/) oder framework-root */
  readonly repoRoot: string;
  /** Aus KUMIKO_CLI_SCOPE env-var, scope für quality-checks. */
  readonly scope: string | undefined;
  /** Output-handler — Default ist console, in tests injected. */
  readonly out: Output;
};

export type Command = {
  readonly id: string;
  readonly label: string;
  /** 1-line description for help-output + TUI list. */
  readonly description: string;
  /** Multi-line help for detail-panes. */
  readonly help: string;
  readonly category: Category;
  readonly roles: ReadonlyArray<Role>;
  /** Returns exit code (0 = ok). */
  readonly run: (ctx: CommandContext) => Promise<number>;
};
