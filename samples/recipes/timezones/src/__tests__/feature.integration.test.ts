// Timezones Sample — Integration Test
// Proves: located round-trip with computed UTC across DST, all four time field
// types preserved, IANA validation at the write boundary, the todayRange
// day-window query, and the fromCoordinates GeoTzProvider seam.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import type { GeoTzProvider } from "@cosmicdrift/kumiko-framework/time";
import { deliveryEntity, timezonesFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;

// A stand-in for an offline geo-tz library: positive latitude → northern
// example zone, negative → southern. Real providers resolve true lat/lng;
// this one only has to prove the injection seam threads through to ctx.tz.
const fakeGeoTz: GeoTzProvider = {
  fromCoordinates: (coords) => (coords.latitude >= 0 ? "Europe/Berlin" : "America/Sao_Paulo"),
};

beforeAll(async () => {
  stack = await setupTestStack({
    features: [timezonesFeature],
    extraContext: { geoTzProvider: fakeGeoTz },
  });
  await unsafeCreateEntityTable(stack.db, deliveryEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
});

// --- locatedTimestamp round-trip ---

describe("located round-trip", () => {
  test("write { at, tz } reads back { at, tz, utc } with UTC computed across DST", async () => {
    // Lisbon is on WEST (UTC+1) on 2026-04-15, so 10:00 local is 09:00 UTC.
    const created = await stack.http.writeOk<SaveContext>(
      "timezones:write:delivery:create",
      { label: "DST check", pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } },
      admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "timezones:query:delivery:detail",
      { id: created.id },
      admin,
    );

    const pickup = detail["pickup"] as { at: string; tz: string; utc: string };
    expect(pickup.tz).toBe("Europe/Lisbon");
    expect(pickup.at).toBe("2026-04-15T10:00:00");
    expect(pickup.utc).toBe("2026-04-15T09:00:00Z");
  });
});

// --- all four time field types ---

describe("field types", () => {
  test("date, timestamp and tz fields each preserve their value", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "timezones:write:delivery:create",
      {
        label: "Full record",
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
        dropoffOn: "2026-04-20",
        bookedAt: "2026-04-15T08:30:00Z",
        homeZone: "Europe/Berlin",
      },
      admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "timezones:query:delivery:detail",
      { id: created.id },
      admin,
    );

    // A `date` field carries a calendar day; the read serializes it as an ISO
    // instant at UTC midnight ("2026-04-20T00:00:00Z").
    expect(detail["dropoffOn"]).toBe("2026-04-20T00:00:00Z");
    expect(detail["homeZone"]).toBe("Europe/Berlin");
    expect(detail["bookedAt"]).toBe("2026-04-15T08:30:00Z");
  });
});

// --- IANA validation at the write boundary ---

describe("IANA validation", () => {
  test("invalid bare tz field is rejected with validation_error", async () => {
    const error = await stack.http.writeErr(
      "timezones:write:delivery:create",
      {
        label: "Bad zone",
        pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" },
        homeZone: "Mars/Olympus",
      },
      admin,
    );
    expect(error.code).toBe("validation_error");
  });

  test("invalid located-field tz is rejected with validation_error", async () => {
    const error = await stack.http.writeErr(
      "timezones:write:delivery:create",
      { label: "Bad located zone", pickup: { at: "2026-04-15T10:00:00", tz: "Nowhere/Nope" } },
      admin,
    );
    expect(error.code).toBe("validation_error");
  });
});

// --- ctx.tz.todayRange — day-window query ---

describe("day-window query (todayRange)", () => {
  test("returns the zone's calendar date and a 24h UTC window", async () => {
    const window = await stack.http.queryOk<{
      zone: string;
      date: string;
      start: string;
      end: string;
    }>("timezones:query:day-window", { zone: "Asia/Tokyo" }, admin);

    expect(window.zone).toBe("Asia/Tokyo");
    expect(window.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(window.start.endsWith("Z")).toBe(true);
    expect(window.end.endsWith("Z")).toBe(true);
    // Tokyo has no DST, so today's window is exactly 24 hours.
    expect(Date.parse(window.end) - Date.parse(window.start)).toBe(24 * 60 * 60 * 1000);
  });

  test("invalid zone is rejected with validation_error, not a raw RangeError", async () => {
    const res = await stack.http.query(
      "timezones:query:day-window",
      { zone: "Nowhere/Nope" },
      admin,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });
});

// --- ctx.tz.fromCoordinates — GeoTzProvider seam ---

describe("fromCoordinates (injected GeoTzProvider)", () => {
  test("northern coordinates resolve to the provider's northern zone", async () => {
    const result = await stack.http.queryOk<{ zone: string }>(
      "timezones:query:zone-at",
      { latitude: 52.52, longitude: 13.405 },
      admin,
    );
    expect(result.zone).toBe("Europe/Berlin");
  });

  test("southern coordinates resolve to the provider's southern zone", async () => {
    const result = await stack.http.queryOk<{ zone: string }>(
      "timezones:query:zone-at",
      { latitude: -23.55, longitude: -46.63 },
      admin,
    );
    expect(result.zone).toBe("America/Sao_Paulo");
  });
});
