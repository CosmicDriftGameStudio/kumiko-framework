import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import {
  findHandlersWithoutAccessDeniedTest,
  findRoleRestrictedWriteHandlers,
  guard,
  testMentionsHandler,
} from "../guard-access-denied-test";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

const writeHandler = (name: string, rolesExpr = '["TenantAdmin"]'): string => `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	name: "${name}",
	access: { roles: ${rolesExpr} },
	handler: async () => ({ isSuccess: true, data: {} }),
});
`;

describe("findRoleRestrictedWriteHandlers", () => {
  test("access: { openToAll: { reason } } is never role-restricted", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/approve.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
export const h = defineWriteHandler({
	name: "approve-invoice",
	access: { openToAll: { reason: "x" } },
	handler: async () => ({}),
});
`,
    });
    expect(findRoleRestrictedWriteHandlers(sfs)).toHaveLength(0);
  });

  test("an anonymous/all role is not restricted", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/approve.write.ts": writeHandler(
        "approve-invoice",
        '["anonymous", "User"]',
      ),
    });
    expect(findRoleRestrictedWriteHandlers(sfs)).toHaveLength(0);
  });

  test("roles: access.all is not restricted", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/approve.write.ts": writeHandler(
        "approve-invoice",
        "access.all",
      ),
    });
    expect(findRoleRestrictedWriteHandlers(sfs)).toHaveLength(0);
  });

  test("defineQueryHandler is not a write handler", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/list.query.ts": `
declare function defineQueryHandler(cfg: unknown): unknown;
export const h = defineQueryHandler({ name: "list-invoices", access: { roles: ["TenantAdmin"] } });
`,
    });
    expect(findRoleRestrictedWriteHandlers(sfs)).toHaveLength(0);
  });

  test("a *.writeHandler call is matched too", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/approve.write.ts": `
declare const r: { writeHandler(cfg: unknown): unknown };
export const h = r.writeHandler({
	name: "approve-invoice",
	access: { roles: ["TenantAdmin"] },
	handler: async () => ({}),
});
`,
    });
    expect(findRoleRestrictedWriteHandlers(sfs).map((h) => h.name)).toEqual(["approve-invoice"]);
  });

  test("a non-literal name is skipped", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/approve.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare const enabled: boolean;
export const h = defineWriteHandler({
	name: enabled ? "approve" : "deny",
	access: { roles: ["TenantAdmin"] },
	handler: async () => ({}),
});
`,
    });
    expect(findRoleRestrictedWriteHandlers(sfs)).toHaveLength(0);
  });

  test("access as a bare identifier (not an object literal) is skipped", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/approve.write.ts": `
declare function defineWriteHandler(cfg: unknown): unknown;
declare const sharedAccess: unknown;
export const h = defineWriteHandler({
	name: "approve-invoice",
	access: sharedAccess,
	handler: async () => ({}),
});
`,
    });
    expect(findRoleRestrictedWriteHandlers(sfs)).toHaveLength(0);
  });
});

describe("testMentionsHandler", () => {
  test("a colon-namespaced short form matches inside a longer colon literal", () => {
    expect(
      testMentionsHandler('void "invoice:write:approve"; expect(x).toBe(403);', "invoice:approve"),
    ).toBe(true);
  });

  test("a short word does not match a mere substring of another identifier", () => {
    expect(testMentionsHandler("approveAll(); expect(x).toBe(403);", "invoice:approve")).toBe(
      false,
    );
    expect(testMentionsHandler("const approve = 1; expect(x).toBe(403);", "invoice:approve")).toBe(
      false,
    );
  });
});

describe("findHandlersWithoutAccessDeniedTest", () => {
  const HANDLER_FILE = "/r/packages/bundled-features/src/x/handlers/approve.write.ts";

  test("a handler with a test referencing it and asserting AccessDeniedError has no finding", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("approve-invoice"),
      "/r/packages/bundled-features/src/x/__tests__/approve.test.ts": `
declare const AccessDeniedError: unknown;
test("rejects non-admins", () => {
	void "approve-invoice";
	expect(err).toBeInstanceOf(AccessDeniedError);
});
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs)).toHaveLength(0);
  });

  test("the same handler with no test file at all is a finding", () => {
    const sfs = files({ [HANDLER_FILE]: writeHandler("approve-invoice") });
    expect(findHandlersWithoutAccessDeniedTest(sfs).map((h) => h.name)).toEqual([
      "approve-invoice",
    ]);
  });

  test("a test that mentions the handler but never asserts a denial is a finding", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("approve-invoice"),
      "/r/packages/bundled-features/src/x/__tests__/approve.test.ts": `
test("approves", () => {
	void "approve-invoice";
	expect(res.isSuccess).toBe(true);
});
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs)).toHaveLength(1);
  });

  test("access_denied as the assertion literal counts as coverage", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("approve-invoice"),
      "/r/packages/bundled-features/src/x/__tests__/approve.test.ts": `
test("rejects", () => { void "approve-invoice"; expect(err.code).toBe("access_denied"); });
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs)).toHaveLength(0);
  });

  test("403 as the assertion literal counts as coverage", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("approve-invoice"),
      "/r/packages/bundled-features/src/x/__tests__/approve.test.ts": `
test("rejects", () => { void "approve-invoice"; expect(res.status).toBe(403); });
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs)).toHaveLength(0);
  });

  test("a denial-asserting test that names a different handler is not coverage", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("approve-invoice"),
      "/r/packages/bundled-features/src/x/__tests__/reject.test.ts": `
test("rejects", () => { void "reject-invoice"; expect(res.status).toBe(403); });
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs)).toHaveLength(1);
  });

  test("colon-name: a full colon-segment literal plus 403 counts as coverage", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("invoice:approve"),
      "/r/packages/bundled-features/src/x/__tests__/approve.test.ts": `
test("rejects", () => { void "invoice:write:approve"; expect(res.status).toBe(403); });
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs)).toHaveLength(0);
  });

  test("colon-name: a bare short-word substring plus 403 is NOT coverage", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("invoice:approve"),
      "/r/packages/bundled-features/src/x/__tests__/approve.test.ts": `
test("rejects", () => { approveAll(); expect(res.status).toBe(403); });
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs)).toHaveLength(1);

    const sfs2 = files({
      [HANDLER_FILE]: writeHandler("invoice:approve"),
      "/r/packages/bundled-features/src/x/__tests__/approve2.test.ts": `
test("rejects", () => { const approve = 1; expect(res.status).toBe(403); void approve; });
`,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs2)).toHaveLength(1);
  });
});

