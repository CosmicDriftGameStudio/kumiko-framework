import { afterEach, describe, expect, test } from "bun:test";
import { createLogger } from "../pino-logger.ts";
import { createFallbackLogger, setProcessLogger } from "../utils.ts";

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "debug",
    destination: {
      write(chunk: string) {
        lines.push(JSON.parse(chunk));
      },
    },
  });
  return { logger, lines };
}

describe("process logger", () => {
  afterEach(() => setProcessLogger(null));

  test("a fallback logger created before setProcessLogger writes through it afterwards, tagged with component", () => {
    const earlyFallback = createFallbackLogger("redis");
    const { logger, lines } = captureLogger();

    setProcessLogger(logger);
    earlyFallback.warn("connection lost", { attempt: 2 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: "connection lost", component: "redis", attempt: 2 });
  });

  test("setProcessLogger(null) returns the fallback logger to console output", () => {
    const { logger, lines } = captureLogger();
    const fallback = createFallbackLogger("jobs");
    setProcessLogger(logger);
    setProcessLogger(null);

    fallback.debug("quiet");

    expect(lines).toHaveLength(0);
  });

  test("an explicit logger wins over the process logger", () => {
    const { logger, lines } = captureLogger();
    setProcessLogger(logger);
    const seen: string[] = [];

    createFallbackLogger("api", { error: (msg) => seen.push(msg) }).error("boom");

    expect(seen).toEqual(["[api] boom"]);
    expect(lines).toHaveLength(0);
  });
});
