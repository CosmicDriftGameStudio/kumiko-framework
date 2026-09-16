import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { findViolations } from "../guard-i18n-locale-terminology";

function deBundle(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/repo/packages/locale-de/src/strings.ts", code);
}

function esBundle(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/repo/packages/locale-es/src/strings.ts", code);
}

describe("guard-i18n-locale-terminology", () => {
  test("flags Tenant in a German translation value", () => {
    const sf = deBundle(`export const localeDeBundle = { "x.y": "Bitte Tenant wählen" };`);
    const violations = findViolations([sf]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("Tenant");
  });

  test("allows Mandant in German values", () => {
    const sf = deBundle(`export const localeDeBundle = { "x.y": "Mandant auswählen" };`);
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("word boundary: TenantAdmin compound is clean, bare Tenant- is not", () => {
    const clean = deBundle(
      `export const localeDeBundle = { "x.y": "TenantAdmin-Rolle erforderlich." };`,
    );
    expect(findViolations([clean])).toHaveLength(0);
    const dirty = deBundle(
      `export const localeDeBundle = { "x.y": "Tenant-Rolle erforderlich." };`,
    );
    const violations = findViolations([dirty]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("Tenant");
  });

  test("ignores tenant in the JSON key name when the value is clean", () => {
    const sf = deBundle(`export const localeDeBundle = { "tenant.members.title": "Mitglieder" };`);
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("flags plural Tenants and Organisations- compounds in German values", () => {
    const tenants = deBundle(`export const localeDeBundle = { "x.y": "Alle Tenants anzeigen" };`);
    expect(findViolations([tenants])).toHaveLength(1);
    const org = deBundle(`export const localeDeBundle = { "x.y": "Ihre Organisations-ID" };`);
    expect(findViolations([org])).toHaveLength(1);
  });

  test("flags the tenant loanword in a Spanish translation value", () => {
    const sf = esBundle(`export const localeEsBundle = { "x.y": "Seleccione un tenant" };`);
    const violations = findViolations([sf]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("tenant");
  });

  test("flags Spanish plural tenants", () => {
    const sf = esBundle(`export const localeEsBundle = { "x.y": "Ver todos los tenants" };`);
    expect(findViolations([sf])).toHaveLength(1);
  });

  test("allows Organización in Spanish values", () => {
    const sf = esBundle(`export const localeEsBundle = { "x.y": "Seleccione una Organización" };`);
    expect(findViolations([sf])).toHaveLength(0);
  });
});
