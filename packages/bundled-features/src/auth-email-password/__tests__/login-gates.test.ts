import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { USER_STATUS } from "../../user";
import type { AuthUserRow } from "../auth-user-row";
import { accountRestricted, emailNotVerified, invalidCredentials } from "../errors";
import {
  gateBuildSession,
  gateEnforceAccountStatus,
  gateEnforceEmailVerified,
} from "../handlers/login.write";

// resolveAuthClaims is the only ctx member gateBuildSession touches.
const authClaimsCtx = {
  resolveAuthClaims: async () => ({}),
} as unknown as HandlerContext;

function row(over: Partial<AuthUserRow> = {}): AuthUserRow {
  return { id: "00000000-0000-4000-8000-000000000001", passwordHash: "x", ...over };
}

describe("login.write gates (fw#1284)", () => {
  test("gateEnforceEmailVerified rejects when strict and unverified", () => {
    const g = gateEnforceEmailVerified(row({ emailVerified: false }), true);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.result).toEqual(emailNotVerified());
  });

  test("gateEnforceEmailVerified passes when not strict", () => {
    expect(gateEnforceEmailVerified(row({ emailVerified: false }), false).ok).toBe(true);
  });

  test("gateEnforceAccountStatus rejects restricted", () => {
    const g = gateEnforceAccountStatus(row({ status: USER_STATUS.Restricted }));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.result).toEqual(accountRestricted());
  });

  test("gateEnforceAccountStatus rejects deletion_requested as invalid_creds shape", () => {
    const g = gateEnforceAccountStatus(row({ status: USER_STATUS.DeletionRequested }));
    expect(g.ok).toBe(false);
    // anti-enumeration — same payload as invalid credentials, not a
    // distinguishable "account deleted" error.
    if (!g.ok) expect(g.result).toEqual(invalidCredentials());
  });

  test("gateEnforceAccountStatus rejects deleted as invalid_creds shape", () => {
    const g = gateEnforceAccountStatus(row({ status: USER_STATUS.Deleted }));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.result).toEqual(invalidCredentials());
  });

  test("gateEnforceAccountStatus passes active", () => {
    expect(gateEnforceAccountStatus(row({ status: USER_STATUS.Active })).ok).toBe(true);
  });

  test("gateBuildSession carries the user's timezone into the session", async () => {
    const g = await gateBuildSession(
      authClaimsCtx,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      ["User"],
      "Asia/Tokyo",
    );
    expect(g.session.timezone).toBe("Asia/Tokyo");
  });

  test("gateBuildSession omits timezone when the user never set one (fw#1636)", async () => {
    const g = await gateBuildSession(
      authClaimsCtx,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      ["User"],
      null,
    );
    expect(g.session.timezone).toBeUndefined();
  });
});
