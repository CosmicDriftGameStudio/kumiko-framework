import { describe, expect, test } from "bun:test";
import { describeUnparseableTscFailure } from "../check-app-tsc";

// #386/1: wenn tsc -b mit exit≠0 endet aber keine Zeile auf `/ error TS\d+:/`
// matcht (Spawn-Fehler, Config-Load, `error TS6053:` ohne führendes Space),
// druckte der Runner irreführend "0 error(s)" und exitete 1. Der Helper baut
// die Diagnose, die diesen Pfad sichtbar macht.
describe("describeUnparseableTscFailure", () => {
  test("spawn error (status null) → surfaces spawn error + no-output note", () => {
    const msg = describeUnparseableTscFailure(
      { status: null, error: new Error("spawn tsc ENOENT") },
      "",
    );
    expect(msg).toContain("no parseable");
    expect(msg).toContain("spawn error: spawn tsc ENOENT");
    expect(msg).toContain("exit status: null");
    expect(msg).toContain("(no stdout/stderr captured)");
  });

  test("non-zero exit with unparseable output → surfaces the raw output", () => {
    const raw = "error TS6053: File 'x.ts' not found.";
    const msg = describeUnparseableTscFailure({ status: 1 }, raw);
    expect(msg).toContain("exit status: 1");
    expect(msg).toContain("raw tsc output:");
    expect(msg).toContain(raw);
    // Kein Spawn-Fehler-Hinweis wenn result.error fehlt.
    expect(msg).not.toContain("spawn error");
  });
});
