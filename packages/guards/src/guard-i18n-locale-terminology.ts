#!/usr/bin/env bun
/**
 * Guard: locale bundle values must follow Mandant/Organización terminology (#2200, fw#2355).
 *
 * German UI copy always says "Mandant" (never "Tenant"/"Organisation"); Spanish always
 * says "Organización" (never the "tenant" loanword). Only translation *values* are
 * checked — JSON key names like `tenant.members.*` are ignored. Role identifiers
 * such as TenantAdmin/SystemAdmin in prose are allowed.
 *
 * Usage:
 *   bun guards/guard-i18n-locale-terminology.ts
 *
 * Ignore: // kumiko-lint-ignore i18n-locale-terminology
 */

import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  kinds: ["framework"],
  frameworkWithin: ["packages/locale-de/src/strings.ts", "packages/locale-es/src/strings.ts"],
};
const IGNORE_TAG = "kumiko-lint-ignore i18n-locale-terminology";

type LocaleRule = {
  readonly preferred: string;
  readonly forbidden: readonly RegExp[];
};

const RULES: Record<"de" | "es", LocaleRule> = {
  de: {
    preferred: "Mandant",
    // Tenants? covers plural; Organisation(en|s)? without trailing \b so
    // compounds like Organisations-ID / Organisationsstruktur still match
    // (infra#603). TenantAdmin stays safe: \b after Tenant fails on 'A'.
    forbidden: [/\bTenants?\b/i, /\bOrganisation(en|s)?/],
  },
  es: {
    preferred: "Organización",
    forbidden: [/\btenants?\b/i],
  },
};

function localeFromPath(filePath: string): "de" | "es" | undefined {
  if (filePath.includes("locale-de/src/strings.ts")) return "de";
  if (filePath.includes("locale-es/src/strings.ts")) return "es";
  return undefined;
}

function stringLiteralText(node: Node): string | undefined {
  if (node.isKind(SyntaxKind.StringLiteral)) return node.getLiteralText();
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) return node.getLiteralValue();
  return undefined;
}

function forbiddenTerm(text: string, rule: LocaleRule): string | undefined {
  for (const re of rule.forbidden) {
    const match = text.match(re);
    if (match !== null) return match[0];
  }
  return undefined;
}

export function findViolations(files: readonly SourceFile[]): GuardViolation[] {
  const violations: GuardViolation[] = [];

  for (const sf of files) {
    const locale = localeFromPath(sf.getFilePath());
    if (locale === undefined) continue;
    const rule = RULES[locale];

    for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (hasIgnoreTag(prop, IGNORE_TAG)) continue;
      const init = prop.getInitializer();
      if (init === undefined) continue;
      const text = stringLiteralText(init);
      if (text === undefined) continue;

      const hit = forbiddenTerm(text, rule);
      if (hit !== undefined) {
        violations.push({
          file: sf.getFilePath(),
          line: prop.getStartLineNumber(),
          message: `[${locale}] verbotener Begriff "${hit}" in Übersetzungswert — nutze "${rule.preferred}" (fw#2200).`,
        });
      }
    }
  }

  return violations;
}

export const guard: AstGuard = {
  name: "i18n-Locale-Terminology Guard",
  scan: SCAN,
  hint: "DE: Mandant statt Tenant/Organisation; ES: Organización statt tenant-Loanword. Rollen wie TenantAdmin sind OK.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    const violations = findViolations(files)
      .map((v) => ({ ...v, file: relFromRepoRoot(v.file, roots) }))
      .filter(isLocalFinding);
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
