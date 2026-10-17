import { describe, expect, test } from "bun:test";
import { missingPeerMessage } from "../missing-peer";

describe("missingPeerMessage", () => {
  test("names the framework package when the resolver cannot find it", () => {
    const error = new Error("Cannot find package '@cosmicdrift/kumiko-framework' from '/app/x.ts'");
    expect(missingPeerMessage(error)).toContain(
      "Install @cosmicdrift/kumiko-framework in your app",
    );
  });

  test("asks for an upgrade, not an install, when the installed package lacks a subpath", () => {
    const error = new Error(
      "Cannot find module '@cosmicdrift/kumiko-bundled-features/agent-tools' from '/app/x.ts'",
    );
    const message = missingPeerMessage(error);
    expect(message).toContain("Installed @cosmicdrift/kumiko-bundled-features lacks agent-tools");
    expect(message).toContain("Upgrade");
    expect(message).not.toContain("bun add");
  });

  test("ignores unrelated errors", () => {
    expect(missingPeerMessage(new Error("Cannot find package 'left-pad'"))).toBeUndefined();
    expect(missingPeerMessage("boom")).toBeUndefined();
  });
});
