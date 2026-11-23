import { describe, expect, test } from "bun:test";
import {
  exceedsImageBudget,
  InvalidPdfError,
  listedImagesWithinBudget,
  MAX_LISTED_IMAGES,
  readCappedText,
} from "../rasterize";

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

function streamOf(chunks: readonly Uint8Array[]): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly pulls: () => number;
} {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled];
      pulled += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return { stream, pulls: () => pulled };
}

describe("readCappedText", () => {
  test("input under the limit comes back whole", async () => {
    const { stream } = streamOf([new TextEncoder().encode("hello")]);
    expect(await readCappedText(stream, 100)).toEqual({ text: "hello", truncated: false });
  });

  test("input of exactly maxBytes is not truncated", async () => {
    const { stream } = streamOf([new TextEncoder().encode("12345")]);
    expect(await readCappedText(stream, 5)).toEqual({ text: "12345", truncated: false });
  });

  test("multi-chunk input over the limit is cut and the stream still drained", async () => {
    const chunks = Array.from({ length: 5 }, () => new Uint8Array(400).fill(97));
    const { stream, pulls } = streamOf(chunks);
    const result = await readCappedText(stream, 1000);
    expect(result.text).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(pulls()).toBeGreaterThanOrEqual(chunks.length);
  });
});

describe("listedImagesWithinBudget", () => {
  const small = list([row(0, 400, 300)]);

  test("truncated stdout is over budget even with exit 0", () => {
    expect(
      listedImagesWithinBudget({ exitCode: 0, stdout: small, stdoutTruncated: true, stderr: "" }),
    ).toBe(false);
  });

  test("truncated stdout with a failing exit does not throw", () => {
    expect(
      listedImagesWithinBudget({ exitCode: 1, stdout: "", stdoutTruncated: true, stderr: "boom" }),
    ).toBe(false);
  });

  test("a failing exit without truncation throws InvalidPdfError with the stderr text", () => {
    const listFailingRun = () =>
      listedImagesWithinBudget({
        exitCode: 1,
        stdout: "",
        stdoutTruncated: false,
        stderr: "bad pdf\n",
      });
    expect(listFailingRun).toThrow(InvalidPdfError);
    expect(listFailingRun).toThrow("bad pdf");
  });

  test("small lists pass, an oversized image does not", () => {
    expect(
      listedImagesWithinBudget({ exitCode: 0, stdout: small, stdoutTruncated: false, stderr: "" }),
    ).toBe(true);
    expect(
      listedImagesWithinBudget({
        exitCode: 0,
        stdout: list([row(0, 9000, 9000)]),
        stdoutTruncated: false,
        stderr: "",
      }),
    ).toBe(false);
  });
});
