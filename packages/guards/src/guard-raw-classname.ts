#!/usr/bin/env bun
// Design comes from widgets/theme tokens, not raw Tailwind in app code.
// Flags design-carrying classes in app `className`: default-palette colors
// (bg-red-500), arbitrary color values (bg-[#fff], text-[rgb(...)]), shadow-*.
// Layout utilities (flex/grid/gap/p-/m-/w-) and token classes
// (bg-primary, text-status-ok, …) stay allowed.
//
// Part of App-Mounting 2.0 (infra#208). Enabled per app repo in the
// respective migration PR (ui-guards input in _app-test.yml).

import { type JsxAttribute, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["tsx"],
  frameworkWithin: ["packages/bundled-features/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore raw-classname";

const PALETTE =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const COLOR_PREFIX =
  "bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret";

const PALETTE_CLASS = new RegExp(`^(${COLOR_PREFIX})-(${PALETTE})-\\d+(/\\d+)?$`);
const ARBITRARY_COLOR = new RegExp(`^(${COLOR_PREFIX})-\\[(#|rgb|hsl|oklch|color-mix)`);
// Only shadows — `rounded-*` was included initially, but the evidence
// across studio/publicstatus/money-horse shows: radius hits are
// chips/pills/small surfaces, not design drift (that comes via
// colors/shadows). 41 of 44 mh hits were rounded noise.
const CHROME_CLASS = /^shadow(-.+)?$/;

// Strip modifier prefixes (hover:, dark:, sm:, group-open:, …) — the base
// class is what gets checked.
function baseClass(token: string): string {
  const idx = token.lastIndexOf(":");
  return idx === -1 ? token : token.slice(idx + 1);
}

function offendingTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(baseClass)
    .filter((t) => PALETTE_CLASS.test(t) || ARBITRARY_COLOR.test(t) || CHROME_CLASS.test(t));
}

function classNameStrings(attr: JsxAttribute): { text: string; line: number }[] {
  const init = attr.getInitializer();
  if (init === undefined) return [];
  if (init.getKind() === SyntaxKind.StringLiteral) {
    return [
      {
        text: init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText(),
        line: init.getStartLineNumber(),
      },
    ];
  }
  // Expression: collect every string/template component (covers
  // cn("…", cond && "…") and template literals).
  const parts: { text: string; line: number }[] = [];
  for (const s of init.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    parts.push({ text: s.getLiteralText(), line: s.getStartLineNumber() });
  }
  for (const s of init.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    parts.push({ text: s.getLiteralText(), line: s.getStartLineNumber() });
  }
  for (const kind of [
    SyntaxKind.TemplateHead,
    SyntaxKind.TemplateMiddle,
    SyntaxKind.TemplateTail,
  ]) {
    for (const s of init.getDescendantsOfKind(kind)) {
      parts.push({ text: s.getText().replace(/^[`}]|[`$]{?$/g, ""), line: s.getStartLineNumber() });
    }
  }
  return parts;
}

export const guard: AstGuard = {
  name: "Raw-ClassName Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Design-tragende Klassen gehören in Widgets/Theme-Tokens (@cosmicdrift/kumiko-renderer-web widgets/, --color-status-*). " +
    `Begründete Ausnahme: // ${IGNORE_TAG} <Grund>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
        if (attr.getNameNode().getText() !== "className") continue;
        if (hasIgnoreTag(attr, IGNORE_TAG)) continue;
        for (const part of classNameStrings(attr)) {
          const bad = offendingTokens(part.text);
          if (bad.length === 0) continue;
          violations.push({
            file: sf.getFilePath(),
            line: part.line,
            message: `design-tragende Tailwind-Klassen in App-Code: ${bad.join(", ")}`,
          });
        }
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
