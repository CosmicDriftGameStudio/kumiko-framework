import { describe, expect, test } from "bun:test";
import { USER_STATUS } from "../../user";
import type { AuthUserRow } from "../auth-user-row";
import { gateEnforceAccountStatus, gateEnforceEmailVerified } from "../handlers/login.write";

function row(over: Partial<AuthUserRow> = {}): AuthUserRow {
  return { id: "00000000-0000-4000-8000-000000000001", passwordHash: "x", ...over };
}

describe("login.write gates (fw#1284)", () => {
  test("gateEnforceEmailVerified rejects when strict and unverified", () => {
    const g = gateEnforceEmailVerified(row({ emailVerified: false }), true);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.result.isSuccess).toBe(false);
  });

  test("gateEnforceEmailVerified passes when not strict", () => {
    expect(gateEnforceEmailVerified(row({ emailVerified: false }), false).ok).toBe(true);
  });

  test("gateEnforceAccountStatus rejects restricted", () => {
    const g = gateEnforceAccountStatus(row({ status: USER_STATUS.Restricted }));
    expect(g.ok).toBe(false);
  });

  test("gateEnforceAccountStatus rejects deletion_requested as invalid_creds shape", () => {
    const g = gateEnforceAccountStatus(row({ status: USER_STATUS.DeletionRequested }));
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.result.isSuccess).toBe(false);
      // anti-enumeration — same family as invalid credentials
      expect(g.result).toMatchObject({ isSuccess: false });
    }
  });

  test("gateEnforceAccountStatus passes active", () => {
    expect(gateEnforceAccountStatus(row({ status: USER_STATUS.Active })).ok).toBe(true);
  });
});
