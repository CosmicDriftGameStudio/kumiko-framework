// Command definition + dispatch context. Symmetric to the Probe-Pattern
// in bin/kumiko-tui/probes — each command lives in its own file,
// registers itself on import via defineCommand and is dispatched
// via runCommand(id, ctx).

export type Role = "maintainer" | "app-dev";

export type Category = "help" | "lifecycle" | "quality" | "code" | "ops";

/** What goes to stdout/stderr — pluggable so tests can collect the output
 *  instead of writing directly to the terminal. */
export type Output = {
  readonly log: (msg: string) => void;
  readonly warn: (msg: string) => void;
  readonly err: (msg: string) => void;
};

export type CommandContext = {
  /** Args after the command name (corresponds to Bun.argv.slice(3) in the legacy version). */
  readonly argv: ReadonlyArray<string>;
  /** Where the user invoked the command (NOT framework-root). */
  readonly cwd: string;
  /** From cwd detection, or via --as override. */
  readonly role: Role;
  /** node_modules/.bin path — repo-root preferred, otherwise cwd. */
  readonly binPath: string;
  /** REPO_ROOT = workspace-parent (cosmicdriftgamestudio/) or framework-root */
  readonly repoRoot: string;
  /** From KUMIKO_CLI_SCOPE env-var, scope for quality checks. */
  readonly scope: string | undefined;
  /** Output handler — default is console, injected in tests. */
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
