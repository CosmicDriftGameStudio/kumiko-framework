import {
  createDateField,
  createEntity,
  createLocatedTimestampField,
  createTextField,
  createTimestampField,
  createTzField,
  defineEntityDeleteHandler,
  defineFeature,
  registerEntityCrud,
} from "@cosmicdrift/kumiko-framework/engine";
import { isValidIanaTimeZone } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";

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
  registerEntityCrud(r, "delivery", deliveryEntity, {
    write,
    read: openRead,
    verbs: { delete: false, restore: false },
  });
  r.writeHandler(defineEntityDeleteHandler("delivery", deliveryEntity, adminWrite));

  r.queryHandler(
    "day-window",
    z.object({
      zone: z.string().refine(isValidIanaTimeZone, { message: "Invalid IANA timezone" }),
    }),
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
