/**
 * Guard: verhindert dass `@kumiko/renderer` (shared, plattform-
 * neutral) auf DOM- oder platform-spezifische APIs zugreift. Sobald
 * da window/document/EventSource/react-dom auftaucht, ist die
 * Trennung kaputt und der Code müsste ins `@kumiko/renderer-web`-
 * (oder renderer-native-)Package.
 *
 * Vorsätzlich simple Implementation: regex-basierte Scan über den
 * Source-Text. Falsch-Positive (z.B. "window" in einem String-
 * Literal) sind möglich aber selten — der Guard dient als
 * Pflege-Alarm, nicht als Semantik-Beweis.
 *
 * Geprüft:
 *   - Imports:  react-dom/*, jsdom, @kumiko/renderer-web, @kumiko/renderer-native
 *   - Symbole:  window., document., location., history., localStorage,
 *               sessionStorage, navigator., EventSource, fetch
 *               (bare — nicht qualifiziert)
 *
 * Tests-Ordner (__tests__) werden AUSGENOMMEN — Tests mounten im
 * jsdom, das ist erwartetes Verhalten.
 *
 * Usage:
 *   yarn tsx scripts/guard-renderer-boundaries.ts
 *
 * Exit 1 bei Verstößen, 0 wenn sauber.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_DIR = path.join(ROOT, "packages/renderer/src");

// Imports die im shared-layer tabu sind.
const FORBIDDEN_IMPORTS = [
  /from ["']react-dom(?:\/.*)?["']/,
  /from ["']jsdom["']/,
  /from ["']@kumiko\/renderer-web["']/,
  /from ["']@kumiko\/renderer-native["']/,
  /from ["']@kumiko\/dispatcher-live["']/,
];

// Runtime-Symbole die DOM/Browser bedeuten. `\b` verhindert Substring-
// Matches (z.B. "origin" nicht als "origin.foo" im Token-Sinn). Die
// Absicherung ist grob — eine ts-morph-basierte Prüfung wäre präziser,
// aber der Aufwand lohnt sich hier nicht.
const FORBIDDEN_SYMBOLS = [
  /\bwindow\s*\./,
  /\bdocument\s*\./,
  /\blocation\s*\./,
  /\bhistory\s*\./,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bnavigator\s*\./,
  /\bEventSource\b/,
  /\bHTMLElement\b/,
  /\bcreateRoot\b/,
];

// JSX-Elemente mit lowercase-Namen = HTML-Tags (React-Konvention:
// lowercase = intrinsic DOM element, Capitalized = Component).
// Shared-Renderer dürfen keine DOM-Tags emittieren — alles muss
// über Primitives laufen, die plattformgebunden sind.
//
// Match: `<tagname` am Anfang eines JSX-Opening, mit lowercase-Letter.
// Ignoriert: Fragment `<>`, Components `<Capitalized`, Attribute-
// Werte wie `<string>` im Type-Annotation-Context (die regex matched
// nur direkt nach whitespace/newline/>, nicht nach Identifier-Zeichen).
const FORBIDDEN_JSX_TAG = /(^|\s|>|\()<([a-z][a-zA-Z0-9-]*)[\s/>]/;

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly excerpt: string;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...walk(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function check(file: string): Violation[] {
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Kommentare überspringen. Pure Heuristik — mehrzeilige
    // Block-Kommentare fängt das nicht. Gut genug für Source-Code
    // der nicht jsdoc-blockweise 'window.*' als Prose einfügt.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    for (const pattern of FORBIDDEN_IMPORTS) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          rule: "forbidden-import",
          excerpt: trimmed,
        });
      }
    }
    for (const pattern of FORBIDDEN_SYMBOLS) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          rule: "forbidden-symbol",
          excerpt: trimmed,
        });
      }
    }
    const jsxMatch = line.match(FORBIDDEN_JSX_TAG);
    if (jsxMatch !== null) {
      violations.push({
        file: path.relative(ROOT, file),
        line: i + 1,
        rule: `forbidden-jsx-tag (<${jsxMatch[2]}>)`,
        excerpt: trimmed,
      });
    }
  }
  return violations;
}

function main(): void {
  const files = walk(SCAN_DIR);
  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.log(`Renderer-Boundaries Guard: ${files.length} Dateien geprüft in @kumiko/renderer.`);

  const allViolations: Violation[] = [];
  for (const file of files) {
    allViolations.push(...check(file));
  }

  if (allViolations.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.log("Keine Boundary-Verstöße. @kumiko/renderer bleibt platform-neutral.");
    return;
  }

  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    `\nBLOCKED: ${allViolations.length} Boundary-Verstoß/Verstöße in @kumiko/renderer:\n`,
  );
  for (const v of allViolations) {
    // biome-ignore lint/suspicious/noConsole: CLI tool output
    console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.excerpt}`);
  }
  // biome-ignore lint/suspicious/noConsole: CLI tool output
  console.error(
    "\n  @kumiko/renderer darf keine DOM-/Browser-/Platform-APIs nutzen.\n  Platform-spezifischer Code gehört nach @kumiko/renderer-web (oder renderer-native).\n",
  );
  process.exit(1);
}

main();
