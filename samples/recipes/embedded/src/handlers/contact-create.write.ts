import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { contactTable } from "../entities/contact";

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
  handler: async (event, ctx) => {
    const [row] = await ctx.db
      .insert(contactTable)
      .values({
        ...event.payload,
        insertedById: event.user.id,
        insertedAt: Temporal.Now.instant(),
      })
      .returning();
    const data = row as Record<string, unknown>;
    return {
      isSuccess: true,
      data: {
        id: data["id"] as number,
        data,
        changes: event.payload,
        previous: {},
        isNew: true,
        entityName: "contact",
      },
    };
  },
});
