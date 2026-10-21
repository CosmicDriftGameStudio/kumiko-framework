import { DEFAULT_LOCALE } from "../i18n/request-locale.ts";
import { createNoopMetricsHandle, getFallbackTracer } from "../observability/index.ts";
import { createTzContext } from "../time/index.ts";
import { createAnonymousUser } from "./system-user.ts";
import type { HandlerContext, SessionUser } from "./types/index.ts";

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

const notAvailable =
  (what: string) =>
  async (..._args: readonly unknown[]): Promise<never> => {
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
  | "resolveActiveMembership"
  | "queryAsMember"
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
  const stubUser: SessionUser =
    opts?.user ?? createAnonymousUser("00000000-0000-0000-0000-000000000000");
  return {
    user: stubUser,
    query: notAvailable("query"),
    queryAs: notAvailable("queryAs"),
    write: notAvailable("write"),
    writeAs: notAvailable("writeAs"),
    appendEvent: notAvailable("appendEvent"),
    unsafeAppendEvent: notAvailable("unsafeAppendEvent"),
    tryAppendEvent: notAvailable("tryAppendEvent"),
    fetchForWriting: notAvailable("fetchForWriting"),
    loadAggregate: notAvailable("loadAggregate"),
    archiveStream: notAvailable("archiveStream"),
    restoreStream: notAvailable("restoreStream"),
    isStreamArchived: notAvailable("isStreamArchived"),
    snapshotAggregate: notAvailable("snapshotAggregate"),
    loadAggregateWithSnapshot: notAvailable("loadAggregateWithSnapshot"),
    queryProjection: notAvailable("queryProjection"),
    resolveAuthClaims: notAvailable("resolveAuthClaims"),
    resolveActiveMembership: notAvailable("resolveActiveMembership"),
    queryAsMember: notAvailable("queryAsMember"),
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
