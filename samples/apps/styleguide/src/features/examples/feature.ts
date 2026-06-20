// Config-Stresstest (server). Die shadcn-Referenz-Designs NICHT handgebaut,
// sondern 1:1 aus dem Schema erzeugt — um zu sehen was die Auto-UI trägt und
// wo sie an Grenzen stößt. Erster Fall: "Shipping Address" (flache Form,
// 2-Felder-Reihen, Custom-Submit-Label).

import {
  createBooleanField,
  createEntity,
  createSelectField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const shippingEntity = createEntity({
  table: "read_examples_shipping",
  fields: {
    street: createTextField({ required: true }),
    apt: createTextField(),
    city: createTextField({ required: true }),
    state: createSelectField({
      options: ["California", "New York", "Texas", "Washington", "Florida"] as const,
    }),
    zip: createTextField({ required: true }),
    country: createSelectField({
      options: ["United States", "Germany", "United Kingdom", "Canada"] as const,
      default: "United States",
    }),
    saveAsDefault: createBooleanField({ default: false }),
  },
});

const open = { access: { openToAll: true } } as const;

export const examplesFeature = defineFeature("examples", (r) => {
  r.entity("shipping", shippingEntity);
  r.writeHandler(defineEntityCreateHandler("shipping", shippingEntity, open));
  r.writeHandler(defineEntityUpdateHandler("shipping", shippingEntity, open));
  r.queryHandler(defineEntityDetailHandler("shipping", shippingEntity, open));

  // EINE titellose Section: Card-Titel + Subtitle (aus i18n) tragen den
  // Kontext, die Felder fließen direkt darunter. street/apt/saveAsDefault
  // spannen beide Spalten (volle Breite), city/state + zip/country teilen
  // sich je eine Reihe.
  r.screen({
    id: "shipping-edit",
    type: "entityEdit",
    entity: "shipping",
    submitLabel: "examples:shipping:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "street", span: 2 },
            { field: "apt", span: 2 },
            "city",
            "state",
            "zip",
            "country",
            { field: "saveAsDefault", span: 2 },
          ],
        },
      ],
    },
  });

  r.nav({ id: "examples", label: "Examples", order: 30 });
  r.nav({
    id: "shipping",
    label: "Shipping address",
    parent: "examples:nav:examples",
    screen: "examples:screen:shipping-edit",
    icon: "file",
    order: 10,
  });
});