describe("findHandlersWithoutAccessDeniedTest with repo roots", () => {
  const ROOTS = [{ absPath: "/a" }, { absPath: "/b" }];
  const HANDLER_FILE = "/a/src/features/x/handlers/approve.write.ts";
  const TEST_SRC = `
declare const AccessDeniedError: unknown;
test("rejects non-admins", () => {
	void "approve-invoice";
	expect(err).toBeInstanceOf(AccessDeniedError);
});
`;

  test("a test in a sibling repo does not count as coverage", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("approve-invoice"),
      "/b/src/features/y/__tests__/approve.test.ts": TEST_SRC,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs, ROOTS).map((h) => h.name)).toEqual([
      "approve-invoice",
    ]);
  });

  test("a test in the handler's own repo counts as coverage", () => {
    const sfs = files({
      [HANDLER_FILE]: writeHandler("approve-invoice"),
      "/a/src/features/x/__tests__/approve.test.ts": TEST_SRC,
    });
    expect(findHandlersWithoutAccessDeniedTest(sfs, ROOTS)).toHaveLength(0);
  });
});

describe("guard", () => {
  test("run() reports a violation with the expected message and guard metadata", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/x/handlers/approve.write.ts":
        writeHandler("approve-invoice"),
    });
    const outcome = guard.run(sfs);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toMatch(/has no access-denied test/);
    expect(guard.security).toBe(true);
    expect(guard.scan).toEqual({
      scope: "source",
      extensions: ["ts"],
      frameworkWithin: ["packages/*/src/**", "samples/**"],
    });
  });
});
