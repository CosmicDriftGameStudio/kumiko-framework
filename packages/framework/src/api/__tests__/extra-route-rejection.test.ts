// Constructor invariants for ExtraRouteRejection's `retryAfterSeconds` option
// (kumiko-framework#3168): it only makes sense together with 503 and must
// render as a valid Retry-After delta-seconds header.

import { describe, expect, test } from "bun:test";
import { ExtraRouteRejection } from "../extra-route";

describe("ExtraRouteRejection retryAfterSeconds invariants", () => {
  test("retryAfterSeconds with a non-503 status throws RangeError", () => {
    expect(
      () => new ExtraRouteRejection(404, { error: "x" }, undefined, { retryAfterSeconds: 30 }),
    ).toThrow(RangeError);
  });

  test("negative retryAfterSeconds throws RangeError", () => {
    expect(
      () => new ExtraRouteRejection(503, { error: "x" }, undefined, { retryAfterSeconds: -1 }),
    ).toThrow(RangeError);
  });

  test("non-integer retryAfterSeconds throws RangeError", () => {
    expect(
      () => new ExtraRouteRejection(503, { error: "x" }, undefined, { retryAfterSeconds: 1.5 }),
    ).toThrow(RangeError);
  });

  test("retryAfterSeconds: 0 with status 503 is accepted", () => {
    const rejection = new ExtraRouteRejection(503, { error: "x" }, undefined, {
      retryAfterSeconds: 0,
    });
    expect(rejection.retryAfterSeconds).toBe(0);
  });

  test("no options leaves retryAfterSeconds undefined", () => {
    const rejection = new ExtraRouteRejection(503, { error: "x" });
    expect(rejection.retryAfterSeconds).toBeUndefined();
  });
});
