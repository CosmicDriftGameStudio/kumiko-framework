import { describe, expect, test } from "bun:test";
import { readSseFrames } from "../sse-frames.ts";

const encoder = new TextEncoder();

function responseOfChunks(chunks: readonly string[], options?: { readonly closes?: boolean }) {
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk !== undefined) {
        controller.enqueue(encoder.encode(chunk));
      } else if (options?.closes !== false) {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(stream), wasCancelled: () => cancelled };
}

describe("readSseFrames", () => {
  test("parses frames across chunk boundaries, including a frame split over two chunks", async () => {
    const { response } = responseOfChunks([
      "event: a\ndata: 1\nid: 10\n\nevent: b\nda",
      "ta: 2\n\n",
      "data: 3\n\n",
    ]);
    const frames = await readSseFrames(response, { until: (_, all) => all.length === 3 });
    expect(frames).toEqual([
      { event: "a", data: "1", id: "10" },
      { event: "b", data: "2", id: undefined },
      { event: undefined, data: "3", id: undefined },
    ]);
  });

  test("skips pings and comment lines by default", async () => {
    const { response } = responseOfChunks([
      "event: ping\ndata: \n\n",
      ": keepalive\n\n",
      "event: real\ndata: x\n\n",
    ]);
    const frames = await readSseFrames(response, { until: (frame) => frame.event === "real" });
    expect(frames.map((f) => f.event)).toEqual(["real"]);
  });

  test("keeps pings when skipPings is false", async () => {
    const { response } = responseOfChunks(["event: ping\ndata: \n\n", "event: real\ndata: x\n\n"]);
    const frames = await readSseFrames(response, {
      skipPings: false,
      until: (frame) => frame.event === "real",
    });
    expect(frames.map((f) => f.event)).toEqual(["ping", "real"]);
  });

  test("joins multiple data lines with a newline", async () => {
    const { response } = responseOfChunks(["data: line1\ndata: line2\n\n"]);
    const frames = await readSseFrames(response, { until: () => true });
    expect(frames[0]?.data).toBe("line1\nline2");
  });

  test("throws when the stream ends before the condition is met", async () => {
    const { response } = responseOfChunks(["data: 1\n\n"]);
    await expect(readSseFrames(response, { until: () => false })).rejects.toThrow(
      "sse stream ended before condition: 1 frames read",
    );
  });

  test("throws on timeout and cancels the stream", async () => {
    const { response, wasCancelled } = responseOfChunks(["data: 1\n\n"], { closes: false });
    await expect(readSseFrames(response, { until: () => false, timeoutMs: 20 })).rejects.toThrow(
      "sse read timed out after 20ms: 1 frames read",
    );
    expect(wasCancelled()).toBe(true);
  });
});
