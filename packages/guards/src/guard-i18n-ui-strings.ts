#!/usr/bin/env bun
// Kein hardcodeter UI-Text in App-Web-Code: JSX-Textknoten und Label-artige
// String-Props müssen über t("…")-Keys laufen (guard-i18n-keys prüft dann,
// dass die Keys definiert sind — dieser Guard schließt die Lücke davor:
// Strings, die nie zu Keys wurden, z.B. "Lade Tenants…").
//
// Teil von App-Mounting 2.0 (infra#208).

import { type CallExpression, type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

// Nur Web-/Public-Code — Server-Code (Handler-Fehlertexte) läuft über die
// Error-i18n-Pipeline und hat eigene Guards.
//
// samples/ deliberately NOT scanned (tried in infra#478, rolled back): the
// showcase/gallery pages are dev docs about the framework API itself
// ("Form.title / toolbarTitle", "children — auto from schema.navs"), not
// app UI text a real user sees. 354 hits in the trial run, almost all such
// API annotations. guard-i18n-keys covers samples/ (t() calls +
// r.translations definitions); this guard stays scoped to app repos.
//
// src/features/**/feature.ts covers feature.ts registrar calls (r.nav/r.screen
// object-literal arguments) — infra#504: those sit outside JSX and were a
// blind spot. Other server code (handlers/, lib/) has its own i18n pipeline
// and is filtered out below by requiring an r.*-call ancestor.
const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  within: [
    "**/web/**/*.tsx",
    "public/**/*.tsx",
    "features/**/feature.ts",
    "features/**/register/**/*.ts",
  ],
  frameworkWithin: ["packages/bundled-features/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore i18n-ui-strings";

// Mindestens zwei Buchstaben in Folge = menschenlesbarer Text (lässt "—",
// Zahlen, Interpunktion und Einzel-Zeichen durch).
const HUMAN_TEXT = /\p{L}{2,}/u;

// i18n-Key-Shape (e.g. "tenant.nav.members", "money-horse:nav.scenarioCompare"):
// alphanumeric/dash segments (camelCase allowed) joined by "." or ":", at
// least one separator — real keys have no spaces and no bare single word.
// r.nav/r.screen label props are keys, not raw text, unlike JSX props.
const I18N_KEY_SHAPE =
  /^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*(?:[:.][a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*)+$/;

const LABEL_PROPS = new Set([
  "label",
  "title",
  "subtitle",
  "placeholder",
  "description",
  "confirm",
  "confirmLabel",
  "emptyLabel",
  "ariaLabel",
  "aria-label",
  "startLabel",
  "endLabel",
]);

// projectionDetail screens: `header: { title, subtitle, status }` names
// columns from the query row (RecordHeaderSpec, packages/types/src/screen.ts),
// not UI text — analogous to `metrics: [...]`, which stays out of LABEL_PROPS
// for the same reason. Only exempt when directly nested under a `header:`
// property so a section/column `title` elsewhere stays flagged.
const HEADER_SPEC_PROPS = new Set(["title", "subtitle", "status"]);

const REGISTRAR_CALL = /^r\.[a-zA-Z]+$/;

const LOGICAL_OPERATORS = new Set([SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken]);

function isTernaryOrLogical(node: Node): boolean {
  if (node.isKind(SyntaxKind.ConditionalExpression)) return true;
  return (
    node.isKind(SyntaxKind.BinaryExpression) &&
    LOGICAL_OPERATORS.has(node.getOperatorToken().getKind())
  );
}

type TextPiece = { readonly text: string; readonly node: Node };

// Leaf strings a ternary/logical branch can bottom out on: a plain string, or
// a template literal's static spans (interpolated `${…}` values are skipped —
// only the literal text around them is human-authored copy, e.g. "Apply " /
// " change(s)" in `Apply ${n} change(s)`).
function textPieces(node: Node): TextPiece[] {
  if (
    node.isKind(SyntaxKind.StringLiteral) ||
    node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
  ) {
    return [{ text: node.getLiteralText(), node }];
  }
  if (node.isKind(SyntaxKind.TemplateExpression)) {
    const pieces: TextPiece[] = [{ text: node.getHead().getLiteralText(), node }];
    for (const span of node.getTemplateSpans()) {
      pieces.push({
        text: span.getLiteral().getLiteralText(),
        node: span.getLiteral(),
      });
    }
    return pieces;
  }
  return [];
}

// Only descends through ternary/logical branches — a literal reached through
// any other expression (function call, member access, …) is out of scope, so
// e.g. `formatLabel("Save")` inside a ternary branch is not flattened into it.
function collectTernaryLogicText(node: Node): TextPiece[] {
  if (node.isKind(SyntaxKind.ConditionalExpression)) {
    return [
      ...collectTernaryLogicText(node.getWhenTrue()),
      ...collectTernaryLogicText(node.getWhenFalse()),
    ];
  }
  if (
    node.isKind(SyntaxKind.BinaryExpression) &&
    LOGICAL_OPERATORS.has(node.getOperatorToken().getKind())
  ) {
    return [
      ...collectTernaryLogicText(node.getLeft()),
      ...collectTernaryLogicText(node.getRight()),
    ];
  }
  return textPieces(node);
}

// infra#711: a hop out of a helper is only taken while that helper call is
// itself an argument of the next call — a call nested deeper (inside an object
// or array, e.g. `createTextField({ label })` under `createEntity({ fields })`)
// builds a value instead of forwarding the registrar's argument. The full chain
// comes back so the line-anchored ignore tag also works above the helper.
function registrarCallChain(prop: Node): CallExpression[] | undefined {
  const chain: CallExpression[] = [];
  let call = prop.getFirstAncestorByKind(SyntaxKind.CallExpression);
  while (call !== undefined) {
    chain.push(call);
    if (REGISTRAR_CALL.test(call.getExpression().getText())) return chain;
    call = call.getParentIfKind(SyntaxKind.CallExpression);
  }
  return undefined;
}

export const guard: AstGuard = {
  name: "i18n-UI-Strings Guard (App-Repos)",
  scan: SCAN,
  hint:
    'UI text belongs in i18n bundles + t("feature:key") — not as a literal in JSX. ' +
    `Justified exception (e.g. proper noun/brand): // ${IGNORE_TAG} <reason>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const textNode of sf.getDescendantsOfKind(SyntaxKind.JsxText)) {
        const text = textNode.getText().trim();
        if (!HUMAN_TEXT.test(text)) continue;
        if (hasIgnoreTag(textNode, IGNORE_TAG)) continue;
        violations.push({
          file: sf.getFilePath(),
          line: textNode.getStartLineNumber(),
          message: `hardcoded JSX text: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`,
        });
      }
      for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
        if (!LABEL_PROPS.has(attr.getNameNode().getText())) continue;
        const init = attr.getInitializer();
        if (init === undefined || init.getKind() !== SyntaxKind.StringLiteral) continue;
        const value = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
        if (!HUMAN_TEXT.test(value)) continue;
        if (hasIgnoreTag(attr, IGNORE_TAG)) continue;
        violations.push({
          file: sf.getFilePath(),
          line: attr.getStartLineNumber(),
          message: `hardcoded label prop ${attr.getNameNode().getText()}="${value.slice(0, 40)}"`,
        });
      }
      // Ternary/logical JSX expressions: `{saving ? "Saving…" : "Save"}` as a
      // child, or `title={busy ? "…" : "Send"}` on a label prop — a string
      // literal reachable only via getDescendantsOfKind(JsxText/JsxAttribute)
      // above never fires here since the literal sits one level deeper,
      // inside the {…} expression.
      for (const jsxExpr of sf.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
        const inner = jsxExpr.getExpression();
        if (inner === undefined || !isTernaryOrLogical(inner)) continue;
        const attr = jsxExpr.getParentIfKind(SyntaxKind.JsxAttribute);
        if (attr !== undefined && !LABEL_PROPS.has(attr.getNameNode().getText())) continue;
        if (hasIgnoreTag(jsxExpr, IGNORE_TAG)) continue;
        for (const piece of collectTernaryLogicText(inner)) {
          if (!HUMAN_TEXT.test(piece.text)) continue;
          const shown = `${piece.text.slice(0, 40)}${piece.text.length > 40 ? "…" : ""}`;
          violations.push({
            file: sf.getFilePath(),
            line: piece.node.getStartLineNumber(),
            message:
              attr !== undefined
                ? `hardcoded label prop ${attr.getNameNode().getText()} in ternary/logical expression: "${shown}"`
                : `hardcoded JSX text in ternary/logical expression: "${shown}"`,
          });
        }
      }
      // r.nav({ label: "..." }) etc.: registrar param is conventionally
      // named "r" across framework/bundled-features/app repos (verified,
      // no exceptions found) — see the samples/ scan-boundary note above.
      for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        if (!LABEL_PROPS.has(prop.getName())) continue;
        if (HEADER_SPEC_PROPS.has(prop.getName())) {
          const enclosingObject = prop.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
          const enclosingProp = enclosingObject?.getParentIfKind(SyntaxKind.PropertyAssignment);
          if (enclosingProp?.getName() === "header") continue;
        }
        const init = prop.getInitializer();
        if (init === undefined || init.getKind() !== SyntaxKind.StringLiteral) continue;
        const value = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
        if (!HUMAN_TEXT.test(value) || I18N_KEY_SHAPE.test(value)) continue;
        const callChain = registrarCallChain(prop);
        if (callChain === undefined) continue;
        // The agent-doc slot (kumiko-framework#2615) is LLM metadata for the
        // AI tool catalog: English by design, never rendered as UI text. The
        // slot is the options object handed to a call on the registrar
        // argument chain, so forwarding it through a `defineEntity*Handler`
        // helper is the same slot and stays exempt.
        if (
          prop.getName() === "description" &&
          prop
            .getParentIfKind(SyntaxKind.ObjectLiteralExpression)
            ?.getParentIfKind(SyntaxKind.CallExpression) !== undefined
        )
          continue;
        if (callChain.some((c) => hasIgnoreTag(c, IGNORE_TAG)) || hasIgnoreTag(prop, IGNORE_TAG))
          continue;
        violations.push({
          file: sf.getFilePath(),
          line: prop.getStartLineNumber(),
          message: `hardcoded label property ${prop.getName()}="${value.slice(0, 40)}" in r.* call — use an i18n key instead of plain text`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
