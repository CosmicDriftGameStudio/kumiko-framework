import { describe, expect, test } from "bun:test";
import { mayEditTemplate } from "../template-edit-policy.ts";

const LAYOUT = { slug: "tenant-layout-brief", kind: "pdf-layout" } as const;
const EDITOR_A = { roles: ["EditorA"] };

const policy = (...entries: { slug: string; role: string }[]) => ({
  tenantEditable: entries.map(({ slug, role }) => ({
    kind: "document-pdf" as const,
    slug,
    access: { roles: [role] },
  })),
});

describe("mayEditTemplate :: tenant layouts", () => {
  const both = policy({ slug: "a", role: "EditorA" }, { slug: "b", role: "EditorB" });

  test("the right on template A but not B does not cover a tenant layout", () => {
    expect(mayEditTemplate(both, EDITOR_A, LAYOUT)).toBe(false);
  });

  test("the right on every PDF template does", () => {
    expect(mayEditTemplate(both, { roles: ["EditorA", "EditorB"] }, LAYOUT)).toBe(true);
  });

  test("without any PDF template entry nobody but a SystemAdmin may", () => {
    const none = { tenantEditable: [] };
    expect(mayEditTemplate(none, EDITOR_A, LAYOUT)).toBe(false);
    expect(mayEditTemplate(none, { roles: ["SystemAdmin"] }, LAYOUT)).toBe(true);
  });

  test("a layout slug outside the prefix still needs its own entry", () => {
    expect(
      mayEditTemplate(both, { roles: ["EditorA", "EditorB"] }, { slug: "x", kind: "pdf-layout" }),
    ).toBe(false);
  });
});
