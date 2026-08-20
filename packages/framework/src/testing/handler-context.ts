// @runtime runtime
//
// bridgeStub hands back a HandlerContext shape with throw-on-use bridge
// methods (ctx.query/write/loadAggregate/...). Used by both test code AND
// production services (delivery-service uses it to run cross-feature notify
// calls without a real dispatcher). Hence the runtime classification despite
// living under `testing/` — no vitest imports, no test side-effects.
import type {
  AppendEventArgs,
  FetchForWritingArgs,
  HandlerContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { DEFAULT_LOCALE } from "../i18n/request-locale";
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

export function bridgeStub(opts?: {
  readonly user?: SessionUser;
}): Pick<
  HandlerContext,
  | "query"
  | "queryAs"
  | "write"
  | "writeAs"
  | "appendEvent"
  | "unsafeAppendEvent"
  | "tryAppendEvent"
  | "fetchForWriting"
  | "loadAggregate"
  | "archiveStream"
  | "restoreStream"
  | "isStreamArchived"
  | "snapshotAggregate"
  | "loadAggregateWithSnapshot"
  | "queryProjection"
  | "resolveAuthClaims"
  | "hasFeature"
  | "metrics"
  | "metricsFor"
  | "tracer"
  | "tz"
  | "locale"
  | "user"
> {
  // ctx.user is a convenience alias for event.user (see HandlerContext
  // docs). Caller code expects the field; bridgeStub hands back a stub with
  // anonymous default values when no user is passed explicitly. Test code
  // that cares about identity passes its own SessionUser here and gets it
  // back on ctx.
  const stubUser: SessionUser = opts?.user ?? {
    id: "00000000-0000-0000-0000-000000000000",
    tenantId: "00000000-0000-0000-0000-000000000000" as SessionUser["tenantId"], // @cast-boundary engine-bridge
    roles: ["all"],
  };
  return {
    user: stubUser,
    query: notAvailable("query") as HandlerContext["query"], // @cast-boundary engine-bridge
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
    unsafeAppendEvent: notAvailable("unsafeAppendEvent") as unknown as (
      args: AppendEventArgs,
    ) => Promise<void>,
    tryAppendEvent: notAvailable("tryAppendEvent") as unknown as HandlerContext["tryAppendEvent"],
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
    // Stub defaults to always-enabled — matches the dispatcher's behaviour
    // when no effectiveFeatures resolver is wired (tests without toggles).
    hasFeature: async () => true,
    metrics: createNoopMetricsHandle(),
    metricsFor: () => createNoopMetricsHandle(),
    tracer: noopTracer,
    // Real TzContext, not notAvailable — test code uses ctx.tz routinely,
    // it isn't a "bridge" concept. Defaults to UTC.
    tz: createTzContext(),
    // Same reasoning as tz above — ctx.locale is always-present, not a
    // bridge method. Defaults to DEFAULT_LOCALE.
    locale: DEFAULT_LOCALE,
  };
}
