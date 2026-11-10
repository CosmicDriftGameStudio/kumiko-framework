import { describe, expect, test } from "bun:test";
import {
  addressFrameContent,
  columnsTableContent,
  frameTagKind,
  moveFrameBox,
  resizeFrameBox,
  roundToHalfMm,
  snapFrameBox,
  textFrameContent,
} from "../document-frame-control.ts";

const BOX = { xMm: 20, yMm: 45, widthMm: 85, heightMm: 45 };

describe("roundToHalfMm", () => {
  test("snaps to 0.5 mm", () => {
    expect(roundToHalfMm(10.3)).toBe(10.5);
    expect(roundToHalfMm(10.2)).toBe(10);
  });
});

describe("moveFrameBox", () => {
  test("moves and rounds, keeping the size", () => {
    expect(moveFrameBox(BOX, 5.2, -3.1)).toEqual({ ...BOX, xMm: 25, yMm: 42 });
  });

  test("never leaves the paper at the top left", () => {
    expect(moveFrameBox(BOX, -100, -100)).toEqual({ ...BOX, xMm: 0, yMm: 0 });
  });
});

describe("resizeFrameBox", () => {
  test("se grows width and height", () => {
    expect(resizeFrameBox(BOX, "se", 10, 5)).toEqual({ ...BOX, widthMm: 95, heightMm: 50 });
  });

  test("nw keeps the opposite corner fixed", () => {
    expect(resizeFrameBox(BOX, "nw", 5, 5)).toEqual({
      xMm: 25,
      yMm: 50,
      widthMm: 80,
      heightMm: 40,
    });
  });

  test("edge handles change one dimension only", () => {
    expect(resizeFrameBox(BOX, "e", 10, 99)).toEqual({ ...BOX, widthMm: 95 });
    expect(resizeFrameBox(BOX, "s", 99, 5)).toEqual({ ...BOX, heightMm: 50 });
    expect(resizeFrameBox(BOX, "w", 5, 99)).toEqual({ ...BOX, xMm: 25, widthMm: 80 });
    expect(resizeFrameBox(BOX, "n", 99, 5)).toEqual({ ...BOX, yMm: 50, heightMm: 40 });
  });

  test("edge handles keep the opposite edge at the minimum size", () => {
    expect(resizeFrameBox(BOX, "w", 500, 0)).toMatchObject({ xMm: 95, widthMm: 10 });
    expect(resizeFrameBox(BOX, "n", 0, 500)).toMatchObject({ yMm: 80, heightMm: 10 });
  });

  test("does not shrink below the minimum size", () => {
    const result = resizeFrameBox(BOX, "ne", -500, 500);
    expect(result.widthMm).toBe(10);
    expect(result.yMm + result.heightMm).toBe(90);
  });
});

describe("frame defaults", () => {
  test("the text frame sits right of the address field and does not reserve flow", () => {
    expect(textFrameContent().attrs).toMatchObject({
      xMm: 125,
      yMm: 50,
      widthMm: 65,
      heightMm: 34,
      reserveFlow: false,
    });
    expect(addressFrameContent().attrs).toMatchObject({ reserveFlow: true });
  });

  test("the columns block has four cells", () => {
    expect(columnsTableContent().content?.[0]?.content).toHaveLength(4);
  });
});

describe("frameTagKind", () => {
  test("names DIN 5008 forms by position", () => {
    expect(frameTagKind("address", 27)).toBe("addressFormA");
    expect(frameTagKind("address", 45)).toBe("addressFormB");
    expect(frameTagKind("address", 60)).toBe("address");
    expect(frameTagKind("text", 45)).toBe("text");
  });
});

describe("snapFrameBox", () => {
  const targets = {
    xLinesMm: [20, 105],
    yLinesMm: [45, 90],
    widthsMm: [85],
    heightsMm: [34],
  };

  test("move snaps the left edge to a line and keeps the size", () => {
    const { box, guides } = snapFrameBox({ ...BOX, xMm: 21 }, "move", targets);
    expect(box).toEqual({ ...BOX, xMm: 20 });
    expect(guides.xMm).toBe(20);
  });

  test("move snaps the right edge when it is the nearer one", () => {
    const { box, guides } = snapFrameBox({ ...BOX, xMm: 40.5, widthMm: 65 }, "move", targets);
    expect(box).toMatchObject({ xMm: 40, widthMm: 65 });
    expect(guides.xMm).toBe(105);
  });

  test("move snaps the top edge", () => {
    const { box, guides } = snapFrameBox({ ...BOX, xMm: 0, yMm: 46 }, "move", targets);
    expect(box.yMm).toBe(45);
    expect(guides.yMm).toBe(45);
  });

  test("resize snaps only the dragged edge to a line", () => {
    const { box, guides } = snapFrameBox({ ...BOX, xMm: 30, widthMm: 74 }, "e", targets);
    expect(box).toMatchObject({ xMm: 30, widthMm: 75 });
    expect(guides.xMm).toBe(105);
    expect(guides.yMm).toBeNull();
  });

  test("resize from the west keeps the right edge", () => {
    const { box } = snapFrameBox({ ...BOX, xMm: 21, widthMm: 84 }, "w", targets);
    expect(box).toMatchObject({ xMm: 20, widthMm: 85 });
  });

  test("the width snaps to another frame's width without a guide", () => {
    const { box, guides } = snapFrameBox(
      { xMm: 125, yMm: 50, widthMm: 84, heightMm: 34 },
      "e",
      targets,
    );
    expect(box.widthMm).toBe(85);
    expect(guides.xMm).toBeNull();
  });

  test("nothing snaps outside the tolerance", () => {
    const input = { xMm: 30, yMm: 60, widthMm: 50, heightMm: 20 };
    expect(snapFrameBox(input, "move", targets)).toEqual({
      box: input,
      guides: { xMm: null, yMm: null },
    });
  });

  test("a snap never shrinks below the minimum size", () => {
    const input = { xMm: 20, yMm: 50, widthMm: 11, heightMm: 20 };
    const { box } = snapFrameBox(input, "e", { ...targets, xLinesMm: [29], widthsMm: [] }, 3);
    expect(box.widthMm).toBe(11);
  });
});
