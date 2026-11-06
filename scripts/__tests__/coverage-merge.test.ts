import { describe, expect, test } from "bun:test";
import { mergeLineCoverage, parseLcovLines } from "../coverage-merge";

const keepAll = (): boolean => false;

function record(file: string, lines: ReadonlyArray<readonly [number, number]>): string {
  return `SF:${file}\n${lines.map(([line, count]) => `DA:${line},${count}`).join("\n")}\nend_of_record\n`;
}

describe("parseLcovLines", () => {
  test("keeps the highest count when a file appears twice in one lcov", () => {
    const lcov = record("src/a.ts", [[1, 0], [2, 3]]) + record("src/a.ts", [[1, 2], [2, 0]]);
    expect(parseLcovLines(lcov, keepAll).get("src/a.ts")).toEqual(
      new Map([
        [1, 2],
        [2, 3],
      ]),
    );
  });

  test("drops ignored files and normalizes backslashes", () => {
    const lcov = record("src\\a.ts", [[1, 1]]) + record("gen/b.ts", [[1, 1]]);
    const parsed = parseLcovLines(lcov, (file) => file.startsWith("gen/"));
    expect([...parsed.keys()]).toEqual(["src/a.ts"]);
  });
});

describe("mergeLineCoverage across shards", () => {
  test("a file covered by different lines in two shards counts the union of hit lines", () => {
    const shard1 = parseLcovLines(record("src/a.ts", [[1, 1], [2, 0], [3, 0]]), keepAll);
    const shard2 = parseLcovLines(record("src/a.ts", [[1, 0], [2, 4], [3, 0]]), keepAll);

    expect(mergeLineCoverage([shard1, shard2])).toEqual({ lines: 3, hit: 2 });
  });

  test("files exclusive to one shard are added, nothing is lost by the other shard's lack of them", () => {
    const shard1 = parseLcovLines(record("src/a.ts", [[1, 1]]), keepAll);
    const shard2 = parseLcovLines(record("src/b.ts", [[1, 1], [2, 0]]), keepAll);

    expect(mergeLineCoverage([shard1, shard2, new Map()])).toEqual({ lines: 3, hit: 2 });
  });
});
