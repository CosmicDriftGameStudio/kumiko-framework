import { describe, expect, test } from "bun:test";
import * as apiBarrel from "../index.ts";

describe("/api barrel request-context surface", () => {
  test("does not export run or runAsAgentToolCallEntry", () => {
    expect("runAsAgentToolCallEntry" in apiBarrel).toBe(false);
    expect("run" in apiBarrel).toBe(false);
  });

  test("requestContext exposes read access only", () => {
    expect(typeof apiBarrel.requestContext.get).toBe("function");
    expect("run" in apiBarrel.requestContext).toBe(false);
  });
});
