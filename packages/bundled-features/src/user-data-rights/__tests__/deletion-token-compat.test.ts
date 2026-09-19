import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { signToken } from "../../shared";
import { redeemDeletionToken, signDeletionToken } from "../deletion-token";

const SECRET = "deletion-token-compat-secret";
const USER_ID = "user-7";
const REQUEST_ID = "req-99";
const NOW = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);

// Deletion tokens sit in mails that are already out. Moving the minting onto
// shared/row-bound-grant must not change a single byte of them, so this pins
// the wire format against the formula the hand-rolled version used:
// signToken(userId, `deletion-request:${requestId}`, ...).
describe("deletion token wire format", () => {
  test("a token minted with the pre-refactor formula still redeems", async () => {
    const legacy = signToken(USER_ID, `deletion-request:${REQUEST_ID}`, 30, SECRET).token;

    const result = await redeemDeletionToken({
      token: legacy,
      secret: SECRET,
      loadPendingRequestId: async () => REQUEST_ID,
      commitDeletion: async () => true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.subject).toBe(USER_ID);
  });

  test("minting produces exactly the pre-refactor bytes", () => {
    const minted = signDeletionToken(USER_ID, REQUEST_ID, 30, SECRET, NOW);
    const legacy = signToken(USER_ID, `deletion-request:${REQUEST_ID}`, 30, SECRET, NOW);

    expect(minted.token).toBe(legacy.token);
  });
});
