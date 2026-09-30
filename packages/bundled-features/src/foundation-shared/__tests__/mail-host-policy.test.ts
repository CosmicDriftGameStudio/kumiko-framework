import { describe, expect, test } from "bun:test";
import type { lookup } from "node:dns/promises";
import {
  BlockedHostError,
  HostResolutionError,
  resolveMailConnectTarget,
} from "../mail-host-policy.js";

describe("resolveMailConnectTarget", () => {
  test("pins a public hostname to its resolved address and sets servername to the original host", async () => {
    const fakeLookup = (async () => [
      { address: "203.0.113.5", family: 4 },
    ]) as unknown as typeof lookup;

    await expect(
      resolveMailConnectTarget("smtp.tenant.example", { lookupFn: fakeLookup }),
    ).resolves.toEqual({ host: "203.0.113.5", servername: "smtp.tenant.example" });
  });

  test("connects a public IP-literal host directly, without a servername", async () => {
    await expect(resolveMailConnectTarget("93.184.216.34")).resolves.toEqual({
      host: "93.184.216.34",
    });
  });

  test("rejects a private IP-literal host", async () => {
    await expect(resolveMailConnectTarget("10.0.0.5")).rejects.toThrow(BlockedHostError);
  });

  test("rejects a hostname that resolves to a private address", async () => {
    const fakeLookup = (async () => [
      { address: "127.0.0.1", family: 4 },
    ]) as unknown as typeof lookup;

    await expect(
      resolveMailConnectTarget("internal.example", { lookupFn: fakeLookup }),
    ).rejects.toThrow(BlockedHostError);
  });

  test("surfaces a DNS failure distinctly from a blocked host", async () => {
    const failingLookup = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof lookup;

    await expect(
      resolveMailConnectTarget("nowhere.example", { lookupFn: failingLookup }),
    ).rejects.toThrow(HostResolutionError);
  });

  test("allowlisted private host bypasses resolution entirely, case-insensitively", async () => {
    const lookupFn = (() => {
      throw new Error("must not be called for an allowlisted host");
    }) as unknown as typeof lookup;

    await expect(
      resolveMailConnectTarget("Mailpit.internal", {
        allowedPrivateMailHosts: ["mailpit.internal"],
        lookupFn,
      }),
    ).resolves.toEqual({ host: "Mailpit.internal" });
  });

  test("a host absent from the allowlist still goes through resolution", async () => {
    await expect(
      resolveMailConnectTarget("10.0.0.5", { allowedPrivateMailHosts: ["mailpit.internal"] }),
    ).rejects.toThrow(BlockedHostError);
  });
});
