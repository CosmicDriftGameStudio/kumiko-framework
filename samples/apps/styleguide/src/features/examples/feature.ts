// Config-Stresstest (server). Die shadcn-Referenz-Designs NICHT handgebaut,
// sondern 1:1 aus dem Schema erzeugt — um zu sehen was die Auto-UI trägt und
// wo sie an Grenzen stößt. Erster Fall: "Shipping Address" (flache Form,
// 2-Felder-Reihen, Custom-Submit-Label).

import {
  createBooleanField,
  createDateField,
  createEntity,
  createImageField,
  createLocatedTimestampField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
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

// Profile — testet das Avatar-Image-Upload-Feld (createImageField) in der
// Auto-Form: runde Preview + "Change"-Button, Upload an /api/files.
export const profileEntity = createEntity({
  table: "read_examples_profile",
  fields: {
    avatar: createImageField({ maxSize: "5mb", accept: ["jpg", "jpeg", "png"] }),
    fullName: createTextField({ required: true }),
    // Demo-Daten, kein echtes PII-Encryption-Setup → Plaintext bewusst erlaubt.
    email: createTextField({ required: true, allowPlaintext: "is-business-data" }),
    bio: createTextField({ multiline: { rows: 3 } }),
  },
});

// Delivery — der locatedTimestamp-Picker (Wall-Clock + IANA-Zone, item 10) in
// der Auto-Form. Spiegelt die timezones-Recipe-Entity 1:1 (pickup/dropoffOn/
// bookedAt/homeZone), damit der Docs-Screenshot den eingebetteten Recipe-Code
// zeigt. `pickup` rendert als kombinierter Date-Time + Zone-Picker, die andern
// drei Zeit-Feldtypen als ihre jeweilige Auto-UI-Kontrolle.
export const deliveryEntity = createEntity({
  table: "read_examples_delivery",
  fields: {
    label: createTextField({ required: true }),
    pickup: createLocatedTimestampField({ required: true }),
    dropoffOn: createDateField(),
    bookedAt: createTimestampField(),
    homeZone: createTzField(),
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

  r.entity("profile", profileEntity);
  r.writeHandler(defineEntityCreateHandler("profile", profileEntity, open));
  r.writeHandler(defineEntityUpdateHandler("profile", profileEntity, open));
  r.queryHandler(defineEntityDetailHandler("profile", profileEntity, open));

  r.screen({
    id: "profile-edit",
    type: "entityEdit",
    entity: "profile",
    submitLabel: "examples:profile:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [{ field: "avatar", span: 2 }, "fullName", "email", { field: "bio", span: 2 }],
        },
      ],
    },
  });

  r.entity("delivery", deliveryEntity);
  r.writeHandler(defineEntityCreateHandler("delivery", deliveryEntity, open));
  r.writeHandler(defineEntityUpdateHandler("delivery", deliveryEntity, open));
  r.queryHandler(defineEntityDetailHandler("delivery", deliveryEntity, open));

  r.screen({
    id: "delivery-edit",
    type: "entityEdit",
    entity: "delivery",
    submitLabel: "examples:delivery:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "label", span: 2 },
            { field: "pickup", span: 2 },
            "dropoffOn",
            "homeZone",
            { field: "bookedAt", span: 2 },
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
  r.nav({
    id: "profile",
    label: "Profile",
    parent: "examples:nav:examples",
    screen: "examples:screen:profile-edit",
    icon: "file",
    order: 20,
  });
  r.nav({
    id: "delivery",
    label: "Located date-time",
    parent: "examples:nav:examples",
    screen: "examples:screen:delivery-edit",
    icon: "file",
    order: 30,
  });
});
