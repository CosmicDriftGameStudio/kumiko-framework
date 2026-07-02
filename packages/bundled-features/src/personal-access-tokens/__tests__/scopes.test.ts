import { describe, expect, it } from "bun:test";
import { expandScopes, type PatScopeConfig, parseGrant } from "../scopes";

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
