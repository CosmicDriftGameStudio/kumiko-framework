#!/usr/bin/env bun
/**
 * Guard: every ts/tsx/js/jsx block in docs/guides carries `file=` or `illustration`.
 *
 * kumiko-platform's docgen copies docs/guides into the docs site and its
 * `check-embeds --complete` gate rejects bare code blocks there. Catching them
 * here keeps a framework release from turning the platform build red.
 * The fence parsing mirrors tools/docgen/src/check-embeds.ts in kumiko-platform.
 *
 * Usage:
 *   bun scripts/guard-guide-code-blocks.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const CODE_LANGS: ReadonlySet<string> = new Set(["ts", "tsx", "typescript", "js", "jsx"]);

export type BareCodeBlock = {
	readonly file: string;
	readonly line: number;
	readonly lang: string;
};

function walkMarkdown(dir: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) results.push(...walkMarkdown(full));
		else if (entry.isFile() && /\.mdx?$/.test(entry.name)) results.push(full);
	}
	return results;
}

function isMarkedCodeBlockMeta(meta: string): boolean {
	return /\bfile=\S+/.test(meta) || /\billustration\b/.test(meta);
}

export function findBareCodeBlocks(content: string): { line: number; lang: string }[] {
	const bare: { line: number; lang: string }[] = [];
	let fence: string | null = null;
	for (const [index, line] of content.split("\n").entries()) {
		if (fence === null) {
			const open = /^(`{3,}|~{3,})([A-Za-z0-9]+)?(.*)$/.exec(line);
			if (open?.[1] === undefined) continue;
			fence = open[1];
			const lang = (open[2] ?? "").toLowerCase();
			if (CODE_LANGS.has(lang) && !isMarkedCodeBlockMeta((open[3] ?? "").trim())) {
				bare.push({ line: index + 1, lang });
			}
			continue;
		}
		// CommonMark closer: bare fence chars of the same kind, at least as long.
		const close = /^(`{3,}|~{3,})\s*$/.exec(line);
		if (close?.[1] && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
	}
	return bare;
}

export function findBareGuideCodeBlocks(repoRoot: string): BareCodeBlock[] {
	const guidesDir = join(repoRoot, "docs", "guides");
	if (!existsSync(guidesDir)) return [];
	return walkMarkdown(guidesDir).flatMap((path) =>
		findBareCodeBlocks(readFileSync(path, "utf8")).map((block) => ({
			file: relative(repoRoot, path),
			...block,
		})),
	);
}

if (import.meta.main) {
	const findings = findBareGuideCodeBlocks(join(import.meta.dir, ".."));
	if (findings.length === 0) {
		console.log("  ✓ guard-guide-code-blocks (every ts block in docs/guides has file= or illustration)");
		process.exit(0);
	}
	console.log(`  ✗ guard-guide-code-blocks (${findings.length} bare code block(s))`);
	for (const f of findings) console.error(`    ${f.file}:${f.line} \`\`\`${f.lang}`);
	console.error(
		"    → Embed real source with `file=<path>` or mark the fragment as ```ts illustration.",
	);
	process.exit(1);
}
