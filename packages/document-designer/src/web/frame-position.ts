import type { MarginsMm, PaperSize } from "./paper-geometry.ts";

export type FrameBox = {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
};

export const DIN_5008_FORMS = ["form-a", "form-b"] as const;
export type Din5008Form = (typeof DIN_5008_FORMS)[number];
export type FramePosition = Din5008Form | "free";

const DIN_5008_LEFT_MM = 20;
const DIN_5008_WIDTH_MM = 85;
const DIN_5008_HEIGHT_MM = 45;
const DIN_5008_TOP_MM: Readonly<Record<Din5008Form, number>> = { "form-a": 27, "form-b": 45 };

export function din5008Box(form: Din5008Form): FrameBox {
  return {
    xMm: DIN_5008_LEFT_MM,
    yMm: DIN_5008_TOP_MM[form],
    widthMm: DIN_5008_WIDTH_MM,
    heightMm: DIN_5008_HEIGHT_MM,
  };
}

function sameBox(a: FrameBox, b: FrameBox): boolean {
  return a.xMm === b.xMm && a.yMm === b.yMm && a.widthMm === b.widthMm && a.heightMm === b.heightMm;
}

export function framePositionOf(box: FrameBox): FramePosition {
  return DIN_5008_FORMS.find((form) => sameBox(box, din5008Box(form))) ?? "free";
}

export type FrameOverhang = {
  readonly intoTopMargin: boolean;
  readonly beyondPaper: boolean;
};

export function frameOverhangOf(
  box: FrameBox,
  paper: PaperSize,
  margins: MarginsMm,
): FrameOverhang {
  return {
    intoTopMargin: box.yMm < margins.top,
    beyondPaper: box.xMm + box.widthMm > paper.widthMm || box.yMm + box.heightMm > paper.heightMm,
  };
}

export function hasFrameOverhang(overhang: FrameOverhang): boolean {
  return overhang.intoTopMargin || overhang.beyondPaper;
}
