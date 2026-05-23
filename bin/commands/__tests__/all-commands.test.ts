// Smoke-Test über alle Commands: jeder muss registriert sein, valide
// Metadaten haben, und ein paar definierte Eigenschaften erfüllen
// (id, label, roles, category, run-fn).
//
// Plus: stellt sicher dass IDs eindeutig sind und Categories nur die
// erlaubten Werte enthalten — kein "drift" zwischen Command-Files und
// TUI-Categories.

import { describe, expect, test } from "vitest";
import { getCommand, getCommands } from "..";
import type { Category, Command, Role } from "../types";

// Touch the registry by importing the index — side-effect imports
// register every command.
// (side-effect; nothing to assign)
import "..";

const EXPECTED_IDS = [
  "add",
  "build",
  "check",
  "check:fast",
  "ci:guards",
  "clean-test-dbs",
  "codegen",
  "codemod",
  "consumer",
  "create",
  "dev",
  "docs",
  "doctor",
  "eval",
  "events",
  "init-deploy",
  "migrate",
  "new",
  "ops",
  "project",
  "reset",
  "status",
  "stop",
  "test",
] as const;

const ALLOWED_CATEGORIES: ReadonlyArray<Category> = ["help", "lifecycle", "quality", "code", "ops"];
const ALLOWED_ROLES: ReadonlyArray<Role> = ["maintainer", "app-dev"];

describe("commands — registry coverage", () => {
  test("all expected commands are registered", () => {
    for (const id of EXPECTED_IDS) {
      expect(getCommand(id), `command "${id}" missing`).toBeDefined();
    }
  });

  test("no extra ids registered beyond the expected set", () => {
    // Maintainer-Filter zeigt mehr Commands als App-Dev.
    const all = getCommands("maintainer").map((c) => c.id);
    for (const id of all) {
      expect(EXPECTED_IDS).toContain(id);
    }
  });
});

describe("commands — per-command metadata", () => {
  for (const id of EXPECTED_IDS) {
    test(`${id} has valid metadata`, () => {
      const cmd = getCommand(id);
      expect(cmd, `${id} not registered`).toBeDefined();
      const c = cmd as Command;

      expect(c.id).toBe(id);
      expect(c.label.length, "label empty").toBeGreaterThan(0);
      expect(c.description.length, "description empty").toBeGreaterThan(0);
      expect(typeof c.run, "run is not a function").toBe("function");

      expect(ALLOWED_CATEGORIES, `category "${c.category}" not allowed`).toContain(c.category);

      expect(c.roles.length, "no roles").toBeGreaterThan(0);
      for (const r of c.roles) {
        expect(ALLOWED_ROLES, `role "${r}" not allowed`).toContain(r);
      }
    });
  }
});

describe("commands — role-filter", () => {
  test("getCommands(maintainer) returns ≥ getCommands(app-dev)", () => {
    const m = getCommands("maintainer").length;
    const a = getCommands("app-dev").length;
    expect(m).toBeGreaterThanOrEqual(a);
  });

  test("all app-dev-commands are also maintainer (maintainer sees everything)", () => {
    const maintainerIds = new Set(getCommands("maintainer").map((c) => c.id));
    const appDevIds = getCommands("app-dev").map((c) => c.id);
    for (const id of appDevIds) {
      expect(maintainerIds.has(id), `app-dev "${id}" not in maintainer-list`).toBe(true);
    }
  });
});
