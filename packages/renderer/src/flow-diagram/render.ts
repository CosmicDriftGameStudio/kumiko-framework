import { escapeHtml } from "../headless/index.ts";
import { ICONS } from "./icons.ts";
import type { FlowEdge, FlowNode, FlowSpec } from "./types.ts";

const BADGE = 24;
const ICON_SIZE = 13;
const PAD_X = 9.6;
const GAP_BADGE_TEXT = 8;
const GAP_RIGHT = 11.2;
const ROW_GAP = 35;
const COL_GAP = 22;
const MIN_CARD_WIDTH = 120;
const TITLE_SIZE = 11.2;
const SUB_SIZE = 9.2;
const STEP_SECONDS = 1.2;

interface Placed {
  node: FlowNode;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function textWidth(text: string, fontSize: number, bold: boolean): number {
  return text.length * fontSize * (bold ? 0.62 : 0.56);
}

function cardSize(node: FlowNode): { width: number; height: number } {
  const titleWidth = textWidth(node.title, TITLE_SIZE, true);
  const subWidth = node.sub ? textWidth(node.sub, SUB_SIZE, false) : 0;
  const content = Math.max(titleWidth, subWidth);
  const width = Math.max(MIN_CARD_WIDTH, BADGE + GAP_BADGE_TEXT + content + PAD_X + GAP_RIGHT);
  const height = node.sub ? 42 : 32;
  return { width, height };
}

function assertEdgesReferenceKnownNodes(spec: FlowSpec): void {
  const ids = new Set(spec.nodes.map((n) => n.id));
  for (const edge of spec.edges) {
    if (!ids.has(edge.from))
      throw new Error(`FlowSpec: edge references unknown node "${edge.from}"`);
    if (!ids.has(edge.to)) throw new Error(`FlowSpec: edge references unknown node "${edge.to}"`);
  }
}

function buildAdjacency(spec: FlowSpec): {
  children: Map<string, FlowEdge[]>;
  inDegree: Map<string, number>;
} {
  const children = new Map<string, FlowEdge[]>();
  const inDegree = new Map<string, number>();
  for (const node of spec.nodes) inDegree.set(node.id, 0);
  for (const edge of spec.edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge]);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  return { children, inDegree };
}

/** Longest-path depth per node via Kahn's algorithm; throws if the graph has no root or contains a cycle. */
function longestPathDepths(
  spec: FlowSpec,
  children: Map<string, FlowEdge[]>,
  inDegree: Map<string, number>,
): Map<string, number> {
  const depth = new Map<string, number>();
  const queue = spec.nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  if (queue.length === 0 && spec.nodes.length > 0) {
    throw new Error(
      "FlowSpec: no root node found (every node has an incoming edge — check for a cycle)",
    );
  }
  for (const id of queue) depth.set(id, 0);

  const remaining = new Map(inDegree);
  let visited = 0;
  for (const id of queue) {
    visited += 1;
    for (const edge of children.get(id) ?? []) {
      const next = Math.max(depth.get(edge.to) ?? 0, (depth.get(id) ?? 0) + 1);
      depth.set(edge.to, next);
      const left = (remaining.get(edge.to) ?? 0) - 1;
      remaining.set(edge.to, left);
      if (left === 0) queue.push(edge.to);
    }
  }
  if (visited < spec.nodes.length) {
    throw new Error("FlowSpec: graph has a cycle — a flow diagram must be acyclic");
  }
  return depth;
}

function computeDepths(spec: FlowSpec): Map<string, number> {
  assertEdgesReferenceKnownNodes(spec);
  const { children, inDegree } = buildAdjacency(spec);
  return longestPathDepths(spec, children, inDegree);
}

