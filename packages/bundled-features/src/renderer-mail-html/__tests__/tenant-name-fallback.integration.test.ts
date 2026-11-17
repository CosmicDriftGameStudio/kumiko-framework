// Without managed-pages mounted there is no branding title config key, so the
// document context fell back to an empty tenantName.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTenantFeature,
  TenantHandlers,
  tenantEntity,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import type { ConfigAccessor, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createLogger, setProcessLogger } from "@cosmicdrift/kumiko-framework/logging";
import { TENANT_TIMEZONE_CONFIG_KEY } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { readDocumentFormat, readTenantName } from "../document-kit";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("readTenantName without managed-pages", () => {
  test("falls back to the tenant record's name", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TenantHandlers.create,
      { key: "muster-ag", name: "Muster AG" },
      TestUsers.systemAdmin,
    );
    const name = await readTenantName({
      db: stack.db,
      registry: stack.registry,
      tenantId: created.id as TenantId,
    });
    expect(name).toBe("Muster AG");
  });

  test("an unknown tenant yields an empty name", async () => {
    const name = await readTenantName({
      db: stack.db,
      registry: stack.registry,
      tenantId: "00000000-0000-4000-8000-0000000000ff" as TenantId,
    });
    expect(name).toBe("");
  });
});

describe("readDocumentFormat tenant time zone", () => {
  const formatWith = async (zone: string) =>
    readDocumentFormat(
      {
        db: stack.db,
        registry: stack.registry,
        tenantId: "00000000-0000-4000-8000-0000000000ff" as TenantId,
        config: (async (key: string) =>
          key === TENANT_TIMEZONE_CONFIG_KEY ? zone : undefined) as ConfigAccessor,
      },
      "de",
    );

  test("takes the tenant's configured IANA zone", async () => {
    expect((await formatWith("Europe/Berlin")).timeZone).toBe("Europe/Berlin");
  });

  afterEach(() => setProcessLogger(null));

  test("ignores an invalid zone instead of failing the render", async () => {
    const logLines: Record<string, unknown>[] = [];
    setProcessLogger(
      createLogger({
        destination: {
          write(chunk: string) {
            logLines.push(JSON.parse(chunk));
          },
        },
      }),
    );
    expect((await formatWith("Mars/Olympus")).timeZone).toBeUndefined();
    expect(JSON.stringify(logLines)).toContain("Mars/Olympus");
  });
});
