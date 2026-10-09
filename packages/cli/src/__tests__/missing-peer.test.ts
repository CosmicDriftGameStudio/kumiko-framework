import { describe, expect, test } from "bun:test";
import { missingPeerMessage } from "../missing-peer";

describe("missingPeerMessage", () => {
  test("names the framework package when the resolver cannot find it", () => {
    const error = new Error("Cannot find package '@cosmicdrift/kumiko-framework' from '/app/x.ts'");
    expect(missingPeerMessage(error)).toContain(
      "Install @cosmicdrift/kumiko-framework in your app",
    );
  });

  test("names bundled-features for a missing subpath import", () => {
    const error = new Error(
      "Cannot find module '@cosmicdrift/kumiko-bundled-features/agent-tools' from '/app/x.ts'",
    );
    expect(missingPeerMessage(error)).toContain("@cosmicdrift/kumiko-bundled-features");
  });

  test("ignores unrelated errors", () => {
    expect(missingPeerMessage(new Error("Cannot find package 'left-pad'"))).toBeUndefined();
    expect(missingPeerMessage("boom")).toBeUndefined();
  });
});
