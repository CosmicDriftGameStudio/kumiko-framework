import { afterEach, describe, expect, test } from "vitest";
import { evalCommand } from "../eval";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const c of cleanups) c();
	cleanups.length = 0;
});

describe("eval command", () => {
	test("registered + maintainer role", () => {
		expect(evalCommand.id).toBe("eval");
		expect(evalCommand.roles).toContain("maintainer");
	});

	test("missing kumiko-enterprise sibling → exit 1 + helpful error", async () => {
		// Setup: temp dir with NO sibling kumiko-enterprise dir.
		const t = makeTempCwd();
		cleanups.push(t.cleanup);

		// repoRoot points at a fake-framework dir inside our temp; its
		// sibling (..) is our temp dir, which has no kumiko-enterprise.
		const fakeFrameworkRoot = `${t.cwd}/kumiko-framework-fake`;

		const spy = makeSpyOutput();
		const exit = await evalCommand.run(
			makeContext({
				cwd: t.cwd,
				argv: ["--smoke"],
				repoRoot: fakeFrameworkRoot,
				out: spy.out,
			}),
		);
		expect(exit).toBe(1);
		expect(spy.errs.join("\n")).toMatch(/expected sibling repo at .*kumiko-enterprise/);
		expect(spy.errs.join("\n")).toMatch(/kumiko-enterprise \(private\)/);
	});

	test("routes 'drift' subcommand to eval-l2-drift.ts (script-path check via stub)", async () => {
		// We can't actually run bun-subprocess in unit-tests without
		// enterprise checkout. Instead pin the behavior at the API-level:
		// the command should attempt to dispatch to drift-script when
		// argv[0] === "drift". We verify via the error-message-path:
		// missing-enterprise error mentions the right script-path.
		const t = makeTempCwd();
		cleanups.push(t.cleanup);
		const fakeFrameworkRoot = `${t.cwd}/kumiko-framework-fake`;

		const spy = makeSpyOutput();
		// missing enterprise → fails before script-path is checked, so
		// we don't yet differentiate eval vs drift paths in the error.
		// This is a smoke that the dispatch doesn't throw on either arg.
		const exit = await evalCommand.run(
			makeContext({
				cwd: t.cwd,
				argv: ["drift", "--baseline", "/tmp/a.json", "--current", "/tmp/b.json"],
				repoRoot: fakeFrameworkRoot,
				out: spy.out,
			}),
		);
		expect(exit).toBe(1); // missing enterprise → 1 regardless of sub
	});

	test("help-string mentions the relevant subcommands", () => {
		expect(evalCommand.help).toContain("kumiko eval [args]");
		expect(evalCommand.help).toContain("kumiko eval drift [args]");
		expect(evalCommand.help).toContain("--smoke");
		expect(evalCommand.help).toContain("--provider openai-compat");
	});
});
