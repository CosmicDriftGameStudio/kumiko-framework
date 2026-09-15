import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import {
  findGlobalUserWritesMissingMembershipCheck,
  findMembershipMintsMissingStrip,
  findOverrideHandlersMissingHelper,
  findRoleInputHandlers,
  findUntestedRoleHandlers,
} from "../guard-tenant-escalation";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

const roleHandler = (name: string, schemaBody: string): string => `
declare function defineWriteHandler(cfg: unknown): unknown;
declare const z: any;
export const h = defineWriteHandler({
	name: "${name}",
	schema: z.object({ ${schemaBody} }),
	access: { roles: ["SystemAdmin"] },
	handler: async () => ({ isSuccess: true, data: {} }),
});
`;

describe("Check A: role-input handlers need an escalation test", () => {
  test("flags a role-input handler with no escalation test", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/add.write.ts": roleHandler(
        "addMember",
        "userId: z.string(), roles: z.array(z.string())",
      ),
    });
    expect(findUntestedRoleHandlers(sfs).map((h) => h.name)).toEqual(["addMember"]);
  });

  test("passes when a test references the handler name + a reserved role", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/add.write.ts": roleHandler(
        "addMember",
        "userId: z.string(), roles: z.array(z.string())",
      ),
      "/r/packages/bundled-features/src/foo/__tests__/foo.integration.test.ts": `
				test("addMember rejects reserved roles", () => { void "SystemAdmin"; void "addMember"; });
			`,
    });
    expect(findUntestedRoleHandlers(sfs)).toHaveLength(0);
  });

  test("matches a colon-named handler via its last segment (user:create → create)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/user/handlers/create.write.ts": roleHandler(
        "user:create",
        "email: z.string(), roles: z.array(z.string())",
      ),
      "/r/packages/bundled-features/src/auth/__tests__/multi-roles.integration.test.ts": `
				test("create blocks reserved roles", () => { void UserHandlers.create; void "SystemAdmin"; });
			`,
    });
    expect(findUntestedRoleHandlers(sfs)).toHaveLength(0);
  });

  test("a raw substring in an unrelated test does NOT count as coverage (word-boundary regression)", () => {
    // Regression fuer die weak-name-match-Klasse des Original-Incidents:
    // vorher matchte t.includes(f) jede Test-Datei die zufaellig
    // "createTestStack()" (enthaelt Substring "create") UND irgendwo
    // "SystemAdmin" erwaehnt — ohne dass ein einziger Test die Kombination
    // tatsaechlich prueft. \bcreate\b darf das nicht mehr als Coverage zaehlen.
    const sfs = files({
      "/r/packages/bundled-features/src/user/handlers/create.write.ts": roleHandler(
        "user:create",
        "email: z.string(), roles: z.array(z.string())",
      ),
      "/r/packages/bundled-features/src/unrelated/__tests__/admin.integration.test.ts": `
				const stack = createTestStack();
				test("some unrelated admin check", () => { void "SystemAdmin"; void stack; });
			`,
    });
    expect(findUntestedRoleHandlers(sfs).map((h) => h.name)).toEqual(["user:create"]);
  });

  test("a test without a reserved-role literal does not count as coverage", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/add.write.ts": roleHandler(
        "addMember",
        "roles: z.array(z.string())",
      ),
      "/r/packages/bundled-features/src/foo/__tests__/foo.test.ts": `
				test("addMember happy path", () => { void "addMember"; void "Admin"; });
			`,
    });
    expect(findUntestedRoleHandlers(sfs)).toHaveLength(1);
  });

  test("ignores write handlers without a role/roles field", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/x.write.ts": roleHandler(
        "setThing",
        "title: z.string(), body: z.string()",
      ),
    });
    expect(findRoleInputHandlers(sfs)).toHaveLength(0);
  });

  test("resolves an outlined schema const (schema: FooSchema shape, #1556-adjacent)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/add.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare const z: any;
const AddMemberSchema = z.object({ userId: z.string(), roles: z.array(z.string()) });
export const h = defineWriteHandler({
	name: "addMember",
	schema: AddMemberSchema,
	access: { roles: ["SystemAdmin"] },
	handler: async () => ({ isSuccess: true, data: {} }),
});
`,
    });
    expect(findRoleInputHandlers(sfs).map((h) => h.name)).toEqual(["addMember"]);
  });
});

describe("Check B: tenantIdOverride needs crossTenantOverrideDenied", () => {
  const overrideHandler = (usesHelper: boolean): string => `
declare function defineWriteHandler(cfg: unknown): unknown;
declare const z: any;
declare function writeFailure(e: unknown): unknown;
${usesHelper ? "declare function crossTenantOverrideDenied(...a: unknown[]): unknown;" : ""}
export const h = defineWriteHandler({
	name: "set",
	schema: z.object({ slug: z.string(), tenantIdOverride: z.string().min(1).optional() }),
	access: { roles: ["TenantAdmin", "SystemAdmin"] },
	handler: async (event: any) => {
		${usesHelper ? 'const d = crossTenantOverrideDenied(event.user, event.payload.tenantIdOverride, "k"); if (d) return writeFailure(d);' : ""}
		return { isSuccess: true, data: {} };
	},
});
`;

  test("flags a tenantIdOverride handler that skips the helper", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/set.write.ts": overrideHandler(false),
    });
    expect(findOverrideHandlersMissingHelper(sfs)).toHaveLength(1);
  });

  test("passes when the handler calls crossTenantOverrideDenied", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/set.write.ts": overrideHandler(true),
    });
    expect(findOverrideHandlersMissingHelper(sfs)).toHaveLength(0);
  });

  test("ignores handlers without a tenantIdOverride field", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/plain.write.ts": roleHandler(
        "plain",
        "slug: z.string()",
      ),
    });
    expect(findOverrideHandlersMissingHelper(sfs)).toHaveLength(0);
  });

  test("flags the unsafe handler when a file has two tenantIdOverride handlers, only one calling the helper (regression: first-match break used to pass the whole file)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/two.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare const z: any;
declare function writeFailure(e: unknown): unknown;
declare function crossTenantOverrideDenied(...a: unknown[]): unknown;
export const safe = defineWriteHandler({
	name: "safeSet",
	schema: z.object({ slug: z.string(), tenantIdOverride: z.string().min(1).optional() }),
	access: { roles: ["TenantAdmin", "SystemAdmin"] },
	handler: async (event: any) => {
		const d = crossTenantOverrideDenied(event.user, event.payload.tenantIdOverride, "k");
		if (d) return writeFailure(d);
		return { isSuccess: true, data: {} };
	},
});
export const unsafe = defineWriteHandler({
	name: "unsafeSet",
	schema: z.object({ slug: z.string(), tenantIdOverride: z.string().min(1).optional() }),
	access: { roles: ["TenantAdmin", "SystemAdmin"] },
	handler: async () => {
		return { isSuccess: true, data: {} };
	},
});
`,
    });
    const findings = findOverrideHandlersMissingHelper(sfs);
    expect(findings).toHaveLength(1);
  });
});

