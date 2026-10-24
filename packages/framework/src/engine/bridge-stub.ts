import { DEFAULT_LOCALE } from "../i18n/request-locale.ts";
import { createFallbackFullLogger } from "../logging/utils.ts";
import { createNoopMetricsHandle, getFallbackTracer } from "../observability/index.ts";
import { createTzContext } from "../time/index.ts";
import { createAnonymousUser } from "./system-user.ts";
import type {
  ContextServices,
  HandlerContext,
  HandlerDispatch,
  HandlerObservability,
  SessionUser,
} from "./types/index.ts";

// Test/service helper: cross-feature bridge methods that throw on use.
//
// Production code always receives a full HandlerContext from the Dispatcher's
// buildHandlerContext (with real query/write closures). Some internal services
// and tests construct a mini-context manually (typically just `{ db, registry }`)
// to invoke a single handler. Those call sites don't use ctx.dispatch.query/write —
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

// Noop observability — hand back the shared fallback tracer so ctx.obs.tracer has
// a valid Tracer shape. No allocations per call.
const noopTracer = getFallbackTracer();

export function bridgeStub(opts?: {
  readonly user?: SessionUser;
  readonly log?: HandlerObservability["log"];
  // Replaces single stubbed bridge calls, so a test can wire e.g. `write` to a real dispatcher.
  readonly dispatch?: Partial<HandlerDispatch>;
  // Spread order matters at the call site: bridgeStub's own `services` would overwrite one set beside it.
  readonly services?: Partial<ContextServices>;
}): Pick<
  HandlerContext,
  | "dispatch"
  | "events"
  | "auth"
  | "obs"
  | "hasFeature"
  | "tz"
  | "locale"
  | "user"
  | "services"
  | "lifecycle"
  | "tenants"
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
    dispatch: {
      query: notAvailable("dispatch.query"),
      queryAs: notAvailable("dispatch.queryAs"),
      write: notAvailable("dispatch.write"),
      writeAs: notAvailable("dispatch.writeAs"),
      queryAsMember: notAvailable("dispatch.queryAsMember"),
      queryProjection: notAvailable("dispatch.queryProjection"),
      ...opts?.dispatch,
    },
    events: {
      append: notAvailable("events.append"),
      unsafeAppend: notAvailable("events.unsafeAppend"),
      tryAppend: notAvailable("events.tryAppend"),
      fetchForWriting: notAvailable("events.fetchForWriting"),
      load: notAvailable("events.load"),
      archive: notAvailable("events.archive"),
      restore: notAvailable("events.restore"),
      isArchived: notAvailable("events.isArchived"),
      snapshot: notAvailable("events.snapshot"),
      loadWithSnapshot: notAvailable("events.loadWithSnapshot"),
    },
    auth: {
      resolveClaims: notAvailable("auth.resolveClaims"),
      resolveActiveMembership: notAvailable("auth.resolveActiveMembership"),
    },
    // Stub defaults to always-enabled — matches the dispatcher's behaviour
    // when no effectiveFeatures resolver is wired (tests without toggles).
    hasFeature: async () => true,
    obs: {
      log: opts?.log ?? createFallbackFullLogger("bridge-stub"),
      tracer: noopTracer,
      metrics: createNoopMetricsHandle(),
      metricsFor: () => createNoopMetricsHandle(),
    },
    // Real TzContext, not notAvailable — test code uses ctx.tz routinely,
    // it isn't a "bridge" concept. Defaults to UTC.
    tz: createTzContext(),
    // Same reasoning as tz above — ctx.locale is always-present, not a
    // bridge method. Defaults to DEFAULT_LOCALE.
    locale: DEFAULT_LOCALE,
    services: { extensions: {}, ...opts?.services },
    lifecycle: {},
    tenants: {},
  };
}
