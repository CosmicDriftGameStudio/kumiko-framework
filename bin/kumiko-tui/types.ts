// Sprint B: TUI-Types werden direkt aus dem Command-Registry abgeleitet.
// Kein hardcoded SPIKE_COMMANDS mehr — die Liste kommt aus
// `bin/commands/index.ts`-Registry, gefiltert nach Role.

export type Role = "maintainer" | "app-dev";
export type Category = "help" | "lifecycle" | "quality" | "code" | "ops";

/** TUI-side view-model. Vom registry's Command abgeleitet, ohne run-fn
 *  (das ist die responsibility der CLI-bootstrap, nicht des UIs).
 *  argv ist hier statisch leer — Args werden später im run-flow vom
 *  User abgefragt (Sprint C: arg-form). */
export type TuiCommand = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly help: string;
  readonly category: Category;
  readonly roles: ReadonlyArray<Role>;
  readonly argv: ReadonlyArray<string>;
};
