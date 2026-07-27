import { describe, expect, test } from "bun:test";
import { schedulerIdForJobName } from "../job-runner";

describe("schedulerIdForJobName", () => {
  test("strips dots and colons so BullMQ job ids stay under the 5-segment legacy heuristic", () => {
    // Job id becomes repeat:<id>:<millis> — colons in <id> previously pushed
    // the segment count to ≥5 and leaked a permanent hash per cron tick
    // (fw#1603 / bullmq#3828).
    const id = schedulerIdForJobName("publicstatus:job:uptime-probe");
    expect(id).toBe("scheduler-publicstatus-job-uptime-probe");
    expect(id.includes(":")).toBe(false);
    expect(`repeat:${id}:1784992080000`.split(":").length).toBeLessThan(5);
  });

  test("still collapses dotted QNs", () => {
    expect(schedulerIdForJobName("app.job.tick")).toBe("scheduler-app-job-tick");
  });
});
