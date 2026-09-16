import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { applySecurityBaseline, type SecurityBaselineLoad } from "../_lib/security-baseline";
import {
  createEscapeHatchGuard,
  findEscapeHatchFindings,
  findGenericReasonCalls,
  systemScopeDirs,
} from "../guard-escape-hatch-declared";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

const RAW_HANDLER = `
declare const ctx: { db: { raw: unknown } };
export async function handler() {
	return ctx.db.raw;
}
`;

describe("R1: raw-outside-system-scope", () => {
  test("flags ctx.db.raw outside systemScope", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": RAW_HANDLER,
    });
    const found = findEscapeHatchFindings(sfs, "/r");
    expect(found.map((f) => f.rule)).toEqual(["raw-outside-system-scope"]);
  });

  test("passes when the handler's feature dir calls r.systemScope()", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/feature.ts": `
declare const r: { systemScope(): void };
r.systemScope();
`,
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": RAW_HANDLER,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("flags a var alias (const db = ctx.db; db.raw)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { db: { raw: unknown } };
const db = ctx.db;
export const x = db.raw;
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "raw-outside-system-scope",
    ]);
  });

  test("flags a destructured alias (const { db } = ctx; db.raw)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { db: { raw: unknown } };
const { db } = ctx;
export const x = db.raw;
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "raw-outside-system-scope",
    ]);
  });

  test("ignores a destructured alias from a non-ctx-named variable (const { db } = config; db.raw)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const config: { db: { raw: unknown } };
const { db } = config;
export const x = db.raw;
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test('flags element access (ctx["db"].raw)', () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { db: { raw: unknown } };
export const x = ctx["db"].raw;
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "raw-outside-system-scope",
    ]);
  });

  test("ignores test files", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/__tests__/x.test.ts": RAW_HANDLER,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });
});

describe("R2: unsafe-raw-outside-system-scope", () => {
  const UNSAFE_RAW = `
declare const ctx: { systemDb: { unsafeRaw: (reason: string) => unknown } };
export const x = ctx.systemDb.unsafeRaw("cleanup of orphaned rows");
`;

  test("flags ctx.systemDb.unsafeRaw outside systemScope", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": UNSAFE_RAW,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("passes inside systemScope", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/feature.ts": `
declare const r: { systemScope(): void };
r.systemScope();
`,
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": UNSAFE_RAW,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });
});

describe("R3: system-identity-outside-declared-scope", () => {
  test("flags queryAs(systemUser, ...) inside a hook (no escapeHatch)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/hooks.ts": `
declare const t: unknown;
declare const systemUser: unknown;
declare const r: { hook(name: string, t: unknown, fn: (ctx: any) => unknown): void };
r.hook("postSave", t, async (ctx: any) => {
	await ctx.queryAs(systemUser, "qn", {});
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "system-identity-outside-declared-scope",
    ]);
  });

  test("passes in a .job.ts file", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/cleanup.job.ts": `
declare const ctx: { queryAs: (...a: unknown[]) => unknown };
declare const systemUser: unknown;
export const run = async () => { await ctx.queryAs(systemUser, "qn", {}); };
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("passes inside r.job(...)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const r: { job(name: string, opts: unknown, fn: (ctx: any) => unknown): void };
declare const systemUser: unknown;
r.job("n", {}, async (ctx: any) => {
	await ctx.queryAs(systemUser, "qn", {});
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("passes with a declared escapeHatch on the handler", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare function createSystemUser(t: unknown): unknown;
declare const t: unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "batch revoke needs system identity" },
	handler: async (e: unknown, ctx: any) => {
		await ctx.writeAs(createSystemUser(t), "qn", {});
	},
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("flags an alias to createSystemUser with no declared scope", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function createSystemUser(t: unknown): unknown;
declare const t: unknown;
declare const ctx: { writeAs: (...a: unknown[]) => unknown };
const writer = createSystemUser(t);
export const run = async () => { await ctx.writeAs(writer, "qn", {}); };
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "system-identity-outside-declared-scope",
    ]);
  });

  test("ignores queryAs(event.user, ...) — not a system identity", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { queryAs: (...a: unknown[]) => unknown };
declare const event: { user: unknown };
export const run = async () => { await ctx.queryAs(event.user, "qn", {}); };
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });
});

