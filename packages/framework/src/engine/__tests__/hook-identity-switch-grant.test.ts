import { describe, expect, mock, test } from "bun:test";
import { AccessDeniedError } from "../../errors";
import { createGatedIdentitySwitch, type QueryAsFn } from "../../pipeline/system-identity-switch";
import { createEntity, createRegistry, createSystemUser, defineFeature } from "../index";
import type { AppContext, PostSaveHookFn, SaveContext } from "../types";
import type { TenantId } from "../types/identifiers";

// fw#2859: r.hook({ allOf }, ...) must get the same identity-switch gate as the handler-keyed path.

const TENANT = "00000000-0000-4000-8000-00000000cd01" as TenantId;
const systemUser = createSystemUser(TENANT);

const dummySaveContext: SaveContext = {
  kind: "save",
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
    const handlerCtx = createGatedIdentitySwitch(
      'handler "test:write:thing:create"',
      true,
      ungated,
    );

    let caught: unknown;
    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      const hookFn: PostSaveHookFn = async (_result, ctx) => {
        const asContext = ctx as unknown as { queryAs: QueryAsFn };
        try {
          await asContext.queryAs(systemUser, "whoami", {});
        } catch (err) {
          caught = err;
        }
      };
      r.hook("postSave", { allOf: thing }, hookFn);
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
    const handlerCtx = createGatedIdentitySwitch(
      'handler "test:write:thing:create"',
      false,
      ungated,
    );

    let queryAsResult: unknown;
    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      const hookFn: PostSaveHookFn = async (_result, ctx) => {
        const asContext = ctx as unknown as { queryAs: QueryAsFn };
        queryAsResult = await asContext.queryAs(systemUser, "whoami", {});
      };
      r.hook("postSave", { allOf: thing }, hookFn, {
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
        const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
        r.hook("postSave", { allOf: thing }, async () => undefined, {
          escapeHatch: { reason: "" },
        });
      });
    }).toThrow(/non-empty string/);
  });
});
