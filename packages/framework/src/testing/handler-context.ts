import type {
  AppendEventArgs,
  FetchForWritingArgs,
  HandlerContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { createNoopMetricsHandle, getFallbackTracer } from "../observability";
import { createTzContext } from "../time";

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

// Noop observability — hand back the shared fallback tracer so ctx.tracer has
// a valid Tracer shape. No allocations per call.
const noopTracer = getFallbackTracer();

export function bridgeStub(): Pick<
  HandlerContext,
  | "query"
  | "queryAs"
  | "write"
  | "writeAs"
  | "appendEvent"
  | "fetchForWriting"
  | "loadAggregate"
  | "archiveStream"
  | "restoreStream"
  | "isStreamArchived"
  | "snapshotAggregate"
  | "loadAggregateWithSnapshot"
  | "queryProjection"
  | "resolveAuthClaims"
  | "metrics"
  | "tracer"
  | "tz"
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
    appendEvent: notAvailable("appendEvent") as unknown as (args: AppendEventArgs) => Promise<void>,
    fetchForWriting: notAvailable("fetchForWriting") as unknown as (
      args: FetchForWritingArgs,
    ) => ReturnType<HandlerContext["fetchForWriting"]>,
    loadAggregate: notAvailable("loadAggregate") as unknown as HandlerContext["loadAggregate"],
    archiveStream: notAvailable("archiveStream") as unknown as HandlerContext["archiveStream"],
    restoreStream: notAvailable("restoreStream") as unknown as HandlerContext["restoreStream"],
    isStreamArchived: notAvailable(
      "isStreamArchived",
    ) as unknown as HandlerContext["isStreamArchived"],
    snapshotAggregate: notAvailable(
      "snapshotAggregate",
    ) as unknown as HandlerContext["snapshotAggregate"],
    loadAggregateWithSnapshot: notAvailable(
      "loadAggregateWithSnapshot",
    ) as unknown as HandlerContext["loadAggregateWithSnapshot"],
    queryProjection: notAvailable(
      "queryProjection",
    ) as unknown as HandlerContext["queryProjection"],
    resolveAuthClaims: notAvailable(
      "resolveAuthClaims",
    ) as unknown as HandlerContext["resolveAuthClaims"],
    metrics: createNoopMetricsHandle(),
    tracer: noopTracer,
    // Echter TzContext, kein notAvailable — Test-Code nutzt ctx.tz häufig
    // ohne dass es ein "Bridge"-Konzept ist. Default UTC.
    tz: createTzContext(),
  };
}
