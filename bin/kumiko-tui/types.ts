// Sprint B: TUI types are derived directly from the Command Registry.
// No more hardcoded SPIKE_COMMANDS — the list comes from
// `bin/commands/index.ts`-registry, filtered by Role.

export type Role = "maintainer" | "app-dev";
export type Category = "help" | "lifecycle" | "quality" | "code" | "ops";

/** TUI-side view-model. Derived from the registry's Command, without run-fn
 *  (this is the responsibility of the CLI-bootstrap, not the UI).
 *  argv is statically empty here — Args are requested later in the run-flow from the
 *  User (Sprint C: arg-form). */
export type TuiCommand = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly help: string;
  readonly category: Category;
  readonly roles: ReadonlyArray<Role>;
  readonly argv: ReadonlyArray<string>;
};