function layout(spec: FlowSpec): {
  placed: Map<string, Placed>;
  width: number;
  height: number;
  maxDepth: number;
} {
  const depthById = computeDepths(spec);
  const maxDepth = Math.max(0, ...[...depthById.values()]);
  const rows: FlowNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const node of spec.nodes) rows[depthById.get(node.id) ?? 0]?.push(node);

  // Siblings in the same row share one card size (the row's largest), so a
  // row of 3+ always lands symmetrically under its parent — an odd sibling
  // count with mismatched widths otherwise throws the middle card off-center.
  const sizedRows = rows.map((row) => {
    const sizes = row.map((n) => cardSize(n));
    return {
      row,
      width: Math.max(MIN_CARD_WIDTH, ...sizes.map((s) => s.width)),
      height: Math.max(0, ...sizes.map((s) => s.height)),
    };
  });
  const rowWidths = sizedRows.map(
    ({ row, width }) => row.length * width + COL_GAP * Math.max(0, row.length - 1),
  );
  const canvasWidth = Math.max(...rowWidths, MIN_CARD_WIDTH) + 40;
  const centerX = canvasWidth / 2;

  const placed = new Map<string, Placed>();
  let y = 20;
  for (const { row, width, height } of sizedRows) {
    const rowWidth = row.length * width + COL_GAP * Math.max(0, row.length - 1);
    let x = centerX - rowWidth / 2;
    for (const node of row) {
      placed.set(node.id, { node, depth: depthById.get(node.id) ?? 0, x, y, width, height });
      x += width + COL_GAP;
    }
    y += height + ROW_GAP;
  }
  const canvasHeight = y - ROW_GAP + 20;
  return { placed, width: canvasWidth, height: canvasHeight, maxDepth };
}

interface EdgeTiming {
  startFrac: number;
  endFrac: number;
}

function computeTiming(placed: Map<string, Placed>, spec: FlowSpec, maxDepth: number) {
  const totalSeconds = STEP_SECONDS * (maxDepth + 1) + STEP_SECONDS * 0.5;
  const timingByEdge = new Map<FlowEdge, EdgeTiming>();
  const arrivalByNode = new Map<string, number>();

  for (const edge of spec.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    const span = Math.max(1, to.depth - from.depth);
    const startT = from.depth * STEP_SECONDS;
    const travelT = STEP_SECONDS * 0.75 * span;
    const startFrac = startT / totalSeconds;
    const endFrac = Math.min(0.98, (startT + travelT) / totalSeconds);
    timingByEdge.set(edge, { startFrac, endFrac });
    arrivalByNode.set(edge.to, Math.max(arrivalByNode.get(edge.to) ?? 0, endFrac));
  }

  return { totalSeconds, timingByEdge, arrivalByNode };
}

const CORNER_RADIUS = 8; // 10 * 0.8

function edgePath(from: Placed, to: Placed): { d: string; midX: number; midY: number } {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  if (Math.abs(x1 - x2) < 1) {
    return { d: `M ${x1} ${y1} L ${x2} ${y2}`, midX: x1, midY: (y1 + y2) / 2 };
  }
  const midY = (y1 + y2) / 2;
  const dir = x2 > x1 ? 1 : -1;
  const r = Math.min(CORNER_RADIUS, Math.abs(x2 - x1) / 2, midY - y1, y2 - midY);
  const d =
    `M ${x1} ${y1} L ${x1} ${midY - r} ` +
    `Q ${x1} ${midY} ${x1 + dir * r} ${midY} ` +
    `L ${x2 - dir * r} ${midY} ` +
    `Q ${x2} ${midY} ${x2} ${midY + r} ` +
    `L ${x2} ${y2}`;
  return { d, midX: (x1 + x2) / 2, midY };
}

