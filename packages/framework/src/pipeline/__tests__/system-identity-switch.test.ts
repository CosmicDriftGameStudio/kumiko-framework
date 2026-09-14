import { describe, expect, mock, test } from "bun:test";
import type { DbRunner } from "../../db/connection";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createSystemUser, SYSTEM_ROLE, SYSTEM_USER_ID } from "../../engine";
import type { SessionUser } from "../../engine/types";
import type { TenantId } from "../../engine/types/identifiers";
import { AccessDeniedError, FrameworkReasons } from "../../errors";
import {
  createGatedIdentitySwitch,
  type IdentitySwitch,
  isIdentitySwitchAllowed,
  isSystemIdentity,
  type WriteAsFn,
  withHookEscapeHatchGrant,
} from "../system-identity-switch";

const TENANT = "00000000-0000-4000-8000-00000000ab01" as TenantId;

const normalUser: SessionUser = { id: crypto.randomUUID(), tenantId: TENANT, roles: ["User"] };
const systemUserById: SessionUser = { id: SYSTEM_USER_ID, tenantId: TENANT, roles: ["User"] };
const systemUserByRole: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: TENANT,
  roles: [SYSTEM_ROLE],
};

function makeUngated(): {
  readonly ungated: IdentitySwitch;
  readonly queryAsMock: ReturnType<typeof mock>;
  readonly writeAsMock: ReturnType<typeof mock>;
} {
  const queryAsMock = mock(async (_user: SessionUser, _qn: string, _payload: unknown) => ({
    ok: true,
  }));
  const writeAsMock = mock(async (_user: SessionUser, _qn: string, _payload: unknown) => ({
    isSuccess: true as const,
    data: { ok: true },
  }));
  return {
    ungated: { queryAs: queryAsMock, writeAs: writeAsMock },
    queryAsMock,
    writeAsMock,
  };
}

describe("isSystemIdentity", () => {
  test("SYSTEM_USER_ID alone counts as SYSTEM", () => {
    expect(isSystemIdentity(systemUserById)).toBe(true);
  });

  test("SYSTEM_ROLE alone counts as SYSTEM", () => {
    expect(isSystemIdentity(systemUserByRole)).toBe(true);
  });

  test("a normal user is not SYSTEM", () => {
    expect(isSystemIdentity(normalUser)).toBe(false);
  });

  test("createSystemUser(...) is SYSTEM", () => {
    expect(isSystemIdentity(createSystemUser(TENANT))).toBe(true);
  });
});

const OTHER_TENANT = "00000000-0000-4000-8000-00000000ab02" as TenantId;
const multiRoleCaller: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: TENANT,
  roles: ["User", "Editor"],
  claims: { "teams:teamId": "team-1" },
  sid: "session-1",
};

