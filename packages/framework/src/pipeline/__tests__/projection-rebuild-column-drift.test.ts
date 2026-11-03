import { describe, expect, test } from "bun:test";
import { columnDriftLikelyCause } from "../projection-rebuild.ts";

const EXPECTED = /^Expected cause/;
const LIKELY = /^Likely cause/;

describe("columnDriftLikelyCause", () => {
  test("a complete sample that differs only in tenant_id is the expected backfill cause", () => {
    const drift = { rowCount: 2, sample: ["a.tenant_id", "b.tenant_id"] };
    expect(columnDriftLikelyCause(drift)).toMatch(EXPECTED);
  });

  test("a truncated all-tenant_id sample may hide other drift outside it", () => {
    const drift = { rowCount: 50, sample: ["a.tenant_id", "b.tenant_id"] };
    expect(columnDriftLikelyCause(drift)).toMatch(LIKELY);
  });

  test("an empty sample is never reported as the expected cause", () => {
    expect(columnDriftLikelyCause({ rowCount: 3, sample: [] })).toMatch(LIKELY);
  });

  test("a non-tenant column in the sample is reported as likely legacy drift", () => {
    const drift = { rowCount: 2, sample: ["a.tenant_id", "b.title"] };
    expect(columnDriftLikelyCause(drift)).toMatch(LIKELY);
  });
});
