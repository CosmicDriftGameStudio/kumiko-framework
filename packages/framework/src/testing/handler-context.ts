import type { HandlerContext, SessionUser, WriteResult } from "../engine/types";

// Test/service helper: cross-feature bridge methods that throw on use.
//
// Production code always receives a full HandlerContext from the Dispatcher's
// buildHandlerContext (with real query/write closures). Some internal services
// and tests construct a mini-context manually (typically just `{ db, registry }`)
// to invoke a single handler. Those call sites don't use ctx.query/write —
// the stubs make the TypeScript shape match while still failing loudly if
// anything downstream accidentally reaches for them.
//
// Use: `{ db, registry, ...bridgeStub() }`

const notAvailable = (what: string) => async (): Promise<never> => {
  throw new Error(
    `ctx.${what} not available in this context — use the dispatcher, not a stubbed handler context`,
  );
};

export function bridgeStub(): Pick<
  HandlerContext,
  "query" | "queryAs" | "write" | "writeAs" | "emit"
> {
  return {
    query: notAvailable("query") as HandlerContext["query"],
    queryAs: notAvailable("queryAs") as unknown as (
      user: SessionUser,
      qn: string,
      payload: unknown,
    ) => Promise<unknown>,
    write: notAvailable("write") as unknown as (
      qn: string,
      payload: unknown,
    ) => Promise<WriteResult>,
    writeAs: notAvailable("writeAs") as unknown as (
      user: SessionUser,
      qn: string,
      payload: unknown,
    ) => Promise<WriteResult>,
    emit: notAvailable("emit") as unknown as (qn: string, payload: unknown) => Promise<void>,
  };
}
