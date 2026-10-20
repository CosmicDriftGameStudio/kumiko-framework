import { describe, expect, test } from "bun:test";
import { resolveTrustedProxyHops } from "../trusted-proxy-hops.ts";

const unset = { option: undefined, authOption: undefined, envValue: undefined };

describe("resolveTrustedProxyHops", () => {
  test("the option wins over the auth option and the env value", () => {
    expect(
      resolveTrustedProxyHops({ option: 2, authOption: 1, envValue: "3", nodeEnv: "production" }),
    ).toBe(2);
  });

  test("falls back to the auth option, then to the env value", () => {
    expect(
      resolveTrustedProxyHops({ ...unset, authOption: 1, envValue: "3", nodeEnv: "production" }),
    ).toBe(1);
    expect(resolveTrustedProxyHops({ ...unset, envValue: "3", nodeEnv: "production" })).toBe(3);
  });

  test("an explicit 0 is accepted in production", () => {
    expect(resolveTrustedProxyHops({ ...unset, envValue: "0", nodeEnv: "production" })).toBe(0);
    expect(resolveTrustedProxyHops({ ...unset, option: 0, nodeEnv: "production" })).toBe(0);
  });

  test("production without any source throws and names the option and the env var", () => {
    expect(() => resolveTrustedProxyHops({ ...unset, nodeEnv: "production" })).toThrow(
      /trustedProxyHops.*KUMIKO_TRUSTED_PROXY_HOPS/,
    );
  });

  test("outside production an unset value stays undefined", () => {
    expect(resolveTrustedProxyHops({ ...unset, nodeEnv: "development" })).toBeUndefined();
    expect(resolveTrustedProxyHops({ ...unset, nodeEnv: undefined })).toBeUndefined();
  });
});
