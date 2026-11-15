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

describe("mayEditTemplate :: variants", () => {
  const withVariants = {
    tenantEditable: [
      { kind: "document-pdf" as const, slug: "a", access: EDITOR_A, variants: true as const },
      { kind: "document-pdf" as const, slug: "b", access: EDITOR_A },
    ],
  };
  const variant = (slug: string) => ({ slug, kind: "document-pdf" });

  test("a variant follows the base entry with variants", () => {
    expect(mayEditTemplate(withVariants, EDITOR_A, variant("a:short"))).toBe(true);
  });

  test("a base without variants, an unlisted base and a nested name do not cover a variant", () => {
    expect(mayEditTemplate(withVariants, EDITOR_A, variant("b:short"))).toBe(false);
    expect(mayEditTemplate(withVariants, EDITOR_A, variant("c:short"))).toBe(false);
    expect(mayEditTemplate(withVariants, EDITOR_A, variant("a:short:deep"))).toBe(false);
  });

  test("variants are a document-pdf concept only", () => {
    expect(mayEditTemplate(withVariants, EDITOR_A, { slug: "a:short", kind: "mail" })).toBe(false);
  });
});
