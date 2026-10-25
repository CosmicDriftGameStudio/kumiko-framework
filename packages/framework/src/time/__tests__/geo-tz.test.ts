// ctx.tz.fromCoordinates / fromAddress — the GeoTzProvider injection seam.
// The framework only provides the interface and delegation; without a provider,
// it throws explicitly instead of silently guessing.

import { beforeAll, describe, expect, test } from "bun:test";
import type { GeoTzProvider } from "../geo-tz.ts";
import { ensureTemporalPolyfill } from "../polyfill.ts";
import { createTzContext } from "../tz-context.ts";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

const BERLIN = { latitude: 52.52, longitude: 13.405 };

describe("ctx.tz — GeoTzProvider seam", () => {
  test("fromCoordinates delegates to the provider (sync)", async () => {
    const provider: GeoTzProvider = { fromCoordinates: () => "Europe/Berlin" };
    const tz = createTzContext({ geoTz: provider });
    expect(await tz.fromCoordinates(BERLIN)).toBe("Europe/Berlin");
  });

  test("fromCoordinates delegates to the provider (async)", async () => {
    const provider: GeoTzProvider = { fromCoordinates: async () => "Asia/Tokyo" };
    const tz = createTzContext({ geoTz: provider });
    expect(await tz.fromCoordinates({ latitude: 35.68, longitude: 139.69 })).toBe("Asia/Tokyo");
  });

  test("fromCoordinates passes the coordinates through unchanged", async () => {
    let seen: { latitude: number; longitude: number } | undefined;
    const provider: GeoTzProvider = {
      fromCoordinates: (c) => {
        seen = c;
        return "Europe/Berlin";
      },
    };
    await createTzContext({ geoTz: provider }).fromCoordinates(BERLIN);
    expect(seen).toEqual(BERLIN);
  });

  test("fromCoordinates throws without a provider", async () => {
    const tz = createTzContext();
    await expect(tz.fromCoordinates(BERLIN)).rejects.toThrow(/GeoTzProvider/);
  });

  test("fromAddress delegates when the provider supports it", async () => {
    const provider: GeoTzProvider = {
      fromCoordinates: () => "UTC",
      fromAddress: (a) => (a.country === "PT" ? "Europe/Lisbon" : "UTC"),
    };
    const tz = createTzContext({ geoTz: provider });
    expect(await tz.fromAddress({ country: "PT" })).toBe("Europe/Lisbon");
  });

  test("fromAddress throws when the provider has no fromAddress (offline lat/lng)", async () => {
    const provider: GeoTzProvider = { fromCoordinates: () => "UTC" };
    const tz = createTzContext({ geoTz: provider });
    // Regression (680/2): this message must say the PROVIDER lacks
    // fromAddress, not the misleading "no provider configured" message.
    await expect(tz.fromAddress({ country: "PT" })).rejects.toThrow(
      /GeoTzProvider that implements fromAddress/,
    );
  });

  test("fromAddress throws without a provider — its own message, not the provider-without-fromAddress message", async () => {
    const tz = createTzContext();
    await expect(tz.fromAddress({ country: "PT" })).rejects.toThrow(
      /requires a GeoTzProvider — inject one/,
    );
  });
});
