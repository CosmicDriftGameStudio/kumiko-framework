import { describe, expect, test } from "bun:test";
import { toContentfulStatus } from "../contentful-status.ts";

describe("toContentfulStatus", () => {
  test("keeps statuses Hono can answer with a body", () => {
    expect(toContentfulStatus(409)).toBe(409);
    expect(toContentfulStatus(503)).toBe(503);
  });

  test("maps contentless statuses to 500", () => {
    expect(toContentfulStatus(204)).toBe(500);
  });

  test("maps out-of-range statuses to 500", () => {
    expect(toContentfulStatus(99)).toBe(500);
  });
});
