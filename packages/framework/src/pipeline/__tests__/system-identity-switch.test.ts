import { describe, expect, mock, test } from "bun:test";
import { createSystemUser, SYSTEM_ROLE, SYSTEM_USER_ID } from "../../engine";
import type { SessionUser } from "../../engine/types";
import type { TenantId } from "../../engine/types/identifiers";
import { AccessDeniedError, FrameworkReasons } from "../../errors";
import {
  createGatedIdentitySwitch,
  type IdentitySwitch,
  isSystemIdentity,
  isSystemIdentitySwitchAllowed,
  type WriteAsFn,
  withHookIdentitySwitchGrant,
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

describe("isSystemIdentitySwitchAllowed", () => {
  test("SYSTEM target requires allowSystemIdentity=true", () => {
    expect(isSystemIdentitySwitchAllowed(systemUserById, false)).toBe(false);
    expect(isSystemIdentitySwitchAllowed(systemUserById, true)).toBe(true);
  });

  test("a non-SYSTEM target is always allowed", () => {
    expect(isSystemIdentitySwitchAllowed(normalUser, false)).toBe(true);
    expect(isSystemIdentitySwitchAllowed(normalUser, true)).toBe(true);
  });
});

describe("createGatedIdentitySwitch", () => {
  test("queryAs to SYSTEM throws AccessDeniedError with the reason code, no asUser/tenantId/payload leak", async () => {
    const { ungated } = makeUngated();
    const gated = createGatedIdentitySwitch('handler "x"', false, ungated);

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
    const gated = createGatedIdentitySwitch('handler "x"', false, ungated);

    await expect(gated.writeAs(systemUserById, "some:target", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  test("allowSystemIdentity=true lets a SYSTEM switch pass through to the ungated pair", async () => {
    const { ungated, queryAsMock, writeAsMock } = makeUngated();
    const gated = createGatedIdentitySwitch('handler "x"', true, ungated);

    await gated.queryAs(systemUserById, "q", { a: 1 });
    await gated.writeAs(systemUserById, "w", { b: 2 });

    expect(queryAsMock).toHaveBeenCalledWith(systemUserById, "q", { a: 1 });
    expect(writeAsMock).toHaveBeenCalledWith(systemUserById, "w", { b: 2 });
  });

  test("a non-system asUser always passes through, regardless of allowSystemIdentity", async () => {
    const { ungated, queryAsMock } = makeUngated();
    const deniedByDefault = createGatedIdentitySwitch('handler "x"', false, ungated);

    await deniedByDefault.queryAs(normalUser, "q", {});

    expect(queryAsMock).toHaveBeenCalledWith(normalUser, "q", {});
  });
});

describe("withHookIdentitySwitchGrant", () => {
  test("hook without escapeHatch does NOT inherit the handler's SYSTEM grant", async () => {
    const { ungated } = makeUngated();
    // Simulates dispatch-shared.ts's buildHandlerContext for a handler that
    // itself declared escapeHatch / is systemScope (allowSystemIdentity=true).
    const handlerCtx = { ...createGatedIdentitySwitch('handler "outer"', true, ungated) };

    const hookCtx = withHookIdentitySwitchGrant(
      handlerCtx,
      'postSave hook of feature "f"',
      undefined,
    );

    await expect(hookCtx.queryAs(systemUserById, "q", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  test("hook WITH escapeHatch is allowed even when the handler's own grant was false", async () => {
    const { ungated, queryAsMock } = makeUngated();
    // Handler itself has NO escapeHatch (allowSystemIdentity=false).
    const handlerCtx = { ...createGatedIdentitySwitch('handler "outer"', false, ungated) };

    const hookCtx = withHookIdentitySwitchGrant(handlerCtx, 'postSave hook of feature "f"', {
      reason: "test hook needs SYSTEM",
    });

    await hookCtx.queryAs(systemUserById, "q", { a: 1 });
    // Reaches the REAL ungated fn — not the handler's own (still-denying) gate.
    expect(queryAsMock).toHaveBeenCalledWith(systemUserById, "q", { a: 1 });
  });

  test("a non-system asUser is always allowed through the hook's own gate", async () => {
    const { ungated, queryAsMock } = makeUngated();
    const handlerCtx = { ...createGatedIdentitySwitch('handler "outer"', false, ungated) };
    const hookCtx = withHookIdentitySwitchGrant(handlerCtx, "hook", undefined);

    await hookCtx.queryAs(normalUser, "q", {});
    expect(queryAsMock).toHaveBeenCalledWith(normalUser, "q", {});
  });

  test("spreading the context ({...ctx}) still resolves back to the ungated pair", async () => {
    const { ungated, queryAsMock } = makeUngated();
    const handlerCtx = { ...createGatedIdentitySwitch('handler "outer"', true, ungated), extra: 1 };
    const spread = { ...handlerCtx };

    const hookCtx = withHookIdentitySwitchGrant(spread, "hook", { reason: "needs system" });
    await hookCtx.queryAs(systemUserById, "q", {});

    expect(queryAsMock).toHaveBeenCalledWith(systemUserById, "q", {});
  });

  test("a context without queryAs/writeAs is returned unchanged", () => {
    const plainContext = { db: {} };
    const result = withHookIdentitySwitchGrant(plainContext, "hook", { reason: "x" });
    expect(result).toBe(plainContext);
  });

  test("a deny-stubbed writeAs is not revived through a sibling queryAs's registered ungated pair", async () => {
    // Mirrors a member-resolution HandlerContext: queryAs is still the real
    // gated fn (registered in ungatedByGated), writeAs was independently
    // replaced by a deny stub never registered in that map. The per-function
    // resolution must not let queryAs's registration leak a working writeAs.
    const { ungated, writeAsMock } = makeUngated();
    const gatedIdentitySwitch = createGatedIdentitySwitch('handler "outer"', true, ungated);
    const denyStubWriteAs: WriteAsFn = async () => {
      throw new AccessDeniedError({
        message: "read-only",
        details: { reason: "member_resolution_read_only" },
      });
    };
    const handlerCtx = { queryAs: gatedIdentitySwitch.queryAs, writeAs: denyStubWriteAs };

    const hookCtx = withHookIdentitySwitchGrant(handlerCtx, "hook", {
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

    const hookCtx = withHookIdentitySwitchGrant(stubContext, "hook", undefined);
    await expect(hookCtx.queryAs(systemUserById, "q", {})).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(stubQueryAs).not.toHaveBeenCalled();

    const allowedHookCtx = withHookIdentitySwitchGrant(stubContext, "hook", { reason: "x" });
    await allowedHookCtx.queryAs(systemUserById, "q", {});
    expect(stubQueryAs).toHaveBeenCalledWith(systemUserById, "q", {});
  });
});
