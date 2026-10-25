// feature.ts contract tests for mail-transport-inmemory.

import { describe, expect, test } from "bun:test";
import { describeMailTransportContract } from "../../mail-foundation/__tests__/mail-transport-contract.ts";
import { isMailTransportPlugin, type MailTransportPlugin } from "../../mail-foundation/index.ts";
import { clearInbox, createMailTransportInMemoryFeature, getInbox } from "../feature.ts";

function registeredPlugin(): MailTransportPlugin {
  const usage = createMailTransportInMemoryFeature().extensionUsages.find(
    (u) => u.extensionName === "mailTransport" && u.entityName === "inmemory",
  );
  if (!usage || !isMailTransportPlugin(usage.options)) {
    throw new Error("mail-transport-inmemory: plugin not registered under 'inmemory'");
  }
  return usage.options;
}

describeMailTransportContract(
  "mail-transport-inmemory",
  () => ({
    plugin: registeredPlugin(),
    ctx: { secrets: undefined },
    tenantId: "contract-test-tenant",
    readBack: getInbox,
  }),
  { verifiesDelivery: true },
);

describe("mailTransportInMemoryFeature — shape", () => {
  test("has the expected name", () => {
    expect(createMailTransportInMemoryFeature().name).toBe("mail-transport-inmemory");
  });

  test("requires only mail-foundation (no config, no secrets — nothing to configure)", () => {
    expect(createMailTransportInMemoryFeature().requires).toContain("mail-foundation");
    expect(createMailTransportInMemoryFeature().requires).not.toContain("config");
    expect(createMailTransportInMemoryFeature().requires).not.toContain("secrets");
  });
});

describe("mailTransportInMemoryFeature — plugin-registration", () => {
  test("registers itself under entityName 'inmemory' for mail-foundation's extension", () => {
    const usages = createMailTransportInMemoryFeature().extensionUsages;
    expect(
      usages.some((u) => u.extensionName === "mailTransport" && u.entityName === "inmemory"),
    ).toBe(true);
  });
});

describe("getInbox / clearInbox — per-tenant buffer helpers", () => {
  test("getInbox returns an empty array for an unknown tenant", () => {
    expect(getInbox("never-touched-tenant")).toEqual([]);
  });

  test("clearInbox on a nonexistent tenant is a no-op (does not throw)", () => {
    // Defensive: a demo test may call clearInbox before the first send,
    // so the call must not throw.
    expect(() => clearInbox("not-yet-existing")).not.toThrow();
  });
});
