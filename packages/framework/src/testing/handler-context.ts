// @runtime runtime
//
// bridgeStub liefert eine HandlerContext-Shape mit throw-on-use Bridge-Methods
// (ctx.query/write/loadAggregate/...). Wird von Test-Code UND Production-
// Services genutzt (delivery-service nutzt es um cross-feature notify-Calls
// ohne echten Dispatcher zu fahren). Daher runtime-Klassifizierung trotz
// Wohnsitz unter `testing/` — keine vitest-Imports, keine Test-Side-Effects.
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
  | "tracer"
  | "tz"
  | "user"
> {
  // ctx.user ist Convenience-Alias zu event.user (siehe HandlerContext-
  // Doku). Caller-Code erwartet das Feld; bridgeStub liefert es als
  // Stub mit den Anonymous-Default-Werten wenn kein User explizit
  // übergeben wird. Test-Code mit Identity-Bezug übergibt seinen
  // SessionUser hier und bekommt ihn am ctx zurück.
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
    tracer: noopTracer,
    // Echter TzContext, kein notAvailable — Test-Code nutzt ctx.tz häufig
    // ohne dass es ein "Bridge"-Konzept ist. Default UTC.
    tz: createTzContext(),
  };
}
