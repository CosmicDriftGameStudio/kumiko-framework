import { describe, expect, test } from "bun:test";
import { createConnectorRoutes } from "../routes.ts";

describe("createConnectorRoutes verificationUri", () => {
  test("a relative verificationUri throws when the routes are mounted", () => {
    expect(() => createConnectorRoutes({ verificationUri: "/connector-pair" })).toThrow(
      /verificationUri must be an absolute URL/,
    );
  });

  test("an absolute verificationUri mounts", () => {
    expect(
      createConnectorRoutes({ verificationUri: "https://app.example.com/base/connector-pair" })
        .length,
    ).toBeGreaterThan(0);
  });
});
