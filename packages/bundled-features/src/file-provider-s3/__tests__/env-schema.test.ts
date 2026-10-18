import { afterEach, describe, expect, test } from "bun:test";
import { s3EndpointSchema } from "../env-schema.ts";

describe("s3EndpointSchema", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = originalNodeEnv;
  });

  test("outside production a compose hostname over http is accepted", () => {
    process.env["NODE_ENV"] = "development";
    expect(s3EndpointSchema.safeParse("http://minio:9000").success).toBe(true);
  });

  test("in production http on a remote host is rejected", () => {
    process.env["NODE_ENV"] = "production";
    expect(s3EndpointSchema.safeParse("http://minio:9000").success).toBe(false);
  });

  test("in production https and loopback http stay accepted", () => {
    process.env["NODE_ENV"] = "production";
    expect(s3EndpointSchema.safeParse("https://s3.example.com").success).toBe(true);
    expect(s3EndpointSchema.safeParse("http://localhost:9000").success).toBe(true);
  });
});