describe("isIdentitySwitchAllowed", () => {
  test("SYSTEM target requires a grant, even when the caller is SYSTEM itself", () => {
    expect(isIdentitySwitchAllowed(normalUser, systemUserById, false)).toBe(false);
    expect(isIdentitySwitchAllowed(systemUserById, systemUserById, false)).toBe(false);
    expect(isIdentitySwitchAllowed(normalUser, systemUserByRole, true)).toBe(true);
  });

  test("switching to the caller itself is free", () => {
    expect(isIdentitySwitchAllowed(multiRoleCaller, multiRoleCaller, false)).toBe(true);
    expect(isIdentitySwitchAllowed(multiRoleCaller, { ...multiRoleCaller }, false)).toBe(true);
  });

  test("a subset of the caller's roles is free; sid/locale may differ", () => {
    const narrowed: SessionUser = {
      ...multiRoleCaller,
      roles: ["User"],
      claims: { "teams:teamId": "team-1" },
      sid: undefined,
      locale: "de",
    };
    expect(isIdentitySwitchAllowed(multiRoleCaller, narrowed, false)).toBe(true);
    expect(isIdentitySwitchAllowed(multiRoleCaller, { ...multiRoleCaller, roles: [] }, false)).toBe(
      true,
    );
  });

  test("an additional role without a grant is denied", () => {
    const escalated: SessionUser = { ...multiRoleCaller, roles: ["User", "TenantAdmin"] };
    expect(isIdentitySwitchAllowed(multiRoleCaller, escalated, false)).toBe(false);
    expect(isIdentitySwitchAllowed(multiRoleCaller, escalated, true)).toBe(true);
  });

  test("the same id in a foreign tenant without a grant is denied, even with a role subset", () => {
    const foreignTenant: SessionUser = { ...multiRoleCaller, tenantId: OTHER_TENANT, roles: [] };
    expect(isIdentitySwitchAllowed(multiRoleCaller, foreignTenant, false)).toBe(false);
    expect(isIdentitySwitchAllowed(multiRoleCaller, foreignTenant, true)).toBe(true);
  });

  test("a foreign id in the same tenant without a grant is denied, even with a role subset", () => {
    const foreignUser: SessionUser = {
      ...multiRoleCaller,
      id: crypto.randomUUID(),
      roles: ["User"],
    };
    expect(isIdentitySwitchAllowed(multiRoleCaller, foreignUser, false)).toBe(false);
    expect(isIdentitySwitchAllowed(multiRoleCaller, foreignUser, true)).toBe(true);
  });

  test("changed claims or origin without a grant are denied", () => {
    const forgedClaim: SessionUser = { ...multiRoleCaller, claims: { "teams:teamId": "team-2" } };
    const droppedClaims: SessionUser = { ...multiRoleCaller, claims: undefined };
    const extraClaim: SessionUser = {
      ...multiRoleCaller,
      claims: { "teams:teamId": "team-1", "billing:plan": "enterprise" },
    };
    const memberCaller: SessionUser = { ...multiRoleCaller, origin: "member-resolution" };
    const { origin: _origin, ...originStripped } = memberCaller;
    expect(isIdentitySwitchAllowed(multiRoleCaller, forgedClaim, false)).toBe(false);
    expect(isIdentitySwitchAllowed(multiRoleCaller, droppedClaims, false)).toBe(false);
    expect(isIdentitySwitchAllowed(multiRoleCaller, extraClaim, false)).toBe(false);
    expect(isIdentitySwitchAllowed(memberCaller, originStripped, false)).toBe(false);
    expect(isIdentitySwitchAllowed(multiRoleCaller, memberCaller, false)).toBe(false);
  });

  test("without a known caller only a grant lets a switch through", () => {
    expect(isIdentitySwitchAllowed(undefined, normalUser, false)).toBe(false);
    expect(isIdentitySwitchAllowed(undefined, normalUser, true)).toBe(true);
  });
});

