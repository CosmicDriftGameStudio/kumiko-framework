import { describe, expect, test } from "bun:test";
import { seedServiceLockfile } from "../seed-lockfile";

const manifest = {
  name: "svc",
  private: true,
  dependencies: { hono: "1.0.0" },
  devDependencies: { tool: "workspace:*" },
};

function lockWith(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lockfileVersion: 1,
    workspaces: {
      "": { name: "root", dependencies: { root: "1" } },
      "apps/other": { name: "other" },
    },
    packages: { hono: ["hono@1.0.0", "", {}, "sha512-x"] },
    ...extra,
  };
}

describe("seedServiceLockfile", () => {
  test("rewrites the root workspace and leaves the rest of the lock untouched", () => {
    const { lock } = seedServiceLockfile({ manifest, lock: lockWith() });
    expect(lock["workspaces"]).toEqual({
      "": { name: "svc", dependencies: { hono: "1.0.0" } },
      "apps/other": { name: "other" },
    });
    expect(lock["packages"]).toEqual(lockWith()["packages"]);
  });

  test("drops devDependencies and keeps the other manifest fields", () => {
    const result = seedServiceLockfile({ manifest, lock: lockWith() }).manifest;
    expect("devDependencies" in result).toBe(false);
    expect(result).toMatchObject({ name: "svc", private: true, dependencies: { hono: "1.0.0" } });
  });

  test("lock overrides land in the manifest, no key without them", () => {
    const withOverrides = seedServiceLockfile({
      manifest,
      lock: lockWith({ overrides: { ws: "8.0.0" } }),
    });
    expect(withOverrides.manifest["overrides"]).toEqual({ ws: "8.0.0" });
    expect("overrides" in seedServiceLockfile({ manifest, lock: lockWith() }).manifest).toBe(false);
  });

  test("invalid input throws a message naming the file", () => {
    expect(() => seedServiceLockfile({ manifest, lock: { packages: {} } })).toThrow(/bun\.lock/);
    expect(() =>
      seedServiceLockfile({ manifest: { dependencies: {} }, lock: lockWith() }),
    ).toThrow(/package\.json/);
    expect(() =>
      seedServiceLockfile({
        manifest: { name: "svc", dependencies: { hono: 1 } },
        lock: lockWith(),
      }),
    ).toThrow(/package\.json/);
  });
});