describe("R4: generic-reason (findGenericReasonCalls)", () => {
  test.each(["", "todo", "legacy"])("flags acknowledgeCrossTenant(%p)", (reason) => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { systemDb: { acknowledgeCrossTenant: (reason: string) => unknown } };
export const a = ctx.systemDb.acknowledgeCrossTenant(${JSON.stringify(reason)});
`,
    });
    expect(findGenericReasonCalls(sfs, "/r")).toHaveLength(1);
  });

  test("fires even inside systemScope", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/feature.ts": `
declare const r: { systemScope(): void };
r.systemScope();
`,
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { systemDb: { acknowledgeCrossTenant: (reason: string) => unknown } };
export const a = ctx.systemDb.acknowledgeCrossTenant("todo");
`,
    });
    expect(findGenericReasonCalls(sfs, "/r")).toHaveLength(1);
  });

  test("passes a concrete reason", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { systemDb: { acknowledgeCrossTenant: (reason: string) => unknown } };
export const a = ctx.systemDb.acknowledgeCrossTenant("SystemAdmin lists tenants platform-wide");
`,
    });
    expect(findGenericReasonCalls(sfs, "/r")).toHaveLength(0);
  });

  test("ignores a template literal with a substitution (not statically judgeable)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ctx: { systemDb: { acknowledgeCrossTenant: (reason: string) => unknown } };
declare const why: string;
export const a = ctx.systemDb.acknowledgeCrossTenant(\`reason: \${why}\`);
`,
    });
    expect(findGenericReasonCalls(sfs, "/r")).toHaveLength(0);
  });

  test("flags a placeholder escapeHatch reason", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "todo" },
	handler: async () => ({ isSuccess: true, data: {} }),
});
`,
    });
    const found = findGenericReasonCalls(sfs, "/r");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/uses a placeholder reason/);
  });

  test("leaves an empty escapeHatch reason to the boot validator (no double-check)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "" },
	handler: async () => ({ isSuccess: true, data: {} }),
});
`,
    });
    expect(findGenericReasonCalls(sfs, "/r")).toHaveLength(0);
  });

  test("passes a concrete escapeHatch reason", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "batch revoke needs system identity" },
	handler: async () => ({ isSuccess: true, data: {} }),
});
`,
    });
    expect(findGenericReasonCalls(sfs, "/r")).toHaveLength(0);
  });
});

describe("R5: unsafe-all-tenants-outside-declared-scope", () => {
  test("flags ctx.queryProjection(name, { unsafeAllTenants: true }) outside a declared scope", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare const ctx: { queryProjection: (name: string, opts: unknown) => unknown };
export const run = async () => ctx.queryProjection("proj", { unsafeAllTenants: true });
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-all-tenants-outside-declared-scope",
    ]);
  });

  test("passes when unsafeAllTenants is called inside a handler function that declares escapeHatch", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "cross-tenant cleanup batch" },
	handler: async (e: unknown, ctx: any) => ctx.queryProjection("proj", { unsafeAllTenants: true }),
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("passes when unsafeAllTenants is called inside r.hook(fn, { escapeHatch })", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/hooks.write.ts": `
declare const t: unknown;
declare const r: { hook(name: string, t: unknown, fn: (ctx: any) => unknown, opts?: unknown): void };
r.hook(
	"postSave",
	t,
	async (ctx: any) => {
		await ctx.queryProjection("proj", { unsafeAllTenants: true });
	},
	{ escapeHatch: { reason: "cross-tenant cleanup batch" } },
);
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("defineProjectionQueryHandler with unsafeAllTenants+escapeHatch in the same object passes; without escapeHatch it flags", () => {
    const withHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare function defineProjectionQueryHandler(name: string, proj: unknown, cfg: unknown): unknown;
export const h = defineProjectionQueryHandler("proj", {}, {
	access: {},
	unsafeAllTenants: true,
	escapeHatch: { reason: "cross-tenant billing rollup" },
});
`,
    });
    expect(findEscapeHatchFindings(withHatch, "/r")).toHaveLength(0);

    const withoutHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare function defineProjectionQueryHandler(name: string, proj: unknown, cfg: unknown): unknown;
export const h = defineProjectionQueryHandler("proj", {}, {
	access: {},
	unsafeAllTenants: true,
});
`,
    });
    expect(findEscapeHatchFindings(withoutHatch, "/r").map((f) => f.rule)).toEqual([
      "unsafe-all-tenants-outside-declared-scope",
    ]);
  });

  test("flags r.step.read.findMany(name, { table, unsafeAllTenants: { reason } }) inside a handler without escapeHatch", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	handler: async (e: unknown, r: any) =>
		r.step.read.findMany("table", {
			table: "t",
			unsafeAllTenants: { reason: "cross-tenant aggregate for billing report" },
		}),
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-all-tenants-outside-declared-scope",
    ]);
  });

  test("ignores unsafeAllTenants: false and an identifier value", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare const ctx: { queryProjection: (name: string, opts: unknown) => unknown };
declare const dynamic: boolean;
export const a = ctx.queryProjection("proj", { unsafeAllTenants: false });
export const b = ctx.queryProjection("proj2", { unsafeAllTenants: dynamic });
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("passes inside systemScope and inside a .job.ts file", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/feature.ts": `
declare const r: { systemScope(): void };
r.systemScope();
`,
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare const ctx: { queryProjection: (name: string, opts: unknown) => unknown };
export const a = ctx.queryProjection("proj", { unsafeAllTenants: true });
`,
      "/r/packages/bundled-features/src/bar/handlers/cleanup.job.ts": `
declare const ctx: { queryProjection: (name: string, opts: unknown) => unknown };
export const run = async () => ctx.queryProjection("proj", { unsafeAllTenants: true });
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("ignores unsafeAllTenants when the option object is assigned to a variable or wrapped in a ternary", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare const ctx: { queryProjection: (name: string, opts: unknown) => unknown };
declare const cond: boolean;
const o = { unsafeAllTenants: true };
export const a = ctx.queryProjection("proj", o);
export const b = ctx.queryProjection("proj2", cond ? { unsafeAllTenants: true } : {});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("flags a placeholder unsafeAllTenants reason (R4 extension)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare function defineProjectionQueryHandler(name: string, proj: unknown, cfg: unknown): unknown;
export const h = defineProjectionQueryHandler("proj", {}, {
	access: {},
	unsafeAllTenants: { reason: "todo" },
});
`,
    });
    const found = findGenericReasonCalls(sfs, "/r");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/uses a placeholder reason/);
  });
});

