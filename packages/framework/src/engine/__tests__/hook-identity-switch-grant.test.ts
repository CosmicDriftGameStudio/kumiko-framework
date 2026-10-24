import { describe, expect, mock, test } from "bun:test";
import { createTestStoredEvent } from "@cosmicdrift/kumiko-testing/helpers";
import { AccessDeniedError, FrameworkReasons } from "../../errors/index.ts";
import {
  createGatedIdentitySwitch,
  type QueryAsFn,
  type ResolveActiveMembershipFn,
  systemIdentitySwitchDenied,
} from "../../pipeline/system-identity-switch.ts";
import { createEntity, createRegistry, createSystemUser, defineFeature } from "../index.ts";
import type { TenantId } from "../types/identifiers.ts";
import type {
  ActiveMembershipResult,
  AppContext,
  PostSaveHookFn,
  SaveContext,
} from "../types/index.ts";

// r.hook({ allOf }, ...) must get the same identity-switch gate as the handler-keyed path.

const TENANT = "00000000-0000-4000-8000-00000000cd01" as TenantId;
const systemUser = createSystemUser(TENANT);

const dummySaveContext: SaveContext = {
  kind: "save",
  event: createTestStoredEvent(),
  id: "thing-1" as SaveContext["id"],
  data: {},
  changes: {},
  previous: {},
  isNew: true,
};

describe("r.hook({ allOf }, ...) identity-switch gate", () => {
  test("entity-wide hook WITHOUT escapeHatch does not inherit the handler's SYSTEM grant", async () => {
    const ungatedQueryAs = mock(async () => "ok");
    const ungated = {
      queryAs: ungatedQueryAs as QueryAsFn,
      writeAs: async () => ({ isSuccess: true as const, data: null }),
    };
    // Simulates a handler whose OWN grant is allow=true (e.g. it declared
    // escapeHatch or is systemScope) — the hook must not inherit this.
    const handlerCtx = {
      dispatch: createGatedIdentitySwitch(
        'handler "test:write:thing:create"',
        undefined,
        true,
        ungated,
      ),
    };

    let caught: unknown;
    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      const hookFn: PostSaveHookFn = async (_result, ctx) => {
        const asContext = ctx as unknown as { dispatch: { queryAs: QueryAsFn } };
        try {
          await asContext.dispatch.queryAs(systemUser, "whoami", {});
        } catch (err) {
          caught = err;
        }
      };
      r.hook({ type: "postSave", target: { allOf: thing }, handler: hookFn });
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostSaveHooks("thing");
    expect(hooks).toHaveLength(1);

    await hooks[0]?.(dummySaveContext, handlerCtx as unknown as AppContext);

    expect(caught).toBeInstanceOf(AccessDeniedError);
    expect(ungatedQueryAs).not.toHaveBeenCalled();
  });

  test("entity-wide hook WITH escapeHatch reaches SYSTEM even when the handler's own grant was false", async () => {
    const ungatedQueryAs = mock(async () => "ok");
    const ungated = {
      queryAs: ungatedQueryAs as QueryAsFn,
      writeAs: async () => ({ isSuccess: true as const, data: null }),
    };
    const handlerCtx = {
      dispatch: createGatedIdentitySwitch(
        'handler "test:write:thing:create"',
        undefined,
        false,
        ungated,
      ),
    };

    let queryAsResult: unknown;
    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      const hookFn: PostSaveHookFn = async (_result, ctx) => {
        const asContext = ctx as unknown as { dispatch: { queryAs: QueryAsFn } };
        queryAsResult = await asContext.dispatch.queryAs(systemUser, "whoami", {});
      };
      r.hook({
        type: "postSave",
        target: { allOf: thing },
        handler: hookFn,
        escapeHatch: { reason: "test: allOf hook needs SYSTEM" },
      });
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostSaveHooks("thing");
    expect(hooks).toHaveLength(1);

    await hooks[0]?.(dummySaveContext, handlerCtx as unknown as AppContext);

    expect(queryAsResult).toBe("ok");
    expect(ungatedQueryAs).toHaveBeenCalledWith(systemUser, "whoami", {});
  });

  test("registering an { allOf } hook with an empty escapeHatch reason throws at registration", () => {
    expect(() => {
      defineFeature("test", (r) => {
        const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
        r.hook({
          type: "postSave",
          target: { allOf: thing },
          handler: async () => undefined,
          escapeHatch: { reason: "" },
        });
      });
    }).toThrow(/non-empty/);
  });

  test("entity-wide hook WITHOUT escapeHatch does not inherit the handler's resolveActiveMembership grant", async () => {
    const activeResult: ActiveMembershipResult = {
      kind: "active",
      membership: { tenantId: TENANT, roles: [] },
    };
    const ungatedResolveActiveMembership = mock(async () => activeResult);
    const handlerCtx = {
      dispatch: createGatedIdentitySwitch('handler "test:write:thing:create"', undefined, true, {
        queryAs: mock(async () => "ok") as QueryAsFn,
        writeAs: async () => ({ isSuccess: true as const, data: null }),
      }),
      auth: {
        resolveActiveMembership: ungatedResolveActiveMembership as ResolveActiveMembershipFn,
      },
    };

    let caught: unknown;
    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      const hookFn: PostSaveHookFn = async (_result, ctx) => {
        const asContext = ctx as unknown as {
          auth: { resolveActiveMembership: ResolveActiveMembershipFn };
        };
        try {
          await asContext.auth.resolveActiveMembership("user-1", TENANT);
        } catch (err) {
          caught = err;
        }
      };
      r.hook({ type: "postSave", target: { allOf: thing }, handler: hookFn });
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostSaveHooks("thing");
    expect(hooks).toHaveLength(1);

    await hooks[0]?.(dummySaveContext, handlerCtx as unknown as AppContext);

    expect(caught).toBeInstanceOf(AccessDeniedError);
    expect((caught as AccessDeniedError).details).toEqual({
      reason: FrameworkReasons.systemIdentitySwitchDenied,
    });
    expect(ungatedResolveActiveMembership).not.toHaveBeenCalled();
  });

  test("entity-wide hook WITH escapeHatch does not re-grant resolveActiveMembership the handler was denied (deny-only)", async () => {
    const handlerLabel = 'handler "test:write:thing:create"';
    const handlerCtx = {
      dispatch: createGatedIdentitySwitch(handlerLabel, undefined, false, {
        queryAs: mock(async () => "ok") as QueryAsFn,
        writeAs: async () => ({ isSuccess: true as const, data: null }),
      }),
      auth: {
        resolveActiveMembership: (async () => {
          throw systemIdentitySwitchDenied(handlerLabel);
        }) as ResolveActiveMembershipFn,
      },
    };

    let caught: unknown;
    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      const hookFn: PostSaveHookFn = async (_result, ctx) => {
        const asContext = ctx as unknown as {
          auth: { resolveActiveMembership: ResolveActiveMembershipFn };
        };
        try {
          await asContext.auth.resolveActiveMembership("user-1", TENANT);
        } catch (err) {
          caught = err;
        }
      };
      r.hook({
        type: "postSave",
        target: { allOf: thing },
        handler: hookFn,
        escapeHatch: { reason: "test: allOf hook needs SYSTEM" },
      });
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostSaveHooks("thing");
    expect(hooks).toHaveLength(1);

    await hooks[0]?.(dummySaveContext, handlerCtx as unknown as AppContext);

    expect(caught).toBeInstanceOf(AccessDeniedError);
    expect((caught as AccessDeniedError).details).toEqual({
      reason: FrameworkReasons.systemIdentitySwitchDenied,
    });
  });
});
