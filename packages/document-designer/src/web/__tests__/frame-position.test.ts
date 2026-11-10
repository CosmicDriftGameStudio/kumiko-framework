import { describe, expect, test } from "bun:test";
import {
  din5008Box,
  frameOverhangOf,
  framePositionOf,
  hasFrameOverhang,
} from "../frame-position.ts";

const PAPER = { widthMm: 210, heightMm: 297 };
const MARGINS = { top: 15, right: 15, bottom: 15, left: 20 };

describe("framePositionOf", () => {
  test("recognises the two DIN 5008 forms and calls everything else free", () => {
    expect(framePositionOf(din5008Box("form-a"))).toBe("form-a");
    expect(framePositionOf(din5008Box("form-b"))).toBe("form-b");
    expect(framePositionOf({ ...din5008Box("form-b"), xMm: 21 })).toBe("free");
  });

  test("the forms differ only in the top offset", () => {
    expect(din5008Box("form-a").yMm).toBe(27);
    expect(din5008Box("form-b").yMm).toBe(45);
  });
});

describe("frameOverhangOf", () => {
  test("a frame inside the content area overhangs nothing", () => {
    expect(hasFrameOverhang(frameOverhangOf(din5008Box("form-b"), PAPER, MARGINS))).toBe(false);
  });

  test("reports a frame in the top margin; the left margin never overhangs", () => {
    const overhang = frameOverhangOf(
      { xMm: 10, yMm: 5, widthMm: 50, heightMm: 20 },
      PAPER,
      MARGINS,
    );
    expect(overhang).toEqual({ intoTopMargin: true, beyondPaper: false });
  });

  test("reports a frame that leaves the paper", () => {
    const overhang = frameOverhangOf(
      { xMm: 150, yMm: 20, widthMm: 80, heightMm: 20 },
      PAPER,
      MARGINS,
    );
    expect(overhang.beyondPaper).toBe(true);
  });
});
