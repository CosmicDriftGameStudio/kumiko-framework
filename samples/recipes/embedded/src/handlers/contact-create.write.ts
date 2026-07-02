import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { contactEntity, contactTable } from "../entities/contact";

const contactCrud = createEventStoreExecutor(contactTable, contactEntity, {
  entityName: "contact",
});

const addressSchema = z.object({
  street: z.string().min(1),
  zip: z.string().min(1),
  city: z.string().min(1),
  country: z.string().optional(),
});

const billingAddressSchema = z.object({
  street: z.string().min(1),
  zip: z.string().min(1),
  city: z.string().min(1),
  country: z.string().optional(),
  vatId: z.string().optional(),
});

export const contactCreate = defineWriteHandler({
  name: "contact:create",
  schema: z.object({
    name: z.string().min(1),
    email: z.email().optional(),
    address: addressSchema,
    billingAddress: billingAddressSchema.optional(),
  }),
  access: { roles: ["Admin"] },
  // Embedded fields (address/billingAddress) arrive as objects — already the
  // combined API form the executor expects; it flattens them into the read row.
  handler: async (event, ctx) => contactCrud.create(event.payload, event.user, ctx.db),
});