describe("createGatedIdentitySwitch", () => {
  test("queryAs to SYSTEM throws AccessDeniedError with the reason code, no asUser/tenantId/payload leak", async () => {
    const { ungated } = makeUngated();
    const gated = createGatedIdentitySwitch('handler "x"', normalUser, false, ungated);

    let caught: unknown;
    try {
      await gated.queryAs(systemUserById, "some:target", { secret: "payload-value" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AccessDeniedError);
    const error = caught as AccessDeniedError;
    expect(error.details).toEqual({ reason: FrameworkReasons.systemIdentitySwitchDenied });
    expect(error.message).not.toContain(systemUserById.id);
    expect(error.message).not.toContain(TENANT);
    expect(error.message).not.toContain("payload-value");
  });

  test("writeAs to SYSTEM throws the same way (never falls back to a WriteResult failure)", async () => {
    const { ungated } = makeUngated();
    const gated = createGatedIdentitySwitch('handler "x"', normalUser, false, ungated);

    await expect(gated.writeAs(systemUserById, "some:target", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  test("allowSystemIdentity=true lets a SYSTEM switch pass through to the ungated pair", async () => {
    const { ungated, queryAsMock, writeAsMock } = makeUngated();
    const gated = createGatedIdentitySwitch('handler "x"', normalUser, true, ungated);

    await gated.queryAs(systemUserById, "q", { a: 1 });
    await gated.writeAs(systemUserById, "w", { b: 2 });

    expect(queryAsMock).toHaveBeenCalledWith(systemUserById, "q", { a: 1 });
    expect(writeAsMock).toHaveBeenCalledWith(systemUserById, "w", { b: 2 });
  });

  test("switching to the caller itself passes through without a grant", async () => {
    const { ungated, queryAsMock } = makeUngated();
    const deniedByDefault = createGatedIdentitySwitch('handler "x"', normalUser, false, ungated);

    await deniedByDefault.queryAs(normalUser, "q", {});

    expect(queryAsMock).toHaveBeenCalledWith(normalUser, "q", {});
  });

  test("writeAs to a foreign tenant without a grant throws identity_switch_denied, no id/tenant leak", async () => {
    const { ungated, writeAsMock } = makeUngated();
    const gated = createGatedIdentitySwitch('handler "x"', normalUser, false, ungated);
    const foreignTenantAdmin: SessionUser = {
      id: crypto.randomUUID(),
      tenantId: OTHER_TENANT,
      roles: ["TenantAdmin"],
    };

    let caught: unknown;
    try {
      await gated.writeAs(foreignTenantAdmin, "billing:write:cancel", {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AccessDeniedError);
    const error = caught as AccessDeniedError;
    expect(error.details).toEqual({ reason: FrameworkReasons.identitySwitchDenied });
    expect(error.message).not.toContain(foreignTenantAdmin.id);
    expect(error.message).not.toContain(OTHER_TENANT);
    expect(writeAsMock).not.toHaveBeenCalled();
  });

  test("a grant lets a foreign identity through", async () => {
    const { ungated, writeAsMock } = makeUngated();
    const gated = createGatedIdentitySwitch('handler "x"', normalUser, true, ungated);
    const foreignUser: SessionUser = { id: crypto.randomUUID(), tenantId: OTHER_TENANT, roles: [] };

    await gated.writeAs(foreignUser, "w", {});

    expect(writeAsMock).toHaveBeenCalledWith(foreignUser, "w", {});
  });
});

describe("withHookEscapeHatchGrant", () => {
  test("hook without escapeHatch does NOT inherit the handler's SYSTEM grant", async () => {
    const { ungated } = makeUngated();
    // Simulates dispatch-shared.ts's buildHandlerContext for a handler that
    // itself declared escapeHatch / is systemScope (allowSystemIdentity=true).
    const handlerCtx = {
      ...createGatedIdentitySwitch('handler "outer"', normalUser, true, ungated),
    };

    const hookCtx = withHookEscapeHatchGrant(handlerCtx, 'postSave hook of feature "f"', undefined);

    await expect(hookCtx.queryAs(systemUserById, "q", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  test("hook WITH escapeHatch is allowed even when the handler's own grant was false", async () => {
    const { ungated, queryAsMock } = makeUngated();
    // Handler itself has NO escapeHatch (allowSystemIdentity=false).
    const handlerCtx = {
      ...createGatedIdentitySwitch('handler "outer"', normalUser, false, ungated),
    };

    const hookCtx = withHookEscapeHatchGrant(handlerCtx, 'postSave hook of feature "f"', {
      reason: "test hook needs SYSTEM",
    });

    await hookCtx.queryAs(systemUserById, "q", { a: 1 });
    // Reaches the REAL ungated fn — not the handler's own (still-denying) gate.
    expect(queryAsMock).toHaveBeenCalledWith(systemUserById, "q", { a: 1 });
  });

  test("a hook without escapeHatch may still switch to the handler's own caller", async () => {
    const { ungated, queryAsMock } = makeUngated();
    const handlerCtx = {
      ...createGatedIdentitySwitch('handler "outer"', normalUser, false, ungated),
    };
    const hookCtx = withHookEscapeHatchGrant(handlerCtx, "hook", undefined);

    await hookCtx.queryAs(normalUser, "q", {});
    expect(queryAsMock).toHaveBeenCalledWith(normalUser, "q", {});
  });

  test("a hook without escapeHatch does NOT inherit the handler's grant for a foreign identity", async () => {
    const { ungated, writeAsMock } = makeUngated();
    const handlerCtx = {
      ...createGatedIdentitySwitch('handler "outer"', normalUser, true, ungated),
    };
    const hookCtx = withHookEscapeHatchGrant(handlerCtx, "hook", undefined);
    const foreignUser: SessionUser = { ...normalUser, tenantId: OTHER_TENANT };

    await expect(hookCtx.writeAs(foreignUser, "w", {})).rejects.toBeInstanceOf(AccessDeniedError);
    expect(writeAsMock).not.toHaveBeenCalled();
  });

  test("the hook gate takes the caller from the dispatcher, never from a spoofed ctx.user", async () => {
    const { ungated, writeAsMock } = makeUngated();
    const foreignUser: SessionUser = {
      id: crypto.randomUUID(),
      tenantId: OTHER_TENANT,
      roles: ["Admin"],
    };
    const spoofedCtx = {
      ...createGatedIdentitySwitch('handler "outer"', normalUser, false, ungated),
      user: foreignUser,
    };
    const hookCtx = withHookEscapeHatchGrant(spoofedCtx, "hook", undefined);

    await expect(hookCtx.writeAs(foreignUser, "w", {})).rejects.toBeInstanceOf(AccessDeniedError);
    expect(writeAsMock).not.toHaveBeenCalled();
  });

  test("queryAs and writeAs gated for different callers yield no caller — only a grant passes", async () => {
    const { ungated, queryAsMock } = makeUngated();
    const otherCaller: SessionUser = { ...normalUser, id: crypto.randomUUID() };
    const mixedCtx = {
      queryAs: createGatedIdentitySwitch('handler "a"', normalUser, false, ungated).queryAs,
      writeAs: createGatedIdentitySwitch('handler "b"', otherCaller, false, ungated).writeAs,
    };
    const hookCtx = withHookEscapeHatchGrant(mixedCtx, "hook", undefined);

    await expect(hookCtx.queryAs(normalUser, "q", {})).rejects.toBeInstanceOf(AccessDeniedError);
    expect(queryAsMock).not.toHaveBeenCalled();
  });

  test("spreading the context ({...ctx}) still resolves back to the ungated pair", async () => {
    const { ungated, queryAsMock } = makeUngated();
    const handlerCtx = {
      ...createGatedIdentitySwitch('handler "outer"', normalUser, true, ungated),
      extra: 1,
    };
    const spread = { ...handlerCtx };

    const hookCtx = withHookEscapeHatchGrant(spread, "hook", { reason: "needs system" });
    await hookCtx.queryAs(systemUserById, "q", {});

    expect(queryAsMock).toHaveBeenCalledWith(systemUserById, "q", {});
  });

  test("a context without queryAs/writeAs/db/dbOutsideTransaction is returned unchanged", () => {
    const plainContext = { unrelated: 1 };
    const result = withHookEscapeHatchGrant(plainContext, "hook", { reason: "x" });
    expect(result).toBe(plainContext);
  });

  test("a deny-stubbed writeAs is not revived through a sibling queryAs's registered ungated pair", async () => {
    // Like a member-resolution ctx: registered gated queryAs next to an unregistered deny-stub writeAs.
    const { ungated, writeAsMock } = makeUngated();
    const gatedIdentitySwitch = createGatedIdentitySwitch(
      'handler "outer"',
      normalUser,
      true,
      ungated,
    );
    const denyStubWriteAs: WriteAsFn = async () => {
      throw new AccessDeniedError({
        message: "read-only",
        details: { reason: "member_resolution_read_only" },
      });
    };
    const handlerCtx = { queryAs: gatedIdentitySwitch.queryAs, writeAs: denyStubWriteAs };

    const hookCtx = withHookEscapeHatchGrant(handlerCtx, "hook", {
      reason: "test hook needs SYSTEM",
    });

    await expect(hookCtx.writeAs(systemUserById, "w", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(writeAsMock).not.toHaveBeenCalled();
  });

  test("an ungated context not built by the dispatcher bridge fails closed (unit-test stub)", async () => {
    const stubQueryAs = mock(async (_user: SessionUser, _qn: string, _payload: unknown) => "ok");
    const stubContext = { queryAs: stubQueryAs };

    const hookCtx = withHookEscapeHatchGrant(stubContext, "hook", undefined);
    await expect(hookCtx.queryAs(systemUserById, "q", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(hookCtx.queryAs(normalUser, "q", {})).rejects.toBeInstanceOf(AccessDeniedError);
    const stubWithUser = withHookEscapeHatchGrant(
      { ...stubContext, user: normalUser },
      "hook",
      undefined,
    );
    await expect(stubWithUser.queryAs(normalUser, "q", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(stubQueryAs).not.toHaveBeenCalled();

    const allowedHookCtx = withHookEscapeHatchGrant(stubContext, "hook", { reason: "x" });
    await allowedHookCtx.queryAs(systemUserById, "q", {});
    expect(stubQueryAs).toHaveBeenCalledWith(systemUserById, "q", {});
  });

  test("hook re-gates ctx.db.unsafeRaw() independently of the handler's own grant", () => {
    const rawDb: DbRunner = {
      unsafe: async () => [],
      begin: async () => {
        throw new Error("begin not used in this test");
      },
    } as DbRunner;
    // Simulates buildHandlerContext granting the HANDLER its own unsafeRaw escapeHatch.
    const handlerDb = createTenantDb(rawDb, TENANT, "tenant", undefined, undefined, undefined, {
      unsafeRaw: { reason: "handler's own grant" },
    });
    const handlerCtx = { db: handlerDb };

    const hookCtxWithoutEscapeHatch = withHookEscapeHatchGrant(handlerCtx, "hook", undefined) as {
      db: TenantDb;
    };
    expect(() => hookCtxWithoutEscapeHatch.db.unsafeRaw("test reason")).toThrow(AccessDeniedError);

    const hookCtxWithEscapeHatch = withHookEscapeHatchGrant(handlerCtx, "hook", {
      reason: "hook's own grant",
    }) as { db: TenantDb };
    expect(hookCtxWithEscapeHatch.db.unsafeRaw("test reason")).toBe(rawDb);
  });
});
