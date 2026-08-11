import {
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const listingEntity = createEntity({
  table: "read_sample_listings",
  fields: {
    title: createTextField({ required: true, searchable: true }),
    category: createSelectField({
      options: ["electronics", "furniture", "vehicles", "other"] as const,
      required: true,
    }),
    price: createNumberField({ required: true }),
    condition: createSelectField({
      options: ["new", "used"] as const,
      default: "used",
    }),
  },
});
