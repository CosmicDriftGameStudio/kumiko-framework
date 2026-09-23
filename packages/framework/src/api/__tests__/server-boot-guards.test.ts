// buildServer boot-time guards + httpRoute verb wiring (PUT branch).

import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import {
  createEntity,
  createFileField,
  createRegistry,
  createTextField,
  defineFeature,
  defineQueryHandler,
  EXT_PRINCIPAL_STATUS,
  EXT_TENANT_LIFECYCLE_STATUS,
} from "../../engine";
import { createInMemorySearchAdapter } from "../../search";
import { buildServer } from "../server";

const JWT_SECRET = "server-boot-guards-test-secret-min-32-chars";

// Find the "[kumiko:boot] ... SearchAdapter" line among all console.warn calls
// so the unrelated instanceIdWasRandom warning (fires whenever
// KUMIKO_INSTANCE_ID is unset, as it is in this test run) can't false-fire
// or hide the assertion.
function searchAdapterWarning(calls: unknown[][]): string | undefined {
  const hit = calls.find(
    (args) => typeof args[0] === "string" && args[0].includes("SearchAdapter is wired"),
  );
  return hit ? String(hit[0]) : undefined;
}

describe("buildServer — file-storage provider guard", () => {
  const fileFieldFeature = defineFeature("needs-files", (r) => {
    r.entity(
      "doc",
      createEntity({
        table: "boot_guard_docs",
        fields: {
          title: createTextField({ personal: false, reason: "test_fixture" }),
          attachment: createFileField(),
        },
      }),
    );
  });

  test("throws when registry declares file fields but no provider is mounted", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([fileFieldFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
      }),
    ).toThrow(/no file-storage provider is mounted/);
  });
});

describe("buildServer — rateLimit resolver guard", () => {
  test("throws when L1 global middleware requested without resolver", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([]),
        context: {},
        jwtSecret: JWT_SECRET,
        rateLimit: { global: { limit: 100, windowSeconds: 60 } },
      }),
    ).toThrow(/rateLimit middleware requested but no resolver available/);
  });
});

describe("buildServer — feature httpRoute PUT mounting", () => {
  const putFeature = defineFeature("put-route", (r) => {
    r.httpRoute({
      method: "PUT",
      path: "/resource/42",
      anonymous: true,
      handler: (c) => c.json({ method: "PUT", ok: true }),
    });
  });

  const { app } = buildServer({
    registry: createRegistry([putFeature]),
    context: {},
    jwtSecret: JWT_SECRET,
  });

  test("PUT /resource/42 reaches the declared handler", async () => {
    const res = await app.request("/resource/42", { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "PUT", ok: true });
  });
});

