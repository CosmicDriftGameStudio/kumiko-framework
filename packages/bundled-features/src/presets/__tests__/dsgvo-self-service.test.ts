import { describe, expect, test } from "bun:test";
import { dsgvoSelfServiceFeatures } from "../dsgvo-self-service";

// Pins the DSGVO/self-service bundle: the five features in dependency order
// (user-data-rights requires data-retention + compliance-profiles + sessions;
// user-profile requires user-data-rights). Order is load-bearing, so it is
// asserted explicitly.

describe("dsgvoSelfServiceFeatures", () => {
  test("returns the five features in require-order", () => {
    const names = dsgvoSelfServiceFeatures().map((f) => f.name);
    expect(names).toEqual([
      "data-retention",
      "compliance-profiles",
      "sessions",
      "user-data-rights",
      "user-profile",
    ]);
  });

  test("data-retention/compliance-profiles precede user-data-rights (dependency order holds)", () => {
    const names = dsgvoSelfServiceFeatures().map((f) => f.name);
    const udr = names.indexOf("user-data-rights");
    expect(names.indexOf("data-retention")).toBeLessThan(udr);
    expect(names.indexOf("compliance-profiles")).toBeLessThan(udr);
    expect(names.indexOf("sessions")).toBeLessThan(udr);
    expect(names.indexOf("user-profile")).toBeGreaterThan(udr);
  });

  test("each call yields fresh feature instances (no shared mutable state)", () => {
    const a = dsgvoSelfServiceFeatures();
    const b = dsgvoSelfServiceFeatures();
    expect(a[0]).not.toBe(b[0]);
  });
});
