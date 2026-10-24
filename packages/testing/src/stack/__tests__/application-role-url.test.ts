import { describe, expect, test } from "bun:test";
import { applicationRoleUrlOf, TEST_APPLICATION_ROLE } from "../db.ts";

describe("applicationRoleUrlOf", () => {
  test("swaps user and database, keeps password, host, port and query", () => {
    const url = new URL(
      applicationRoleUrlOf(
        "postgres://postgres:secret@db.local:5433/other?sslmode=disable",
        "mydb",
      ),
    );
    expect(url.username).toBe(TEST_APPLICATION_ROLE);
    expect(url.password).toBe("secret");
    expect(url.pathname).toBe("/mydb");
    expect(url.host).toBe("db.local:5433");
    expect(url.search).toBe("?sslmode=disable");
  });

  test("keeps a percent-encoded password intact", () => {
    const url = new URL(applicationRoleUrlOf("postgres://postgres:p%40ss%2Fw%3Ard@h:1/x", "mydb"));
    expect(url.password).toBe("p%40ss%2Fw%3Ard");
    expect(decodeURIComponent(url.password)).toBe("p@ss/w:rd");
  });
});
