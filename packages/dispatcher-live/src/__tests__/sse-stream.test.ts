import { describe, expect, test } from "bun:test";
import { iterateSseChunks, parseSseFrames } from "../sse-stream";

describe("parseSseFrames", () => {
  test("parses chunk + done frames from a complete body", () => {
    const text = [
      "event: chunk",
      'data: {"i":0}',
      "",
      "event: chunk",
      'data: {"i":1}',
      "",
      "event: ping",
      "data: ",
      "",
      "event: done",
      "data: ",
      "",
    ].join("\n");

    expect(parseSseFrames(text)).toEqual([
      { event: "chunk", data: '{"i":0}' },
      { event: "chunk", data: '{"i":1}' },
      { event: "ping", data: "" },
      { event: "done", data: "" },
    ]);
  });
});

describe("iterateSseChunks", () => {
  test("yields JSON chunks, swallows ping, stops on done", async () => {
    const text = [
      "event: chunk",
      'data: {"i":0}',
      "",
      "event: ping",
      "data: ",
      "",
      "event: chunk",
      'data: {"i":1}',
      "",
      "event: done",
      "data: ",
      "",
    ].join("\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });

    const chunks: unknown[] = [];
    for await (const c of iterateSseChunks(stream)) chunks.push(c);
    expect(chunks).toEqual([{ i: 0 }, { i: 1 }]);
  });

  test("error frame throws mapped DispatcherError", async () => {
    const text = [
      "event: error",
      'data: {"code":"access_denied","httpStatus":403,"i18nKey":"errors.access","message":"nope"}',
      "",
    ].join("\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });

    await expect(async () => {
      for await (const _ of iterateSseChunks(stream)) {
        // no chunks expected
      }
    }).toThrow(/nope/);
  });

  test("stream closed without a done frame throws instead of ending cleanly", async () => {
    const text = ["event: chunk", 'data: {"i":0}', ""].join("\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });

    const chunks: unknown[] = [];
    await expect(async () => {
      for await (const c of iterateSseChunks(stream)) chunks.push(c);
    }).toThrow(/without a done frame/);
    expect(chunks).toEqual([{ i: 0 }]);
  });

  test("malformed chunk JSON throws a DispatcherError instead of a raw SyntaxError", async () => {
    const text = ["event: chunk", "data: {not json", "", "event: done", "data: ", ""].join("\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });

    await expect(async () => {
      for await (const _ of iterateSseChunks(stream)) {
        // no chunks expected
      }
    }).toThrow(/malformed chunk frame/);
  });

  test("cancels the reader on early break instead of leaving the response open", async () => {
    let cancelled = false;
    const text = ["event: chunk", 'data: {"i":0}', "", "event: chunk", 'data: {"i":1}', ""].join(
      "\n",
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
      },
      cancel() {
        cancelled = true;
      },
    });

    for await (const _ of iterateSseChunks(stream)) {
      break;
    }
    expect(cancelled).toBe(true);
  });
});
