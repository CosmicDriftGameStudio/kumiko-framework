import { describe, expect, it } from "bun:test";
import { shouldWireProdSessions } from "../session-wiring";

describe("shouldWireProdSessions — secure-by-default (#1372)", () => {
  it("wires when auth + sessionStore provider mounted", () => {
    expect(shouldWireProdSessions(true, true)).toBe(true);
  });

  it("does not wire without auth", () => {
    expect(shouldWireProdSessions(false, true)).toBe(false);
  });

  it("does not wire without sessionStore provider", () => {
    expect(shouldWireProdSessions(true, false)).toBe(false);
  });
});