describe("Check C: membership-derived JWT mints must strip reserved roles", () => {
  const mergeMint = (strip: boolean): string => `
${strip ? "declare const stripForbiddenMembershipRoles: (r: readonly string[]) => readonly string[];" : ""}
declare const globalRoles: string[];
declare const chosen: { roles: string[]; tenantId: string };
declare const found: { id: string };
type SessionUser = { id: string; tenantId: string; roles: readonly string[] };
const mergedRoles = Array.from(
	new Set([...globalRoles, ...${strip ? "stripForbiddenMembershipRoles(chosen.roles)" : "chosen.roles"}]),
);
const baseSession: SessionUser = { id: found.id, tenantId: chosen.tenantId, roles: mergedRoles };
`;

  test("flags a membership merge mint that skips the strip", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/auth/handlers/login.write.ts": mergeMint(false),
    });
    expect(findMembershipMintsMissingStrip(sfs)).toHaveLength(1);
  });

  test("passes when the mint calls stripForbiddenMembershipRoles", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/auth/handlers/login.write.ts": mergeMint(true),
    });
    expect(findMembershipMintsMissingStrip(sfs)).toHaveLength(0);
  });

  test("flags an auth-session result minted from invitationRole without strip", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/auth/handlers/invite.write.ts": `
				declare const invitationRole: string;
				declare const userId: string;
				declare const invitationTenantId: string;
				const r = { kind: "auth-session" as const, session: { id: userId, tenantId: invitationTenantId, roles: [invitationRole] } };
			`,
    });
    expect(findMembershipMintsMissingStrip(sfs)).toHaveLength(1);
  });

  test("ignores a constant-role mint (no membership source — signup-confirm shape)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/auth/handlers/signup-confirm.write.ts": `
				declare const INITIAL_SIGNUP_ROLES: readonly string[];
				declare const provisioned: { userId: string; tenantId: string };
				type SessionUser = { id: string; tenantId: string; roles: readonly string[] };
				const session: SessionUser = { id: provisioned.userId, tenantId: provisioned.tenantId, roles: [...INITIAL_SIGNUP_ROLES] };
			`,
    });
    expect(findMembershipMintsMissingStrip(sfs)).toHaveLength(0);
  });

  test("ignores reconstructing a session from JWT claims (payload.roles, not membership)", () => {
    const sfs = files({
      "/r/packages/framework/src/api/auth-middleware.ts": `
				declare const payload: { id: string; tenantId: string; roles: string[] };
				type SessionUser = { id: string; tenantId: string; roles: readonly string[] };
				const user: SessionUser = { id: payload.id, tenantId: payload.tenantId, roles: payload.roles };
			`,
    });
    expect(findMembershipMintsMissingStrip(sfs)).toHaveLength(0);
  });

  test("ignores test files", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/auth/__tests__/login.test.ts": mergeMint(false),
    });
    expect(findMembershipMintsMissingStrip(sfs)).toHaveLength(0);
  });
});

describe("Check D: TenantAdmin ctx.db.raw user writes need a membership check", () => {
  const userWrite = (opts: {
    gated: boolean;
    roles?: string;
    schema?: string;
    raw?: boolean;
  }): string => `
declare function defineWriteHandler(cfg: unknown): unknown;
declare function fetchOne(...a: unknown[]): Promise<unknown>;
declare function isSystemAdminActor(u: unknown): boolean;
declare const access: { admin: string[]; systemAdmin: string[] };
declare const tenantMembershipsTable: unknown;
declare const userTable: unknown;
declare const z: any;
export const h = defineWriteHandler({
	name: "restrict-account",
	schema: z.object({ ${opts.schema ?? "userId: z.string().uuid()"} }),
	access: { roles: ${opts.roles ?? "access.admin"} },
	handler: async (event: any, ctx: any) => {
		${opts.gated ? "if (!isSystemAdminActor(event.user)) { await fetchOne(ctx.db.raw, tenantMembershipsTable, { userId: event.payload.userId, tenantId: event.user.tenantId }); }" : ""}
		await fetchOne(${opts.raw === false ? "ctx.db" : "ctx.db.raw"}, userTable, { id: event.payload.userId });
		return { isSuccess: true, data: {} };
	},
});
`;

  test("flags an ungated handler even when `name` is a non-literal expression (factory-built, toggle-enabled.write.ts shape) — name is fallback-labeled, not a skip precondition", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/tenant/handlers/toggle-enabled.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare function fetchOne(...a: unknown[]): Promise<unknown>;
declare const access: { admin: string[] };
declare const userTable: unknown;
declare const z: any;
declare const enable: boolean;
export const h = defineWriteHandler({
	name: enable ? "enable" : "disable",
	schema: z.object({ userId: z.string().uuid() }),
	access: { roles: access.admin },
	handler: async (event: any, ctx: any) => {
		await fetchOne(ctx.db.raw, userTable, { id: event.payload.userId });
		return { isSuccess: true, data: {} };
	},
});
`,
    });
    const found = findGlobalUserWritesMissingMembershipCheck(sfs);
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("toggle-enabled.write.ts");
  });

  test("flags the ungated handler (#1556 shape)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/user-data-rights/handlers/restrict-account.write.ts":
        userWrite({ gated: false }),
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs).map((g) => g.name)).toEqual([
      "restrict-account",
    ]);
  });

  test("passes with the lift-restriction membership gate", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/user-data-rights/handlers/lift-restriction.write.ts":
        userWrite({ gated: true }),
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
  });

  test("passes when gated via denyIfTargetOutsideAdminTenant helper (return value consumed, real lift-restriction.write.ts shape)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/user-data-rights/handlers/lift-restriction.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare function fetchOne(...a: unknown[]): Promise<unknown>;
declare function denyIfTargetOutsideAdminTenant(...a: unknown[]): Promise<unknown>;
declare const access: { admin: string[] };
declare const userTable: unknown;
declare const z: any;
export const h = defineWriteHandler({
	name: "lift-restriction",
	schema: z.object({ userId: z.string().uuid() }),
	access: { roles: access.admin },
	handler: async (event: any, ctx: any) => {
		const outside = await denyIfTargetOutsideAdminTenant(ctx.db.raw, event.user, event.payload.userId);
		if (outside) return outside;
		await fetchOne(ctx.db.raw, userTable, { id: event.payload.userId });
		return { isSuccess: true, data: {} };
	},
});
`,
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
  });

  test("flags a bare denyIfTargetOutsideAdminTenant call whose return value is never consumed (silent no-op gate)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/user-data-rights/handlers/restrict-account.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare function fetchOne(...a: unknown[]): Promise<unknown>;
declare function denyIfTargetOutsideAdminTenant(...a: unknown[]): Promise<unknown>;
declare const access: { admin: string[] };
declare const userTable: unknown;
declare const z: any;
export const h = defineWriteHandler({
	name: "restrict-account",
	schema: z.object({ userId: z.string().uuid() }),
	access: { roles: access.admin },
	handler: async (event: any, ctx: any) => {
		await denyIfTargetOutsideAdminTenant(event, ctx);
		await fetchOne(ctx.db.raw, userTable, { id: event.payload.userId });
		return { isSuccess: true, data: {} };
	},
});
`,
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs).map((g) => g.name)).toEqual([
      "restrict-account",
    ]);
  });

  test.each(["access.systemAdmin", "access.system", "access.privileged"])(
    "ignores platform-wide-only handlers (%s) — no tenant to cross",
    (roles) => {
      const sfs = files({
        "/r/packages/bundled-features/src/sessions/handlers/revoke.write.ts": userWrite({
          gated: false,
          roles,
        }),
      });
      expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
    },
  );

  // The real #1556 handler is openToAll with a runtime isAdminActor() gate,
  // not access.admin — keying the check on the access preset alone would have
  // missed the very bug it exists for.
  test("flags an openToAll handler with a payload userId (real #1556 shape)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/user-data-rights/handlers/restrict-account.write.ts":
        userWrite({ gated: false, roles: "undefined, openToAll: true" }),
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(1);
  });

  test("ignores handlers that stay inside the tenant-filtered ctx.db", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/scoped.write.ts": userWrite({
        gated: false,
        raw: false,
      }),
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
  });

  test("ignores a handler with no access property at all (deny-all — engine/access.ts treats undefined access as unreachable)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/orphaned.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare function fetchOne(...a: unknown[]): Promise<unknown>;
declare const userTable: unknown;
declare const z: any;
export const h = defineWriteHandler({
	name: "orphaned",
	schema: z.object({ userId: z.string().uuid() }),
	handler: async (event: any, ctx: any) => {
		await fetchOne(ctx.db.raw, userTable, { id: event.payload.userId });
		return { isSuccess: true, data: {} };
	},
});
`,
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
  });

  test("ignores handlers that don't target another user by id", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/self.write.ts": userWrite({
        gated: false,
        schema: "reason: z.string()",
      }),
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
  });

  test("flags only the ungated one when a file holds both handlers", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/handlers/pair.write.ts": `
${userWrite({ gated: true })}
${userWrite({ gated: false }).replace("export const h =", "export const h2 =")}
`,
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(1);
  });

  test("ignores test files", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/__tests__/restrict.test.ts": userWrite({
        gated: false,
      }),
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
  });

  test("ignores a ctx.db.raw read against an unrelated global table (not a user-row read, real cancel-invitation.write.ts shape)", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/user-data-rights/handlers/cancel-invitation.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare function fetchOne(...a: unknown[]): Promise<unknown>;
declare const access: { admin: string[] };
declare const tenantInvitationsTable: unknown;
declare const z: any;
export const h = defineWriteHandler({
	name: "cancel-invitation",
	schema: z.object({ invitationId: z.string(), userId: z.string().uuid() }),
	access: { roles: access.admin },
	handler: async (event: any, ctx: any) => {
		await fetchOne(ctx.db.raw, tenantInvitationsTable, { id: event.payload.invitationId });
		return { isSuccess: true, data: {} };
	},
});
`,
    });
    expect(findGlobalUserWritesMissingMembershipCheck(sfs)).toHaveLength(0);
  });
});
