// The system user (SystemAdmin only) dispatches a fixed set of handlers; apps that name their own
// roles without SystemAdmin must not lock it out, and a new system dispatch must join the list.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { createRegistry, hasAccess } from "@cosmicdrift/kumiko-framework/engine";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { ImapHandlers } from "../../inbound-provider-imap/constants.ts";
import { createInboundProviderImapFeature } from "../../inbound-provider-imap/feature.ts";
import { createSecretsFeature } from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { InboundMailFoundationHandlers } from "../constants.ts";
import { createInboundMailFoundationFeature } from "../feature.ts";
import { SYSTEM_DISPATCHED_MAIL_HANDLERS } from "../mail-roles.ts";

const APP_ROLES = { userRoles: ["PropertyManager"], adminRoles: ["Admin"] } as const;

describe("system-dispatched mail handlers", () => {
  test("accept a system user although the app roles leave SystemAdmin out", () => {
    const registry = createRegistry([
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(APP_ROLES),
      createInboundProviderImapFeature(APP_ROLES),
    ]);
    const systemUser = { roles: [ROLES.SystemAdmin] };

    for (const handlerQn of SYSTEM_DISPATCHED_MAIL_HANDLERS) {
      const handler = registry.getWriteHandler(handlerQn);
      expect(handler, handlerQn).toBeDefined();
      expect(hasAccess(systemUser, handler?.access), handlerQn).toBe(true);
    }
  });
});

const FEATURE_DIRS = [
  join(import.meta.dir, ".."),
  join(import.meta.dir, "../../inbound-provider-imap"),
];
const HANDLER_QN_OF_NAME: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  InboundMailFoundationHandlers,
  ImapHandlers,
};
const DISPATCH_CALL = /\bdispatch(?:System)?Write\(\{/g;
const DISPATCHED_QN = /handlerQn:\s*(\w+)\.(\w+)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(dir, entry.name));
}

function codeWithoutComments(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

describe("system dispatch call sites", () => {
  test("every dispatchWrite/dispatchSystemWrite call targets a listed handler", () => {
    const dispatches: string[] = [];
    for (const file of FEATURE_DIRS.flatMap(sourceFiles)) {
      const code = codeWithoutComments(file);
      const calls = code.match(DISPATCH_CALL)?.length ?? 0;
      const targets = [...code.matchAll(DISPATCHED_QN)];
      // A call whose handler is not written as `Handlers.name` cannot be checked here.
      expect(targets.length, file).toBe(calls);
      for (const [, holder, name] of targets) {
        const qn = HANDLER_QN_OF_NAME[holder ?? ""]?.[name ?? ""];
        expect(qn, `${file}: ${holder}.${name}`).toBeDefined();
        dispatches.push(qn as string);
      }
    }
    expect(dispatches.length).toBeGreaterThan(0);
    for (const qn of dispatches) expect(SYSTEM_DISPATCHED_MAIL_HANDLERS).toContain(qn);
  });
});
