#!/usr/bin/env node
// Must run under Node, not Bun: Bun's resolver fills in missing extensions, so
// a relative specifier without `.js` is invisible there but breaks every Node
// ESM consumer of the published dist.
// Usage: node scripts/check-dist-node-esm.mjs <dist-dir> [<dist-dir> ...]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)["'](\.{1,2}\/[^"']*)["']/gm;

function collectEmittedFiles(dir, out) {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) collectEmittedFiles(path, out);
		else if (path.endsWith(".js") || path.endsWith(".d.ts")) out.push(path);
	}
	return out;
}

// Node's ESM resolution for a relative specifier: plain URL resolution against
// the importer, no extension search and no directory index.
function resolveLikeNode(specifier, importer) {
	const target = fileURLToPath(new URL(specifier, pathToFileURL(importer)));
	if (!existsSync(target)) return { target, problem: "file does not exist" };
	if (statSync(target).isDirectory()) return { target, problem: "directory import" };
	return { target };
}

const distDirs = process.argv.slice(2).map((dir) => resolve(dir));
if (distDirs.length === 0) {
	console.error("x usage: check-dist-node-esm.mjs <dist-dir> [<dist-dir> ...]");
	process.exit(2);
}

const emitted = [];
for (const dist of distDirs) {
	if (!existsSync(dist)) {
		console.error(`x ${dist} does not exist - build the package first.`);
		process.exit(2);
	}
	collectEmittedFiles(dist, emitted);
}

const failures = [];
for (const file of emitted) {
	// Template literals hold generated source, whole-line comments hold usage examples, and lines that start
	// with a quote are string-array elements of generated source (a real import statement never starts with one).
	const code = readFileSync(file, "utf8")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/^\s*["'].*$/gm, "")
		.replace(/`(?:\\.|[^`\\])*`/gs, "``");
	for (const [, specifier] of code.matchAll(SPECIFIER)) {
		const { target, problem } = resolveLikeNode(specifier, file);
		if (problem) failures.push(`${relative(process.cwd(), file)}: "${specifier}" -> ${relative(process.cwd(), target)} (${problem})`);
	}
}

if (failures.length > 0) {
	console.error(`x ${failures.length} relative specifiers in dist do not resolve from Node (missing .js extension?):`);
	for (const failure of failures.slice(0, 30)) console.error(`  ${failure}`);
	if (failures.length > 30) console.error(`  ... and ${failures.length - 30} more`);
	console.error('Fix in the source: `./feature` -> `./feature.js`, directory -> `./feature/index.js`.');
	process.exit(1);
}

console.error(`OK ${emitted.length} emitted files in ${distDirs.length} dist dir(s) - every relative specifier resolves from Node.`);
