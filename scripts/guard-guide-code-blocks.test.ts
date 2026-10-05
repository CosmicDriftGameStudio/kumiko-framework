import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBareCodeBlocks, findBareGuideCodeBlocks } from "./guard-guide-code-blocks";

const FENCE = "```";

describe("findBareCodeBlocks", () => {
	it("flags a ts block without file= or illustration", () => {
		const md = ["# Guide", "", `${FENCE}ts`, "const x = 1;", FENCE].join("\n");
		expect(findBareCodeBlocks(md)).toEqual([{ line: 3, lang: "ts" }]);
	});

	it("accepts illustration and file= blocks and ignores non-code languages", () => {
		const md = [
			`${FENCE}ts illustration`,
			"const x = 1;",
			FENCE,
			`${FENCE}tsx file=<rootDir>/samples/a.tsx`,
			FENCE,
			`${FENCE}bash`,
			"bun test",
			FENCE,
		].join("\n");
		expect(findBareCodeBlocks(md)).toEqual([]);
	});

	it("does not treat a ts opener nested in a longer fence as a block", () => {
		const md = ["````md", `${FENCE}ts`, "const x = 1;", FENCE, "````"].join("\n");
		expect(findBareCodeBlocks(md)).toEqual([]);
	});
});

describe("findBareGuideCodeBlocks", () => {
	it("reports the guide path and line", () => {
		const root = mkdtempSync(join(tmpdir(), "guide-blocks-"));
		mkdirSync(join(root, "docs", "guides", "deploy"), { recursive: true });
		writeFileSync(join(root, "docs", "guides", "deploy", "k3s.md"), `intro\n${FENCE}tsx\n<A />\n${FENCE}\n`);
		writeFileSync(join(root, "docs", "guides", "ok.md"), `${FENCE}ts illustration\nx\n${FENCE}\n`);

		expect(findBareGuideCodeBlocks(root)).toEqual([
			{ file: join("docs", "guides", "deploy", "k3s.md"), line: 2, lang: "tsx" },
		]);
	});

	it("the framework's own guides are clean", () => {
		expect(findBareGuideCodeBlocks(join(import.meta.dir, ".."))).toEqual([]);
	});
});
