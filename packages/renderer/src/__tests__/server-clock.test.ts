import { afterEach, describe, expect, test } from "bun:test";
import { noteServerClock, resetServerClock, serverNowMs } from "../server-clock.ts";

const HOUR_MS = 3_600_000;

describe("server clock", () => {
  afterEach(resetServerClock);

  test("x-kumiko-now wins over the Date header", () => {
    noteServerClock(
      new Headers({
        "x-kumiko-now": "2031-05-06T07:08:09Z",
        date: new Date(Date.now() + HOUR_MS).toUTCString(),
      }),
    );
    expect(Math.abs(serverNowMs() - Date.parse("2031-05-06T07:08:09Z"))).toBeLessThan(2_000);
  });

  test("without x-kumiko-now the Date header is used", () => {
    noteServerClock(new Headers({ date: new Date(Date.now() + HOUR_MS).toUTCString() }));
    expect(Math.abs(serverNowMs() - (Date.now() + HOUR_MS))).toBeLessThan(2_000);
  });

  test("no or invalid headers keep the device clock", () => {
    noteServerClock(new Headers());
    noteServerClock(new Headers({ "x-kumiko-now": "not a date" }));
    expect(Math.abs(serverNowMs() - Date.now())).toBeLessThan(50);
  });
});
