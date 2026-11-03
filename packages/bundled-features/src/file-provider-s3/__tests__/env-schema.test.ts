import { describe, expect, test } from "bun:test";
import { isAcceptableS3Endpoint } from "../env-schema.ts";

describe("isAcceptableS3Endpoint", () => {
  test("outside production a compose hostname over http is accepted", () => {
    expect(isAcceptableS3Endpoint("http://minio:9000", false)).toBe(true);
  });

  test("in production http on a remote host is rejected", () => {
    expect(isAcceptableS3Endpoint("http://minio:9000", true)).toBe(false);
  });

  test("in production https and loopback http stay accepted", () => {
    expect(isAcceptableS3Endpoint("https://s3.example.com", true)).toBe(true);
    expect(isAcceptableS3Endpoint("http://localhost:9000", true)).toBe(true);
  });

  test("ignores the ambient process NODE_ENV", () => {
    const original = process.env["NODE_ENV"];
    delete process.env["NODE_ENV"];
    try {
      expect(isAcceptableS3Endpoint("http://s3.example.com", true)).toBe(false);
    } finally {
      if (original !== undefined) process.env["NODE_ENV"] = original;
    }
  });
});
