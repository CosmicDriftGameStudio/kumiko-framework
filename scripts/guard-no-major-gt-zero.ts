#!/usr/bin/env bun
/**
 * Guard: block major version bumps out of 0.x.
 *
 * Accidental `major` changesets (and hand-edited package.json majors ≥ 1)
 * published 1.0.0 / 2.0.0 without approval. Cosmic Drift stays on 0.x until
 * an explicit, human-approved 1.0 decision.
 *
 * Checks:
 *   1. changeset markdown files frontmatter — no package may be bumped as `major`
 *   2. packages/<name>/package.json — publishable packages must have major == 0
 *
 * Usage:
 *   bun scripts/guard-no-major-gt-zero.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MajorFinding = {
	readonly kind: "changeset" | "package";
	readonly file: string;
	readonly detail: string;
};

const CHANGESET_SKIP = new Set(["README.md", "config.json"]);

/** Semver major component; returns null for non-semver strings. */
export function semverMajor(version: string): number | null {
	const m = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(version.trim());
	return m ? Number(m[1]) : null;
}

/** Parse changeset frontmatter bump map (pkg → major|minor|patch). */
export function parseChangesetBumps(content: string): ReadonlyMap<string, string> {
	const bumps = new Map<string, string>();
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) return bumps;
	const end = trimmed.indexOf("\n---", 3);
	if (end < 0) return bumps;
	const fm = trimmed.slice(3, end);
	for (const line of fm.split("\n")) {
		const m = /^\s*"([^"]+)"\s*:\s*(major|minor|patch)\s*$/.exec(line);
		if (m) bumps.set(m[1], m[2]);
	}
	return bumps;
}

export function findMajorViolations(repoRoot: string): MajorFinding[] {
	const findings: MajorFinding[] = [];

	const changesetDir = join(repoRoot, ".changeset");
	if (existsSync(changesetDir)) {
		for (const name of readdirSync(changesetDir)) {
			if (CHANGESET_SKIP.has(name) || !name.endsWith(".md")) continue;
			const file = join(changesetDir, name);
			const bumps = parseChangesetBumps(readFileSync(file, "utf8"));
			for (const [pkg, bump] of bumps) {
				if (bump === "major") {
					findings.push({
						kind: "changeset",
						file: `.changeset/${name}`,
						detail: `${pkg}: major (forbidden while on 0.x — use minor/patch)`,
					});
				}
			}
		}
	}

	const packagesDir = join(repoRoot, "packages");
	if (existsSync(packagesDir)) {
		for (const dir of readdirSync(packagesDir)) {
			const pkgPath = join(packagesDir, dir, "package.json");
			if (!existsSync(pkgPath)) continue;
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
				name?: string;
				version?: string;
				private?: boolean;
			};
			if (pkg.private === true) continue;
			if (!pkg.name || !pkg.version) continue;
			const major = semverMajor(pkg.version);
			if (major !== null && major >= 1) {
				findings.push({
					kind: "package",
					file: `packages/${dir}/package.json`,
					detail: `${pkg.name}@${pkg.version} (major ≥ 1 forbidden — stay on 0.x)`,
				});
			}
		}
	}

	return findings;
}

if (import.meta.main) {
	const repoRoot = join(import.meta.dir, "..");
	const findings = findMajorViolations(repoRoot);
	if (findings.length === 0) {
		console.log("  ✓ guard-no-major-gt-zero (no major≥1 package.json / no major changesets)");
		process.exit(0);
	}
	console.log(`  ✗ guard-no-major-gt-zero (${findings.length} violation(s))`);
	for (const f of findings) {
		console.error(`    [${f.kind}] ${f.file}: ${f.detail}`);
	}
	console.error(
		"    → Cosmic Drift publishes 0.x only. Use changeset bump `minor`/`patch`, never `major`, until 1.0 is explicitly approved.",
	);
	process.exit(1);
}
