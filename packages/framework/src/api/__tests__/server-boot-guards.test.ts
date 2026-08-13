// buildServer boot-time guards + httpRoute verb wiring (PUT branch).

import { describe, expect, spyOn, test } from "bun:test";
import {
  createEntity,
  createFileField,
  createRegistry,
  createTextField,
  defineFeature,
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
        fields: { title: createTextField(), attachment: createFileField() },
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
        fields: { title: createTextField({ searchable: true }) },
      }),
    );
    r.screen({ id: "note-list", type: "entityList", entity: "note", columns: ["title"] });
  });

  const nonSearchableFeature = defineFeature("no-search", (r) => {
    r.entity(
      "note",
      createEntity({
        table: "boot_guard_plain_notes",
        fields: { title: createTextField() },
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
        fields: { title: createTextField({ searchable: true }) },
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
