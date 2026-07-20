import { describe, expect, test } from "bun:test";
import {
  CSRF_COOKIE_NAME as DISPATCHER_CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME as DISPATCHER_CSRF_HEADER_NAME,
} from "@cosmicdrift/kumiko-dispatcher-live";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../auth-middleware";

// dispatcher-live keeps its own literal copies of these two constants
// (see packages/dispatcher-live/src/csrf.ts) because it must stay
// server-dep-free for browser/React Native bundles. This test is the
// guardrail that catches drift in CI instead of at runtime.
describe("CSRF constant sync between framework and dispatcher-live", () => {
  test("cookie name matches", () => {
    expect(DISPATCHER_CSRF_COOKIE_NAME).toBe(CSRF_COOKIE_NAME);
  });

  test("header name matches", () => {
    expect(DISPATCHER_CSRF_HEADER_NAME).toBe(CSRF_HEADER_NAME);
  });
});
