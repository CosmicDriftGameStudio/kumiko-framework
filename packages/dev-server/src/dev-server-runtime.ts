/// <reference types="bun-types" preserve="true" />

// The dev server is meant to run under Bun, but this module must at least
// load without it: every Bun.* call is gated, and tests drive the fetch
// handler directly instead of going through Bun.serve and real sockets.
export const hasBun = typeof Bun !== "undefined";

// Bun.serve returns a parametrised Server<WebSocketData>; nothing here reads
// the socket data, so the narrow binding is plenty. Without Bun the type
// falls back to `unknown`.
export type BunServer = typeof Bun extends undefined ? unknown : ReturnType<typeof Bun.serve>;

// @wrapper-known semantic-alias
// biome-ignore lint/suspicious/noConsole: dev-server status logging
export const logInfo = (msg: string): void => console.log(msg);
// @wrapper-known semantic-alias
// biome-ignore lint/suspicious/noConsole: dev-server error logging
export const logError = (...args: unknown[]): void => console.error(...args);
