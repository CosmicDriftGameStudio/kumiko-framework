// feature.ts contract tests for mail-transport-inmemory.

import { describe, expect, test } from "bun:test";
import { isMailTransportPlugin, type MailTransportPlugin } from "../../mail-foundation";
import { describeMailTransportContract } from "../../mail-foundation/__tests__/mail-transport-contract";
import { clearInbox, getInbox, mailTransportInMemoryFeature } from "../feature";

function registeredPlugin(): MailTransportPlugin {
  const usage = mailTransportInMemoryFeature.extensionUsages.find(
    (u) => u.extensionName === "mailTransport" && u.entityName === "inmemory",
  );
  if (!usage || !isMailTransportPlugin(usage.options)) {
    throw new Error("mail-transport-inmemory: plugin not registered under 'inmemory'");
  }
  return usage.options;
}

describeMailTransportContract("mail-transport-inmemory", () => ({
  plugin: registeredPlugin(),
  ctx: {},
  tenantId: "contract-test-tenant",
  readBack: getInbox,
}));

describe("mailTransportInMemoryFeature — shape", () => {
  test("has the expected name", () => {
    expect(mailTransportInMemoryFeature.name).toBe("mail-transport-inmemory");
  });

  test("requires only mail-foundation (no config, no secrets — nothing to configure)", () => {
    expect(mailTransportInMemoryFeature.requires).toContain("mail-foundation");
    expect(mailTransportInMemoryFeature.requires).not.toContain("config");
    expect(mailTransportInMemoryFeature.requires).not.toContain("secrets");
  });
});

describe("mailTransportInMemoryFeature — plugin-registration", () => {
  test("registers itself under entityName 'inmemory' for mail-foundation's extension", () => {
    const usages = mailTransportInMemoryFeature.extensionUsages;
    expect(
      usages.some((u) => u.extensionName === "mailTransport" && u.entityName === "inmemory"),
    ).toBe(true);
  });
});

describe("getInbox / clearInbox — per-tenant buffer helpers", () => {
  test("getInbox liefert empty-array für unbekannten Tenant", () => {
    expect(getInbox("never-touched-tenant")).toEqual([]);
  });

  test("clearInbox auf nicht-existierenden Tenant ist no-op (kein throw)", () => {
    // Defensive — wenn ein Demo-Test clearInbox vor dem ersten send aufruft,
    // soll das nicht crashen.
    expect(() => clearInbox("not-yet-existing")).not.toThrow();
  });
});
