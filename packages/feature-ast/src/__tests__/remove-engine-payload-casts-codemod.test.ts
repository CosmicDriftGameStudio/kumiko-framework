import { describe, expect, it } from "bun:test";
import { Project, ts } from "ts-morph";
import { transformEnginePayloadCastsSource } from "../scripts/codemod/remove-engine-payload-casts.ts";

// The codemod recognises executor reads by the declaring file name, so the fixture project
// carries its own minimal copy of that declaration instead of the real framework types.
const EXECUTOR_TYPES = `
export type EventStoreExecutor<Row extends Record<string, unknown> = Record<string, unknown>> = {
  detail(query: { id: string }): Promise<Row | null>;
  list(query: { limit: number }): Promise<{ rows: Row[] }>;
};
`;

function createFixtureProject(): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      noUncheckedIndexedAccess: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
  project.createSourceFile("/lib/event-store-executor-types.ts", EXECUTOR_TYPES);
  return project;
}

const PRELUDE = `
import type { EventStoreExecutor } from "./lib/event-store-executor-types.ts";
type TicketRow = { readonly id: string; readonly title: string; readonly count: number | null };
declare const typed: EventStoreExecutor<TicketRow>;
declare const untyped: EventStoreExecutor;
`;

function transform(body: string) {
  return transformEnginePayloadCastsSource(
    `${PRELUDE}${body}`,
    "/fixture.ts",
    createFixtureProject(),
  );
}

function outputBody(body: string): string {
  return transform(body).output.slice(PRELUDE.length);
}

describe("remove-engine-payload-casts codemod", () => {
  it("removes a field cast on a typed row together with its marker comment", () => {
    const body = `
export async function run(): Promise<string> {
  const row = await typed.detail({ id: "1" });
  if (!row) return "";
  const title = row["title"] as string; // @cast-boundary engine-payload
  return title;
}
`;
    const result = transform(body);
    expect(result.output.slice(PRELUDE.length)).toBe(`
export async function run(): Promise<string> {
  const row = await typed.detail({ id: "1" });
  if (!row) return "";
  const title = row["title"];
  return title;
}
`);
    expect(result.rewrites).toHaveLength(1);
    expect(result.manual).toHaveLength(0);
  });

  it("removes a double cast on a direct read and a whole-row cast through a variable", () => {
    const output = outputBody(`
export async function run(): Promise<TicketRow | null> {
  const direct = (await typed.detail({ id: "1" })) as unknown as TicketRow | null;
  const row = await typed.detail({ id: "2" });
  return direct ?? (row as TicketRow | null);
}
`);
    expect(output).toContain(`const direct = (await typed.detail({ id: "1" }));`);
    expect(output).toContain(`return direct ?? (row);`);
    expect(output).not.toContain(" as ");
  });

  it("removes a cast on a list row reached through rows[0] and a nullish fallback", () => {
    const output = outputBody(`
export async function run(): Promise<string> {
  const page = await typed.list({ limit: 1 });
  const first = page.rows[0];
  return (first?.title ?? "") as string;
}
`);
    expect(output).toContain(`return (first?.title ?? "");`);
  });

  it("keeps a cast the row type does not satisfy and reports it as manual", () => {
    const body = `
export async function run(): Promise<number> {
  const row = await typed.detail({ id: "1" });
  if (!row) return 0;
  return row["count"] as number; // @cast-boundary engine-payload
}
`;
    const result = transform(body);
    expect(result.output.slice(PRELUDE.length)).toBe(body);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.description).toContain("not assignable");
  });

  it("keeps casts on an untyped executor, whose rows are Record<string, unknown>", () => {
    const body = `
export async function run(): Promise<string> {
  const row = await untyped.detail({ id: "1" });
  if (!row) return "";
  return row["title"] as string;
}
`;
    const result = transform(body);
    expect(result.output.slice(PRELUDE.length)).toBe(body);
    expect(result.manual).toHaveLength(1);
  });

  it("ignores casts on values that do not come from an executor read, and as const", () => {
    const body = `
declare const other: { detail(query: { id: string }): Promise<{ title: unknown }> };
export async function run(): Promise<unknown[]> {
  const foreign = await other.detail({ id: "1" });
  const asConst = { kind: "x" } as const;
  return [foreign.title as string, asConst];
}
`;
    const result = transform(body);
    expect(result.output.slice(PRELUDE.length)).toBe(body);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(0);
  });

  it("leaves the marker when another cast stays in the same statement", () => {
    const output = outputBody(`
export async function run(raw: unknown): Promise<string> {
  const row = await typed.detail({ id: "1" });
  if (!row) return "";
  return \`\${row["title"] as string}\${raw as string}\`; // @cast-boundary engine-payload
}
`);
    expect(output).toContain("@cast-boundary engine-payload");
    expect(output).toContain(`\${row["title"]}`);
    expect(output).toContain(`\${raw as string}`);
  });

  it("removes a marker comment line above the statement", () => {
    const output = outputBody(`
export async function run(): Promise<string> {
  const row = await typed.detail({ id: "1" });
  if (!row) return "";
  // @cast-boundary engine-payload
  const title = row["title"] as string;
  return title;
}
`);
    expect(output).not.toContain("@cast-boundary");
    expect(output).toContain(`const title = row["title"];`);
  });

  it("leaves the file untouched when removing a widening cast would add a type error", () => {
    const body = `
export async function run(): Promise<void> {
  const row = await typed.detail({ id: "1" });
  if (!row) return;
  const widened = row as { title: string | number };
  widened.title = 5;
}
`;
    const result = transform(body);
    expect(result.output.slice(PRELUDE.length)).toBe(body);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual[0]?.description).toContain("adds type errors");
  });

  it("is a no-op for a file without executor reads", () => {
    const source = `export const x = 1 as number;\n`;
    expect(transformEnginePayloadCastsSource(source, "/plain.ts", createFixtureProject())).toEqual({
      output: source,
      rewrites: [],
      manual: [],
    });
  });
});
