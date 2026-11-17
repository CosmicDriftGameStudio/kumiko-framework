import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signToken } from "../../shared/index.ts";
import { signDeletionToken } from "../deletion-token.ts";

const SECRET = "deletion-token-compat-secret";
const USER_ID = "user-7";
const REQUEST_ID = "req-99";
const NOW = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);

// Deletion tokens sit in mails that are already out. Pins the wire format
// `<subject>:<anchor>.<expiresAtMs>.<hmac>` under the purpose
// `row-bound-grant:deletion-request`, so a silent format change fails here.
describe("deletion token wire format", () => {
  test("minting produces exactly the row-bound-grant bytes", () => {
    const minted = signDeletionToken(USER_ID, REQUEST_ID, 30, SECRET, NOW);
    const expected = signToken(
      `${USER_ID}:${REQUEST_ID}`,
      "row-bound-grant:deletion-request",
      30,
      SECRET,
      NOW,
    );

    expect(minted.token).toBe(expected.token);
    expect(minted.expiresAt.epochMilliseconds).toBe(NOW.epochMilliseconds + 30 * 60_000);
  });

  test("token layout is <subject>:<anchor>.<expiresAtMs>.<hmac>", () => {
    const { token } = signDeletionToken(USER_ID, REQUEST_ID, 30, SECRET, NOW);
    const [body, expiresAtMs, signature, ...rest] = token.split(".");

    expect(rest).toHaveLength(0);
    expect(body).toBe(`${USER_ID}:${REQUEST_ID}`);
    expect(expiresAtMs).toBe(String(NOW.epochMilliseconds + 30 * 60_000));
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
