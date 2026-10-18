import { describe, expect, test } from "bun:test";
import { parseBackfillPiiArgs } from "../commands/ops/backfill-pii";

describe("parseBackfillPiiArgs", () => {
  test("no flag runs the real backfill without owner resolution or erasure", () => {
    expect(parseBackfillPiiArgs([])).toEqual({
      mode: "backfill",
      dryRun: false,
      resolveOwnerFromProjection: false,
      rekeyTenantKeyedOwnerFields: false,
      eraseUnresolvableSubjects: false,
    });
  });

  test("backfill flags map onto the backfill options", () => {
    expect(
      parseBackfillPiiArgs([
        "--dry-run",
        "--resolve-owner-from-projection",
        "--rekey-tenant-keyed-owner-fields",
        "--erase-unresolvable-subjects",
      ]),
    ).toEqual({
      mode: "backfill",
      dryRun: true,
      resolveOwnerFromProjection: true,
      rekeyTenantKeyedOwnerFields: true,
      eraseUnresolvableSubjects: true,
    });
  });

  test("--rebuild alone switches to rebuild-only mode", () => {
    expect(parseBackfillPiiArgs(["--rebuild"])).toEqual({ mode: "rebuild" });
  });

  test("--rebuild combined with a backfill flag is rejected", () => {
    expect(() => parseBackfillPiiArgs(["--rebuild", "--dry-run"])).toThrow("takes no other flag");
  });

  test("a misspelled flag fails instead of running the real backfill", () => {
    expect(() => parseBackfillPiiArgs(["--dryrun"])).toThrow("unknown flag: --dryrun");
  });
});
