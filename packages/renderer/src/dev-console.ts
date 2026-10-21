// The renderer has no logger; the browser console is the developer-facing
// channel. Resolved at call time (not bound at import) so tests can spy on
// console.* per test.

export function rendererWarn(...args: unknown[]): void {
  // biome-ignore lint/suspicious/noConsole: renderer has no logger, the browser console is the developer-facing channel
  console.warn(...args);
}

export function rendererError(...args: unknown[]): void {
  // biome-ignore lint/suspicious/noConsole: renderer has no logger, the browser console is the developer-facing channel
  console.error(...args);
}

export function rendererDebug(...args: unknown[]): void {
  // biome-ignore lint/suspicious/noConsole: renderer has no logger, the browser console is the developer-facing channel
  console.debug(...args);
}
