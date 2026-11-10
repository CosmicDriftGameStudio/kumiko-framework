import { describe, expect, test } from "bun:test";
import { COMPANY_DATA_KEYS } from "../../tenant/company-config.ts";
import { COMPANY_PLACEHOLDERS } from "../web/constants.ts";

describe("COMPANY_PLACEHOLDERS", () => {
  test("names exactly the tenant company config keys", () => {
    expect([...COMPANY_PLACEHOLDERS]).toEqual([...COMPANY_DATA_KEYS]);
  });
});
