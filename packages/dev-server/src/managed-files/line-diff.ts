// Unified-style line diff for drift reports. Managed files are a few hundred
// lines at most, so the quadratic LCS table stays small.
const CONTEXT_LINES = 2;

type DiffOp = { readonly kind: " " | "-" | "+"; readonly line: string };

type LcsTable = { readonly lengthAt: (i: number, j: number) => number };

function buildLcsTable(expected: readonly string[], actual: readonly string[]): LcsTable {
  const cols = actual.length + 1;
  const table = new Uint32Array((expected.length + 1) * cols);
  const lengthAt = (i: number, j: number): number => table[i * cols + j] ?? 0;
  for (let i = expected.length - 1; i >= 0; i--) {
    for (let j = actual.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        expected[i] === actual[j]
          ? lengthAt(i + 1, j + 1) + 1
          : Math.max(lengthAt(i + 1, j), lengthAt(i, j + 1));
    }
  }
  return { lengthAt };
}

function nextOp(
  left: string | undefined,
  right: string | undefined,
  dropLeftKeepsLonger: boolean,
): DiffOp {
  if (left !== undefined && left === right) return { kind: " ", line: left };
  if (right === undefined || (left !== undefined && dropLeftKeepsLonger))
    return { kind: "-", line: left ?? "" };
  return { kind: "+", line: right };
}

function diffOps(expected: readonly string[], actual: readonly string[]): readonly DiffOp[] {
  const lcs = buildLcsTable(expected, actual);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < expected.length || j < actual.length) {
    const op = nextOp(expected[i], actual[j], lcs.lengthAt(i + 1, j) >= lcs.lengthAt(i, j + 1));
    ops.push(op);
    if (op.kind !== "+") i++;
    if (op.kind !== "-") j++;
  }
  return ops;
}

/** `-` lines are what the template expects, `+` lines what the repo has. */
export function renderLineDiff(expected: string, actual: string): string {
  const ops = diffOps(expected.split("\n"), actual.split("\n"));
  const keep = ops.map((_op, index) =>
    ops
      .slice(Math.max(0, index - CONTEXT_LINES), index + CONTEXT_LINES + 1)
      .some((near) => near.kind !== " "),
  );
  const out: string[] = [];
  let skipped = false;
  for (const [index, op] of ops.entries()) {
    if (keep[index]) {
      if (skipped && out.length > 0) out.push("...");
      skipped = false;
      out.push(`${op.kind} ${op.line}`);
    } else {
      skipped = true;
    }
  }
  return out.join("\n");
}
