import { describe, expect, test } from "bun:test";
import { renderFlow } from "../render.ts";
import type { FlowSpec } from "../types.ts";

const twoNodeSpec: FlowSpec = {
  nodes: [
    { id: "a", title: "Start", icon: "ui" },
    { id: "b", title: "End", sub: "done", kind: "terminal" },
  ],
  edges: [{ from: "a", to: "b", label: "go" }],
};

function cardYPositions(svg: string): number[] {
  return [...svg.matchAll(/<rect class="flow-card" x="[\d.]+" y="([\d.]+)"/g)].map((m) =>
    Number(m[1]),
  );
}

function wireCount(svg: string): number {
  return [...svg.matchAll(/<path class="wire"/g)].length;
}

describe("renderFlow", () => {
  test("renders one <g> card per node and one wire per edge", () => {
    const svg = renderFlow(twoNodeSpec);
    expect(svg.match(/<g>/g)).toHaveLength(2);
    expect(svg.match(/class="wire"/g)).toHaveLength(1);
  });

  test("escapes node titles/sub and edge labels against XML injection", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "a", title: '<script>alert("x")</script>' },
        { id: "b", title: "End" },
      ],
      edges: [{ from: "a", to: "b", label: 'a & b "c"' }],
    };
    const svg = renderFlow(spec);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(svg).toContain("a &amp; b &quot;c&quot;");
  });

  test("throws when an edge references an unknown node", () => {
    const spec: FlowSpec = {
      nodes: [{ id: "a", title: "A" }],
      edges: [{ from: "a", to: "missing" }],
    };
    expect(() => renderFlow(spec)).toThrow(/unknown node "missing"/);
  });

  test("throws when the graph has no root (every node has an incoming edge)", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    expect(() => renderFlow(spec)).toThrow(/no root node found/);
  });

  test("throws when the graph has a cycle downstream of a valid root", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "root", title: "Root" },
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      edges: [
        { from: "root", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    expect(() => renderFlow(spec)).toThrow(/graph has a cycle/);
  });

  test("places nodes at increasing depth into successive rows (y increases downstream)", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
        { id: "c", title: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    const svg = renderFlow(spec);
    const yValues = [...svg.matchAll(/class="flow-card" x="[^"]*" y="([^"]*)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(yValues).toHaveLength(3);
    expect(yValues[0]).toBeLessThan(yValues[1] ?? 0);
    expect(yValues[1]).toBeLessThan(yValues[2] ?? 0);
  });

  test("wider canvas for a row with more siblings", () => {
    const narrow = renderFlow({
      nodes: [{ id: "a", title: "A" }],
      edges: [],
    });
    const wide = renderFlow({
      nodes: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
        { id: "c", title: "C" },
      ],
      edges: [],
    });
    const widthOf = (svg: string) => Number(/<svg width="([^"]*)"/.exec(svg)?.[1]);
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow));
  });

  test("lays out a linear chain in strictly increasing rows", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "ui", title: "UI", icon: "ui" },
        { id: "api", title: "API", icon: "api" },
        { id: "handler", title: "Handler", icon: "handler" },
        { id: "es", title: "Event Store", icon: "event-store" },
      ],
      edges: [
        { from: "ui", to: "api" },
        { from: "api", to: "handler" },
        { from: "handler", to: "es" },
      ],
    };
    const svg = renderFlow(spec);
    const ys = cardYPositions(svg);
    expect(ys).toHaveLength(4);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1] ?? Number.POSITIVE_INFINITY);
    }
    expect(wireCount(svg)).toBe(3);
    expect(svg).toContain(">UI<");
    expect(svg).toContain(">Event Store<");
  });

  test("places two children of a decision node on the same row", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "review", title: "Review", kind: "decision" },
        { id: "approved", title: "Approved", icon: "check" },
        { id: "rejected", title: "Rejected", kind: "terminal", icon: "stop" },
      ],
      edges: [
        { from: "review", to: "approved", label: "approved" },
        { from: "review", to: "rejected", label: "rejected" },
      ],
    };
    const svg = renderFlow(spec);
    const ys = cardYPositions(svg);
    expect(ys[1]).toBe(ys[2]);
    expect(svg).toContain('text-anchor="middle">approved<');
    expect(svg).toContain('text-anchor="middle">rejected<');
  });

  test("wider titles produce wider cards than short ones", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "a", title: "A" },
        { id: "b", title: "A considerably longer title that needs more room" },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    const svg = renderFlow(spec);
    const widths = [
      ...svg.matchAll(/<rect class="flow-card" x="[\d.]+" y="[\d.]+" width="([\d.]+)"/g),
    ].map((m) => Number(m[1]));
    expect(widths[1]).toBeGreaterThan(widths[0] ?? Number.POSITIVE_INFINITY);
  });
});
