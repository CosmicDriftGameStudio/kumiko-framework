import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Node, type Project, type SourceFile } from "ts-morph";
import {
  type ApiTypeDeclaration,
  isApiTypeDeclaration,
  isInternalApi,
  referencedTypeNodes,
} from "./agent-docs-api-nodes";
import { renderApiDeclaration } from "./agent-docs-api-render";
import { compareCodepoint, finishFile, isRecord, parseJsonFile, table } from "./agent-docs-shared";

type ApiEntry = { readonly packageDir: string; readonly subpath: string };

const API_ENTRIES: readonly ApiEntry[] = [
  { packageDir: "packages/framework", subpath: "./engine" },
  { packageDir: "packages/framework", subpath: "./errors" },
  { packageDir: "packages/framework", subpath: "./ui-types" },
  { packageDir: "packages/framework", subpath: "./db" },
  { packageDir: "packages/framework", subpath: "./event-store" },
  { packageDir: "packages/framework", subpath: "./seeding" },
  { packageDir: "packages/renderer", subpath: "./web" },
  { packageDir: "packages/testing", subpath: "./stack" },
  { packageDir: "packages/testing", subpath: "./helpers" },
  { packageDir: "packages/dev-server", subpath: "./testing" },
];

// Bundled-feature types stay out of the closure; features.md covers them.
const TYPES_PACKAGE_DIR = "packages/types";
const PACKAGE_SCOPE_PREFIX = "@cosmicdrift/kumiko-";
const TYPES_FILE = "api/types.md";

type ResolvedEntry = {
  readonly importPath: string;
  readonly file: string;
  readonly sourceRel: string;
  readonly sourceFile: SourceFile;
};

function resolveEntry(repoRoot: string, project: Project, entry: ApiEntry): ResolvedEntry {
  const packageJsonRel = `${entry.packageDir}/package.json`;
  const parsed = parseJsonFile(
    packageJsonRel,
    readFileSync(join(repoRoot, packageJsonRel), "utf-8"),
  );
  const name = isRecord(parsed) ? parsed["name"] : undefined;
  const exportsField = isRecord(parsed) ? parsed["exports"] : undefined;
  const target = isRecord(exportsField) ? exportsField[entry.subpath] : undefined;
  const typesPath = isRecord(target) ? target["types"] : undefined;
  if (typeof name !== "string" || typeof typesPath !== "string") {
    throw new Error(`${packageJsonRel}: needs a name and exports["${entry.subpath}"].types`);
  }
  const sourceRel = join(entry.packageDir, typesPath).split(sep).join("/");
  const slug = `${name.replace(PACKAGE_SCOPE_PREFIX, "")}-${entry.subpath.replace(/^\.\//, "").replace(/\//g, "-")}`;
  return {
    importPath: `${name}/${entry.subpath.replace(/^\.\//, "")}`,
    file: `api/${slug}.md`,
    sourceRel,
    sourceFile: project.addSourceFileAtPath(join(repoRoot, sourceRel)),
  };
}

// An unresolved `export … from` silently drops its names from
// getExportedDeclarations(), which would shrink the docs without a signal.
function assertReExportsResolve(entryFiles: readonly SourceFile[]): void {
  const pending = [...entryFiles];
  const visited = new Set<SourceFile>(entryFiles);
  for (let sourceFile = pending.pop(); sourceFile !== undefined; sourceFile = pending.pop()) {
    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier === undefined) continue;
      const target = declaration.getModuleSpecifierSourceFile();
      if (target === undefined) {
        throw new Error(`${sourceFile.getFilePath()}: cannot resolve re-export "${specifier}"`);
      }
      if (!visited.has(target)) {
        visited.add(target);
        pending.push(target);
      }
    }
  }
}

// The tmp dirs of tests and symlinked checkouts reach the same file under two
// paths; comparing real paths keeps the closure filter and module headers stable.
// ts-morph serves the TypeScript lib files from memory, so they have no real path.
function realFilePath(file: SourceFile): string {
  const path = file.getFilePath();
  return existsSync(path) ? realpathSync(path) : path;
}

