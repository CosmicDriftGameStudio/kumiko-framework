// r.bootCheck does not run inside setupTestStack, only validateBoot() does.

import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import {
  createInboundMailFoundationFeature,
  MY_MAIL_ACCOUNT_LIST_SCREEN_QN,
  resolveInboundMailRoles,
} from "../../inbound-mail-foundation/index.ts";
import { createSecretsFeature } from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { ImapHandlers } from "../constants.ts";
import { createInboundProviderImapFeature } from "../feature.ts";
import { createImapConnectScreen, createMyImapConnectScreen } from "../screens.ts";

const roleConfig = { userRoles: ["PropertyManager"], adminRoles: ["Admin"] } as const;

function boot(
  foundation: Parameters<typeof createInboundMailFoundationFeature>[0],
  imap: Parameters<typeof createInboundProviderImapFeature>[0],
) {
  return () =>
    validateBoot([
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(foundation),
      createInboundProviderImapFeature(imap),
    ]);
}

describe("inbound-provider-imap role options", () => {
  test("the same options on both features boot", () => {
    expect(boot(roleConfig, roleConfig)).not.toThrow();
    expect(boot({}, {})).not.toThrow();
  });

  test("the order inside a role list does not matter", () => {
    expect(
      boot(
        { userRoles: ["A", "B"], adminRoles: ["Admin"] },
        { userRoles: ["B", "A"], adminRoles: ["Admin"] },
      ),
    ).not.toThrow();
  });

  test("deviating roles are a boot error that names both features", () => {
    expect(boot(roleConfig, {})).toThrow(
      /inbound-provider-imap: role options differ from inbound-mail-foundation/,
    );
    expect(boot({}, roleConfig)).toThrow(/role options differ/);
    expect(boot(roleConfig, { userRoles: ["PropertyManager"] })).toThrow(/adminRoles/);
  });
});

describe("inbound-provider-imap connect screens", () => {
  const roles = resolveInboundMailRoles(roleConfig);

  test("the personal connect form is open to all members and has no sender-check field", () => {
    const screen = createMyImapConnectScreen(roles);
    expect(screen.access).toEqual({ roles: [...roles.memberRoles] });
    expect(screen.handler).toBe(ImapHandlers.connectMyMailbox);
    expect(Object.keys(screen.fields)).not.toContain("trustedAuthservId");
    expect(screen.redirect).toBe(MY_MAIL_ACCOUNT_LIST_SCREEN_QN);
  });

  test("the shared connect form stays with the admins and keeps the sender-check field", () => {
    const screen = createImapConnectScreen(roles);
    expect(screen.access).toEqual({ roles: [...roles.adminRoles] });
    expect(screen.handler).toBe(ImapHandlers.connectMailbox);
    expect(Object.keys(screen.fields)).toContain("trustedAuthservId");
  });
});
