import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_CONFIG_FILE } from "@cosmicdrift/kumiko-framework/config";
import { type Node, type ObjectLiteralExpression, Project, SyntaxKind } from "ts-morph";

const RUNNER_NAMES: ReadonlySet<string> = new Set(["runProdApp", "runDevApp", "runWorkerApp"]);
const BUNDLED_LISTS = "bundledLists";

function parseSource(fileName: string, source: string) {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  return project.createSourceFile(fileName, source);
}

function declaresProperty(object: ObjectLiteralExpression, name: string): boolean {
  return object.getProperties().some((property) => {
    if (property.isKind(SyntaxKind.ShorthandPropertyAssignment)) return property.getName() === name;
    if (property.isKind(SyntaxKind.PropertyAssignment)) {
      return property.getName().replace(/^["']|["']$/g, "") === name;
    }
    return false;
  });
}

function hasSpread(object: ObjectLiteralExpression): boolean {
  return object.getProperties().some((property) => property.isKind(SyntaxKind.SpreadAssignment));
}

function firstObjectArgument(args: readonly Node[]): ObjectLiteralExpression | undefined {
  const first = args[0];
  return first?.isKind(SyntaxKind.ObjectLiteralExpression) ? first : undefined;
}

function configDeclaresBundledLists(source: string): boolean {
  const call = parseSource(APP_CONFIG_FILE, source)
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((candidate) => candidate.getExpression().getText() === "defineAppConfig");
  const config = call === undefined ? undefined : firstObjectArgument(call.getArguments());
  return config !== undefined && declaresProperty(config, BUNDLED_LISTS);
}

function runnersWithoutBundledLists(fileName: string, source: string): readonly string[] {
  return parseSource(fileName, source)
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .flatMap((call) => {
      const runner = call.getExpression().getText();
      if (!RUNNER_NAMES.has(runner)) return [];
      const options = firstObjectArgument(call.getArguments());
      // A spread may carry the key; the static check cannot see into it.
      if (options === undefined || declaresProperty(options, BUNDLED_LISTS) || hasSpread(options)) {
        return [];
      }
      return [runner];
    });
}

/**
 * `bundledLists` lives in kumiko.config.ts for the schema tooling and in the runner options for
 * the running app. A runner call in bin/ that leaves it out would serve other screens than
 * `kumiko check` validates.
 */
export function findBundledListsWiringErrors(appRoot: string): readonly string[] {
  const configPath = join(appRoot, APP_CONFIG_FILE);
  if (!existsSync(configPath) || !configDeclaresBundledLists(readFileSync(configPath, "utf-8"))) {
    return [];
  }
  const binDir = join(appRoot, "bin");
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .flatMap((name) =>
      runnersWithoutBundledLists(name, readFileSync(join(binDir, name), "utf-8")).map(
        (runner) =>
          `bin/${name}: ${runner}() does not pass bundledLists although ${APP_CONFIG_FILE} sets it. Add \`bundledLists: appConfig.bundledLists\` to the runner options, otherwise the app serves other screens than \`kumiko check\` validates.`,
      ),
    );
}
