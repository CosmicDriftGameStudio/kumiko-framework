import { describe, expect, test } from "bun:test";
import { buildDeepLinkUrl } from "../deep-link";

describe("buildDeepLinkUrl()", () => {
  test("screenId only", () => {
    expect(buildDeepLinkUrl("https://app.example.com", { screenId: "jobs" })).toBe(
      "https://app.example.com/jobs",
    );
  });

  test("screenId + entityId", () => {
    expect(
      buildDeepLinkUrl("https://app.example.com", { screenId: "jobs", entityId: "job-1" }),
    ).toBe("https://app.example.com/jobs/job-1");
  });

  test("workspaceId + screenId + entityId, in path order", () => {
    expect(
      buildDeepLinkUrl("https://app.example.com", {
        workspaceId: "admin",
        screenId: "jobs",
        entityId: "job-1",
      }),
    ).toBe("https://app.example.com/admin/jobs/job-1");
  });

  test("strips trailing slash(es) from baseUrl", () => {
    expect(buildDeepLinkUrl("https://app.example.com/", { screenId: "jobs" })).toBe(
      "https://app.example.com/jobs",
    );
    expect(buildDeepLinkUrl("https://app.example.com//", { screenId: "jobs" })).toBe(
      "https://app.example.com/jobs",
    );
  });
});
