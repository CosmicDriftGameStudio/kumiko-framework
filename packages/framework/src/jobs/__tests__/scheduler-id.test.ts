import { describe, expect, test } from "bun:test";
import { bootJobIdForJobName, schedulerIdForJobName } from "../job-runner";

describe("schedulerIdForJobName", () => {
  test("strips dots and colons so BullMQ job ids stay under the 5-segment legacy heuristic", () => {
    // Job id becomes repeat:<id>:<millis> — colons in <id> previously pushed
    // the segment count to ≥5 and leaked a permanent hash per cron tick
    // (fw#1603 / bullmq#3828).
    const id = schedulerIdForJobName("publicstatus:job:uptime-probe");
    expect(id).toBe("scheduler-publicstatus-job-uptime-probe");
    expect(id.includes(":")).toBe(false);
    expect(`repeat:${id}:1784992080000`.split(":").length).toBe(3);
  });

  test("still collapses dotted QNs", () => {
    expect(schedulerIdForJobName("app.job.tick")).toBe("scheduler-app-job-tick");
  });
});

describe("bootJobIdForJobName", () => {
  test("strips colons, same hazard as schedulerIdForJobName (fw#1604)", () => {
    const id = bootJobIdForJobName("publicstatus:job:uptime-probe");
    expect(id).toBe("boot-publicstatus-job-uptime-probe");
    expect(id.includes(":")).toBe(false);
  });

  test("still collapses dotted QNs", () => {
    expect(bootJobIdForJobName("app.job.tick")).toBe("boot-app-job-tick");
  });
});
