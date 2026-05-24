import { describe, expect, test } from "bun:test";
import { assertUnreachable } from "../assert";

describe("assertUnreachable", () => {
  test("throws with the kind label and the offending value in the message", () => {
    // Runtime path: the compile-time never-check is verified by tsc itself —
    // this test just exercises the throw for a case where the union was
    // extended without updating callers.
    expect(() => {
      // Simulating a future enum-extension where a call site forgot to handle
      // the new member. The `as never` matches what a wrong-shape value would
      // look like at runtime after escaping the compiler.
      const rogue = "surprise" as unknown as never;
      assertUnreachable(rogue, "status");
    }).toThrow(/unhandled status: surprise/);
  });
});
