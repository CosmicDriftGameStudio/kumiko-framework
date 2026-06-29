// Timezones Sample
// Shows: every time-aware field type on one entity — a UTC instant, a bare
// calendar date, a wall-clock-at-a-place, and an IANA zone name — plus the
// ctx.tz handler API for the two operations a feature actually reaches for:
// a day-window query (todayRange) and resolving lat/lng to a zone
// (fromCoordinates, via an injected GeoTzProvider).

import {
  createDateField,
  createEntity,
  createLocatedTimestampField,
  createTextField,
  createTimestampField,
  createTzField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// One delivery, four kinds of time:
//   pickup    — wall-clock + IANA zone at the pickup location. ONE schema
//               field → TWO columns (pickup_utc + pickup_tz) → THREE read
//               fields ({ at, tz, utc }). The renderer gives it a date-time +
//               zone picker; the write boundary computes utc from at+tz.
//   dropoffOn — a calendar date with no time and no zone (Temporal.PlainDate).
//   bookedAt  — the UTC instant the booking was made (Temporal.Instant).
//   homeZone  — the courier's IANA zone, a bare validated zone name.
export const deliveryEntity = createEntity({
  table: "read_sample_deliveries",
  fields: {
    label: createTextField({ required: true }),
    pickup: createLocatedTimestampField({ required: true }),
    dropoffOn: createDateField(),
    bookedAt: createTimestampField(),
    homeZone: createTzField(),
  },
  softDelete: true,
});

const write = { access: { roles: ["Admin", "User"] } } as const;
const adminWrite = { access: { roles: ["Admin"] } } as const;
const openRead = { access: { openToAll: true } } as const;

export const timezonesFeature = defineFeature("timezones", (r) => {
  r.entity("delivery", deliveryEntity);

  // Declarative CRUD. create/update accept the located field as { at, tz };
  // the schema-builder computes the UTC instant at the write boundary, so no
  // hand-rolled Temporal lives in your handler. An invalid IANA name (in
  // pickup.tz or homeZone) is rejected there with a validation_error.
  r.writeHandler(defineEntityCreateHandler("delivery", deliveryEntity, write));
  r.writeHandler(defineEntityUpdateHandler("delivery", deliveryEntity, write));
  r.writeHandler(defineEntityDeleteHandler("delivery", deliveryEntity, adminWrite));
  r.queryHandler(defineEntityListHandler("delivery", deliveryEntity, openRead));
  r.queryHandler(defineEntityDetailHandler("delivery", deliveryEntity, openRead));

  // ctx.tz in a handler — the day-window query. "What UTC range is *today* in
  // this zone?" todayRange crosses DST and the date line correctly; the
  // start/end instants feed straight into a BETWEEN over the pickup_utc column.
  // Named without an entity prefix: it's a feature-level utility query, not a
  // delivery read, so it returns its own shape unfiltered.
  r.queryHandler(
    "day-window",
    z.object({ zone: z.string() }),
    async (query, ctx) => {
      const { start, end } = ctx.tz.todayRange(query.payload.zone);
      return {
        zone: query.payload.zone,
        date: ctx.tz.today(query.payload.zone).toString(),
        start: start.toString(),
        end: end.toString(),
      };
    },
    openRead,
  );

  // ctx.tz.fromCoordinates — the GeoTzProvider seam. Inject a provider via the
  // app context (buildServer({ context: { geoTzProvider } }) or
  // runProdApp/runDevApp({ extraContext: { geoTzProvider } })) and lat/lng
  // resolves to an IANA zone; with no provider it throws a clear error.
  r.queryHandler(
    "zone-at",
    z.object({ latitude: z.number(), longitude: z.number() }),
    async (query, ctx) => {
      const zone = await ctx.tz.fromCoordinates(query.payload);
      return { zone };
    },
    openRead,
  );
});
