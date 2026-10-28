function packageJson(name: string, subpaths: Readonly<Record<string, string>>): string {
  const exportsField = Object.fromEntries(
    Object.entries(subpaths).map(([subpath, types]) => [subpath, { types, default: types }]),
  );
  return JSON.stringify({ name, exports: exportsField });
}

export const FRAMEWORK_ENGINE_FIXTURE_PATH = "packages/framework/src/engine/index.ts";

export const ENGINE_FIXTURE_SOURCE = [
  'export type { ListColumnSpec } from "./columns.ts";',
  "",
  "/** Options of a demo screen. Second sentence is dropped. */",
  "export type DemoScreenOptions = {",
  "  readonly id: string;",
  "  /** Columns shown in the list. */",
  "  readonly columns?: readonly ListColumnSpec[];",
  '  readonly density: "compact" | "comfortable";',
  "  // Line comment that must not leak into the signature.",
  "  readonly nested: { readonly size?: Sizing };",
  "  /** @internal */",
  "  readonly secretHook?: HiddenHook;",
  "};",
  "",
  "/** @internal */",
  "export type InternalOnly = { readonly x: number };",
  "",
  "type Sizing = { readonly width: number };",
  "type HiddenHook = { readonly run: () => void };",
  "",
  "/** Builds a demo screen. */",
  "export function defineDemoScreen(options: DemoScreenOptions): DemoScreenOptions {",
  "  return options;",
  "}",
  "",
  'export const DemoRoles = { admin: "Admin", user: "User", owner: "Owner", reader: "Reader", writer: "Writer", auditor: "Auditor", operator: "Operator" } as const;',
  "",
].join("\n");

export const API_ENTRY_FIXTURE_FILES: Readonly<Record<string, string>> = {
  "packages/framework/package.json": packageJson("@cosmicdrift/kumiko-framework", {
    "./engine": "./src/engine/index.ts",
    "./errors": "./src/errors/index.ts",
    "./ui-types": "./src/ui-types/index.ts",
    "./db": "./src/db/index.ts",
    "./event-store": "./src/event-store/index.ts",
    "./seeding": "./src/seeding/index.ts",
  }),
  [FRAMEWORK_ENGINE_FIXTURE_PATH]: ENGINE_FIXTURE_SOURCE,
  "packages/framework/src/engine/columns.ts":
    "/** One list column. */\nexport type ListColumnSpec = { readonly field: string };\n",
  "packages/framework/src/errors/index.ts": "export {};\n",
  "packages/framework/src/ui-types/index.ts":
    'export type { DemoScreenOptions } from "../engine/index.ts";\n',
  "packages/framework/src/db/index.ts": "export {};\n",
  "packages/framework/src/event-store/index.ts": "export {};\n",
  "packages/framework/src/seeding/index.ts": "export {};\n",
  "packages/renderer/package.json": packageJson("@cosmicdrift/kumiko-renderer", {
    "./web": "./src/web/index.ts",
  }),
  "packages/testing/package.json": packageJson("@cosmicdrift/kumiko-testing", {
    "./stack": "./src/stack/index.ts",
    "./helpers": "./src/helpers/index.ts",
  }),
  "packages/testing/src/stack/index.ts": "export {};\n",
  "packages/testing/src/helpers/index.ts": "export {};\n",
  "packages/dev-server/package.json": packageJson("@cosmicdrift/kumiko-dev-server", {
    "./testing": "./src/testing.ts",
  }),
  "packages/dev-server/src/testing.ts": "export {};\n",
};
