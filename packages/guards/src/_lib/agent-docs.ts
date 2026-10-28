import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type ExportedDeclarations, type JSDocableNode, Node, type Project } from "ts-morph";
import { renderApiDocs } from "./agent-docs-api";
import { renderFeatureDocs } from "./agent-docs-features";
import {
  compareCodepoint,
  createAgentDocsProject,
  finishFile,
  firstSentence,
  isRecord,
  parseJsonFile,
  table,
} from "./agent-docs-shared";

export const AGENT_DOCS_DIR = "packages/framework/agents";

const RENDERER_WEB_INDEX_REL = "packages/renderer/src/web/index.ts";
const RECIPES_REL = "samples/recipes";
const RECIPE_SLUG_RE = /^[a-z0-9-]+$/;
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

type WidgetGroup = "Components" | "Hooks" | "Functions" | "Constants" | "Classes";
const WIDGET_GROUP_ORDER: readonly WidgetGroup[] = [
  "Components",
  "Hooks",
  "Functions",
  "Constants",
  "Classes",
];

const HOOK_NAME_RE = /^use[A-Z]/;
const PASCAL_CASE_RE = /^[A-Z][A-Za-z0-9]*$/;

function isFunctionLike(node: Node | undefined): boolean {
  return node !== undefined && (Node.isArrowFunction(node) || Node.isFunctionExpression(node));
}

function isPascalCaseComponentName(name: string): boolean {
  return PASCAL_CASE_RE.test(name) && /[a-z]/.test(name);
}

function widgetGroupOf(name: string, declaration: ExportedDeclarations): WidgetGroup | undefined {
  if (Node.isClassDeclaration(declaration)) return "Classes";
  if (Node.isEnumDeclaration(declaration)) return "Constants";
  const isFunction = Node.isFunctionDeclaration(declaration);
  const isVariable = Node.isVariableDeclaration(declaration);
  if (!isFunction && !isVariable) return undefined;
  if (HOOK_NAME_RE.test(name)) return "Hooks";
  if (isPascalCaseComponentName(name)) return "Components";
  if (isFunction || isFunctionLike(declaration.getInitializer())) return "Functions";
  return "Constants";
}

function jsDocOwnerOf(declaration: ExportedDeclarations): JSDocableNode | undefined {
  if (Node.isVariableDeclaration(declaration)) return declaration.getVariableStatement();
  return Node.isJSDocable(declaration) ? declaration : undefined;
}

function descriptionOf(declarations: readonly ExportedDeclarations[]): string {
  for (const declaration of declarations) {
    const docs = jsDocOwnerOf(declaration)?.getJsDocs() ?? [];
    const description = docs.at(-1)?.getDescription() ?? "";
    if (description.trim() !== "") return firstSentence(description);
  }
  return "";
}

function renderWidgets(repoRoot: string, project: Project): string {
  const indexFile = project.addSourceFileAtPath(join(repoRoot, RENDERER_WEB_INDEX_REL));
  const grouped = new Map<WidgetGroup, [string, string][]>(
    WIDGET_GROUP_ORDER.map((group) => [group, []]),
  );
  for (const [name, declarations] of indexFile.getExportedDeclarations()) {
    const group = declarations
      .map((declaration) => widgetGroupOf(name, declaration))
      .find((candidate) => candidate !== undefined);
    if (group === undefined) continue;
    grouped.get(group)?.push([name, descriptionOf(declarations)]);
  }
  const sections: string[] = [];
  for (const group of WIDGET_GROUP_ORDER) {
    const entries = (grouped.get(group) ?? []).sort(([left], [right]) =>
      compareCodepoint(left, right),
    );
    if (entries.length === 0) continue;
    const rows = entries.map(([name, description]) => [`\`${name}\``, description]);
    sections.push(`## ${group}\n\n${table(["Name", "Description"], rows)}`);
  }
  const intro = "Value exports of `@cosmicdrift/kumiko-renderer/web`.";
  return finishFile(RENDERER_WEB_INDEX_REL, `# Widgets\n\n${intro}\n\n${sections.join("\n\n")}`);
}

type Recipe = {
  readonly slug: string;
  readonly dir: string;
  readonly description: string;
};

