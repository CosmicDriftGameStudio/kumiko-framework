import { relative } from "node:path";
import { Glob } from "bun";
import { Node, type ObjectLiteralExpression, type Project } from "ts-morph";
import { compareCodepoint, finishFile, table } from "./agent-docs-shared";

const RULE_FILE_GLOBS = [
  "packages/framework/src/engine/boot-validator/*-rules.ts",
  "packages/bundled-features/src/*/boot-rules.ts",
];
const RULE_TABLE_TYPE = "BootRuleTable";
const RULE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;
const RULE_FIELDS = ["id", "summary", "fix"] as const;

type DocumentedRule = {
  readonly id: string;
  readonly summary: string;
  readonly fix: string;
  readonly source: string;
};

// Must match bootRuleDocLink in packages/framework/src/engine/boot-validator/boot-rule.ts.
function anchorOf(ruleId: string): string {
  return ruleId.replaceAll("/", "-");
}

function literalText(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

function readRule(source: string, key: string, rule: Node): DocumentedRule {
  if (!Node.isObjectLiteralExpression(rule)) {
    throw new Error(`${source}: rule "${key}" must be an object literal`);
  }
  const values = RULE_FIELDS.map((field) => {
    const property = rule.getProperty(field);
    const text = Node.isPropertyAssignment(property)
      ? literalText(property.getInitializer())
      : undefined;
    if (text === undefined) {
      throw new Error(
        `${source}: rule "${key}" property "${field}" must be a plain string literal`,
      );
    }
    return text;
  });
  const [id = "", summary = "", fix = ""] = values;
  if (!RULE_ID_RE.test(id)) {
    throw new Error(`${source}: rule "${key}" has id "${id}" which does not match ${RULE_ID_RE}`);
  }
  return { id, summary, fix, source };
}

function tableLiteralOf(initializer: Node | undefined): ObjectLiteralExpression | undefined {
  if (initializer === undefined || !Node.isSatisfiesExpression(initializer)) return undefined;
  if (initializer.getTypeNode()?.getText() !== RULE_TABLE_TYPE) return undefined;
  const inner = initializer.getExpression();
  const unwrapped = Node.isAsExpression(inner) ? inner.getExpression() : inner;
  return Node.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
}

function readRulesOfFile(project: Project, repoRoot: string, absPath: string): DocumentedRule[] {
  const source = relative(repoRoot, absPath).split("\\").join("/");
  const rules: DocumentedRule[] = [];
  for (const declaration of project.addSourceFileAtPath(absPath).getVariableDeclarations()) {
    if (!declaration.isExported()) continue;
    const literal = tableLiteralOf(declaration.getInitializer());
    if (literal === undefined) continue;
    for (const property of literal.getProperties()) {
      if (!Node.isPropertyAssignment(property)) {
        throw new Error(`${source}: ${declaration.getName()} may only hold plain properties`);
      }
      const initializer = property.getInitializer();
      if (initializer === undefined) continue;
      rules.push(readRule(source, property.getName(), initializer));
    }
  }
  return rules;
}

function ruleFilesOf(repoRoot: string): string[] {
  const found = new Set<string>();
  for (const pattern of RULE_FILE_GLOBS) {
    for (const rel of new Glob(pattern).scanSync({ cwd: repoRoot, onlyFiles: true })) {
      found.add(`${repoRoot}/${rel}`);
    }
  }
  return [...found].sort(compareCodepoint);
}

function assertUnique(rules: readonly DocumentedRule[]): void {
  const idSources = new Map<string, string>();
  const anchorIds = new Map<string, string>();
  for (const rule of rules) {
    const knownSource = idSources.get(rule.id);
    if (knownSource !== undefined) {
      throw new Error(`Duplicate boot rule id "${rule.id}" in ${rule.source} and ${knownSource}`);
    }
    idSources.set(rule.id, rule.source);
    const anchor = anchorOf(rule.id);
    const knownId = anchorIds.get(anchor);
    if (knownId !== undefined) {
      throw new Error(`Boot rule ids "${rule.id}" and "${knownId}" share the anchor "${anchor}"`);
    }
    anchorIds.set(anchor, rule.id);
  }
}

// Ids are validated against RULE_ID_RE, so the anchor cannot carry markup.
function ruleCell(ruleId: string): string {
  return ['<a id="', anchorOf(ruleId), '"></a>`', ruleId, "`"].join("");
}

const INTRO = [
  "`validateBoot` reports every violation as `- [<id>] <message>`, followed by a `Fix:` and a `Rule:` line that links the entry below.",
  "Violations with an `unclassified/<check>` id have no entry yet.",
  "`kumiko-schema validate --json` returns the same ids.",
].join(" ");

export function renderBootRules(repoRoot: string, project: Project): string {
  const rules = ruleFilesOf(repoRoot).flatMap((file) => readRulesOfFile(project, repoRoot, file));
  assertUnique(rules);
  const source = "boot rule tables (`*-rules.ts`, `boot-rules.ts`)";
  if (rules.length === 0) {
    return finishFile(source, `# Boot rules\n\n${INTRO}\n\nNo boot rules are registered yet.`);
  }
  const byArea = new Map<string, DocumentedRule[]>();
  for (const rule of rules) {
    const area = rule.id.split("/", 1)[0] ?? rule.id;
    byArea.set(area, [...(byArea.get(area) ?? []), rule]);
  }
  const sections = [...byArea.keys()].sort(compareCodepoint).map((area) => {
    const rows = (byArea.get(area) ?? [])
      .sort((left, right) => compareCodepoint(left.id, right.id))
      .map((rule) => [ruleCell(rule.id), rule.summary, rule.fix, `\`${rule.source}\``]);
    return `## ${area}\n\n${table(["Rule", "Summary", "Fix", "Source"], rows)}`;
  });
  return finishFile(source, `# Boot rules\n\n${INTRO}\n\n${sections.join("\n\n")}`);
}
