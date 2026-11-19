import { describe, expect, test } from "bun:test";
import { isPrincipalBlocked, isPrincipalBlockedForNewAuth } from "../principal-status.ts";
import { USER_STATUS } from "../schema/user.ts";

describe("isPrincipalBlockedForNewAuth", () => {
  test("refuses restricted, deletion-requested and deleted accounts a new session", () => {
    for (const status of [
      USER_STATUS.Restricted,
      USER_STATUS.DeletionRequested,
      USER_STATUS.Deleted,
    ]) {
      expect(isPrincipalBlockedForNewAuth(status)).toBe(true);
    }
  });

  test("lets an active account and a missing or unknown status through", () => {
    for (const status of [USER_STATUS.Active, null, undefined, "something-else", 42]) {
      expect(isPrincipalBlockedForNewAuth(status)).toBe(false);
    }
  });

  test("a deletion-requested account keeps its live session but gets no new one", () => {
    expect(isPrincipalBlocked(USER_STATUS.DeletionRequested)).toBe(false);
    expect(isPrincipalBlockedForNewAuth(USER_STATUS.DeletionRequested)).toBe(true);
  });
});
