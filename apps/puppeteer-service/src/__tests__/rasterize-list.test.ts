import { describe, expect, test } from "bun:test";
import { hasOversizedImage } from "../rasterize";

const HEADER = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------`;

describe("hasOversizedImage", () => {
  test("small images pass", () => {
    expect(hasOversizedImage(`${HEADER}\n   1     0 image     400   300  rgb     3   8  image  no        10  0   120   120 5000B 1.4%\n`)).toBe(false);
  });

  test("one image above the pixel limit trips the guard", () => {
    const list = `${HEADER}\n   1     0 image     400   300  rgb     3   8  image  no        10  0   120   120 5000B 1.4%\n   2     1 image    9000  9000  rgb     3   8  image  no        11  0   120   120 9000B 0.0%\n`;
    expect(hasOversizedImage(list)).toBe(true);
  });

  test("header-only and empty output is not oversized", () => {
    expect(hasOversizedImage(HEADER)).toBe(false);
    expect(hasOversizedImage("")).toBe(false);
  });
});