/** Renders a FlowSpec (a small acyclic node/edge graph) to a self-contained, animated SVG diagram string for embedding in docs pages. */
export function renderFlow(spec: FlowSpec): string {
  const { placed, width, height, maxDepth } = layout(spec);
  const { totalSeconds, timingByEdge, arrivalByNode } = computeTiming(placed, spec, maxDepth);

  const wires: string[] = [];
  const dots: string[] = [];
  const labels: string[] = [];

  for (const edge of spec.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    const { d, midX, midY } = edgePath(from, to);
    // html-ok: d is built in edgePath() from numeric coordinates only, never user input
    wires.push(`<path class="wire" d="${d}"/>`);
    if (edge.label) {
      labels.push(
        `<text class="edge-label" x="${midX}" y="${midY - 6}" text-anchor="middle">${escapeHtml(edge.label)}</text>`,
      );
    }

    const timing = timingByEdge.get(edge);
    if (!timing) continue;
    const { startFrac, endFrac } = timing;
    const fadeIn = Math.min(startFrac + 0.02, endFrac);
    const fadeOut = Math.min(endFrac + 0.02, 1);
    dots.push(
      `<circle r="3.2" class="dot">` +
        `<animateMotion dur="${totalSeconds}s" repeatCount="indefinite" calcMode="linear" ` +
        `keyPoints="0;0;1;1" keyTimes="0;${startFrac};${endFrac};1" path="${d}"/>` +
        `<animate attributeName="opacity" dur="${totalSeconds}s" repeatCount="indefinite" ` +
        `values="0;0;1;1;0;0" keyTimes="0;${startFrac};${fadeIn};${endFrac};${fadeOut};1"/>` +
        `</circle>`,
    );
  }

  const cards = spec.nodes.map((node) => {
    const p = placed.get(node.id);
    if (!p) return "";
    const arrival = arrivalByNode.get(node.id) ?? 0.02;
    const pulseEnd = Math.min(arrival + 0.05, 1);
    const badgeX = p.x + PAD_X;
    const badgeY = p.y + (p.height - BADGE) / 2;
    const textX = badgeX + BADGE + GAP_BADGE_TEXT;
    const isTerminal = node.kind === "terminal";
    const badgeFill = isTerminal
      ? "var(--flow-card)"
      : node.icon === "check"
        ? "var(--flow-green)"
        : "var(--flow-badge)";
    const badgeClass = isTerminal ? "flow-badge flow-badge-terminal" : "flow-badge";
    const iconGroupClass = isTerminal ? "flow-icon-terminal" : "";
    const iconInset = (BADGE - ICON_SIZE) / 2;
    const iconInner =
      node.icon === "ai"
        ? `<text class="flow-ai-label" x="${BADGE / 2}" y="${BADGE / 2 + 3}" text-anchor="middle">AI</text>`
        : // html-ok: ICONS is a static internal map keyed by the FlowIcon union, not user input
          `<svg class="${iconGroupClass}" x="${iconInset}" y="${iconInset}" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24">${ICONS[node.icon ?? "box"]}</svg>`;

    return `<g>
      <rect class="flow-card" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="9">
        <animate attributeName="stroke" dur="${totalSeconds}s" repeatCount="indefinite"
          values="var(--flow-card-border);var(--flow-card-border);var(--flow-violet);var(--flow-card-border);var(--flow-card-border)"
          keyTimes="0;${Math.max(0, arrival - 0.02)};${arrival};${pulseEnd};1"/>
      </rect>
      <g transform="translate(${badgeX}, ${badgeY})">
        <rect class="${badgeClass}" width="${BADGE}" height="${BADGE}" rx="6" fill="${badgeFill}"/>
        ${iconInner}
      </g>
      <text class="flow-title" x="${textX}" y="${node.sub ? p.y + p.height / 2 - 2 : p.y + p.height / 2 + 3.5}">${escapeHtml(node.title)}</text>
      ${node.sub ? `<text class="flow-sub" x="${textX}" y="${p.y + p.height / 2 + 11}">${escapeHtml(node.sub)}</text>` : ""}
    </g>`;
  });

  // html-ok: wires/dots/labels/cards hold only fragments built from numeric
  // coordinates or already-escaped text (escapeHtml above), never raw user input
  return `<div class="kumiko-flow">
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Flow diagram">
    ${
      // html-ok: see comment above return
      wires.join("\n    ")
    }
    ${
      // html-ok: see comment above return
      dots.join("\n    ")
    }
    ${
      // html-ok: see comment above return
      labels.join("\n    ")
    }
    ${
      // html-ok: see comment above return
      cards.join("\n    ")
    }
  </svg>
</div>`;
}
