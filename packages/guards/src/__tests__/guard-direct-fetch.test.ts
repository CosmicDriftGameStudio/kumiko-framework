import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { resolveRepoRoots } from "../_lib/roots";
import { guard } from "../guard-direct-fetch";

// The egress.ts allowlist entry is keyed on RepoRoot.kind (repoScopedKey() in
// guard-direct-fetch.ts) rather than a bare relative path, so exercising it
// needs a file path anchored under the real "framework" root — a synthetic
// in-memory path with no matching root is exactly the fail-closed case the
// allowlist is meant to reject. Skips where no framework sibling is checked
// out (CI standalone), same pattern as vacuity-floor.test.ts.
const frameworkRoot = resolveRepoRoots().find((r) => r.kind === "framework");

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

describe("Direct-Fetch Guard", () => {
  test("flags a raw fetch() call in server code", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function callOut() {
					return fetch("https://example.com");
				}
			`,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("fetch(");
  });

  test("flags globalThis.fetch()/window.fetch() calls in server code", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function a() {
					return globalThis.fetch("https://a.example.com");
				}
				export async function b() {
					return window.fetch("https://b.example.com");
				}
				export async function c() {
					// self.fetch is intentionally not flagged (infra#582)
					return self.fetch("https://c.example.com");
				}
			`,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(2);
    expect(violations[0]?.message).toContain("globalThis.fetch(");
    expect(violations[1]?.message).toContain("window.fetch(");
  });

  test("same-origin path literal fetch is allowed", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function a() {
					return fetch("/api/files");
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("same-origin template literal fetch is allowed", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function a(id: string) {
					return fetch(\`/api/files/\${id}\`);
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("flags a template literal fetch whose head is only a leading slash", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function a(host: string) {
					return fetch(\`/\${host}/x\`);
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("flags a protocol-relative template literal fetch", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function a(host: string) {
					return fetch(\`//\${host}/x\`);
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("flags a template literal fetch with an absolute-URL head", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function a(host: string) {
					return fetch(\`https://\${host}/x\`);
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("does not flag fetch() as a property access (e.g. client.fetch(...))", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function callOut(client: { fetch(url: string): Promise<Response> }) {
					return client.fetch("https://example.com");
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("does not flag egress(policy)(...) calls", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				import { egress } from "@cosmicdrift/kumiko-framework/http";
				export async function callOut() {
					return egress({ kind: "external" })("https://example.com");
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test.skipIf(!frameworkRoot)("allows the egress() implementation itself", () => {
    const path = join(frameworkRoot!.absPath, "packages/framework/src/http/egress.ts");
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      useInMemoryFileSystem: true,
    });
    project.createSourceFile(
      path,
      `
				export function egress(policy: unknown) {
					return async (raw: string) => fetch(raw);
				}
			`,
    );
    expect(guard.run(project.getSourceFiles()).violations).toHaveLength(0);
  });

  test("does not flag fetch() inside a **/web/** path (client, same-origin)", () => {
    const sfs = files({
      "packages/bundled-features/src/auth-email-password/web/auth-client.ts": `
				export async function login() {
					return fetch("/auth/login", { method: "POST" });
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("does not flag globalThis.fetch() inside a **/web/** path (client, same-origin)", () => {
    const sfs = files({
      "packages/bundled-features/src/auth-email-password/web/auth-client.ts": `
				export async function login() {
					return globalThis.fetch("/auth/login", { method: "POST" });
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test.skipIf(!frameworkRoot)(
    "allows globalThis.fetch() inside the egress() implementation itself",
    () => {
      const path = join(frameworkRoot!.absPath, "packages/framework/src/http/egress.ts");
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        useInMemoryFileSystem: true,
      });
      project.createSourceFile(
        path,
        `
				export function egress(policy: unknown) {
					return async (raw: string) => globalThis.fetch(raw);
				}
			`,
      );
      expect(guard.run(project.getSourceFiles()).violations).toHaveLength(0);
    },
  );

  test("does not flag fetch() inside a **/public/** path (client, same-origin)", () => {
    const sfs = files({
      "packages/framework/src/public/api.ts": `
				export async function ping() {
					return fetch("/api/ping");
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("does not scan .test.ts / __tests__ files", () => {
    const sfs = files({
      "packages/framework/src/rogue/feature.test.ts": `
				test("x", () => { fetch("https://example.com"); });
			`,
      "packages/framework/src/rogue/__tests__/helper.ts": `
				export function stub() { return fetch("https://example.com"); }
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("flags multiple raw fetch() calls in the same file with correct line numbers", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				export async function a() {
					return fetch("https://a.example.com");
				}
				export async function b() {
					return fetch("https://b.example.com");
				}
			`,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(2);
    expect(violations[0]?.line).toBeLessThan(violations[1]?.line ?? 0);
  });

  test("scans samples/ as well as packages/*/src", () => {
    const sfs = files({
      "samples/showcases/demo/feature.ts": `
				export async function callOut() {
					return fetch("https://example.com");
				}
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("scan targets server TS under packages and samples (every root reached via manifest sourceRoots)", () => {
    expect(guard.scan).toEqual({
      scope: "source",
      extensions: ["ts"],
      frameworkWithin: ["packages/*/src/**", "samples/**"],
    });
  });

  test("flags fetch in a second file that is not on the allowlist", () => {
    const sfs = files({
      "packages/bundled-features/src/a/feature.ts": `
				export async function a() { return fetch("https://a.example.com"); }
			`,
      "packages/bundled-features/src/b/feature.ts": `
				export async function b() { return fetch("https://b.example.com"); }
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(2);
  });

  test("in-memory path with no matching root is not allowlistable", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
    project.createSourceFile(
      "/nowhere/packages/framework/src/http/egress.ts",
      "export async function x() { return fetch('x'); }",
    );
    expect(guard.run(project.getSourceFiles()).violations).toHaveLength(1);
  });
});