function readRecipes(repoRoot: string): readonly Recipe[] {
  const recipesDir = join(repoRoot, RECIPES_REL);
  if (!existsSync(recipesDir)) return [];
  const recipes: Recipe[] = [];
  for (const entry of readdirSync(recipesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(recipesDir, entry.name);
    const packageJsonPath = join(dir, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    if (!RECIPE_SLUG_RE.test(entry.name)) {
      throw new Error(
        `${RECIPES_REL}/${entry.name}: recipe directory must match ${RECIPE_SLUG_RE}`,
      );
    }
    const parsed = parseJsonFile(
      `${RECIPES_REL}/${entry.name}/package.json`,
      readFileSync(packageJsonPath, "utf-8"),
    );
    const description = isRecord(parsed) ? parsed["description"] : undefined;
    recipes.push({
      slug: entry.name,
      dir,
      description: typeof description === "string" ? description : "",
    });
  }
  return recipes.sort((left, right) => compareCodepoint(left.slug, right.slug));
}

function renderExamplesIndex(recipes: readonly Recipe[]): string {
  const rows = recipes.map((recipe) => [
    `\`${recipe.slug}\``,
    recipe.description,
    `\`examples/${recipe.slug}.md\``,
  ]);
  return finishFile(
    `${RECIPES_REL}/*/package.json`,
    `# Examples\n\n${table(["Example", "Description", "File"], rows)}`,
  );
}

const RECIPE_SKIPPED_DIRS = new Set(["node_modules", "screenshots", "dist"]);
const GENERATED_FILE = /\.generated\./;

function listSourceFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!RECIPE_SKIPPED_DIRS.has(entry.name))
        found.push(...listSourceFiles(join(dir, entry.name), rel));
    } else if (
      SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) &&
      !GENERATED_FILE.test(entry.name)
    ) {
      found.push(rel);
    }
  }
  return found.sort(compareCodepoint);
}

function fenceFor(content: string): string {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function renderRecipe(recipe: Recipe): string {
  const parts = [`# ${recipe.slug}`];
  if (recipe.description !== "") parts.push(recipe.description);
  const readmePath = join(recipe.dir, "README.md");
  if (existsSync(readmePath)) {
    parts.push(`## README\n\n${readFileSync(readmePath, "utf-8").replace(/\r\n/g, "\n").trim()}`);
  }
  const sourceBlocks = listSourceFiles(recipe.dir).map((rel) => {
    const content = readFileSync(join(recipe.dir, rel), "utf-8").replace(/\r\n/g, "\n").trimEnd();
    const fence = fenceFor(content);
    const language = rel.endsWith(".tsx") ? "tsx" : "ts";
    return `### ${rel}\n\n${fence}${language}\n${content}\n${fence}`;
  });
  if (sourceBlocks.length > 0) parts.push(`## Source files\n\n${sourceBlocks.join("\n\n")}`);
  return finishFile(`${RECIPES_REL}/${recipe.slug}`, parts.join("\n\n"));
}

export function renderAgentDocs(repoRoot: string): ReadonlyMap<string, string> {
  const recipes = readRecipes(repoRoot);
  const project = createAgentDocsProject(repoRoot);
  const featureDocs = renderFeatureDocs(repoRoot);
  const files = new Map<string, string>();
  files.set("features-index.md", featureDocs.featuresIndex);
  files.set("features.md", featureDocs.features);
  files.set("widgets.md", renderWidgets(repoRoot, project));
  for (const [rel, content] of renderApiDocs(repoRoot, project)) files.set(rel, content);
  files.set("examples.md", renderExamplesIndex(recipes));
  for (const recipe of recipes) files.set(`examples/${recipe.slug}.md`, renderRecipe(recipe));
  return files;
}

function listFilesRecursive(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listFilesRecursive(join(dir, entry.name), rel));
    else found.push(rel);
  }
  return found.sort(compareCodepoint);
}

export function readAgentDocsOnDisk(repoRoot: string): ReadonlyMap<string, string> {
  const dir = join(repoRoot, AGENT_DOCS_DIR);
  return new Map(
    listFilesRecursive(dir).map((rel) => [rel, readFileSync(join(dir, rel), "utf-8")]),
  );
}

function removeEmptyDirs(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(join(dir, entry.name));
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

export function writeAgentDocs(repoRoot: string): number {
  const outDir = join(repoRoot, AGENT_DOCS_DIR);
  const files = renderAgentDocs(repoRoot);
  for (const [rel, content] of files) {
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
  }
  for (const rel of listFilesRecursive(outDir)) {
    if (!files.has(rel)) unlinkSync(join(outDir, rel));
  }
  if (existsSync(outDir) && statSync(outDir).isDirectory()) removeEmptyDirs(outDir);
  return files.size;
}