describe("buildServer — search-adapter boot warning (#2051)", () => {
  const searchableFeature = defineFeature("has-search", (r) => {
    r.entity(
      "note",
      createEntity({
        table: "boot_guard_notes",
        fields: {
          title: createTextField({ personal: false, reason: "test_fixture", searchable: true }),
        },
      }),
    );
    r.screen({ id: "note-list", type: "entityList", entity: "note", columns: ["title"] });
  });

  const nonSearchableFeature = defineFeature("no-search", (r) => {
    r.entity(
      "note",
      createEntity({
        table: "boot_guard_plain_notes",
        fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({ id: "note-list", type: "entityList", entity: "note", columns: ["title"] });
  });

  // Pins the `screen.searchable === false` exclusion specifically: without
  // it, this would false-positive purely off the entity having a searchable
  // field, ignoring that the screen (whitelisted per entity-list-screens.ts
  // SEARCHABLE_FALSE_WHITELIST) never renders the search box.
  const explicitlyNonSearchableScreenFeature = defineFeature("opted-out-search", (r) => {
    r.entity(
      "download-attempt",
      createEntity({
        table: "boot_guard_download_attempts",
        fields: {
          title: createTextField({ personal: false, reason: "test_fixture", searchable: true }),
        },
      }),
    );
    r.screen({
      id: "download-attempt-list",
      type: "entityList",
      entity: "download-attempt",
      columns: ["title"],
      searchable: false,
    });
  });

  test("warns naming the entity when a searchable screen has no context.searchAdapter", () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "warn").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      buildServer({
        registry: createRegistry([searchableFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
      });
      const logged = searchAdapterWarning(calls);
      expect(logged).toBeDefined();
      expect(logged).toContain("note");
    } finally {
      spy.mockRestore();
    }
  });

  test("stays silent when context.searchAdapter is wired", () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "warn").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      buildServer({
        registry: createRegistry([searchableFeature]),
        context: { searchAdapter: createInMemorySearchAdapter() },
        jwtSecret: JWT_SECRET,
      });
      expect(searchAdapterWarning(calls)).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  test("stays silent when no screen has a searchable field", () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "warn").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      buildServer({
        registry: createRegistry([nonSearchableFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
      });
      expect(searchAdapterWarning(calls)).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  test("stays silent when the entity has a searchable field but the screen opts out (searchable: false)", () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "warn").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      buildServer({
        registry: createRegistry([explicitlyNonSearchableScreenFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
      });
      expect(searchAdapterWarning(calls)).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("buildServer — auth membershipQuery requires a principalStatus provider", () => {
  const MEMBERSHIP_QN = "tenant:query:memberships";

  // The registry auto-qualifies a SHORT handler name as `<feature>:query:<name>`,
  // so the feature must be named "tenant" for MEMBERSHIP_QN to come out right.
  const membershipQueryFeature = defineFeature("tenant", (r) => {
    r.queryHandler(
      defineQueryHandler({
        name: "memberships",
        schema: z.object({ userId: z.string() }),
        handler: async () => [],
        access: { roles: ["all"] },
      }),
    );
  });

  const principalStatusFeature = defineFeature("has-principal-status", (r) => {
    r.extendsRegistrar(EXT_PRINCIPAL_STATUS, {});
    r.useExtension(EXT_PRINCIPAL_STATUS, "has-principal-status", {
      resolveStatus: async () => "active" as const,
      resolveProfile: async () => ({ globalRoles: [] }),
    });
  });

  test("throws when membershipQuery is registered but no feature provides principalStatus", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([membershipQueryFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
        auth: { membershipQuery: MEMBERSHIP_QN },
      }),
    ).toThrow(/no feature provides the "principalStatus" contract/);
  });

  test("boots when a feature provides principalStatus", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([membershipQueryFeature, principalStatusFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
        auth: { membershipQuery: MEMBERSHIP_QN },
      }),
    ).not.toThrow();
  });

  test("boots when the membershipQuery handler isn't registered at all (e.g. features:[] tests)", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([]),
        context: {},
        jwtSecret: JWT_SECRET,
        auth: { membershipQuery: MEMBERSHIP_QN },
      }),
    ).not.toThrow();
  });
});

describe("buildServer — tenant-lifecycle gate derivation", () => {
  const lifecyclePlugin = { resolveStatus: async () => null };
  const providerFeature = defineFeature("lifecycle-provider", (r) => {
    r.extendsRegistrar(EXT_TENANT_LIFECYCLE_STATUS, {});
    r.useExtension(EXT_TENANT_LIFECYCLE_STATUS, "lifecycle-provider", lifecyclePlugin);
  });
  const secondProviderFeature = defineFeature("lifecycle-provider-2", (r) => {
    r.useExtension(EXT_TENANT_LIFECYCLE_STATUS, "lifecycle-provider-2", lifecyclePlugin);
  });

  test("throws when a lifecycle provider is mounted but context.db is missing", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([providerFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
      }),
    ).toThrow(/tenantLifecycleStatus provider is mounted .* but context\.db is missing/);
  });

  test("throws when two lifecycle providers are registered", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([providerFeature, secondProviderFeature]),
        context: {},
        jwtSecret: JWT_SECRET,
      }),
    ).toThrow(/multiple "tenantLifecycleStatus" providers registered/);
  });

  test("no provider mounted leaves the gate unwired", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([]),
        context: {},
        jwtSecret: JWT_SECRET,
      }),
    ).not.toThrow();
  });
});