type ExportGroup = "Functions" | "Constants" | "Classes" | "Types";
const EXPORT_GROUP_ORDER: readonly ExportGroup[] = ["Functions", "Constants", "Classes", "Types"];

function exportGroupOf(node: Node): ExportGroup | undefined {
  if (Node.isFunctionDeclaration(node)) return "Functions";
  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    const isFunction =
      node.getTypeNode() === undefined &&
      initializer !== undefined &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer));
    return isFunction ? "Functions" : "Constants";
  }
  if (Node.isEnumDeclaration(node)) return "Constants";
  if (Node.isClassDeclaration(node)) return "Classes";
  if (Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)) return "Types";
  return undefined;
}

type ExportedApi = { readonly name: string; readonly node: Node; readonly group: ExportGroup };

function publicExportsOf(sourceFile: SourceFile): readonly ExportedApi[] {
  const found: ExportedApi[] = [];
  for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
    for (const node of declarations) {
      const group = exportGroupOf(node);
      if (group !== undefined && !isInternalApi(node)) found.push({ name, node, group });
    }
  }
  return found.sort((left, right) => compareCodepoint(left.name, right.name));
}

function codeBlock(lines: readonly string[]): string {
  return `\`\`\`ts\n${lines.join("\n")}\n\`\`\``;
}

function isInsideInternalMember(node: Node): boolean {
  return node
    .getAncestors()
    .some((ancestor) => !isApiTypeDeclaration(ancestor) && isInternalApi(ancestor));
}

function referencedDeclarations(
  node: Node,
  isRepoSource: (file: SourceFile) => boolean,
): ApiTypeDeclaration[] {
  const found: ApiTypeDeclaration[] = [];
  for (const reference of referencedTypeNodes(node)) {
    if (isInsideInternalMember(reference)) continue;
    const nameNode = Node.isTypeReference(reference)
      ? reference.getTypeName()
      : Node.isExpressionWithTypeArguments(reference)
        ? reference.getExpression()
        : undefined;
    const symbol = nameNode?.getSymbol();
    const target = symbol?.getAliasedSymbol() ?? symbol;
    for (const declaration of target?.getDeclarations() ?? []) {
      if (
        isApiTypeDeclaration(declaration) &&
        !isInternalApi(declaration) &&
        isRepoSource(declaration.getSourceFile())
      ) {
        found.push(declaration);
      }
    }
  }
  return found;
}

function declarationName(node: ApiTypeDeclaration): string {
  return node.getName() ?? "default";
}

