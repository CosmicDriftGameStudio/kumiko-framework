import { describe, expect, test } from "bun:test";
import { createSecretsFeature } from "../feature";

describe("createSecretsFeature access/roles precedence", () => {
  test("roles-only adopts the host role vocabulary", () => {
    expect(() => createSecretsFeature({ roles: ["Admin"] })).not.toThrow();
  });

  test("access-only is accepted", () => {
    expect(() => createSecretsFeature({ access: { openToAll: true } })).not.toThrow();
  });

  test("access + roles together fail fast", () => {
    expect(() => createSecretsFeature({ access: { openToAll: true }, roles: ["Admin"] })).toThrow(
      /either `access` or `roles`/,
    );
  });
});
