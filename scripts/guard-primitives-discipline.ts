/**
 * Guard: erzwingt dass App-/Feature-Web-Code UI-Bausteine aus den
 * Framework-Primitives nutzt, nicht hand-Tailwind auf raw HTML-Tags.
 *
 * Warum: Hand-Tailwind in `web/`-Ordnern ist zweimal Schaden:
 *   1. Style-Drift — bei jedem Renderer-/Theme-Update muss jeder
 *      hand-getailwindete Screen einzeln nachgezogen werden.
 *   2. Multi-Platform-Lock-out — Native (renderer-native) hat kein
 *      `<table>`, `<form>`, `<button>`. Direkt-DOM-Tags binden den
 *      Code an Web. Framework-Primitives (`<DataTable>`, `<Form>`,
 *      `<Button>`) sind im Vertrag plattform-neutral.
 *
 * Verboten in App-/Feature-Web-Code:
 *
 *   <table>/<thead>/<tbody>/<tr>/<td>/<th>  →  <DataTable>
 *   <form>                                  →  <Form>
 *   <input>                                 →  <Input> (in <Field>)
 *   <button>                                →  <Button>
 *   <select>                                →  <ComboboxInput>
 *   <textarea>                              →  <Input kind="textarea">
 *   <dialog>                                →  <DefaultDialog>
 *
 * Erlaubt: Container und Text — `<div>`, `<span>`, `<section>`,
 *   `<header>`, `<main>`, `<nav>`, `<aside>`, `<article>`,
 *   `<h1>`-`<h6>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<img>`,
 *   `<svg>`, `<label>`, `<small>`, `<strong>`, `<em>`, `<br>`, `<hr>`,
 *   `<pre>`, `<code>`.
 *
 * Scan-Pfade:
 *   - packages/bundled-features/(* * /web/* *).tsx        (strict-Modus)
 *   - samples/(* * /web/* *).tsx + samples/(* * /public/* *).tsx
 *
 * Modi:
 *   --strict              Beide Pfade hart (exit 1 bei Treffern)
 *   --strict-bundled      Nur bundled-features hart, samples warnen
 *   (default)             Beide warnen — exit 0, listet Treffer
 *
 * Tests-Ordner (`__tests__`) sind ausgenommen. Override pro Zeile:
 *   `// kumiko-lint-ignore primitives-discipline <reason>`
 *   (auf derselben Zeile oder auf der Zeile direkt darüber).
 *
 * Usage:
 *   yarn tsx scripts/guard-primitives-discipline.ts [--strict|--strict-bundled]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const FORBIDDEN_TAGS: ReadonlyArray<{ readonly tag: string; readonly counterpart: string }> = [
  { tag: "table", counterpart: "<DataTable>" },
  { tag: "thead", counterpart: "<DataTable>" },
  { tag: "tbody", counterpart: "<DataTable>" },
  { tag: "tr", counterpart: "<DataTable>" },
  { tag: "td", counterpart: "<DataTable>" },
  { tag: "th", counterpart: "<DataTable>" },
  { tag: "form", counterpart: "<Form>" },
  { tag: "input", counterpart: "<Input> (über <Field>)" },
  { tag: "button", counterpart: "<Button>" },
  { tag: "select", counterpart: "<ComboboxInput>" },
  { tag: "textarea", counterpart: '<Input kind="textarea">' },
  { tag: "dialog", counterpart: "<DefaultDialog>" },
];

const IGNORE_TAG = "kumiko-lint-ignore primitives-discipline";

type ScopeKind = "bundled-features" | "samples";

type ScanScope = {
  readonly kind: ScopeKind;
  readonly root: string;
};

const SCOPES: ReadonlyArray<ScanScope> = [
  { kind: "bundled-features", root: path.join(ROOT, "packages/bundled-features/src") },
  { kind: "samples", root: path.join(ROOT, "samples") },
];

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
  readonly counterpart: string;
  readonly excerpt: string;
  readonly scope: ScopeKind;
};

function isWebFile(absPath: string, scopeRoot: string): boolean {
  // Nur .tsx-Files unter einem `web/`- oder `public/`-Pfad-Segment
  // (verhindert dass zufällige .tsx in screens/ oder feature-roots
  // gescant werden — die sind Schema-Definitions, kein Web-Code).
  if (!absPath.endsWith(".tsx")) return false;
  const rel = path.relative(scopeRoot, absPath);
  const parts = rel.split(path.sep);
  return parts.includes("web") || parts.includes("public");
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      if (entry.name === "node_modules") continue;
      if (entry.name === "dist") continue;
      walk(full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
}

function buildTagPattern(tag: string): RegExp {
  // Match `<tag` am JSX-Opening: nach whitespace, Klammer, oder >.
  // Negative lookahead `[a-zA-Z0-9-]` damit `<input` nicht `<inputfoo`
  // matched. Match nicht im closing-tag (`</tag>`) — der ist redundant.
  return new RegExp(`(^|[\\s(>{,;])<${tag}(?![a-zA-Z0-9-])`, "u");
}

const TAG_PATTERNS = FORBIDDEN_TAGS.map((t) => ({
  ...t,
  pattern: buildTagPattern(t.tag),
}));

function hasIgnore(currentLine: string, prevLine: string): boolean {
  return currentLine.includes(IGNORE_TAG) || prevLine.includes(IGNORE_TAG);
}

function check(file: string, scope: ScopeKind): Violation[] {
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const violations: Violation[] = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    // Block-Kommentar-Tracking (heuristisch): `/* ... */` über mehrere
    // Zeilen. Single-line `//` und `*` (innerhalb /* */) skippen.
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    const prev = i > 0 ? (lines[i - 1] ?? "") : "";
    if (hasIgnore(line, prev)) continue;

    for (const { tag, counterpart, pattern } of TAG_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          tag,
          counterpart,
          excerpt: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
          scope,
        });
      }
    }
  }
  return violations;
}

