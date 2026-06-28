// ctx.tz.fromCoordinates / fromAddress — der GeoTzProvider-Injection-Seam.
// Das Framework liefert nur Interface + Delegation; ohne Provider wird klar
// geworfen statt still zu raten.

import { beforeAll, describe, expect, test } from "bun:test";
import type { GeoTzProvider } from "../geo-tz";
import { ensureTemporalPolyfill } from "../polyfill";
import { createTzContext } from "../tz-context";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

const BERLIN = { latitude: 52.52, longitude: 13.405 };

describe("ctx.tz — GeoTzProvider seam", () => {
  test("fromCoordinates delegiert an den Provider (sync)", async () => {
    const provider: GeoTzProvider = { fromCoordinates: () => "Europe/Berlin" };
    const tz = createTzContext({ geoTz: provider });
    expect(await tz.fromCoordinates(BERLIN)).toBe("Europe/Berlin");
  });

  test("fromCoordinates delegiert an den Provider (async)", async () => {
    const provider: GeoTzProvider = { fromCoordinates: async () => "Asia/Tokyo" };
    const tz = createTzContext({ geoTz: provider });
    expect(await tz.fromCoordinates({ latitude: 35.68, longitude: 139.69 })).toBe("Asia/Tokyo");
  });

  test("fromCoordinates reicht die Koordinaten unverändert durch", async () => {
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

  test("fromCoordinates wirft ohne Provider", async () => {
    const tz = createTzContext();
    await expect(tz.fromCoordinates(BERLIN)).rejects.toThrow(/GeoTzProvider/);
  });

  test("fromAddress delegiert wenn der Provider es unterstützt", async () => {
    const provider: GeoTzProvider = {
      fromCoordinates: () => "UTC",
      fromAddress: (a) => (a.country === "PT" ? "Europe/Lisbon" : "UTC"),
    };
    const tz = createTzContext({ geoTz: provider });
    expect(await tz.fromAddress({ country: "PT" })).toBe("Europe/Lisbon");
  });

  test("fromAddress wirft wenn der Provider kein fromAddress hat (offline lat/lng)", async () => {
    const provider: GeoTzProvider = { fromCoordinates: () => "UTC" };
    const tz = createTzContext({ geoTz: provider });
    await expect(tz.fromAddress({ country: "PT" })).rejects.toThrow(/fromAddress/);
  });

  test("fromAddress wirft ohne Provider", async () => {
    const tz = createTzContext();
    await expect(tz.fromAddress({ country: "PT" })).rejects.toThrow(/GeoTzProvider/);
  });
});
