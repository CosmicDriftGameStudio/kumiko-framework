import { describe, expect, test } from "bun:test";
import type { ConfigAccessor } from "@cosmicdrift/kumiko-types/config";
import type { Logger } from "../../logging/types.ts";
import { resolveJobTz } from "../job-runner-helpers.ts";

function recordingLogger(): { logger: Pick<Logger, "warn">; warnings: string[] } {
  const warnings: string[] = [];
  return {
    logger: {
      warn: (message) => {
        warnings.push(message);
      },
    },
    warnings,
  };
}

describe("resolveJobTz", () => {
  test("a throwing config accessor falls back to UTC and logs instead of failing the run", async () => {
    const { logger, warnings } = recordingLogger();
    const config: ConfigAccessor = async () => {
      throw new Error("config store unavailable");
    };

    const tz = await resolveJobTz(config, {}, logger);

    expect(tz.tenant).toBe("UTC");
    expect(warnings).toEqual(["tenant timezone config read failed, falling back to UTC"]);
  });

  test("a configured tenant timezone is used when the read succeeds", async () => {
    const { logger, warnings } = recordingLogger();
    const config: ConfigAccessor = async () => "Europe/Berlin";

    const tz = await resolveJobTz(config, {}, logger);

    expect(tz.tenant).toBe("Europe/Berlin");
    expect(warnings).toEqual([]);
  });
});
