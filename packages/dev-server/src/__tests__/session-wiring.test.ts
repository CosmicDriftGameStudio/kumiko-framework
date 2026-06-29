import { describe, expect, it } from "bun:test";
import { resolveProdSessionsConfig, shouldWireProdSessions } from "../session-wiring";

describe("shouldWireProdSessions — secure-by-default with opt-out (KF-1)", () => {
  it("wires sessions when the feature is mounted, even without an explicit config", () => {
    // The publicstatus bug: sessions feature mounted + auth set, but no auth.sessions —
    // previously left stateless (no revocation). Now it wires automatically.
    expect(shouldWireProdSessions(true, true, undefined)).toBe(true);
  });

  it("wires sessions when a config object is given", () => {
    expect(shouldWireProdSessions(true, true, { expiresInMs: 1000 })).toBe(true);
  });

  it("does not wire when sessions: false (explicit opt-out)", () => {
    expect(shouldWireProdSessions(true, true, false)).toBe(false);
  });

  it("does not wire when the sessions feature is not mounted", () => {
    expect(shouldWireProdSessions(true, false, undefined)).toBe(false);
  });

  it("does not wire when the app has no auth at all", () => {
    expect(shouldWireProdSessions(false, true, undefined)).toBe(false);
  });
});

describe("resolveProdSessionsConfig", () => {
  it("passes a config object through", () => {
    expect(resolveProdSessionsConfig({ expiresInMs: 5000 })).toEqual({ expiresInMs: 5000 });
  });

  it("collapses false / undefined to defaults", () => {
    expect(resolveProdSessionsConfig(undefined)).toEqual({});
    expect(resolveProdSessionsConfig(false)).toEqual({});
  });
});
