import { describe, expect, test } from "bun:test";
import * as apiBarrel from "../index.js";

describe("/api barrel request-context surface", () => {
  test("does not export run or runAsDirectCallEntry", () => {
    expect("runAsDirectCallEntry" in apiBarrel).toBe(false);
    expect("run" in apiBarrel).toBe(false);
  });

  test("requestContext exposes read access only", () => {
    expect(typeof apiBarrel.requestContext.get).toBe("function");
    expect("run" in apiBarrel.requestContext).toBe(false);
  });
});
