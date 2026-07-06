import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/feature";
import { JOB_RUN_DETAIL_SCREEN_ID, JOB_RUNS_SCREEN_ID, JobHandlers, JobQueries } from "../constants";
import { createJobsFeature } from "../feature";

const SYSTEM_ADMIN_ROLES = ["SystemAdmin"] as const;

describe("jobs screens + handler access alignment", () => {
  const features = [createConfigFeature(), createJobsFeature()];

  test("boot-validates with job-runs screens registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("job-runs screens are SystemAdmin-gated", () => {
    const jobs = createJobsFeature();
    for (const id of [JOB_RUNS_SCREEN_ID, JOB_RUN_DETAIL_SCREEN_ID] as const) {
      const screen = jobs.screens[id];
      expect(screen?.type).toBe("custom");
      if (screen && "access" in screen && screen.access && "roles" in screen.access) {
        expect(screen.access.roles).toEqual(SYSTEM_ADMIN_ROLES);
      }
    }
  });

  test("jobs queries + operator writes share SystemAdmin access", () => {
    const jobs = createJobsFeature();
    const roles = [...SYSTEM_ADMIN_ROLES];
    expect(rolesOf(jobs.queryHandlers["list"]?.access)).toEqual(roles);
    expect(rolesOf(jobs.queryHandlers["details"]?.access)).toEqual(roles);
    expect(rolesOf(jobs.writeHandlers["trigger"]?.access)).toEqual(roles);
    expect(rolesOf(jobs.writeHandlers["retry"]?.access)).toEqual(roles);
  });
});