describe("escapeHatch declaration (Weg A)", () => {
  test("hook with options escapeHatch clears unsafeRaw inside it", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/hooks.write.ts": `
declare const t: unknown;
declare const r: { hook(name: string, t: unknown, fn: (ctx: any) => unknown, opts?: unknown): void };
r.hook(
	"postSave",
	t,
	async (ctx: any) => {
		await ctx.systemDb.unsafeRaw("cleanup of orphaned invite rows");
	},
	{ escapeHatch: { reason: "cleanup of orphaned invite rows" } },
);
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("same hook without escapeHatch options flags unsafeRaw", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/hooks.write.ts": `
declare const t: unknown;
declare const r: { hook(name: string, t: unknown, fn: (ctx: any) => unknown, opts?: unknown): void };
r.hook(
	"postSave",
	t,
	async (ctx: any) => {
		await ctx.systemDb.unsafeRaw("cleanup of orphaned invite rows");
	},
);
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("exact tier-engine postSave hook pattern clears both unsafeRaw and generic-reason findings", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/tier-engine/feature.ts": `
declare const r: { hook(type: string, target: unknown, fn: (result: unknown, ctx: any) => unknown, opts?: unknown): void };
declare const HookPhases: { inTransaction: string };
const autoDefaultTierHookReason = "creates the default tier row for a newly created tenant";
r.hook(
	"postSave",
	{ allOf: "tenant" },
	async (result, ctx) => {
		const rawDb = ctx.systemDb
			? ctx.systemDb.unsafeRaw(autoDefaultTierHookReason)
			: ctx.db && "unsafeRaw" in ctx.db
				? ctx.db.unsafeRaw(autoDefaultTierHookReason)
				: undefined;
		return rawDb;
	},
	{ phase: HookPhases.inTransaction, escapeHatch: { reason: autoDefaultTierHookReason } },
);
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
    expect(findGenericReasonCalls(sfs, "/r")).toHaveLength(0);
  });

  test("defineWriteHandler with escapeHatch clears unsafeRaw in its handler; without escapeHatch flags it", () => {
    const withHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "batch revoke needs a raw cleanup pass" },
	handler: async (e: unknown, ctx: any) => ctx.db.unsafeRaw("batch revoke needs a raw cleanup pass"),
});
`,
    });
    expect(findEscapeHatchFindings(withHatch, "/r")).toHaveLength(0);

    const withoutHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	handler: async (e: unknown, ctx: any) => ctx.db.unsafeRaw("batch revoke needs a raw cleanup pass"),
});
`,
    });
    expect(findEscapeHatchFindings(withoutHatch, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("ctx.dbOutsideTransaction.unsafeRaw inside a handler with escapeHatch clears", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "reindex needs the pre-transaction connection" },
	handler: async (e: unknown, ctx: any) =>
		ctx.dbOutsideTransaction.unsafeRaw("reindex needs the pre-transaction connection"),
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("two handlers in one file: only the one without escapeHatch is flagged", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const a = defineWriteHandler({
	escapeHatch: { reason: "handler A cleanup reason text" },
	handler: async (e: unknown, ctx: any) => ({ ok: true }),
});
export const b = defineWriteHandler({
	handler: async (e: unknown, ctx: any) => ctx.db.unsafeRaw("handler B cleanup reason text"),
});
`,
    });
    const found = findEscapeHatchFindings(sfs, "/r");
    expect(found.map((f) => f.rule)).toEqual(["unsafe-raw-outside-system-scope"]);
    expect(found[0]?.line).toBe(8);
  });

  test("feature-wide outer object with escapeHatch does not cover a nested handler without its own escapeHatch", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/feature.ts": `
declare function defineFeature(cfg: unknown): unknown;
declare function defineWriteHandler(cfg: unknown): unknown;
export const feature = defineFeature({
	escapeHatch: { reason: "feature-wide cleanup reason text" },
	handlers: [
		defineWriteHandler({
			handler: async (e: unknown, ctx: any) => ctx.db.unsafeRaw("x reason text"),
		}),
	],
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("a call in a different property than handler on the same object is not covered", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "preload cleanup reason text" },
	handler: async (e: unknown, ctx: any) => 1,
	preload: async (ctx: any) => ctx.db.unsafeRaw("preload cleanup reason text"),
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("a function referenced by variable is not covered even when assigned as handler", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
const fn = async (e: unknown, ctx: any) => ctx.db.unsafeRaw("referenced handler reason text");
export const h = defineWriteHandler({
	escapeHatch: { reason: "referenced handler reason text" },
	handler: fn,
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("r.hook with a referenced function argument is not covered", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/hooks.write.ts": `
declare const t: unknown;
declare const r: { hook(name: string, t: unknown, fn: (ctx: any) => unknown, opts?: unknown): void };
const fn = async (ctx: any) => ctx.systemDb.unsafeRaw("referenced hook reason text");
r.hook("postSave", t, fn, { escapeHatch: { reason: "referenced hook reason text" } });
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("spread options with escapeHatch is not covered", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/hooks.write.ts": `
declare const t: unknown;
declare const r: { hook(name: string, t: unknown, fn: (ctx: any) => unknown, opts?: unknown): void };
const opts = { escapeHatch: { reason: "spread hook reason text" } };
r.hook("postSave", t, async (ctx: any) => ctx.db.unsafeRaw("spread hook reason text"), { ...opts });
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("escapeHatch: undefined on the handler is not covered", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: undefined,
	handler: async (e: unknown, ctx: any) => ctx.db.unsafeRaw("undefined escapeHatch reason text"),
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("a conditional escapeHatch value of two object literals is covered", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const cond: boolean;
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: cond ? { reason: "conditional reason branch one" } : { reason: "conditional reason branch two" },
	handler: async (e: unknown, ctx: any) => ctx.db.unsafeRaw("conditional reason branch text"),
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("a nested closure inside a handler with escapeHatch is covered", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const ids: string[];
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "nested closure cleanup reason text" },
	handler: async (e: unknown, ctx: any) => {
		await Promise.all(ids.map(async () => ctx.db.unsafeRaw("nested closure cleanup reason text")));
	},
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("defineQueryHandler with escapeHatch clears queryAs(system); without it flags", () => {
    const withHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare function defineQueryHandler(cfg: unknown): unknown;
declare const SYSTEM_USER: unknown;
export const h = defineQueryHandler({
	escapeHatch: { reason: "system-wide tenant listing reason text" },
	handler: async (q: unknown, ctx: any) => ctx.queryAs(SYSTEM_USER, "qn", {}),
});
`,
    });
    expect(findEscapeHatchFindings(withHatch, "/r")).toHaveLength(0);

    const withoutHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.query.ts": `
declare function defineQueryHandler(cfg: unknown): unknown;
declare const SYSTEM_USER: unknown;
export const h = defineQueryHandler({
	handler: async (q: unknown, ctx: any) => ctx.queryAs(SYSTEM_USER, "qn", {}),
});
`,
    });
    expect(findEscapeHatchFindings(withoutHatch, "/r").map((f) => f.rule)).toEqual([
      "system-identity-outside-declared-scope",
    ]);
  });

  test("defineStreamHandler object form with escapeHatch clears queryAs(system); without it flags", () => {
    const withHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.stream.ts": `
declare function defineStreamHandler(cfg: unknown): unknown;
declare const SYSTEM_USER: unknown;
export const h = defineStreamHandler({
	escapeHatch: { reason: "system-wide tenant stream reason text" },
	handler: async function* (q: unknown, ctx: any) {
		yield await ctx.queryAs(SYSTEM_USER, "qn", {});
	},
});
`,
    });
    expect(findEscapeHatchFindings(withHatch, "/r")).toHaveLength(0);

    const withoutHatch = files({
      "/r/packages/bundled-features/src/foo/handlers/x.stream.ts": `
declare function defineStreamHandler(cfg: unknown): unknown;
declare const SYSTEM_USER: unknown;
export const h = defineStreamHandler({
	handler: async function* (q: unknown, ctx: any) {
		yield await ctx.queryAs(SYSTEM_USER, "qn", {});
	},
});
`,
    });
    expect(findEscapeHatchFindings(withoutHatch, "/r").map((f) => f.rule)).toEqual([
      "system-identity-outside-declared-scope",
    ]);
  });

  test("positional r.streamHandler with escapeHatch options clears queryAs(system)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.stream.ts": `
declare const schema: unknown;
declare const r: {
	streamHandler(
		name: string,
		schema: unknown,
		fn: (q: unknown, ctx: any) => AsyncGenerator<unknown>,
		opts?: unknown,
	): void;
};
declare const SYSTEM_USER: unknown;
r.streamHandler(
	"n",
	schema,
	async function* (q: unknown, ctx: any) {
		yield await ctx.queryAs(SYSTEM_USER, "qn", {});
	},
	{ access: {}, escapeHatch: { reason: "positional stream handler reason text" } },
);
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("positional r.writeHandler with escapeHatch options clears unsafeRaw", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare const schema: unknown;
declare const r: {
	writeHandler(
		name: string,
		schema: unknown,
		fn: (e: unknown, ctx: any) => unknown,
		opts?: unknown,
	): void;
};
r.writeHandler(
	"n",
	schema,
	async (e: unknown, ctx: any) => ctx.db.unsafeRaw("positional write handler reason text"),
	{ access: {}, escapeHatch: { reason: "positional write handler reason text" } },
);
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("ctx.db.raw inside a handler with escapeHatch is still flagged (R1 unchanged)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	escapeHatch: { reason: "raw escape still flagged reason text" },
	handler: async (e: unknown, ctx: any) => ctx.db.raw,
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "raw-outside-system-scope",
    ]);
  });

  test("r.useExtension hook with escapeHatch in the options object clears unsafeRaw", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/wire-user-data.ts": `
declare const r: {
	useExtension(ext: string, entityName: string, opts: unknown): void;
};
declare const EXT_USER_DATA: string;
r.useExtension(EXT_USER_DATA, "entity", {
	export: async (ctx: any) => ctx.db.unsafeRaw("extension export needs a raw cross-tenant read"),
	escapeHatch: { reason: "extension export needs a raw cross-tenant read" },
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r")).toHaveLength(0);
  });

  test("r.useExtension hook without escapeHatch in the options object flags unsafeRaw", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/wire-user-data.ts": `
declare const r: {
	useExtension(ext: string, entityName: string, opts: unknown): void;
};
declare const EXT_USER_DATA: string;
r.useExtension(EXT_USER_DATA, "entity", {
	export: async (ctx: any) => ctx.db.unsafeRaw("extension export needs a raw cross-tenant read"),
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });

  test("the same options-object-with-escapeHatch shape passed to a non-useExtension call is not covered", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/wire-user-data.ts": `
declare const r: {
	somethingElse(ext: string, entityName: string, opts: unknown): void;
};
declare const EXT_USER_DATA: string;
r.somethingElse(EXT_USER_DATA, "entity", {
	export: async (ctx: any) => ctx.db.unsafeRaw("extension export needs a raw cross-tenant read"),
	escapeHatch: { reason: "extension export needs a raw cross-tenant read" },
});
`,
    });
    expect(findEscapeHatchFindings(sfs, "/r").map((f) => f.rule)).toEqual([
      "unsafe-raw-outside-system-scope",
    ]);
  });
});

describe("systemScopeDirs", () => {
  test("ignores systemScope() calls with an argument", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/feature.ts": `
declare const r: { systemScope(x?: unknown): void };
r.systemScope("x");
`,
    });
    expect(systemScopeDirs(sfs)).toHaveLength(0);
  });
});

describe("guard.run (unified security-baseline mechanism)", () => {
  const REL_FILE = "packages/bundled-features/src/foo/handlers/x.write.ts";

  test("R1-3/deprecated findings carry no neverFrozen; the placeholder-reason finding does", () => {
    const sfs = files({
      [`/r/${REL_FILE}`]: `
declare const ctx: { db: { raw: unknown }; systemDb: { acknowledgeCrossTenant: (reason: string) => unknown } };
export const a = ctx.db.raw;
export const b = ctx.systemDb.acknowledgeCrossTenant("todo");
`,
    });
    const guard = createEscapeHatchGuard({ root: "/r" });
    const outcome = guard.run(sfs);
    expect(outcome.violations).toHaveLength(2);
    const raw = outcome.violations.find((v) => v.message.includes("ctx.db.raw"));
    const placeholder = outcome.violations.find((v) => v.message.includes("placeholder reason"));
    expect(raw?.neverFrozen).toBeUndefined();
    expect(placeholder?.neverFrozen).toBe(true);
  });

  test("sibling findings outside root are reported too", () => {
    const sfs = files({
      "/r/b/packages/bundled-features/src/foo/handlers/x.write.ts": RAW_HANDLER,
    });
    const guard = createEscapeHatchGuard({ root: "/r/a" });
    const outcome = guard.run(sfs);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.file).toBe(`../b/${REL_FILE}`);
  });
});

describe("applySecurityBaseline end-to-end via createEscapeHatchGuard", () => {
  let root: { readonly name: string; readonly absPath: string };
  let guard: ReturnType<typeof createEscapeHatchGuard>;
  beforeEach(() => {
    root = {
      name: "framework",
      absPath: mkdtempSync(path.join(tmpdir(), "escape-hatch-e2e-")),
    };
    guard = createEscapeHatchGuard({ root: root.absPath });
  });
  afterEach(() => {
    rmSync(root.absPath, { recursive: true, force: true });
  });

  const REL_FILE = "packages/bundled-features/src/foo/handlers/x.write.ts";

  function writeSource(code: string): SourceFile {
    const abs = path.join(root.absPath, REL_FILE);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, code);
    return new Project({ skipAddingFilesFromTsConfig: true }).addSourceFileAtPath(abs);
  }

  function loadFrom(perFile: Record<string, number>): (repo: string) => SecurityBaselineLoad {
    return () => ({
      kind: "ok",
      findings: { "Escape-Hatch-Declared Guard": perFile },
      hardFail: [],
    });
  }

  test("a baseline covering the R1 finding freezes it (not blocking)", () => {
    const sf = writeSource(RAW_HANDLER);
    const outcome = guard.run([sf]);
    const result = applySecurityBaseline({
      guardName: guard.name,
      violations: outcome.violations,
      roots: [root],
      cwd: root.absPath,
      load: loadFrom({ [REL_FILE]: 1 }),
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.frozen).toBe(1);
  });

  test("growth beyond the baseline blocks", () => {
    const sf = writeSource(`
declare const ctx: { db: { raw: unknown } };
export const a = ctx.db.raw;
export const b = ctx.db.raw;
`);
    const outcome = guard.run([sf]);
    const result = applySecurityBaseline({
      guardName: guard.name,
      violations: outcome.violations,
      roots: [root],
      cwd: root.absPath,
      load: loadFrom({ [REL_FILE]: 1 }),
    });
    expect(result.blocking.length).toBeGreaterThan(0);
  });

  test("a placeholder reason blocks even when the baseline lists the file with a high count", () => {
    const sf = writeSource(`
declare const ctx: { systemDb: { acknowledgeCrossTenant: (reason: string) => unknown } };
export const a = ctx.systemDb.acknowledgeCrossTenant("todo");
`);
    const outcome = guard.run([sf]);
    const result = applySecurityBaseline({
      guardName: guard.name,
      violations: outcome.violations,
      roots: [root],
      cwd: root.absPath,
      load: loadFrom({ [REL_FILE]: 100 }),
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.message).toMatch(/placeholder reason/);
    expect(result.frozen).toBe(0);
  });
});