function main(): void {
  const argv = process.argv.slice(2);
  const strictAll = argv.includes("--strict");
  const strictBundled = argv.includes("--strict-bundled");

  const allViolations: Violation[] = [];
  let scannedFiles = 0;

  for (const scope of SCOPES) {
    const files: string[] = [];
    walk(scope.root, files);
    const webFiles = files.filter((f) => isWebFile(f, scope.root));
    scannedFiles += webFiles.length;
    for (const file of webFiles) {
      allViolations.push(...check(file, scope.kind));
    }
  }

  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.log(
    `Primitives-Discipline: ${scannedFiles} Web-Dateien geprüft (bundled-features + samples).`,
  );

  if (allViolations.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.log(
      "Keine raw HTML-Tag-Verstöße. Alle Web-Komponenten nutzen Framework-Primitives.",
    );
    return;
  }

  const byFile = new Map<string, Violation[]>();
  for (const v of allViolations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  const bundledViolations = allViolations.filter((v) => v.scope === "bundled-features");
  const sampleViolations = allViolations.filter((v) => v.scope === "samples");

  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    `\n${allViolations.length} raw HTML-Tag-Verstoß/Verstöße in ${byFile.size} Datei(en):`,
  );
  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    `  bundled-features: ${bundledViolations.length}    samples: ${sampleViolations.length}\n`,
  );

  for (const [file, vs] of byFile) {
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.error(`  ${file} (${vs.length})`);
    for (const v of vs) {
      // biome-ignore lint/suspicious/noConsole: CLI tool output
      console.error(`    L${v.line}  <${v.tag}>  →  ${v.counterpart}`);
      // biome-ignore lint/suspicious/noConsole: CLI tool output
      console.error(`           ${v.excerpt}`);
    }
  }

  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    "\n  Migration: usePrimitives() in eine Custom-Screen-Komponente, oder schema-driven\n" +
      "  via EntityListScreenDefinition / EntityEditScreenDefinition wo möglich.\n" +
      "  Override pro Zeile: // kumiko-lint-ignore primitives-discipline <reason>\n",
  );

  if (strictAll && allViolations.length > 0) {
    process.exit(1);
  }
  if (strictBundled && bundledViolations.length > 0) {
    process.exit(1);
  }
}

main();
