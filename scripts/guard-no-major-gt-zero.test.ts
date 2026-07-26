import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findMajorViolations,
	parseChangesetBumps,
	semverMajor,
} from "./guard-no-major-gt-zero";

describe("semverMajor", () => {
	it("reads the major component", () => {
		expect(semverMajor("0.165.0")).toBe(0);
		expect(semverMajor("1.0.0")).toBe(1);
		expect(semverMajor("2.0.0")).toBe(2);
		expect(semverMajor("0.165.0-beta.1")).toBe(0);
	});

	it("rejects non-semver", () => {
		expect(semverMajor("latest")).toBeNull();
		expect(semverMajor("")).toBeNull();
	});
});

describe("parseChangesetBumps", () => {
	it("extracts bump kinds from frontmatter", () => {
		const bumps = parseChangesetBumps(`---
"@cosmicdrift/kumiko-framework": major
"@cosmicdrift/kumiko-types": minor
---

body text with major in it should be ignored
`);
		expect(bumps.get("@cosmicdrift/kumiko-framework")).toBe("major");
		expect(bumps.get("@cosmicdrift/kumiko-types")).toBe("minor");
		expect(bumps.size).toBe(2);
	});

	it("returns empty for missing frontmatter", () => {
		expect(parseChangesetBumps("# no frontmatter\n").size).toBe(0);
	});
});

describe("findMajorViolations", () => {
	it("flags major changesets and package.json major ≥ 1", () => {
		const root = mkdtempSync(join(tmpdir(), "no-major-"));
		mkdirSync(join(root, ".changeset"));
		mkdirSync(join(root, "packages", "framework"), { recursive: true });
		mkdirSync(join(root, "packages", "ok"), { recursive: true });
		writeFileSync(
			join(root, ".changeset", "bad.md"),
			`---
"@cosmicdrift/kumiko-framework": major
---
oops
`,
		);
		writeFileSync(
			join(root, "packages", "framework", "package.json"),
			JSON.stringify({ name: "@cosmicdrift/kumiko-framework", version: "2.0.0" }),
		);
		writeFileSync(
			join(root, "packages", "ok", "package.json"),
			JSON.stringify({ name: "@cosmicdrift/kumiko-cli", version: "0.2.238" }),
		);

		const findings = findMajorViolations(root);
		expect(findings.some((f) => f.kind === "changeset")).toBe(true);
		expect(findings.some((f) => f.kind === "package" && f.detail.includes("2.0.0"))).toBe(true);
		expect(findings.some((f) => f.detail.includes("0.2.238"))).toBe(false);
	});
});
