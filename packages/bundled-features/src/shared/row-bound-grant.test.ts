import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { redeemRowBoundGrant, signRowBoundGrant } from "./row-bound-grant";

const SECRET = "test-secret-value";
const PURPOSE = "waitlist-enrich";
const SUBJECT = "row-42";
const NOW = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);

function grantFor(anchor: string, ttlMinutes = 30): string {
  return signRowBoundGrant({
    subject: SUBJECT,
    purpose: PURPOSE,
    anchor,
    ttlMinutes,
    secret: SECRET,
    now: NOW,
  }).token;
}

function anchorIs(anchor: string | null): (subject: string) => Promise<string | null> {
  return async () => anchor;
}

const SKIP_COMMIT = { unsafeSkip: { reason: "test covers verification only" } } as const;

// Stands in for a conditional UPDATE ... WHERE anchor = expected: the first
// caller to spend the live anchor wins, everyone after it gets false.
function spendableAnchor(initial: string) {
  let current: string | null = initial;
  return {
    load: async () => current,
    commit: async (_subject: string, expected: string) => {
      if (current !== expected) return false;
      current = null;
      return true;
    },
  };
}

describe("redeemRowBoundGrant", () => {
  test("accepts a grant whose row still carries the anchor it was minted for", async () => {
    const result = await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.subject).toBe(SUBJECT);
  });

  test("passes the token's subject to loadAnchor so the row is looked up by it", async () => {
    const seen: string[] = [];

    await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: async (subject) => {
        seen.push(subject);
        return "pending";
      },
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(seen).toEqual([SUBJECT]);
  });

  test("rejects a replayed grant once the row moved on to another anchor", async () => {
    const token = grantFor("pending");

    const first = await redeemRowBoundGrant({
      token,
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });
    const replayed = await redeemRowBoundGrant({
      token,
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("enriched"),
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(first.ok).toBe(true);
    expect(replayed.ok).toBe(false);
  });

  test("rejects when the row has no anchor at all", async () => {
    const result = await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs(null),
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  test("rejects instead of surfacing a throwing row lookup", async () => {
    const result = await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: async () => {
        throw new Error("invalid input syntax for type uuid");
      },
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  test("rejects an expired grant", async () => {
    const result = await redeemRowBoundGrant({
      token: grantFor("pending", 30),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: SKIP_COMMIT,
      now: NOW.add({ minutes: 31 }),
    });

    expect(result.ok).toBe(false);
  });

  test("rejects a grant redeemed against a different purpose", async () => {
    const result = await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: "waitlist-delete",
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  test("rejects a tampered signature", async () => {
    const [subject, expiresAt] = grantFor("pending").split(".");

    const result = await redeemRowBoundGrant({
      token: `${subject}.${expiresAt}.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY`,
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  test("rejects a grant minted with a different secret", async () => {
    const foreign = signRowBoundGrant({
      subject: SUBJECT,
      purpose: PURPOSE,
      anchor: "pending",
      ttlMinutes: 30,
      secret: "someone-elses-secret",
      now: NOW,
    }).token;

    const result = await redeemRowBoundGrant({
      token: foreign,
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  test("rejects without touching the row when no secret is configured", async () => {
    let looked = false;

    const result = await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: undefined,
      loadAnchor: async () => {
        looked = true;
        return "pending";
      },
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(looked).toBe(false);
  });

  test("rejects a malformed token without touching the row", async () => {
    let looked = false;

    const result = await redeemRowBoundGrant({
      token: "not-a-token",
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: async () => {
        looked = true;
        return "pending";
      },
      commitAnchor: SKIP_COMMIT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(looked).toBe(false);
  });

  test("only one of two simultaneous redemptions of the same grant wins", async () => {
    const row = spendableAnchor("pending");
    const token = grantFor("pending");
    const redeem = () =>
      redeemRowBoundGrant({
        token,
        purpose: PURPOSE,
        secret: SECRET,
        loadAnchor: row.load,
        commitAnchor: row.commit,
        now: NOW,
      });

    const [first, second] = await Promise.all([redeem(), redeem()]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  });

  test("does not spend the anchor for a token that fails verification", async () => {
    const row = spendableAnchor("pending");

    const rejected = await redeemRowBoundGrant({
      token: grantFor("some-other-anchor"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: row.load,
      commitAnchor: row.commit,
      now: NOW,
    });
    const legitimate = await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: row.load,
      commitAnchor: row.commit,
      now: NOW,
    });

    expect(rejected.ok).toBe(false);
    expect(legitimate.ok).toBe(true);
  });

  test("refuses an unsafeSkip without a reason", async () => {
    const redeem = redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: { unsafeSkip: { reason: "  " } },
      now: NOW,
    });

    expect(redeem).rejects.toThrow(/non-empty reason/);
  });

  test("rejects when the anchor can no longer be spent", async () => {
    const result = await redeemRowBoundGrant({
      token: grantFor("pending"),
      purpose: PURPOSE,
      secret: SECRET,
      loadAnchor: anchorIs("pending"),
      commitAnchor: async () => false,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });
});
