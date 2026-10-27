// Provider errors can embed token or response data in `message`; logs carry
// only the error class.
export function describeError(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
