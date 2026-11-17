import { describe, expect, it } from "bun:test";
import { transformUnsafeRawAllTenantsSource } from "../scripts/codemod/unsafe-raw-all-tenants.ts";

const FILE = "/repo/packages/bundled-features/src/note/sample.ts";

interface RewriteFixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  readonly rewrites: number;
}

const REWRITE_FIXTURES: readonly RewriteFixture[] = [
  {
    name: "a plain ctx.db.unsafeRaw() call",
    input: `const raw = ctx.db.unsafeRaw();\n`,
    expected: `const raw = ctx.db.unsafeRawAllTenants();\n`,
    rewrites: 1,
  },
  {
    name: "an unsafeRaw() call wrapped in asRawClient",
    input: `const client = asRawClient(tenantDb.unsafeRaw() as DbConnection);\n`,
    expected: `const client = asRawClient(tenantDb.unsafeRawAllTenants() as DbConnection);\n`,
    rewrites: 1,
  },
  {
    name: "a call split over several lines",
    input: [`const raw = ctx.db`, `  .unsafeRaw();`, ``].join("\n"),
    expected: [`const raw = ctx.db`, `  .unsafeRawAllTenants();`, ``].join("\n"),
    rewrites: 1,
  },
];

const UNCHANGED_FIXTURES: readonly { readonly name: string; readonly input: string }[] = [
  {
    name: "ctx.systemDb.unsafeRaw(reason) with an argument",
    input: `const raw = ctx.systemDb.unsafeRaw("reason");\n`,
  },
  {
    name: "the unsafeRaw grant name in an escapeHatch",
    input: `const hatch = { escapeHatch: { reason, grants: ["unsafeRaw"] } };\n`,
  },
  { name: "a file without unsafeRaw", input: `export const answer = 42;\n` },
  {
    name: "a stub that already has unsafeRawAllTenants",
    input: `const stub = { unsafeRaw: () => raw, unsafeRawAllTenants: () => raw };\n`,
  },
  {
    name: "a type that already has unsafeRawAllTenants",
    input: `type Db = { unsafeRaw(): Raw; unsafeRawAllTenants(): Raw };\n`,
  },
];

describe("unsafe-raw-all-tenants codemod", () => {
  for (const fixture of REWRITE_FIXTURES) {
    it(`renames ${fixture.name}`, () => {
      const result = transformUnsafeRawAllTenantsSource(fixture.input, FILE);

      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toHaveLength(0);
    });

    it(`${fixture.name}: a second run changes nothing`, () => {
      const second = transformUnsafeRawAllTenantsSource(fixture.expected, FILE);

      expect(second.output).toBe(fixture.expected);
      expect(second.rewrites).toHaveLength(0);
    });
  }

  for (const fixture of UNCHANGED_FIXTURES) {
    it(`leaves ${fixture.name} unchanged`, () => {
      const result = transformUnsafeRawAllTenantsSource(fixture.input, FILE);

      expect(result.output).toBe(fixture.input);
      expect(result.rewrites).toHaveLength(0);
      expect(result.manual).toHaveLength(0);
    });
  }

  it("reports an object literal stub as manual and leaves the source", () => {
    const input = `const stub = { unsafeRaw: () => raw };\n`;
    const result = transformUnsafeRawAllTenantsSource(input, FILE);

    expect(result.output).toBe(input);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toEqual([
      expect.objectContaining({
        file: FILE,
        line: 1,
        description: expect.stringContaining("add unsafeRawAllTenants"),
      }),
    ]);
  });
});
