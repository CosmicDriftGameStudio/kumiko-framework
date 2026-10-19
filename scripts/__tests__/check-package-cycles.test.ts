import { describe, expect, it } from "bun:test";
import {
  buildPackageGraph,
  checkAgainstBaseline,
  findCycles,
  runtimeBaselineEdges,
} from "../check-package-cycles.ts";

type Manifest = Parameters<typeof buildPackageGraph>[0][number];

function manifest(name: string, deps: string[], extra: Partial<Manifest> = {}): Manifest {
  return {
    name: `@x/${name}`,
    dependencies: Object.fromEntries(deps.map((d) => [`@x/${d}`, "workspace:*"])),
    ...extra,
  } as Manifest;
}

describe("check-package-cycles", () => {
  it("reports a built-in cycle with its path", () => {
    const cycles = findCycles(
      buildPackageGraph([manifest("a", ["b"]), manifest("b", ["c"]), manifest("c", ["a"])]),
    );
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.[0]).toBe(cycles[0]?.[cycles[0].length - 1]);
  });

  it("is green for an acyclic graph", () => {
    expect(findCycles(buildPackageGraph([manifest("a", ["b"]), manifest("b", [])]))).toEqual([]);
  });

  it("counts devDependencies and peerDependencies as edges", () => {
    const dev = manifest("a", [], { devDependencies: { "@x/b": "workspace:*" } });
    const peer = manifest("b", [], { peerDependencies: { "@x/a": "workspace:*" } });
    expect(findCycles(buildPackageGraph([dev, peer])).length).toBeGreaterThan(0);
  });

  it("ratchet: baseline edge passes, a second cycle in the same group fails, a stale edge fails", () => {
    const edge = { from: "@x/a", to: "@x/b" };
    const base = [manifest("a", ["b"]), manifest("b", ["a"])];
    expect(checkAgainstBaseline(buildPackageGraph(base), [edge])).toEqual({
      unexpected: [],
      stale: [],
    });
    const second = [manifest("a", ["b", "c"]), manifest("b", ["a"]), manifest("c", ["a"])];
    expect(checkAgainstBaseline(buildPackageGraph(second), [edge]).unexpected.length).toBeGreaterThan(0);
    const acyclic = buildPackageGraph([manifest("a", ["b"]), manifest("b", [])]);
    expect(checkAgainstBaseline(acyclic, [edge]).stale).toEqual([edge]);
  });

  it("flags a baseline edge that became a runtime dependency", () => {
    const edge = { from: "@x/a", to: "@x/b" };
    const asDev = manifest("a", [], { devDependencies: { "@x/b": "workspace:*" } });
    expect(runtimeBaselineEdges([asDev, manifest("b", ["a"])], [edge])).toEqual([]);
    expect(runtimeBaselineEdges([manifest("a", ["b"]), manifest("b", ["a"])], [edge])).toEqual([edge]);
  });
});
