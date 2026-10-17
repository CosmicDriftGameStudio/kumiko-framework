import { dirname, relative, resolve } from "node:path";

export type OldModule =
  | "stack"
  | "stack-test-users"
  | "stack-other"
  | "testing"
  | "testing-handler-context"
  | "testing-real-providers"
  | "testing-e2e-generator"
  | "testing-other";

export type MoveTargetId =
  | "testing-stack"
  | "testing-helpers"
  | "testing-real-providers"
  | "testing-e2e-generator"
  | "framework-seeding"
  | "framework-engine";

interface MoveTarget {
  readonly packageSpecifier: string;
  readonly sourcePath: string;
  readonly owner: "framework" | "testing";
}

const FRAMEWORK_PACKAGE = "@cosmicdrift/kumiko-framework";
const TESTING_PACKAGE = "@cosmicdrift/kumiko-testing";

const TARGETS: Readonly<Record<MoveTargetId, MoveTarget>> = {
  "testing-stack": {
    packageSpecifier: `${TESTING_PACKAGE}/stack`,
    sourcePath: "packages/testing/src/stack/index",
    owner: "testing",
  },
  "testing-helpers": {
    packageSpecifier: `${TESTING_PACKAGE}/helpers`,
    sourcePath: "packages/testing/src/helpers/index",
    owner: "testing",
  },
  "testing-real-providers": {
    packageSpecifier: `${TESTING_PACKAGE}/helpers/real-providers`,
    sourcePath: "packages/testing/src/helpers/real-providers",
    owner: "testing",
  },
  "testing-e2e-generator": {
    packageSpecifier: `${TESTING_PACKAGE}/helpers/e2e-generator`,
    sourcePath: "packages/testing/src/helpers/e2e-generator",
    owner: "testing",
  },
  "framework-seeding": {
    packageSpecifier: `${FRAMEWORK_PACKAGE}/seeding`,
    sourcePath: "packages/framework/src/seeding/seed-users",
    owner: "framework",
  },
  "framework-engine": {
    packageSpecifier: `${FRAMEWORK_PACKAGE}/engine`,
    sourcePath: "packages/framework/src/engine/bridge-stub",
    owner: "framework",
  },
};

const SEEDING_NAMES: ReadonlySet<string> = new Set([
  "TestUsers",
  "testTenantId",
  "testUserId",
  "createTestUser",
]);
const BRIDGE_STUB_NAME = "bridgeStub";

const PACKAGE_SPECIFIER_MODULES: Readonly<Record<string, OldModule>> = {
  [`${FRAMEWORK_PACKAGE}/stack`]: "stack",
  [`${FRAMEWORK_PACKAGE}/testing`]: "testing",
  [`${FRAMEWORK_PACKAGE}/testing/handler-context`]: "testing-handler-context",
  [`${FRAMEWORK_PACKAGE}/testing/real-providers`]: "testing-real-providers",
  [`${FRAMEWORK_PACKAGE}/testing/e2e-generator`]: "testing-e2e-generator",
};

const FRAMEWORK_SOURCE_DIRS = /\/packages\/framework\/src\/(stack|testing)(?:\/([^/]+))?$/;
const SCRIPT_EXTENSION = /\.(?:js|ts|tsx)$/;

export function classifyPackageSpecifier(specifier: string): OldModule | undefined {
  return PACKAGE_SPECIFIER_MODULES[specifier];
}

function oldTestingModule(file: string | undefined): OldModule {
  if (file === "handler-context") return "testing-handler-context";
  if (file === "real-providers") return "testing-real-providers";
  if (file === "e2e-generator") return "testing-e2e-generator";
  return file === undefined ? "testing" : "testing-other";
}

function oldStackModule(file: string | undefined): OldModule {
  if (file === "test-users") return "stack-test-users";
  return file === undefined ? "stack" : "stack-other";
}

// Path-based on purpose: the old directories no longer exist after the move, so the
// specifier cannot be resolved against the file system.
export function classifyRelativeSpecifier(
  specifier: string,
  importingFile: string,
): OldModule | undefined {
  const resolved = resolve(dirname(importingFile), specifier)
    .replace(SCRIPT_EXTENSION, "")
    .replace(/\/index$/, "");
  const match = FRAMEWORK_SOURCE_DIRS.exec(resolved);
  const directory = match?.[1];
  if (directory === undefined) return undefined;
  const file = match?.[2];
  return directory === "stack" ? oldStackModule(file) : oldTestingModule(file);
}

export function hasSplitNames(old: OldModule): boolean {
  return old === "stack" || old === "testing";
}

export function targetForName(old: OldModule, name: string): MoveTargetId {
  switch (old) {
    case "stack":
      return SEEDING_NAMES.has(name) ? "framework-seeding" : "testing-stack";
    case "stack-test-users":
      return "framework-seeding";
    case "stack-other":
      return "testing-stack";
    case "testing":
      return name === BRIDGE_STUB_NAME ? "framework-engine" : "testing-helpers";
    case "testing-handler-context":
      return "framework-engine";
    case "testing-real-providers":
      return "testing-real-providers";
    case "testing-e2e-generator":
      return "testing-e2e-generator";
    case "testing-other":
      return "testing-helpers";
  }
}

export function mainTarget(old: OldModule): MoveTargetId {
  return targetForName(old, "");
}

const SOURCE_ROOT_MARKERS = {
  framework: "/packages/framework/src/",
  testing: "/packages/testing/src/",
} as const;

function repoRootOf(importingFile: string, owner: MoveTarget["owner"]): string | undefined {
  const index = importingFile.indexOf(SOURCE_ROOT_MARKERS[owner]);
  return index === -1 ? undefined : importingFile.slice(0, index);
}

// Files inside the package that owns the target import it relatively, everyone else
// goes through the package specifier.
export function moduleSpecifierFor(target: MoveTargetId, importingFile: string): string {
  const { owner, sourcePath, packageSpecifier } = TARGETS[target];
  const root = repoRootOf(importingFile, owner);
  if (root === undefined) return packageSpecifier;
  const relativePath = relative(dirname(importingFile), resolve(root, sourcePath));
  return `${relativePath.startsWith(".") ? relativePath : `./${relativePath}`}.js`;
}
