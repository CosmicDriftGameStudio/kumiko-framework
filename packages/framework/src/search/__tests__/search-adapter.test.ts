import { beforeEach, describe, expect, test } from "vitest";
import { createInMemorySearchAdapter } from "../in-memory-adapter";
import type { SearchAdapter } from "../types";

const TENANT = 1;
let adapter: SearchAdapter;

beforeEach(async () => {
  adapter = createInMemorySearchAdapter();
  await adapter.configure(TENANT, {
    searchableFields: ["email", "firstName", "lastName", "_roles", "_department"],
    rankingFields: ["email", "firstName", "lastName", "_roles", "_department"],
  });
});

// --- Basic search ---

describe("basic search", () => {
  test("finds by field value", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: { email: "marc@test.de", firstName: "Marc" },
    });
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 2,
      weight: 10,
      fields: { email: "anna@test.de", firstName: "Anna" },
    });

    const results = await adapter.search(TENANT, "marc");
    expect(results).toHaveLength(1);
    expect(results[0]?.entityId).toBe(1);
  });

  test("search is case-insensitive", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Marc" },
    });

    expect(await adapter.search(TENANT, "MARC")).toHaveLength(1);
    expect(await adapter.search(TENANT, "marc")).toHaveLength(1);
  });

  test("returns empty for no matches", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Marc" },
    });
    expect(await adapter.search(TENANT, "nonexistent")).toEqual([]);
  });
});

// --- Partial matching ---

describe("partial matching", () => {
  test("finds by prefix", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Alexander" },
    });
    expect(await adapter.search(TENANT, "alex")).toHaveLength(1);
  });

  test("finds by substring in email", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { email: "marc.weber@company.de" },
    });
    expect(await adapter.search(TENANT, "weber")).toHaveLength(1);
  });
});

// --- Tenant isolation ---

describe("tenant isolation", () => {
  test("tenant 1 cannot see tenant 2 data", async () => {
    await adapter.configure(2, { searchableFields: ["firstName"] });
    await adapter.index(1, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Marc" },
    });
    await adapter.index(2, {
      entityType: "user",
      entityId: 2,
      weight: 1,
      fields: { firstName: "Marc" },
    });

    const t1 = await adapter.search(1, "marc");
    const t2 = await adapter.search(2, "marc");

    expect(t1).toHaveLength(1);
    expect(t1[0]?.entityId).toBe(1);
    expect(t2).toHaveLength(1);
    expect(t2[0]?.entityId).toBe(2);
  });
});

// --- Entity type filtering (list search) ---

describe("list search (filterType)", () => {
  test("filters by entity type", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: { firstName: "Marc" },
    });
    await adapter.index(TENANT, {
      entityType: "role",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Marc Admin" },
    });

    const users = await adapter.search(TENANT, "marc", { filterType: "user" });
    const roles = await adapter.search(TENANT, "marc", { filterType: "role" });

    expect(users).toHaveLength(1);
    expect(users[0]?.entityType).toBe("user");
    expect(roles).toHaveLength(1);
    expect(roles[0]?.entityType).toBe("role");
  });
});

// --- Global search (no filter) ---

describe("global search (no filterType)", () => {
  test("returns all entity types sorted by weight", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: { firstName: "Admin" },
    });
    await adapter.index(TENANT, {
      entityType: "role",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Admin Role" },
    });

    const results = await adapter.search(TENANT, "admin");
    expect(results).toHaveLength(2);
    // User (weight 10) should rank before Role (weight 1)
    expect(results[0]?.entityType).toBe("user");
    expect(results[1]?.entityType).toBe("role");
  });
});

// --- searchWeight scoring ---

describe("searchWeight scoring", () => {
  test("higher weight entity ranks first", async () => {
    await adapter.index(TENANT, {
      entityType: "vehicle",
      entityId: 1,
      weight: 10,
      fields: { firstName: "BMW 320i" },
    });
    await adapter.index(TENANT, {
      entityType: "workshop",
      entityId: 1,
      weight: 5,
      fields: { firstName: "BMW Werkstatt" },
    });
    await adapter.index(TENANT, {
      entityType: "role",
      entityId: 1,
      weight: 1,
      fields: { firstName: "BMW Fleet Manager" },
    });

    const results = await adapter.search(TENANT, "bmw");
    expect(results[0]?.entityType).toBe("vehicle");
    expect(results[1]?.entityType).toBe("workshop");
    expect(results[2]?.entityType).toBe("role");
  });
});

// --- Relation data in search ---

describe("resolved relation data", () => {
  test("finds user by role name via _roles field", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: { email: "marc@test.de", firstName: "Marc", _roles: "Admin, Developer" },
    });

    const results = await adapter.search(TENANT, "developer");
    expect(results).toHaveLength(1);
    expect(results[0]?.entityId).toBe(1);
  });

  test("finds user by department name via _department field", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: { email: "marc@test.de", _department: "Marketing" },
    });

    const results = await adapter.search(TENANT, "marketing");
    expect(results).toHaveLength(1);
  });
});

// --- Remove ---

describe("remove", () => {
  test("removes document from search", async () => {
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Marc" },
    });
    await adapter.remove(TENANT, "user", 1);
    expect(await adapter.search(TENANT, "marc")).toEqual([]);
  });
});

// --- Limit ---

describe("limit", () => {
  test("respects limit", async () => {
    for (let i = 1; i <= 10; i++) {
      await adapter.index(TENANT, {
        entityType: "user",
        entityId: i,
        weight: 1,
        fields: { firstName: `User${i}`, lastName: "Same" },
      });
    }
    const results = await adapter.search(TENANT, "same", { limit: 3 });
    expect(results).toHaveLength(3);
  });
});
