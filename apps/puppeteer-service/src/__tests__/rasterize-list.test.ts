import { describe, expect, test } from "bun:test";
import { exceedsImageBudget, MAX_LISTED_IMAGES } from "../rasterize";

const HEADER = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------`;

function row(num: number, width: number, height: number): string {
  return `   1 ${String(num).padStart(5)} image ${String(width).padStart(7)} ${String(height).padStart(6)}  rgb     3   8  image  no        10  0   120   120 5000B 1.4%`;
}

function list(rows: readonly string[]): string {
  return `${HEADER}\n${rows.join("\n")}\n`;
}

describe("exceedsImageBudget", () => {
  test("small images pass", () => {
    expect(exceedsImageBudget(list([row(0, 400, 300)]))).toBe(false);
  });

  test("one image above the per-image pixel limit trips the guard", () => {
    expect(exceedsImageBudget(list([row(0, 400, 300), row(1, 9000, 9000)]))).toBe(true);
  });

  test("many images that are each below the limit but together above the pixel budget trip the guard", () => {
    const rows = Array.from({ length: 5 }, (_, num) => row(num, 4900, 4900));
    expect(exceedsImageBudget(list(rows))).toBe(true);
  });

  test("more listed images than the cap trip the guard even when tiny", () => {
    const rows = Array.from({ length: MAX_LISTED_IMAGES + 1 }, (_, num) => row(num, 10, 10));
    expect(exceedsImageBudget(list(rows))).toBe(true);
    expect(exceedsImageBudget(list(rows.slice(0, MAX_LISTED_IMAGES)))).toBe(false);
  });

  test("header-only and empty output is within budget", () => {
    expect(exceedsImageBudget(HEADER)).toBe(false);
    expect(exceedsImageBudget("")).toBe(false);
  });
});
