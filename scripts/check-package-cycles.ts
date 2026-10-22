#!/usr/bin/env bun
/**
 * Package-graph check: no cycle across dependencies, devDependencies and peerDependencies of
 * packages/*\/package.json (workspace packages only). A cycle through a devDependency counts too:
 * it is what stops a package from being built or tested before the package it depends on.
 *
 * One edge kind is not an edge: a devDependency from or to a package with `kumiko.runtime: "test"`
 * (kumiko-testing). That package is the harness every package's tests run on; its own
 * dependencies (framework, types) point back at the packages whose tests use it, and none of
 * these devDependencies is installed for consumers. Its dependencies and peerDependencies still count.
 *
 * Usage: bun scripts/check-package-cycles.ts [packagesDir]
 * Exit 1 with the cycle path(s) on violation.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";

export type PackageGraph = ReadonlyMap<string, readonly string[]>;

export type Manifest = {
  readonly name?: unknown;
  readonly kumiko?: { readonly runtime?: unknown };
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly peerDependencies?: unknown;
};

function namesOf(block: unknown): string[] {
  return typeof block === "object" && block !== null ? Object.keys(block) : [];
}

export function readManifests(packagesDir: string): Manifest[] {
  const manifests: Manifest[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    let raw: string;
    try {
      raw = readFileSync(manifestPath, "utf8");
    } catch (error) {
      if (errorCodeOf(error) === "ENOENT") continue; // a directory without package.json is not a workspace package
      throw error;
    }
    try {
      manifests.push(JSON.parse(raw));
    } catch (error) {
      throw new Error(`${manifestPath}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return manifests;
}

export function buildPackageGraph(manifests: readonly Manifest[]): PackageGraph {
  const named = manifests.filter(
    (manifest): manifest is Manifest & { name: string } => typeof manifest.name === "string",
  );
  const workspaceNames = new Set(named.map((manifest) => manifest.name));
  const testHarnessNames = new Set(
    named
      .filter((manifest) => manifest.kumiko?.runtime === "test")
      .map((manifest) => manifest.name),
  );
  const graph = new Map<string, string[]>();
  for (const manifest of named) {
    const edges = new Set<string>([
      ...namesOf(manifest.dependencies),
      ...namesOf(manifest.peerDependencies),
    ]);
    for (const name of namesOf(manifest.devDependencies)) {
      if (testHarnessNames.has(name) || testHarnessNames.has(manifest.name)) continue;
      edges.add(name);
    }
    graph.set(
      manifest.name,
      [...edges].filter((name) => workspaceNames.has(name) && name !== manifest.name),
    );
  }
  return graph;
}

export function loadPackageGraph(packagesDir: string): PackageGraph {
  return buildPackageGraph(readManifests(packagesDir));
}

/** Returns one path per distinct cycle found, e.g. ["a", "b", "a"]. */
export function findCycles(graph: PackageGraph): string[][] {
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const finished = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): void {
    const onStackAt = stack.indexOf(node);
    if (onStackAt !== -1) {
      const cycle = stack.slice(onStackAt);
      const first = cycle.indexOf([...cycle].sort()[0] ?? node);
      const key = [...cycle.slice(first), ...cycle.slice(0, first)].join(" > ");
      if (!seenCycleKeys.has(key)) {
        seenCycleKeys.add(key);
        cycles.push([...cycle, node]);
      }
      return;
    }
    if (finished.has(node)) return;
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    finished.add(node);
  }

  for (const node of graph.keys()) visit(node);
  return cycles;
}

export type BaselineEdge = { readonly from: string; readonly to: string };

// Tolerated edge, not tolerated cycle: a new cycle through the same package group must still fail.
// 11 renderer-mail-html tests hang on bundled-features-internal helpers; they move in wave 4.
export const BASELINE_EDGES: readonly BaselineEdge[] = [
  { from: "@cosmicdrift/kumiko-bundled-features", to: "@cosmicdrift/kumiko-renderer-mail-html" },
];

function reaches(graph: PackageGraph, start: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [start];
  for (const node of queue) {
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    queue.push(...(graph.get(node) ?? []));
  }
  return false;
}

/** Ratchet: cycles that remain without the baseline edges are new; a baseline edge on no cycle is stale. */
export function checkAgainstBaseline(
  graph: PackageGraph,
  baseline: readonly BaselineEdge[],
): { unexpected: string[][]; stale: BaselineEdge[] } {
  const stale = baseline.filter(
    (edge) => !graph.get(edge.from)?.includes(edge.to) || !reaches(graph, edge.to, edge.from),
  );
  const stripped = new Map<string, readonly string[]>();
  for (const [node, edges] of graph) {
    stripped.set(
      node,
      edges.filter((to) => !baseline.some((edge) => edge.from === node && edge.to === to)),
    );
  }
  return { unexpected: findCycles(stripped), stale };
}

/** A baseline edge only tolerates a devDependency; as a runtime edge the cycle would ship. */
export function runtimeBaselineEdges(
  manifests: readonly Manifest[],
  baseline: readonly BaselineEdge[],
): BaselineEdge[] {
  return baseline.filter((edge) => {
    const from = manifests.find((manifest) => manifest.name === edge.from);
    return [...namesOf(from?.dependencies), ...namesOf(from?.peerDependencies)].includes(edge.to);
  });
}

if (import.meta.main) {
  const packagesDir = resolve(process.argv[2] ?? join(import.meta.dir, "..", "packages"));
  const manifests = readManifests(packagesDir);
  const { unexpected, stale } = checkAgainstBaseline(buildPackageGraph(manifests), BASELINE_EDGES);
  const runtime = runtimeBaselineEdges(manifests, BASELINE_EDGES);
  if (unexpected.length === 0 && stale.length === 0 && runtime.length === 0) {
    console.log("package graph: no new cycles");
  } else {
    for (const cycle of unexpected) console.error(`new cycle: ${cycle.join(" -> ")}`);
    for (const edge of stale) {
      console.error(`stale baseline edge (on no cycle, remove it): ${edge.from} -> ${edge.to}`);
    }
    for (const edge of runtime) {
      console.error(`baseline edge is a runtime dependency now: ${edge.from} -> ${edge.to}`);
    }
    process.exit(1);
  }
}