export function renderApiDocs(repoRoot: string, project: Project): ReadonlyMap<string, string> {
  const realRoot = realpathSync(repoRoot);
  const closureRoots = [
    ...new Set([...API_ENTRIES.map((entry) => entry.packageDir), TYPES_PACKAGE_DIR]),
  ].map((packageDir) => `${realRoot}/${packageDir}/`);
  const isRepoSource = (file: SourceFile): boolean => {
    const path = realFilePath(file);
    return closureRoots.some((root) => path.startsWith(root)) && !path.includes("/node_modules/");
  };
  const entries = API_ENTRIES.map((entry) => resolveEntry(repoRoot, project, entry));
  assertReExportsResolve(entries.map((entry) => entry.sourceFile));

  const documentedIn = new Map<Node, string>();
  const exportsByEntry = entries.map((entry) => publicExportsOf(entry.sourceFile));
  entries.forEach((entry, index) => {
    for (const exported of exportsByEntry[index] ?? []) {
      if (!documentedIn.has(exported.node)) documentedIn.set(exported.node, entry.file);
    }
  });

  const files = new Map<string, string>();
  const pending: Node[] = [];
  entries.forEach((entry, index) => {
    const grouped = new Map<ExportGroup, string[]>(EXPORT_GROUP_ORDER.map((group) => [group, []]));
    const elsewhere = new Map<string, string[]>();
    for (const exported of exportsByEntry[index] ?? []) {
      const owner = documentedIn.get(exported.node);
      if (owner !== entry.file) {
        const names = elsewhere.get(owner ?? "") ?? [];
        names.push(`\`${exported.name}\``);
        elsewhere.set(owner ?? "", names);
        continue;
      }
      grouped
        .get(exported.group)
        ?.push(...(renderApiDeclaration(exported.name, exported.node) ?? []));
      pending.push(exported.node);
    }
    const sections = EXPORT_GROUP_ORDER.flatMap((group) => {
      const lines = grouped.get(group) ?? [];
      return lines.length === 0 ? [] : [`## ${group}\n\n${codeBlock(lines)}`];
    });
    for (const [owner, names] of [...elsewhere].sort(([a], [b]) => compareCodepoint(a, b))) {
      sections.push(`Also exported here, documented in \`${owner}\`: ${names.join(", ")}`);
    }
    const body = `# ${entry.importPath}\n\nImport from \`${entry.importPath}\`. Types used here but not exported by any entry point are in \`${TYPES_FILE}\`.\n\n${sections.join("\n\n")}`;
    files.set(entry.file, finishFile(entry.sourceRel, body));
  });

  const referenced = new Set<ApiTypeDeclaration>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    for (const declaration of referencedDeclarations(node, isRepoSource)) {
      if (documentedIn.has(declaration) || referenced.has(declaration)) continue;
      referenced.add(declaration);
      pending.push(declaration);
    }
  }
  files.set(TYPES_FILE, renderReferencedTypes(repoRoot, referenced));
  files.set(
    "api.md",
    renderApiIndex(
      entries,
      exportsByEntry.map((list) => list.length),
    ),
  );
  return files;
}

function renderReferencedTypes(
  repoRoot: string,
  referenced: ReadonlySet<ApiTypeDeclaration>,
): string {
  const root = realpathSync(repoRoot);
  const byModule = new Map<string, ApiTypeDeclaration[]>();
  for (const declaration of referenced) {
    const moduleRel = relative(root, realFilePath(declaration.getSourceFile()))
      .split(sep)
      .join("/");
    const list = byModule.get(moduleRel) ?? [];
    list.push(declaration);
    byModule.set(moduleRel, list);
  }
  const sections = [...byModule]
    .sort(([left], [right]) => compareCodepoint(left, right))
    .map(([moduleRel, declarations]) => {
      const lines = declarations
        .sort((left, right) => compareCodepoint(declarationName(left), declarationName(right)))
        .flatMap(
          (declaration) => renderApiDeclaration(declarationName(declaration), declaration) ?? [],
        );
      return `## ${moduleRel}\n\n${codeBlock(lines)}`;
    });
  const intro =
    "Types that appear in the signatures of the entry points but are not exported by any of them. Use them to read option shapes; import only what an entry point exports.";
  return finishFile(
    "the API entry points",
    `# Referenced types\n\n${intro}\n\n${sections.join("\n\n")}`,
  );
}

function renderApiIndex(
  entries: readonly ResolvedEntry[],
  exportCounts: readonly number[],
): string {
  const rows = entries.map((entry, index) => [
    `\`${entry.importPath}\``,
    `\`${entry.file}\``,
    String(exportCounts[index] ?? 0),
  ]);
  const intro = [
    "Public signatures of the entry points an app imports, generated from their sources. Read these instead of `dist/*.d.ts`.",
    "",
    "Format: one line per function or constant, object and options types as property lists (`name?: Type;`), and the first sentence of the doc comment after `//`. Bodies and `@internal` declarations are left out. A type that an entry point uses but does not export is listed in `api/types.md`.",
  ].join("\n");
  return finishFile(
    "package.json exports of the listed entry points",
    `# API reference\n\n${intro}\n\n${table(["Import path", "File", "Exports"], rows)}`,
  );
}
