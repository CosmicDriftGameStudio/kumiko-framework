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
