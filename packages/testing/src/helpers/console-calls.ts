export type ConsoleSpyLike = {
  readonly mock: { readonly calls: ReadonlyArray<ReadonlyArray<unknown>> };
};

// Other test files in the same bun process emit async console output while a console spy is
// active, so assertions only count the calls that mention the message under test.
export function consoleCallsMentioning(
  spy: ConsoleSpyLike,
  fragment: string,
): ReadonlyArray<ReadonlyArray<unknown>> {
  return spy.mock.calls.filter((args) => args.some((arg) => String(arg).includes(fragment)));
}

// For "stays silent" assertions: counts every call from the given logger namespace instead of one
// message text, so a new or reworded warning from the module under test still fails the test.
export function consoleCallsFromNamespace(
  spy: ConsoleSpyLike,
  namespace: string,
): ReadonlyArray<ReadonlyArray<unknown>> {
  return spy.mock.calls.filter((args) => String(args[0]).startsWith(`[${namespace}]`));
}
