// Reads the ports out of kumiko.config.ts without importing it: importing
// would execute every feature module of the app, and the port registry scans
// sibling apps whose dependencies may not even be installed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_CONFIG_FILE,
  type AppInfraPorts,
  type AppPorts,
  findAppPortProblems,
} from "@cosmicdrift/kumiko-framework/config";
import { type Node, type ObjectLiteralExpression, Project, SyntaxKind } from "ts-morph";

export type StaticAppConfig =
  | { readonly kind: "missing" }
  /** A config without defineAppConfig: the app has not adopted the standard yet. */
  | { readonly kind: "legacy" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "defined"; readonly ports: AppPorts };

const INFRA_KEYS = [
  "postgres",
  "redis",
  "meilisearch",
  "s3",
] as const satisfies readonly (keyof AppInfraPorts)[];

type InfraKey = (typeof INFRA_KEYS)[number];

function isInfraKey(name: string): name is InfraKey {
  return INFRA_KEYS.some((key) => key === name);
}

class StaticConfigError extends Error {}

function propertyName(node: Node): string | undefined {
  if (node.isKind(SyntaxKind.PropertyAssignment)) return node.getName().replace(/^["']|["']$/g, "");
  return undefined;
}

function objectProperty(object: ObjectLiteralExpression, name: string): Node | undefined {
  let found: Node | undefined;
  let opaqueAfterFound = false;
  for (const property of object.getProperties()) {
    if (property.isKind(SyntaxKind.SpreadAssignment)) {
      opaqueAfterFound = true;
    } else if (property.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
      if (property.getName() === name) opaqueAfterFound = true;
    } else if (propertyName(property) === name && property.isKind(SyntaxKind.PropertyAssignment)) {
      found = property.getInitializerOrThrow();
      opaqueAfterFound = false;
    }
  }
  if (opaqueAfterFound) {
    throw new StaticConfigError(
      `${name}: spread and shorthand properties cannot be read statically`,
    );
  }
  return found;
}

function numericLiteral(node: Node | undefined, path: string): number {
  if (node === undefined) throw new StaticConfigError(`${path} is missing`);
  if (!node.isKind(SyntaxKind.NumericLiteral)) {
    throw new StaticConfigError(
      `${path} must be a number literal so tooling can read it, got "${node.getText()}"`,
    );
  }
  return node.getLiteralValue();
}

function objectLiteral(node: Node | undefined, path: string): ObjectLiteralExpression {
  if (node === undefined) throw new StaticConfigError(`${path} is missing`);
  if (!node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    throw new StaticConfigError(`${path} must be an object literal, got "${node.getText()}"`);
  }
  return node;
}

function readInfraPorts(node: Node | undefined): AppInfraPorts | undefined {
  if (node === undefined) return undefined;
  const object = objectLiteral(node, "ports.infra");
  const infra: Partial<Record<InfraKey, number>> = {};
  for (const property of object.getProperties()) {
    const name = propertyName(property);
    if (name === undefined || !isInfraKey(name)) {
      throw new StaticConfigError(
        `ports.infra: unknown entry "${property.getText()}", expected ${INFRA_KEYS.join(", ")}`,
      );
    }
    infra[name] = numericLiteral(objectProperty(object, name), `ports.infra.${name}`);
  }
  return infra;
}

export function parseStaticAppConfig(source: string): StaticAppConfig {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const file = project.createSourceFile(APP_CONFIG_FILE, source);
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((candidate) => candidate.getExpression().getText() === "defineAppConfig");
  if (call === undefined) return { kind: "legacy" };
  try {
    const config = objectLiteral(call.getArguments()[0], "defineAppConfig argument");
    const ports = objectLiteral(objectProperty(config, "ports"), "ports");
    const infra = readInfraPorts(objectProperty(ports, "infra"));
    const parsed: AppPorts = {
      dev: numericLiteral(objectProperty(ports, "dev"), "ports.dev"),
      e2e: numericLiteral(objectProperty(ports, "e2e"), "ports.e2e"),
      ...(infra === undefined ? {} : { infra }),
    };
    const problems = findAppPortProblems(parsed);
    if (problems.length > 0) return { kind: "invalid", message: problems.join("; ") };
    return { kind: "defined", ports: parsed };
  } catch (error) {
    if (error instanceof StaticConfigError) return { kind: "invalid", message: error.message };
    throw error;
  }
}

export function readStaticAppConfig(appRoot: string): StaticAppConfig {
  const path = join(appRoot, APP_CONFIG_FILE);
  if (!existsSync(path)) return { kind: "missing" };
  return parseStaticAppConfig(readFileSync(path, "utf-8"));
}
