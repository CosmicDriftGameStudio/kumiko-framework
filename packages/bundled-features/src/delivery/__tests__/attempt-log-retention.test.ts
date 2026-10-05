import { describe, expect, test } from "bun:test";
import { resolveAttemptLogRetentionDays } from "../attempt-log-retention.js";
import { createDeliveryFeature } from "../feature.js";
import { DeliveryJobNames } from "../public-names.js";

describe("attempt log retention option", () => {
  test("defaults to 90 days", () => {
    expect(resolveAttemptLogRetentionDays(undefined)).toBe(90);
  });

  test("false disables retention", () => {
    expect(resolveAttemptLogRetentionDays(false)).toBeUndefined();
  });

  test.each([0, -1, 1.5, Number.NaN])("rejects %p", (days) => {
    expect(() => resolveAttemptLogRetentionDays(days)).toThrow(/attemptLogRetentionDays/);
  });

  test("the delivery feature registers the daily job by default", () => {
    const job = createDeliveryFeature().jobs[DeliveryJobNames.attemptLogRetention];
    expect(job?.trigger).toEqual({ cron: "15 3 * * *" });
  });

  test("attemptLogRetentionDays: false registers no job", () => {
    const feature = createDeliveryFeature({ attemptLogRetentionDays: false });
    expect(feature.jobs[DeliveryJobNames.attemptLogRetention]).toBeUndefined();
  });

  test("an invalid retention fails at feature creation", () => {
    expect(() => createDeliveryFeature({ attemptLogRetentionDays: 0 })).toThrow(
      /attemptLogRetentionDays/,
    );
  });
});
