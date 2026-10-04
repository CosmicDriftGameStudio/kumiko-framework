import { describe, expect, test } from "bun:test";
import { resolveAppStartedPayload } from "../record-app-started-on-boot";

const STARTED_AT = "2026-10-04T10:00:00Z";

describe("resolveAppStartedPayload", () => {
  test("takes version, commit and instance id from the environment", () => {
    expect(
      resolveAppStartedPayload(
        { KUMIKO_APP_VERSION: "1.2.3", KUMIKO_GIT_COMMIT: "abc1234", HOSTNAME: "pod-a" },
        "fallback-host",
        STARTED_AT,
      ),
    ).toEqual({ version: "1.2.3", commit: "abc1234", instanceId: "pod-a", startedAt: STARTED_AT });
  });

  test.each([
    ["missing", {}],
    ["empty", { KUMIKO_APP_VERSION: "", KUMIKO_GIT_COMMIT: "" }],
  ])("a %s version becomes 'unknown' and omits the commit", (_label, source) => {
    const payload = resolveAppStartedPayload({ ...source, HOSTNAME: "pod-a" }, "h", STARTED_AT);
    expect(payload.version).toBe("unknown");
    expect("commit" in payload).toBe(false);
  });

  test("falls back to the OS hostname when HOSTNAME is missing", () => {
    expect(resolveAppStartedPayload({}, "fallback-host", STARTED_AT).instanceId).toBe(
      "fallback-host",
    );
  });
});
