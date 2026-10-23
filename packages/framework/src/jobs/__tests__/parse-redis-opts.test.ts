import { describe, expect, test } from "bun:test";
import { parseRedisOpts } from "../job-runner-helpers.ts";

describe("parseRedisOpts", () => {
  test("keeps host, port and db of a plain URL", () => {
    expect(parseRedisOpts("redis://cache:6380/2")).toEqual({ host: "cache", port: 6380, db: 2 });
  });

  test("defaults the port and leaves out credentials the URL does not carry", () => {
    expect(parseRedisOpts("redis://cache")).toEqual({ host: "cache", port: 6379 });
  });

  test("carries a URL-encoded password without a username", () => {
    const password = "p@ss:w/rd%";
    expect(parseRedisOpts(`redis://:${encodeURIComponent(password)}@cache:6379`)).toEqual({
      host: "cache",
      port: 6379,
      password,
    });
  });

  test("carries an ACL username and password", () => {
    expect(parseRedisOpts("redis://app:secret@cache:6379/1")).toEqual({
      host: "cache",
      port: 6379,
      db: 1,
      username: "app",
      password: "secret",
    });
  });

  test("turns on TLS for rediss URLs", () => {
    expect(parseRedisOpts("rediss://cache:6380").tls).toEqual({});
  });
});
