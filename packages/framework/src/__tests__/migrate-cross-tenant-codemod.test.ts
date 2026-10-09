import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CODEMOD_PLACEHOLDER_REASON_MARKER } from "../engine/escape-hatch-reason.js";
import { migrateCrossTenantSource } from "../scripts/codemod/migrate-cross-tenant.js";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "migrate-cross-tenant");

function readFixture(name: string): { input: string; expected: string } {
  return {
    input: readFileSync(join(FIXTURES_DIR, `${name}.input.ts`), "utf8"),
    expected: readFileSync(join(FIXTURES_DIR, `${name}.expected.ts`), "utf8"),
  };
}

describe("migrateCrossTenantSource", () => {
  it("rewrites crossTenant: true to escapeHatch: { reason } for every recognized entity-handler call shape", () => {
    const { input, expected } = readFixture("rewrite");
    const result = migrateCrossTenantSource(input, "export-job.handlers.ts");

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(4);
    expect(result.manual).toHaveLength(0);

    const byLine = new Map(result.rewrites.map((r) => [r.line, r]));

    expect(byLine.get(16)?.after).toBe(
      'escapeHatch: { reason: "export-job:list reads export-job rows across every tenant (migrated from crossTenant: true; state the operator use case here)" }',
    );
    expect(byLine.get(24)?.after).toBe(
      'escapeHatch: { reason: "export-job:update writes export-job rows across every tenant (migrated from crossTenant: true; state the operator use case here)" }',
    );
    expect(byLine.get(31)?.after).toBe(
      'escapeHatch: { reason: "note:delete writes note rows across every tenant (migrated from crossTenant: true; state the operator use case here)" }',
    );
    expect(byLine.get(38)?.after).toBe(
      'escapeHatch: { reason: "export-job:detail reads export-job rows across every tenant (migrated from crossTenant: true; state the operator use case here)" }',
    );
  });

  it("derives handlerName from the call for both the verb-in-name and verb-in-arg factory shapes", () => {
    const { input } = readFixture("rewrite");
    const result = migrateCrossTenantSource(input, "export-job.handlers.ts");

    for (const rewrite of result.rewrites) {
      expect(rewrite.after).toMatch(/^escapeHatch: \{ reason: "/);
    }
    expect(result.rewrites.map((r) => r.line)).toEqual([16, 24, 31, 38]);
  });

  it("leaves a spread/shared access object, a registerEntityCrud write/read block, an already-declared escapeHatch, and a non-literal crossTenant for manual review", () => {
    const { input, expected } = readFixture("manual-only");
    const result = migrateCrossTenantSource(input, "widget.handlers.ts");

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(4);

    const byLine = new Map(result.manual.map((m) => [m.line, m]));

    expect(byLine.get(13)?.why).toBe(
      "crossTenant is not set directly in a handler call (e.g. a spread/shared object) — give each consuming handler its own escapeHatch reason",
    );
    expect(byLine.get(13)?.handlerName).toBeUndefined();

    expect(byLine.get(19)?.why).toBe(
      'under registerEntityCrud("widget", ...) → write: multiple verbs share this crossTenant — set escapeHatch per verb manually, one reason each',
    );

    expect(byLine.get(26)?.why).toBe(
      "this object already declares escapeHatch — merge the two manually and remove crossTenant",
    );
    expect(byLine.get(26)?.handlerName).toBe("widget");

    expect(byLine.get(34)?.why).toBe(
      "crossTenant is not a literal boolean (`someFlag`) — replace manually with escapeHatch: { reason }",
    );
    expect(byLine.get(34)?.handlerName).toBe("legacy-report");
  });

  it("ignores crossTenant: false — no rewrite, no manual entry, output unchanged", () => {
    const { input } = readFixture("manual-only");
    const result = migrateCrossTenantSource(input, "widget.handlers.ts");

    expect(input).toContain("crossTenant: false");
    expect(result.manual.some((m) => m.line === 41)).toBe(false);
    expect(result.rewrites.some((r) => r.line === 41)).toBe(false);
    expect(result.output).toContain("crossTenant: false");
  });

  it("builds each reason from the handler name, entity and access verb", () => {
    const { input } = readFixture("rewrite");
    const result = migrateCrossTenantSource(input, "export-job.handlers.ts");

    const expectedParts: Record<number, { handler: string; entity: string; verb: string }> = {
      16: { handler: "export-job:list", entity: "export-job", verb: "reads" },
      24: { handler: "export-job:update", entity: "export-job", verb: "writes" },
      31: { handler: "note:delete", entity: "note", verb: "writes" },
      38: { handler: "export-job:detail", entity: "export-job", verb: "reads" },
    };

    expect(result.rewrites).toHaveLength(Object.keys(expectedParts).length);
    for (const rewrite of result.rewrites) {
      const reason = rewrite.after.match(/reason: "([^"]*)"/)?.[1] ?? "";
      const parts = expectedParts[rewrite.line];
      expect(parts).toBeDefined();
      expect(reason).toContain(parts?.handler ?? "");
      expect(reason).toContain(parts?.entity ?? "");
      expect(reason).toContain(parts?.verb ?? "");
      // the marker is what the escapeHatch validation rejects until a human replaces it
      expect(reason).toContain(CODEMOD_PLACEHOLDER_REASON_MARKER);
    }
  });
});
