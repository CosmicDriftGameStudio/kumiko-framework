import { describe, expect, test } from "bun:test";
import { PADDLE_WEBHOOK_TOLERANCE_SECONDS, verifyPaddleSignature } from "../verify-webhook.ts";
import {
  envelope,
  NOW_SECONDS,
  paddleSignatureHeader,
  signPaddleBody,
  subscriptionData,
  TEST_WEBHOOK_SECRET,
} from "./paddle-test-kit.ts";

const BODY = envelope("subscription.created", subscriptionData());
const TIMESTAMP = String(NOW_SECONDS);

function headersFor(body = BODY, timestamp = TIMESTAMP) {
  return { "paddle-signature": paddleSignatureHeader({ timestamp, body }) };
}

function verify(headers: Record<string, string>, body = BODY, secret = TEST_WEBHOOK_SECRET) {
  verifyPaddleSignature(body, headers, secret, NOW_SECONDS);
}

describe("verifyPaddleSignature", () => {
  test("accepts a valid signature", () => {
    expect(() => verify(headersFor())).not.toThrow();
  });

  test("rejects a signature made with another secret", () => {
    const other = signPaddleBody({ timestamp: TIMESTAMP, body: BODY, secret: "another-secret" });
    expect(() => verify({ "paddle-signature": `ts=${TIMESTAMP};h1=${other}` })).toThrow(
      /signature verify failed/,
    );
  });

  test("rejects a tampered body", () => {
    expect(() => verify(headersFor(), `${BODY} `)).toThrow(/signature verify failed/);
  });

  test("rejects an h1 of the wrong length or alphabet without throwing from timingSafeEqual", () => {
    for (const h1 of ["abcd", "zz".repeat(32), ""]) {
      expect(() => verify({ "paddle-signature": `ts=${TIMESTAMP};h1=${h1}` })).toThrow();
    }
  });

  test("accepts when one of several h1 entries is valid", () => {
    const valid = signPaddleBody({ timestamp: TIMESTAMP, body: BODY });
    const junk = "0".repeat(64);
    expect(() =>
      verify({ "paddle-signature": `ts=${TIMESTAMP};h1=${junk};h1=${valid}` }),
    ).not.toThrow();
  });

  test("rejects a timestamp older and newer than the tolerance, accepts the boundary", () => {
    const at = (timestamp: number) => verify(headersFor(BODY, String(timestamp)));
    expect(() => at(NOW_SECONDS - PADDLE_WEBHOOK_TOLERANCE_SECONDS - 1)).toThrow(/tolerance/);
    expect(() => at(NOW_SECONDS + PADDLE_WEBHOOK_TOLERANCE_SECONDS + 1)).toThrow(/tolerance/);
    expect(() => at(NOW_SECONDS - PADDLE_WEBHOOK_TOLERANCE_SECONDS)).not.toThrow();
    expect(() => at(NOW_SECONDS + PADDLE_WEBHOOK_TOLERANCE_SECONDS)).not.toThrow();
  });

  test("rejects a non-numeric timestamp", () => {
    expect(() => verify(headersFor(BODY, "17700.5"))).toThrow(/Unix timestamp/);
    expect(() => verify(headersFor(BODY, "soon"))).toThrow(/Unix timestamp/);
  });

  test("rejects a missing or malformed header", () => {
    expect(() => verify({})).toThrow(/header missing/);
    expect(() => verify({ "paddle-signature": "garbage" })).toThrow(/malformed/);
    expect(() => verify({ "paddle-signature": `ts=${TIMESTAMP}` })).toThrow(/malformed/);
  });
});
