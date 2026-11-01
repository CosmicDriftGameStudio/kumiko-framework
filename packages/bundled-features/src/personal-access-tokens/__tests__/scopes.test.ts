import { describe, expect, it } from "bun:test";
import { expandScopeEvents, expandScopes, type PatScopeConfig, parseGrant } from "../web/scopes.ts";

const CONFIG: PatScopeConfig = {
  credit: { label: "Kredite", read: ["credit:query:*"], write: ["credit:write:*"] },
  miete: { label: "Mieten", read: ["ledger:query:*"] }, // read-only domain
};

describe("parseGrant", () => {
  it("splits domain:level on the last colon", () => {
    expect(parseGrant("credit:write")).toEqual({ domain: "credit", level: "write" });
  });
  it("rejects a bare token", () => {
    expect(parseGrant("credit")).toBeNull();
  });
});

describe("expandScopeEvents", () => {
  const WITH_EVENTS: PatScopeConfig = {
    credit: { label: "Kredite", read: [], write: [], events: ["credit.created", "credit:paid"] },
    miete: { label: "Mieten", read: [], events: ["credit:paid", "rent.created"] },
  };

  it("read level already releases the domain events", () => {
    expect(expandScopeEvents(WITH_EVENTS, ["credit:read"])).toEqual([
      "credit.created",
      "credit:paid",
    ]);
  });

  it("unions several domains without duplicates", () => {
    expect(expandScopeEvents(WITH_EVENTS, ["credit:write", "miete:read"])).toEqual([
      "credit.created",
      "credit:paid",
      "rent.created",
    ]);
  });

  it("ignores unknown domains and domains without events", () => {
    expect(expandScopeEvents(CONFIG, ["credit:read", "gone:read"])).toEqual([]);
  });
});

describe("expandScopes", () => {
  it("read grants only the read QNs", () => {
    expect(expandScopes(CONFIG, ["credit:read"])).toEqual(["credit:query:*"]);
  });

  it("write grants read + write QNs", () => {
    expect(expandScopes(CONFIG, ["credit:write"]).sort()).toEqual(
      ["credit:query:*", "credit:write:*"].sort(),
    );
  });

  it("read-only domain ignores a write grant's missing write set", () => {
    expect(expandScopes(CONFIG, ["miete:write"])).toEqual(["ledger:query:*"]);
  });

  it("unknown domain contributes nothing (fail-closed)", () => {
    expect(expandScopes(CONFIG, ["ghost:write"])).toEqual([]);
  });

  it("unions across multiple grants without duplicates", () => {
    expect(expandScopes(CONFIG, ["credit:read", "miete:read"]).sort()).toEqual(
      ["credit:query:*", "ledger:query:*"].sort(),
    );
  });
});
