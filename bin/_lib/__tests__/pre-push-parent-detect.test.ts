import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #2135: `.husky/pre-push` used to check only ONE directory above the repo
// for the parent-workspace `package.json`. From a `.wt/<name>` worktree that
// one level up is `.wt` itself, so the hook fell into the standalone branch
// and ran the sub-repo's full `bun test` instead of the scoped parent
// `bun check`. It also derived `REPO_NAME` from the worktree directory name,
// which leaked into `KUMIKO_CLI_SCOPE` and silently skipped this repo's
// Biome/TSC/Unit-Test steps. These tests exercise the real hook script
// against fixture git repos, without invoking the real `bun check`/`bun test`.
//
// A git hook sets GIT_DIR/GIT_WORK_TREE in its process environment; those
// vars survive into a child `bun test` run and override any `cwd` passed to
// spawned git commands. Every git subprocess below strips the inherited git
// env and pins GIT_CEILING_DIRECTORIES/GIT_CONFIG_GLOBAL to the fixture tree,
// so a run triggered by this very repo's pre-push hook can never touch the
// real repo, even by accident.

const HOOK_PATH = join(import.meta.dir, "..", "..", "..", ".husky", "pre-push");

const {
	GIT_DIR,
	GIT_WORK_TREE,
	GIT_INDEX_FILE,
	GIT_PREFIX,
	GIT_COMMON_DIR,
	GIT_OBJECT_DIRECTORY,
	GIT_ALTERNATE_OBJECT_DIRECTORIES,
	GIT_CONFIG,
	GIT_CONFIG_GLOBAL,
	...INHERITED_ENV
} = process.env;

function fixtureEnv(ceilingDir: string): Record<string, string> {
	return {
		...INHERITED_ENV,
		GIT_CEILING_DIRECTORIES: ceilingDir,
		GIT_CONFIG_GLOBAL: "/dev/null",
	} as Record<string, string>;
}

function runGit(args: string[], cwd: string, ceilingDir: string): void {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		env: fixtureEnv(ceilingDir),
	});
	if (!result.success) {
		throw new Error(
			`git ${args.join(" ")} failed in ${cwd}: ${result.stderr.toString()}`,
		);
	}
}

function gitCommonDir(cwd: string, ceilingDir: string): string {
	const result = Bun.spawnSync(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		{ cwd, env: fixtureEnv(ceilingDir) },
	);
	return result.stdout.toString().trim();
}

function initGitRepo(dir: string, ceilingDir: string): void {
	mkdirSync(dir, { recursive: true });
	runGit(["init", "-q", "."], dir, ceilingDir);
	runGit(
		[
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=test",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			"init",
		],
		dir,
		ceilingDir,
	);
}

function installHook(targetRepoDir: string): void {
	const huskyDir = join(targetRepoDir, ".husky");
	mkdirSync(huskyDir, { recursive: true });
	const hookPath = join(huskyDir, "pre-push");
	copyFileSync(HOOK_PATH, hookPath);
	chmodSync(hookPath, 0o755);
}

function writeStubBun(stubBinDir: string): void {
	mkdirSync(stubBinDir, { recursive: true });
	const stubPath = join(stubBinDir, "bun");
	writeFileSync(
		stubPath,
		[
			"#!/usr/bin/env sh",
			'echo "BUN_ARGV: $*"',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX sh var expansion, not a JS template literal
			'echo "KUMIKO_CLI_SCOPE=${KUMIKO_CLI_SCOPE:-<unset>}"',
			"",
		].join("\n"),
	);
	chmodSync(stubPath, 0o755);
}

function runHook(cwd: string, stubBinDir: string, ceilingDir: string): string {
	const result = Bun.spawnSync(["sh", HOOK_PATH], {
		cwd,
		env: {
			...fixtureEnv(ceilingDir),
			PATH: `${stubBinDir}:${INHERITED_ENV["PATH"] ?? ""}`,
		},
	});
	return result.stdout.toString() + result.stderr.toString();
}

describe("pre-push parent-workspace detection", () => {
	let tmp: string;
	let stubBinDir: string;

	beforeEach(() => {
		// realpathSync: macOS resolves TMPDIR through /var -> /private/var, and
		// git's --git-common-dir output is already fully resolved — without
		// this the startsWith() check below fails on a path that's genuinely
		// inside the fixture tree.
		tmp = realpathSync(mkdtempSync(join(tmpdir(), "prepush-parent-detect-")));
		stubBinDir = join(tmp, "stub-bin");
		writeStubBun(stubBinDir);
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("worktree under .wt/<name> takes the parent branch with the repo's real name", () => {
		const parentDir = join(tmp, "parent");
		mkdirSync(parentDir, { recursive: true });
		writeFileSync(
			join(parentDir, "package.json"),
			JSON.stringify({ name: "cosmicdriftgamestudio" }),
		);

		const mainRepoDir = join(parentDir, "kumiko-framework");
		initGitRepo(mainRepoDir, tmp);

		const worktreeDir = join(parentDir, ".wt", "fw-2135");
		runGit(
			["worktree", "add", "-q", "-b", "test-branch", worktreeDir],
			mainRepoDir,
			tmp,
		);
		installHook(worktreeDir);

		// Proves the fixture git operations stayed inside the fixture tree —
		// this is what the GIT_DIR-inheritance bug (see header comment) would
		// have broken silently.
		expect(gitCommonDir(worktreeDir, tmp)).toStartWith(tmp);

		const output = runHook(worktreeDir, stubBinDir, tmp);

		expect(output).toContain("bun check (scoped: kumiko-framework)");
		expect(output).toContain("KUMIKO_CLI_SCOPE=kumiko-framework");
		expect(output).not.toContain("fw-2135");
	});

	test("regular checkout one level under the parent still takes the parent branch", () => {
		const parentDir = join(tmp, "parent");
		mkdirSync(parentDir, { recursive: true });
		writeFileSync(
			join(parentDir, "package.json"),
			JSON.stringify({ name: "cosmicdriftgamestudio" }),
		);

		const repoDir = join(parentDir, "kumiko-framework");
		initGitRepo(repoDir, tmp);
		installHook(repoDir);

		const output = runHook(repoDir, stubBinDir, tmp);

		expect(output).toContain("bun check (scoped: kumiko-framework)");
		expect(output).toContain("KUMIKO_CLI_SCOPE=kumiko-framework");
	});

	test("standalone clone with no cosmicdriftgamestudio ancestor falls back to bun test", () => {
		const standaloneDir = join(tmp, "standalone-clone");
		initGitRepo(standaloneDir, tmp);
		installHook(standaloneDir);

		const output = runHook(standaloneDir, stubBinDir, tmp);

		expect(output).toContain("bun test (standalone)");
		expect(output).toContain("KUMIKO_CLI_SCOPE=<unset>");
	});
});
