import { describe, expect, test } from "bun:test";
import type { Logger } from "../../logging/types.ts";
import { createJobLogger } from "../job-runner-helpers.ts";
import type { JobLogEntry } from "../job-runner-types.ts";

type PodLine = {
  readonly level: "warn" | "error";
  readonly msg: string;
  readonly meta: Record<string, unknown> | undefined;
};

function setup() {
  const podLines: PodLine[] = [];
  const logger: Pick<Logger, "warn" | "error"> = {
    warn: (msg, meta) => podLines.push({ level: "warn", msg, meta }),
    error: (msg, meta) => podLines.push({ level: "error", msg, meta }),
  };
  const logs: JobLogEntry[] = [];
  const jobLogger = createJobLogger(logs, {}, { logger, job: "feat:job:x", runId: "run-1" });
  return { podLines, logs, jobLogger };
}

describe("createJobLogger pod-log sink", () => {
  test("error reaches the pod log redacted with only job, runId and level", () => {
    const { podLines, jobLogger } = setup();
    jobLogger.error("send to ops@example.com failed https://hooks.slack.com/services/T/B/SECRET");
    expect(podLines).toHaveLength(1);
    const [line] = podLines;
    expect(line?.level).toBe("error");
    expect(line?.msg).toContain("[redacted-address]");
    expect(line?.msg).not.toContain("ops@example.com");
    expect(line?.msg).not.toContain("SECRET");
    expect(line?.meta).toEqual({ job: "feat:job:x", runId: "run-1", level: "error" });
  });

  test("scrubs PG key detail, bearer tokens and JWTs from the pod log", () => {
    const { podLines, jobLogger } = setup();
    jobLogger.error(
      "duplicate key value violates unique constraint: Key (phone)=(+491701234567) already exists",
    );
    jobLogger.error("request failed Authorization: Bearer abc.def.ghi");
    jobLogger.warn("bad token eyJhbGciOi.eyJzdWIi.sig");
    const out = JSON.stringify(podLines);
    expect(out).not.toContain("+491701234567");
    expect(out).not.toContain("abc.def.ghi");
    expect(out).not.toContain("eyJhbGciOi.eyJzdWIi.sig");
  });

  test("data never reaches the pod log but stays in the run log", () => {
    const { podLines, logs, jobLogger } = setup();
    jobLogger.warn("lookup failed", { email: "x@y.z", token: "abc" });
    expect(JSON.stringify(podLines)).not.toContain("x@y.z");
    expect(JSON.stringify(podLines)).not.toContain("abc");
    expect(podLines[0]?.meta).toEqual({ job: "feat:job:x", runId: "run-1", level: "warn" });
    expect(logs[0]?.message).toBe('lookup failed {"email":"x@y.z","token":"abc"}');
  });

  test("info and debug stay out of the pod log", () => {
    const { podLines, logs, jobLogger } = setup();
    jobLogger.info("started");
    jobLogger.debug("detail");
    expect(podLines).toEqual([]);
    expect(logs).toHaveLength(1);
  });

  test("child keeps the sink but never leaks its context", () => {
    const { podLines, logs, jobLogger } = setup();
    jobLogger.child({ a: 1, mail: "leak@example.com" }).warn("child warning");
    expect(podLines).toHaveLength(1);
    expect(podLines[0]?.msg).toBe("child warning");
    expect(JSON.stringify(podLines)).not.toContain("leak@example.com");
    expect(logs[0]?.message).toContain('"a":1');
  });

  test("without a sink nothing is written to a logger", () => {
    const logs: JobLogEntry[] = [];
    createJobLogger(logs).error("x");
    expect(logs).toHaveLength(1);
  });
});
