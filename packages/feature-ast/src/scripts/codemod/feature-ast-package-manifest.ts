import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectIndent, isSortedKeys, isStringRecord, type SiteLists } from "./codemod-support.ts";
import { BUILD_AND_VENDOR_DIR_NAMES } from "./collect-source-files.ts";

const FRAMEWORK_PACKAGE = "@cosmicdrift/kumiko-framework";
const NEW_PACKAGE = "@cosmicdrift/kumiko-feature-ast";
const DEPENDENCY_BLOCKS = ["dependencies", "devDependencies", "peerDependencies"] as const;
const SOURCE_FILE = /\.tsx?$/;

type SourceProbe = (source: string, filePath: string) => boolean;

function packageUsesFeatureAst(packageDir: string, probe: SourceProbe): boolean {
  for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
    const path = join(packageDir, entry.name);
    if (entry.isDirectory()) {
      const isNestedPackage = existsSync(join(path, "package.json"));
      if (BUILD_AND_VENDOR_DIR_NAMES.includes(entry.name) || isNestedPackage) continue;
      if (packageUsesFeatureAst(path, probe)) return true;
    } else if (SOURCE_FILE.test(entry.name) && probe(readFileSync(path, "utf8"), path)) {
      return true;
    }
  }
  return false;
}

function withFeatureAst(block: Record<string, string>, range: string): Record<string, string> {
  const entries = { ...block, [NEW_PACKAGE]: range };
  return isSortedKeys(block)
    ? Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
    : entries;
}

function isOptionalFrameworkPeer(meta: unknown): meta is object {
  if (typeof meta !== "object" || meta === null) return false;
  const framework: unknown = Reflect.get(meta, FRAMEWORK_PACKAGE);
  return (
    typeof framework === "object" &&
    framework !== null &&
    Reflect.get(framework, "optional") === true
  );
}

function mirrorOptionalPeer(record: Record<string, unknown>): void {
  const meta = record["peerDependenciesMeta"];
  if (isOptionalFrameworkPeer(meta)) {
    record["peerDependenciesMeta"] = { ...meta, [NEW_PACKAGE]: { optional: true } };
  }
}

// Every block that declares framework needs the entry: a devDependencies-only add would leave
// the published package (peerDependencies) without it.
function addFeatureAstDependency(record: Record<string, unknown>): string[] {
  const alreadyDeclared = DEPENDENCY_BLOCKS.some((name) => {
    const block = record[name];
    return isStringRecord(block) && NEW_PACKAGE in block;
  });
  if (alreadyDeclared) return [];
  const touched: string[] = [];
  for (const name of DEPENDENCY_BLOCKS) {
    const block = record[name];
    const range = isStringRecord(block) ? block[FRAMEWORK_PACKAGE] : undefined;
    if (!isStringRecord(block) || range === undefined) continue;
    record[name] = withFeatureAst(block, range);
    touched.push(name);
    if (name === "peerDependencies") mirrorOptionalPeer(record);
  }
  return touched;
}

export function transformPackageJson(
  source: string,
  filePath: string,
  result: SiteLists,
  probe: SourceProbe,
): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch {
    result.manual.push({ file: filePath, line: 1, description: "package.json is not valid JSON" });
    return source;
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return source;
  const record: Record<string, unknown> = { ...manifest };
  if (!packageUsesFeatureAst(dirname(filePath), probe)) return source;
  const touched = addFeatureAstDependency(record);
  if (touched.length === 0) return source;
  result.rewrites.push({
    file: filePath,
    line: 1,
    description: `${touched.join(", ")}: ${NEW_PACKAGE} added`,
  });
  return `${JSON.stringify(record, null, detectIndent(source))}${source.endsWith("\n") ? "\n" : ""}`;
}
