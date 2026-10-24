import { bridgeStub } from "../bridge-stub.ts";
import { createRegistry } from "../registry.ts";
import { createSystemUser } from "../system-user.ts";
import { SYSTEM_TENANT_ID, type TenantId } from "../types/identifiers.ts";
import type { HandlerContext, HandlerDb, SessionUser } from "../types/index.ts";

// Hook and pipeline unit tests exercise ordering and context plumbing, never the database.
// @cast-boundary test stub — no hook under test reaches ctx.db
const unusedDb = {} as HandlerDb;

type StubOptions = {
  readonly tenantId?: TenantId;
  readonly user?: SessionUser;
  readonly effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
};

// A complete HandlerContext whose bridges throw on use (bridgeStub), for tests that call hooks directly.
export function stubHandlerContext(options: StubOptions = {}): HandlerContext {
  const user = options.user ?? createSystemUser(options.tenantId ?? SYSTEM_TENANT_ID);
  return {
    ...bridgeStub({ user }),
    db: unusedDb,
    registry: createRegistry([]),
    services: {
      ...(options.effectiveFeatures && { effectiveFeatures: options.effectiveFeatures }),
      extensions: {},
    },
  };
}

type StubParts = {
  readonly dispatch?: Partial<HandlerContext["dispatch"]>;
  readonly auth?: Partial<HandlerContext["auth"]>;
};

// Overlays the bridges a test wires by hand (gated identity switch, membership resolver) on the stub.
export function stubHandlerContextWith(
  parts: StubParts,
  options: StubOptions = {},
): HandlerContext {
  const base = stubHandlerContext(options);
  return {
    ...base,
    dispatch: { ...base.dispatch, ...parts.dispatch },
    auth: { ...base.auth, ...parts.auth },
  };
}
